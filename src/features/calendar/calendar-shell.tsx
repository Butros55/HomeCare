'use client';

import type { DatesSetArg, EventClickArg, EventContentArg, EventInput } from '@fullcalendar/core';
import deLocale from '@fullcalendar/core/locales/de';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import multiMonthPlugin from '@fullcalendar/multimonth';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import {
  AlertTriangle,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { Checkbox, Switch } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn, colorFromId } from '@/lib/utils';
import type { CalendarEventDto } from '@/server/services/calendar-service';
import { rescheduleAppointmentAction } from '@/server/actions/appointment-actions';
import { saveCalendarPreferenceAction } from '@/server/actions/preference-actions';
import { AppointmentDrawer } from '@/features/calendar/appointment-drawer';
import { AppointmentFormDialog } from '@/features/calendar/appointment-form-dialog';

const VIEWS = [
  { key: 'multiMonthYear', label: 'Jahr' },
  { key: 'dayGridMonth', label: 'Monat' },
  { key: 'timeGridWeek', label: 'Woche' },
  { key: 'timeGridDay', label: 'Tag' },
  { key: 'listWeek', label: 'Liste' },
] as const;

/**
 * Fehlermeldung beim Verschieben inkl. konkreter Konfliktgründe – der Nutzer
 * sieht immer, WESHALB der Termin nicht verschoben werden konnte.
 */
function rescheduleFailureMessage(result: { message: string; details?: unknown }): string {
  const details = result.details as
    | { conflicts?: { message: string; severity?: string }[] }
    | undefined;
  const reasons = (details?.conflicts ?? [])
    .filter((conflict) => conflict.severity !== 'INFO')
    .map((conflict) => conflict.message);
  return reasons.length > 0 ? `${result.message} ${reasons.join(' ')}` : result.message;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'var(--color-status-hold)',
  PLANNED: 'var(--color-status-todo)',
  CONFIRMED: 'var(--color-status-review)',
  IN_PROGRESS: 'var(--color-status-progress)',
  COMPLETED: 'var(--color-status-done)',
  CANCELLED: 'var(--color-status-stuck)',
  NO_SHOW: 'var(--color-status-stuck)',
};

export interface CalendarShellProps {
  canManage: boolean;
  isEmployeeOnly: boolean;
  ownEmployeeId: string | null;
  /** Reduziertes UI (Solo/Mitarbeiter): Termine automatisch selbst zuweisen. */
  simplePlanning?: boolean;
  initialView: string;
  initialColorBy: 'customer' | 'employee' | 'status' | 'team';
  employees: { id: string; name: string }[];
  customers: { id: string; name: string; color: string }[];
  teamManagers: { id: string; name: string }[];
  urlParams: {
    neu: boolean;
    kunde?: string;
    serie?: boolean;
    mitarbeiter?: string;
    termin?: string;
    zuweisung?: 'unassigned' | 'declined';
    konflikte?: boolean;
  };
}

