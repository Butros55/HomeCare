'use client';

/**
 * ProCalendarShell — verdrahtet den portierten StudyMate-Kalender mit den
 * HomeCare-Daten: lädt Termine über /api/calendar/events (rollierendes
 * 13-Monats-Fenster um den gewählten Monat), öffnet den bestehenden
 * Termin-Drawer bzw. das Terminformular und respektiert die URL-Parameter
 * (?termin=…, ?neu=1, ?kunde=…). Eingebettet in die Seite — die App-Sidebar
 * bleibt sichtbar.
 */

import { addMonths, startOfMonth } from 'date-fns';
import * as React from 'react';

import { CalendarSurfaceSkeleton } from '@/components/layout/page-loading-skeleton';
import { getCalendarEventsAction } from '@/server/actions/calendar-actions';
import type { CalendarEventDto } from '@/server/services/calendar-service';
import { AppointmentDrawer } from '@/features/calendar/appointment-drawer';
import { AppointmentFormDialog } from '@/features/calendar/appointment-form-dialog';
import { ProMonthCalendar } from './month-calendar';
import { ProCalendarSidePanel, type CalendarPanelPage } from './side-panel';
import {
  dayKey,
  PRO_EVENT_KINDS,
  toProEvent,
  type ProCalendarEvent,
  type ProEventKind,
} from './types';

type CalendarViewMode = 'year' | 'month' | 'week' | 'today';

export interface ProCalendarShellProps {
  canManage: boolean;
  ownEmployeeId: string | null;
  /** Reduziertes UI (Solo/Mitarbeiter): Termine automatisch selbst zuweisen. */
  simplePlanning?: boolean;
  /** Alleine-Modus: keine Mitarbeiter-/Annahmelogik und vereinfachte Statusführung. */
  soloMode?: boolean;
  employees: { id: string; name: string }[];
  customers: { id: string; name: string; color: string }[];
  urlParams: {
    neu: boolean;
    kunde?: string;
    serie?: boolean;
    termin?: string;
  };
}