export function CalendarShell(props: CalendarShellProps) {
  const calendarRef = React.useRef<FullCalendar>(null);
  const api = () => calendarRef.current?.getApi();

  const [view, setView] = React.useState(props.initialView);
  const [title, setTitle] = React.useState('');
  const [colorBy, setColorBy] = React.useState(props.initialColorBy);
  const [monthAsAgenda, setMonthAsAgenda] = React.useState(false);
  const [filterOpen, setFilterOpen] = React.useState(false);

  // Filterzustand (URL-Presets vom Dashboard vorbelegt).
  const [employeeId, setEmployeeId] = React.useState(props.urlParams.mitarbeiter ?? '');
  const [customerId, setCustomerId] = React.useState('');
  const [teamId, setTeamId] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [assignment, setAssignment] = React.useState<string>(props.urlParams.zuweisung ?? '');
  const [conflictsOnly, setConflictsOnly] = React.useState(props.urlParams.konflikte ?? false);
  const [onlyMine, setOnlyMine] = React.useState(false);

  const activeFilterCount = [
    employeeId,
    customerId,
    teamId,
    statusFilter,
    assignment,
    conflictsOnly ? '1' : '',
    onlyMine ? '1' : '',
  ].filter(Boolean).length;

  // Dialoge & Drawer.
  const [createOpen, setCreateOpen] = React.useState(props.urlParams.neu && props.canManage);
  const [createPrefill, setCreatePrefill] = React.useState<{
    customerId?: string;
    date?: string;
    startTime?: string;
    series?: boolean;
  }>({ customerId: props.urlParams.kunde, series: props.urlParams.serie });
  const [drawerAppointmentId, setDrawerAppointmentId] = React.useState<string | null>(
    props.urlParams.termin ?? null,
  );

  // Drag-and-drop-Bestätigung bei Warnungen.
  const [pendingMove, setPendingMove] = React.useState<{
    id: string;
    start: string;
    end: string;
    conflicts: { message: string }[];
    revert: () => void;
  } | null>(null);
  const [movePending, setMovePending] = React.useState(false);

  const filtersRef = React.useRef({
    employeeId,
    customerId,
    teamId,
    statusFilter,
    assignment,
    conflictsOnly,
    onlyMine,
  });

  const fetchEvents = React.useCallback(
    async (info: { startStr: string; endStr: string }): Promise<EventInput[]> => {
      const f = filtersRef.current;
      const params = new URLSearchParams({ start: info.startStr, end: info.endStr });
      if (f.employeeId) params.set('employeeId', f.employeeId);
      if (f.customerId) params.set('customerId', f.customerId);
      if (f.teamId) params.set('teamId', f.teamId);
      if (f.statusFilter) params.set('status', f.statusFilter);
      if (f.assignment) params.set('assignment', f.assignment);
      if (f.conflictsOnly) params.set('conflictsOnly', '1');
      if (f.onlyMine) params.set('onlyMine', '1');

      const response = await fetch(`/api/calendar/events?${params.toString()}`);
      if (!response.ok) {
        toast.error('Kalenderdaten konnten nicht geladen werden.');
        return [];
      }
      const data = (await response.json()) as { events: CalendarEventDto[] };
      return data.events.map((event) => toEventInput(event, colorBy));
    },
    [colorBy],
  );

  // Mobil sind Raster-Ansichten unhandlich → beim Start auf die Agenda-Liste
  // wechseln (ohne die Desktop-Präferenz zu überschreiben).
  React.useEffect(() => {
    if (typeof window === 'undefined' || window.innerWidth >= 640) return;
    if (props.initialView !== 'timeGridWeek' && props.initialView !== 'multiMonthYear') return;
    const timer = setTimeout(() => {
      calendarRef.current?.getApi().changeView('listWeek');
    }, 0);
    return () => clearTimeout(timer);
  }, [props.initialView]);

  // Bei Filter-/Farbwechsel: Ref aktualisieren und neu laden.
  React.useEffect(() => {
    filtersRef.current = {
      employeeId,
      customerId,
      teamId,
      statusFilter,
      assignment,
      conflictsOnly,
      onlyMine,
    };
    api()?.refetchEvents();
  }, [employeeId, customerId, teamId, statusFilter, assignment, conflictsOnly, onlyMine, colorBy]);

  const changeView = (next: string) => {
    const target = next === 'dayGridMonth' && monthAsAgenda ? 'listMonth' : next;
    api()?.changeView(target);
    setView(next);
    void saveCalendarPreferenceAction({ calendarView: next as never });
  };

  const toggleAgenda = (agenda: boolean) => {
    setMonthAsAgenda(agenda);
    if (view === 'dayGridMonth') {
      api()?.changeView(agenda ? 'listMonth' : 'dayGridMonth');
    }
  };

  const resetFilters = () => {
    setEmployeeId('');
    setCustomerId('');
    setTeamId('');
    setStatusFilter('');
    setAssignment('');
    setConflictsOnly(false);
    setOnlyMine(false);
  };

  const handleDatesSet = (arg: DatesSetArg) => {
    setTitle(arg.view.title);
    // navLinks können die Ansicht intern wechseln → Pillen synchron halten.
    const type = arg.view.type;
    if (type === 'listMonth') {
      setView('dayGridMonth');
    } else if (VIEWS.some((entry) => entry.key === type)) {
      setView(type);
    }
  };

  const handleDateClick = (arg: DateClickArg) => {
    if (!props.canManage) return;
    const date = arg.dateStr.slice(0, 10);
    const startTime = arg.allDay ? '09:00' : arg.dateStr.slice(11, 16) || '09:00';
    setCreatePrefill({ date, startTime });
    setCreateOpen(true);
  };

  const handleEventClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    setDrawerAppointmentId(arg.event.id);
  };

  const handleMove = async (info: {
    event: { id: string; startStr: string; endStr: string };
    revert: () => void;
  }) => {
    const result = await rescheduleAppointmentAction(
      info.event.id,
      info.event.startStr,
      info.event.endStr,
      false,
    );
    if (!result.ok) {
      // Grund der Ablehnung mit anzeigen (nicht nur „Konflikt").
      toast.error(rescheduleFailureMessage(result));
      info.revert();
      return;
    }
    if (result.data.requiresConfirmation) {
      setPendingMove({
        id: info.event.id,
        start: info.event.startStr,
        end: info.event.endStr,
        conflicts: result.data.conflicts,
        revert: info.revert,
      });
      return;
    }
    toast.success('Termin verschoben.');
  };

  const refetch = () => api()?.refetchEvents();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Kopfzeile: eine ruhige Zeile – Details stecken im Filter-Dialog. */}
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-4">
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Vorheriger Zeitraum"
            onClick={() => api()?.prev()}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Nächster Zeitraum"
            onClick={() => api()?.next()}
          >
            <ChevronRight aria-hidden />
          </Button>
          <Button variant="secondary" onClick={() => api()?.today()}>
            Heute
          </Button>
        </div>

        <h1 className="order-last w-full min-w-0 truncate text-center text-[length:var(--text-lg)] font-semibold lg:order-none lg:w-auto lg:flex-1 lg:text-left">
          {title}
        </h1>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div
            className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-[var(--color-panel-sunken)] p-1 scrollbar-none"
            role="group"
            aria-label="Kalenderansicht"
          >
            {VIEWS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => changeView(entry.key)}
                aria-pressed={view === entry.key}
                className={cn(
                  'h-7 shrink-0 rounded-full px-3 text-[length:var(--text-sm)] transition-colors pointer-coarse:h-9 pointer-coarse:px-3.5',
                  // Mobil reduziert: Jahr & Woche erst ab sm (Monat/Tag/Liste genügen).
                  (entry.key === 'multiMonthYear' || entry.key === 'timeGridWeek') &&
                    'hidden sm:block',
                  view === entry.key
                    ? 'bg-[var(--color-panel)] font-medium text-[var(--color-ink)] shadow-[var(--shadow-panel)]'
                    : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <Button
            variant="secondary"
            onClick={() => setFilterOpen(true)}
            aria-label={`Filter und Ansicht${activeFilterCount > 0 ? `, ${activeFilterCount} aktiv` : ''}`}
          >
            <SlidersHorizontal aria-hidden />
            <span className="hidden sm:inline">Filter</span>
            {activeFilterCount > 0 ? (
              <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-[var(--color-brand)] px-1 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>

          {props.canManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setCreatePrefill({});
                setCreateOpen(true);
              }}
            >
              <CalendarPlus aria-hidden />
              <span className="hidden sm:inline">Termin</span>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Kalender – füllt den Rest, scrollt intern (kein Seiten-Overflow). */}
      <div className="hcp-calendar min-h-0 flex-1 p-3 sm:p-4">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, multiMonthPlugin, interactionPlugin]}
          initialView={props.initialView}
          locale={deLocale}
          headerToolbar={false}
          height="100%"
          expandRows
          stickyHeaderDates
          nowIndicator
          firstDay={1}
          allDaySlot={false}
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          scrollTime="07:30:00"
          slotDuration="00:30:00"
          dayMaxEvents={3}
          moreLinkText={(n) => `+${n} weitere`}
          navLinks
          editable={props.canManage}
          longPressDelay={150}
          eventLongPressDelay={150}
          selectLongPressDelay={150}
          eventResizableFromStart={false}
          events={fetchEvents}
          datesSet={handleDatesSet}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
          eventDrop={(info) => void handleMove(info)}
          eventResize={(info) => void handleMove(info)}
          eventContent={renderEventContent}
          multiMonthMaxColumns={3}
          views={{
            multiMonthYear: { dayMaxEvents: 2 },
            listWeek: { listDayFormat: { weekday: 'long', day: 'numeric', month: 'long' } },
          }}
        />
      </div>

      {/* Filter & Ansicht */}
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent
          title="Filter & Ansicht"
          description="Einstellungen wirken sofort auf den Kalender."
          wide
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="cal-goto">Zu Datum springen</Label>
              <Input
                id="cal-goto"
                type="date"
                onChange={(event) => {
                  if (event.target.value) api()?.gotoDate(event.target.value);
                }}
              />
            </div>
            <div>
              <Label htmlFor="cal-colorby">Farbcodierung</Label>
              <Select
                value={colorBy}
                onValueChange={(value) => {
                  setColorBy(value as typeof colorBy);
                  void saveCalendarPreferenceAction({ calendarColorBy: value as never });
                }}
              >
                <SelectTrigger id="cal-colorby">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">Nach Kunde</SelectItem>
                  <SelectItem value="employee">Nach Mitarbeiter</SelectItem>
                  <SelectItem value="status">Nach Status</SelectItem>
                  <SelectItem value="team">Nach Team</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!props.isEmployeeOnly ? (
              <div>
                <Label htmlFor="cal-employee">Mitarbeiter</Label>
                <Select
                  value={employeeId || 'ALL'}
                  onValueChange={(v) => setEmployeeId(v === 'ALL' ? '' : v)}
                >
                  <SelectTrigger id="cal-employee">
                    <SelectValue placeholder="Alle Mitarbeiter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Alle Mitarbeiter</SelectItem>
                    {props.employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {!props.isEmployeeOnly ? (
              <div>
                <Label htmlFor="cal-customer">Kunde</Label>
                <Select
                  value={customerId || 'ALL'}
                  onValueChange={(v) => setCustomerId(v === 'ALL' ? '' : v)}
                >
                  <SelectTrigger id="cal-customer">
                    <SelectValue placeholder="Alle Kunden" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Alle Kunden</SelectItem>
                    {props.customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {props.teamManagers.length > 0 ? (
              <div>
                <Label htmlFor="cal-team">Team</Label>
                <Select value={teamId || 'ALL'} onValueChange={(v) => setTeamId(v === 'ALL' ? '' : v)}>
                  <SelectTrigger id="cal-team">
                    <SelectValue placeholder="Alle Teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Alle Teams</SelectItem>
                    {props.teamManagers.map((manager) => (
                      <SelectItem key={manager.id} value={manager.id}>
                        Team {manager.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div>
              <Label htmlFor="cal-status">Terminstatus</Label>
              <Select
                value={statusFilter || 'ALL'}
                onValueChange={(v) => setStatusFilter(v === 'ALL' ? '' : v)}
              >
                <SelectTrigger id="cal-status">
                  <SelectValue placeholder="Alle Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Alle Status</SelectItem>
                  <SelectItem value="PLANNED,CONFIRMED,IN_PROGRESS">Aktive</SelectItem>
                  <SelectItem value="PLANNED">Geplant</SelectItem>
                  <SelectItem value="CONFIRMED">Bestätigt</SelectItem>
                  <SelectItem value="IN_PROGRESS">Läuft</SelectItem>
                  <SelectItem value="COMPLETED">Abgeschlossen</SelectItem>
                  <SelectItem value="CANCELLED">Abgesagt</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!props.isEmployeeOnly ? (
              <div>
                <Label htmlFor="cal-assignment">Zuweisung</Label>
                <Select
                  value={assignment || 'ALL'}
                  onValueChange={(v) => setAssignment(v === 'ALL' ? '' : v)}
                >
                  <SelectTrigger id="cal-assignment">
                    <SelectValue placeholder="Alle" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Zugewiesen & offen</SelectItem>
                    <SelectItem value="assigned">Nur zugewiesene</SelectItem>
                    <SelectItem value="unassigned">Nur offene</SelectItem>
                    <SelectItem value="declined">Abgelehnte</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="mt-4 space-y-2.5">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3.5 py-3">
              <span className="flex items-center gap-2 text-[length:var(--text-sm)]">
                <AlertTriangle className="size-4 text-[var(--color-warning)]" aria-hidden />
                Nur Termine mit Konflikten
              </span>
              <Checkbox
                checked={conflictsOnly}
                onCheckedChange={(checked) => setConflictsOnly(checked === true)}
                aria-label="Nur Konflikte anzeigen"
              />
            </label>
            {props.ownEmployeeId && !props.isEmployeeOnly ? (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3.5 py-3">
                <span className="text-[length:var(--text-sm)]">Nur meine Termine</span>
                <Checkbox
                  checked={onlyMine}
                  onCheckedChange={(checked) => setOnlyMine(checked === true)}
                  aria-label="Nur eigene Termine"
                />
              </label>
            ) : null}
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3.5 py-3">
              <span className="text-[length:var(--text-sm)]">
                <span className="block">Monat als Agenda-Liste</span>
                <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                  Vertikal scrollbare Liste statt Monatsraster.
                </span>
              </span>
              <Switch checked={monthAsAgenda} onCheckedChange={toggleAgenda} />
            </label>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={resetFilters} disabled={activeFilterCount === 0}>
              <RotateCcw aria-hidden /> Zurücksetzen
            </Button>
            <Button variant="primary" onClick={() => setFilterOpen(false)}>
              Fertig
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Termin anlegen */}
      {createOpen ? (
        <AppointmentFormDialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) refetch();
          }}
          customers={props.customers}
          employees={props.employees}
          prefill={createPrefill}
          fixedEmployeeId={props.simplePlanning ? props.ownEmployeeId : null}
        />
      ) : null}

      {/* Termin-Drawer */}
      {drawerAppointmentId ? (
        <AppointmentDrawer
          appointmentId={drawerAppointmentId}
          onClose={() => {
            setDrawerAppointmentId(null);
            refetch();
          }}
          canManage={props.canManage}
          employees={props.employees}
          customers={props.customers}
        />
      ) : null}

      {/* Drag-and-drop-Warnungsbestätigung */}
      <ConfirmDialog
        open={pendingMove !== null}
        onOpenChange={(open) => {
          if (!open && pendingMove) {
            pendingMove.revert();
            setPendingMove(null);
          }
        }}
        title="Trotz Warnungen verschieben?"
        description={
          <span className="block space-y-1">
            {pendingMove?.conflicts.map((conflict, index) => (
              <span key={index} className="flex items-start gap-1.5">
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--color-warning)]"
                  aria-hidden
                />
                {conflict.message}
              </span>
            ))}
          </span>
        }
        confirmLabel="Trotzdem verschieben"
        loading={movePending}
        onConfirm={async () => {
          if (!pendingMove) return;
          setMovePending(true);
          const result = await rescheduleAppointmentAction(
            pendingMove.id,
            pendingMove.start,
            pendingMove.end,
            true,
          );
          setMovePending(false);
          if (result.ok && !result.data.requiresConfirmation) {
            toast.success('Termin verschoben.');
            setPendingMove(null);
            refetch();
          } else {
            toast.error(result.ok ? 'Unerwarteter Zustand.' : rescheduleFailureMessage(result));
            pendingMove.revert();
            setPendingMove(null);
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function toEventInput(event: CalendarEventDto, colorBy: string): EventInput {
  let color: string;
  switch (colorBy) {
    case 'employee':
    case 'team':
      color = event.employeeId ? colorFromId(event.employeeId) : 'var(--color-status-hold)';
      break;
    case 'status':
      color = STATUS_COLORS[event.status] ?? 'var(--color-brand)';
      break;
    default:
      color = event.customerColor;
  }
  const cancelled = event.status === 'CANCELLED' || event.status === 'NO_SHOW';
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    textColor: 'var(--color-ink)',
    extendedProps: {
      dotColor: color,
      customerName: event.customerName,
      employeeName: event.employeeName,
      status: event.status,
      assignmentStatus: event.assignmentStatus,
      hasConflict: event.hasConflict,
      unassigned: !event.employeeId,
      cancelled,
      seriesId: event.seriesId,
      city: event.city,
    },
  };
}

function renderEventContent(arg: EventContentArg) {
  const p = arg.event.extendedProps as {
    dotColor: string;
    customerName: string;
    employeeName: string | null;
    hasConflict: boolean;
    unassigned: boolean;
    cancelled: boolean;
  };
  const isList = arg.view.type.startsWith('list');
  return (
    <div
      className={`hcp-event ${p.cancelled ? 'hcp-event-cancelled' : ''} ${p.unassigned ? 'hcp-event-unassigned' : ''}`}
      style={{ ['--event-color' as string]: p.dotColor }}
    >
      <span className="hcp-event-dot" aria-hidden />
      {arg.timeText ? <span className="hcp-event-time">{arg.timeText}</span> : null}
      <span className="hcp-event-title">
        {p.customerName}
        {isList ? ` · ${arg.event.title}` : ''}
        {p.employeeName && isList ? ` · ${p.employeeName}` : ''}
        {p.unassigned ? ' · offen' : ''}
      </span>
      {p.hasConflict ? (
        <span className="hcp-event-conflict" title="Konflikt">
          ⚠
        </span>
      ) : null}
    </div>
  );
}