export function ProCalendarShell(props: ProCalendarShellProps) {
  const today = React.useMemo(() => new Date(), []);
  const [viewMode, setViewMode] = React.useState<CalendarViewMode>('month');
  const [selectedKey, setSelectedKey] = React.useState(() => dayKey(today));
  const [month, setMonth] = React.useState(() => startOfMonth(today));

  const [events, setEvents] = React.useState<CalendarEventDto[]>([]);
  const [eventsLoading, setEventsLoading] = React.useState(true);
  const loadedRangeRef = React.useRef<{ start: Date; end: Date } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  const [panelOpen, setPanelOpen] = React.useState(false);
  const [panelPage, setPanelPage] = React.useState<CalendarPanelPage>('calendars');
  const [visibleKinds, setVisibleKinds] = React.useState<Set<ProEventKind>>(
    () => new Set(PRO_EVENT_KINDS),
  );

  const [drawerAppointmentId, setDrawerAppointmentId] = React.useState<string | null>(
    props.urlParams.termin ?? null,
  );
  const [createOpen, setCreateOpen] = React.useState(props.urlParams.neu && props.canManage);
  const [createPrefill, setCreatePrefill] = React.useState<{
    customerId?: string;
    date?: string;
    series?: boolean;
  }>({ customerId: props.urlParams.kunde, series: props.urlParams.serie });

  // Rollierendes Ladefenster: Monat −3 … +9 (~13 Monate, API-Limit 400 Tage).
  // Verlässt der gewählte Monat das geladene Fenster, wird neu zentriert.
  React.useEffect(() => {
    const desiredStart = addMonths(startOfMonth(month), -3);
    const desiredEnd = addMonths(startOfMonth(month), 10);
    const loaded = loadedRangeRef.current;
    const covered =
      loaded &&
      loaded.start.getTime() <= addMonths(startOfMonth(month), -1).getTime() &&
      loaded.end.getTime() >= addMonths(startOfMonth(month), 2).getTime();
    // reloadToken invalidiert über loadedRangeRef (refetch setzt es auf null) –
    // ist das Fenster wieder geladen, lösen weitere Monatswechsel nichts aus.
    if (covered) return;

    let cancelled = false;
    setEventsLoading(true);
    const params = new URLSearchParams({
      start: desiredStart.toISOString(),
      end: desiredEnd.toISOString(),
    });
    fetch(`/api/calendar/events?${params}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { events: CalendarEventDto[] }) => {
        if (cancelled) return;
        loadedRangeRef.current = { start: desiredStart, end: desiredEnd };
        setEvents(data.events);
      })
      .catch(() => {
        if (!cancelled) setEvents((current) => current);
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, reloadToken]);

  const refetch = React.useCallback(() => {
    loadedRangeRef.current = null;
    setReloadToken((token) => token + 1);
  }, []);

  // Optimistisch: gelöschte Termine sofort aus der lokalen Liste entfernen –
  // die Divs verschwinden per State-Update, ganz ohne Refetch/Reload.
  const removeEvents = React.useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setEvents((current) => current.filter((event) => !idSet.has(event.id)));
  }, []);

  // Gezielt: nach einer Änderung nur die betroffenen Termine nachladen und im
  // State ersetzen – nur diese Divs aktualisieren sich, kein kompletter Refetch.
  const upsertEvents = React.useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      getCalendarEventsAction(ids).then((result) => {
        if (!result.ok) {
          refetch();
          return;
        }
        setEvents((current) => [
          ...current.filter((event) => !idSet.has(event.id)),
          ...result.data,
        ]);
      });
    },
    [refetch],
  );

  const proEvents = React.useMemo(
    () => events.map((event) => toProEvent(event, props.soloMode)),
    [events, props.soloMode],
  );
  const filteredEvents = React.useMemo(
    () => proEvents.filter((event) => visibleKinds.has(event.kind)),
    [proEvents, visibleKinds],
  );
  const eventsByDay = React.useMemo(() => {
    const result = new Map<string, ProCalendarEvent[]>();
    for (const event of filteredEvents) {
      const key = dayKey(new Date(event.start));
      const entries = result.get(key) ?? [];
      entries.push(event);
      result.set(key, entries);
    }
    for (const entries of result.values()) {
      entries.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    }
    return result;
  }, [filteredEvents]);
  const conflictDays = React.useMemo(() => {
    const days = new Set<string>();
    for (const event of filteredEvents) {
      if (event.hasConflict) days.add(dayKey(new Date(event.start)));
    }
    return days;
  }, [filteredEvents]);
  const kindCounts = React.useMemo(() => {
    const counts = Object.fromEntries(PRO_EVENT_KINDS.map((kind) => [kind, 0])) as Record<
      ProEventKind,
      number
    >;
    for (const event of proEvents) counts[event.kind] += 1;
    return counts;
  }, [proEvents]);

  const selectedDate = React.useMemo(() => new Date(`${selectedKey}T00:00:00`), [selectedKey]);
  const selectedEvents = eventsByDay.get(selectedKey) ?? [];

  const openPanel = React.useCallback((page: CalendarPanelPage) => {
    setPanelPage(page);
    setPanelOpen(true);
  }, []);

  const toggleKind = React.useCallback((kind: ProEventKind) => {
    setVisibleKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const openEvent = React.useCallback((id: string) => {
    setPanelOpen(false);
    setDrawerAppointmentId(id);
  }, []);

  const startCreate = React.useCallback(
    (key: string) => {
      if (!props.canManage) return;
      setPanelOpen(false);
      setCreatePrefill((current) => ({ ...current, date: key, series: false }));
      setCreateOpen(true);
    },
    [props.canManage],
  );

  const sidePanel = (
    <ProCalendarSidePanel
      open={panelOpen}
      page={panelPage}
      onOpenChange={setPanelOpen}
      onPageChange={setPanelPage}
      selectedDate={selectedDate}
      selectedEvents={selectedEvents}
      visibleKinds={visibleKinds}
      kindCounts={kindCounts}
      soloMode={props.soloMode}
      onToggleKind={toggleKind}
      onOpenEvent={openEvent}
      onCreate={() => startCreate(selectedKey)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {eventsLoading ? (
        <CalendarSurfaceSkeleton />
      ) : (
        <ProMonthCalendar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          selectedKey={selectedKey}
          onSelectedKeyChange={setSelectedKey}
          onMonthChange={setMonth}
          eventsByDay={eventsByDay}
          conflictDays={conflictDays}
          today={today}
          onOpenEvent={openEvent}
          onOpenPanel={openPanel}
          onCreate={startCreate}
          sidePanel={sidePanel}
        />
      )}

      {createOpen ? (
        <AppointmentFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onChanged={(opts) => {
            // Einzelnen neuen Termin gezielt einblenden; neue Serie → Refetch.
            if (!opts?.seriesWide && opts?.appointmentIds?.length) {
              upsertEvents(opts.appointmentIds);
            } else {
              refetch();
            }
          }}
          customers={props.customers}
          employees={props.employees}
          prefill={createPrefill}
          fixedEmployeeId={props.simplePlanning ? props.ownEmployeeId : null}
          soloMode={props.soloMode}
        />
      ) : null}

      {drawerAppointmentId ? (
        <AppointmentDrawer
          appointmentId={drawerAppointmentId}
          onClose={() => setDrawerAppointmentId(null)}
          onChanged={refetch}
          onDeleted={removeEvents}
          onUpsert={upsertEvents}
          canManage={props.canManage}
          soloMode={props.soloMode}
          ownEmployeeId={props.ownEmployeeId}
          employees={props.employees}
          customers={props.customers}
        />
      ) : null}
    </div>
  );
}
