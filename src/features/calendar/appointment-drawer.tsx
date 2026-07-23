'use client';

import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  MapPin,
  Navigation,
  Pencil,
  Phone,
  Repeat,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { DrawerContentSkeleton } from '@/components/layout/page-loading-skeleton';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label, Textarea } from '@/components/ui/input';
import { EntityAvatar } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { QuickCompleteButton } from '@/features/appointments/quick-complete-button';
import { formatDateTime, formatTime, toDateInputValue } from '@/lib/dates';
import { formatMinutesVerbose } from '@/lib/duration';
import { googleMapsDirectionsUrl } from '@/lib/geo';
import { describeRecurrenceRule, parseRuleToForm } from '@/lib/recurrence';
import {
  APPOINTMENT_STATUS,
  ASSIGNMENT_STATUS,
  SIMPLE_APPOINTMENT_STATUS,
  simpleAppointmentStatus,
  statusOf,
} from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import {
  assignEmployeeAction,
  cancelAppointmentAction,
  deleteAppointmentAction,
  duplicateAppointmentAction,
  getAppointmentDetailAction,
  respondToAssignmentAction,
  restoreAppointmentAction,
  updateAppointmentStatusAction,
} from '@/server/actions/appointment-actions';
import {
  applyResolutionForAppointmentAction,
  getAppointmentConflictsAction,
  suggestResolutionForAppointmentAction,
} from '@/server/actions/conflict-actions';
import {
  AppointmentFormDialog,
  type AppointmentEditTarget,
} from '@/features/calendar/appointment-form-dialog';

type Detail = Extract<
  Awaited<ReturnType<typeof getAppointmentDetailAction>>,
  { ok: true }
>['data'];

/**
 * Fehlermeldung inkl. konkreter Konfliktgründe: So sieht der Nutzer immer,
 * WESHALB eine Aktion nicht gespeichert werden konnte (nicht nur „Konflikt").
 */
function failureMessage(result: { message: string; details?: unknown }): string {
  const details = result.details as
    | { conflicts?: { message: string; severity?: string }[] }
    | undefined;
  const reasons = (details?.conflicts ?? [])
    .filter((conflict) => conflict.severity !== 'INFO')
    .map((conflict) => conflict.message);
  if (reasons.length === 0) return result.message;
  return `${result.message} ${reasons.join(' ')}`;
}

/** Detail-Drawer eines Termins mit allen Aktionen (Anforderung 13). */
export function AppointmentDrawer({
  appointmentId,
  onClose,
  canManage,
  soloMode = false,
  ownEmployeeId,
  employees,
  customers,
  onChanged,
  onDeleted,
  onUpsert,
}: {
  appointmentId: string;
  onClose: () => void;
  canManage: boolean;
  soloMode?: boolean;
  ownEmployeeId?: string | null;
  employees: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  /**
   * Nach einer Änderung aufgerufen, um gezielt zu aktualisieren (z. B. nur die
   * Kalender-Events neu laden) statt eines kompletten Reloads. Fallback:
   * router.refresh().
   */
  onChanged?: () => void;
  /**
   * Nach dem Löschen aufgerufen: die IDs verschwinden sofort optimistisch aus
   * dem Kalender (ohne Refetch). Fallback: onChanged/router.refresh.
   */
  onDeleted?: (ids: string[]) => void;
  /**
   * Nach einer Änderung an einzelnen Terminen: nur diese IDs gezielt im
   * Kalender aktualisieren (async, kein kompletter Refetch). Fallback: onChanged.
   */
  onUpsert?: (ids: string[]) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelScope, setCancelScope] = React.useState<'single' | 'following' | 'all'>('single');
  const [cancelReason, setCancelReason] = React.useState('');
  // „Absagen" (bleibt als abgesagt sichtbar) vs. „Löschen" (vollständig entfernen).
  const [cancelMode, setCancelMode] = React.useState<'cancel' | 'delete'>('cancel');
  const [pending, startTransition] = React.useTransition();
  const [assignConflicts, setAssignConflicts] = React.useState<{
    employeeId: string | null;
    conflicts: { message: string }[];
  } | null>(null);
  const [conflictInfo, setConflictInfo] = React.useState<{
    conflicts: { type: string; severity: string; message: string }[];
    canResolve: boolean;
  } | null>(null);
  const [resolution, setResolution] = React.useState<
    | Extract<
        Awaited<ReturnType<typeof suggestResolutionForAppointmentAction>>,
        { ok: true }
      >['data']
    | null
  >(null);
  const [resolving, setResolving] = React.useState(false);

  const loadConflicts = React.useCallback(() => {
    getAppointmentConflictsAction(appointmentId).then((result) => {
      if (result.ok) setConflictInfo(result.data);
      else setConflictInfo(null);
    });
  }, [appointmentId]);

  const load = React.useCallback(() => {
    getAppointmentDetailAction(appointmentId).then((result) => {
      if (result.ok) setDetail(result.data as Detail);
      else {
        toast.error(result.message);
        onClose();
      }
    });
  }, [appointmentId, onClose]);

  React.useEffect(() => {
    load();
    loadConflicts();
  }, [load, loadConflicts]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Kalender gezielt aktualisieren: nur die betroffenen Termin-Divs (async),
  // niemals ein kompletter Refetch/Reload. Fallback-Kette: upsert → changed → router.
  const updateCalendar = (ids: string[]) => {
    if (onUpsert) onUpsert(ids);
    else if (onChanged) onChanged();
    else router.refresh();
  };

  const refresh = () => {
    load();
    loadConflicts();
    updateCalendar([appointmentId]);
  };

  const requestResolution = () => {
    setResolving(true);
    suggestResolutionForAppointmentAction(appointmentId).then((result) => {
      setResolving(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setResolution(result.data);
    });
  };

  const applyResolution = () => {
    setResolving(true);
    applyResolutionForAppointmentAction(appointmentId).then((result) => {
      setResolving(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const { appliedCount, unresolvedCount } = result.data;
      toast.success(
        appliedCount > 0
          ? `${appliedCount} Termin${appliedCount === 1 ? '' : 'e'} umgeplant.${unresolvedCount > 0 ? ` ${unresolvedCount} bleiben offen.` : ''}`
          : 'Keine Termine mussten verschoben werden.',
      );
      setResolution(null);
      load();
      loadConflicts();
      if (appliedCount > 0) {
        // Die Auflösung verschiebt mehrere (fremde) Termine → kompletter Refetch.
        if (onChanged) onChanged();
        else router.refresh();
      } else {
        updateCalendar([appointmentId]);
      }
    });
  };

  const changeStatus = (status: Parameters<typeof updateAppointmentStatusAction>[1]) => {
    startTransition(async () => {
      const result = await updateAppointmentStatusAction(appointmentId, status);
      if (result.ok) {
        toast.success('Status aktualisiert.');
        refresh();
      } else toast.error(failureMessage(result));
    });
  };

  const assign = (employeeId: string | null, confirmed: boolean) => {
    startTransition(async () => {
      const result = await assignEmployeeAction(appointmentId, employeeId, confirmed);
      if (!result.ok) {
        // Harte Konfliktgründe (Überschneidung, Abwesenheit …) mit anzeigen.
        toast.error(failureMessage(result));
        return;
      }
      if (result.data.requiresConfirmation) {
        setAssignConflicts({ employeeId, conflicts: result.data.conflicts });
        return;
      }
      setAssignConflicts(null);
      toast.success(employeeId ? 'Mitarbeiter zugewiesen.' : 'Zuweisung entfernt.');
      refresh();
    });
  };

  const respond = (response: 'ACCEPTED' | 'DECLINED') => {
    startTransition(async () => {
      const note =
        response === 'DECLINED'
          ? window.prompt('Optionale Begründung für die Ablehnung:') ?? undefined
          : undefined;
      const result = await respondToAssignmentAction(appointmentId, response, note);
      if (result.ok) {
        toast.success(response === 'ACCEPTED' ? 'Termin angenommen.' : 'Termin abgelehnt.');
        refresh();
      } else toast.error(result.message);
    });
  };

  const duplicate = () => {
    startTransition(async () => {
      const result = await duplicateAppointmentAction(appointmentId);
      if (result.ok) {
        toast.success('Termin dupliziert (als Entwurf am Folgetag).');
        // Neuen Termin gezielt einblenden (kein kompletter Refetch).
        updateCalendar([result.data.appointmentId]);
      } else toast.error(result.message);
    });
  };

  const restore = () => {
    startTransition(async () => {
      const result = await restoreAppointmentAction(appointmentId);
      if (result.ok) {
        toast.success('Termin wiederhergestellt – jetzt wieder bearbeitbar.');
        refresh();
      } else toast.error(result.message);
    });
  };

  // Absagen-/Löschen-Dialog im passenden Modus öffnen.
  const openCancelDialog = (mode: 'cancel' | 'delete') => {
    setCancelMode(mode);
    setCancelOpen(true);
  };

  const isCancelled = detail?.status === 'CANCELLED' || detail?.status === 'NO_SHOW';

  const parsedRecurrence = detail?.series ? parseRuleToForm(detail.series.rule) : null;
  const editTarget: AppointmentEditTarget | null = detail
    ? {
        appointmentId: detail.id,
        isSeriesMember: Boolean(detail.series),
        recurrence: parsedRecurrence
          ? {
              frequency: parsedRecurrence.frequency,
              weekdays: parsedRecurrence.weekdays,
              endMode: parsedRecurrence.endMode,
              endDate: parsedRecurrence.endDate ?? '',
              count: parsedRecurrence.count ?? 10,
            }
          : null,
        values: {
          title: detail.title,
          description: detail.description ?? '',
          assignedEmployeeId: detail.employee?.id ?? '',
          // Datum in derselben Zeitzone wie die Uhrzeit ableiten – der rohe
          // UTC-Slice wäre für Termine kurz nach Mitternacht der Vortag.
          date: toDateInputValue(new Date(detail.startAt)),
          startTime: formatTime(new Date(detail.startAt)),
          durationMinutes: detail.durationMinutes,
          status: (['DRAFT', 'PLANNED', 'CONFIRMED'].includes(detail.status)
            ? detail.status
            : 'PLANNED') as 'DRAFT' | 'PLANNED' | 'CONFIRMED',
          isFlexible: detail.isFlexible,
          earliestTime: '',
          latestTime: '',
          routeRelevant: detail.routeRelevant,
          internalNotes: detail.internalNotes ?? '',
        },
      }
    : null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Details schließen"
        className="animate-overlay-in absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Termindetails"
        className={cn(
          'absolute flex flex-col overflow-y-auto bg-[var(--color-panel)]',
          // Mobil: App-typisches Bottom-Sheet
          'animate-sheet-in inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[var(--radius-xl)] border-t border-[var(--color-line-subtle)] shadow-[var(--shadow-popover)]',
          // Ab sm: Seiten-Drawer rechts
          'sm:animate-drawer-in sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none sm:border-t-0 sm:border-l sm:shadow-[var(--shadow-drawer)]',
        )}
      >
        <div
          className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--color-line-strong)] sm:hidden"
          aria-hidden
        />
        {!detail ? (
          <DrawerContentSkeleton />
        ) : (
          <>
            <header className="flex items-start justify-between gap-3 border-b border-[var(--color-line-subtle)] p-4">
              <div className="min-w-0">
                <h2 className="truncate text-[length:var(--text-lg)] font-semibold">{detail.title}</h2>
                <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                  {formatDateTime(new Date(detail.startAt))} ·{' '}
                  {formatMinutesVerbose(detail.durationMinutes)}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <StatusPill
                    size="sm"
                    tone={
                      soloMode
                        ? statusOf(
                            SIMPLE_APPOINTMENT_STATUS,
                            simpleAppointmentStatus(detail.status),
                          ).tone
                        : statusOf(APPOINTMENT_STATUS, detail.status).tone
                    }
                  >
                    {soloMode
                      ? statusOf(
                          SIMPLE_APPOINTMENT_STATUS,
                          simpleAppointmentStatus(detail.status),
                        ).label
                      : statusOf(APPOINTMENT_STATUS, detail.status).label}
                  </StatusPill>
                  {!soloMode ? (
                    <StatusPill size="sm" tone={statusOf(ASSIGNMENT_STATUS, detail.assignmentStatus).tone}>
                      {statusOf(ASSIGNMENT_STATUS, detail.assignmentStatus).label}
                    </StatusPill>
                  ) : null}
                  {detail.series ? (
                    <StatusPill size="sm" tone="neutral" withDot={false}>
                      <Repeat className="size-3" aria-hidden /> Serie
                    </StatusPill>
                  ) : null}
                </div>
              </div>
              <Button variant="ghost" size="icon" aria-label="Schließen" onClick={onClose}>
                <X aria-hidden />
              </Button>
            </header>

            <div className="flex-1 space-y-4 p-4">
              {/* Konflikte: konkret benennen, wo & mit welchem Termin. */}
              {conflictInfo && conflictInfo.conflicts.length > 0 ? (
                <section className="rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3">
                  <h3 className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-semibold text-[var(--color-warning)]">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden />
                    {conflictInfo.conflicts.length === 1
                      ? 'Ein Konflikt bei diesem Termin'
                      : `${conflictInfo.conflicts.length} Konflikte bei diesem Termin`}
                  </h3>
                  <ul className="mt-2 space-y-1 text-[length:var(--text-sm)] text-[var(--color-ink)]">
                    {conflictInfo.conflicts.map((conflict, index) => (
                      <li key={index} className="flex items-start gap-1.5">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" aria-hidden />
                        {conflict.message}
                      </li>
                    ))}
                  </ul>

                  {resolution ? (
                    <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-panel)] p-2.5">
                      <p className="text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">
                        Vorschlag – flexible Termine werden umgeplant, fixe bleiben:
                      </p>
                      {resolution.moves.length === 0 ? (
                        <p className="mt-1.5 text-[length:var(--text-sm)]">
                          Kein automatischer Vorschlag möglich – bitte manuell anpassen.
                        </p>
                      ) : (
                        <ul className="mt-1.5 space-y-1 text-[length:var(--text-sm)]">
                          {resolution.moves.map((move) => (
                            <li key={move.appointmentId} className="flex flex-wrap items-center gap-1">
                              <span className="font-medium">{move.customerName}</span>
                              <span className="text-[var(--color-ink-subtle)]">
                                {move.fromLabel} →
                              </span>
                              <span className="font-medium text-[var(--color-success)]">
                                {move.toLabel}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {resolution.unresolved.length > 0 ? (
                        <ul className="mt-1.5 space-y-1 text-[length:var(--text-xs)] text-[var(--color-danger)]">
                          {resolution.unresolved.map((item) => (
                            <li key={item.appointmentId}>
                              {item.title}: {item.reason}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-2.5 flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setResolution(null)}
                          disabled={resolving}
                        >
                          Verwerfen
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          loading={resolving}
                          disabled={resolution.moves.length === 0}
                          onClick={applyResolution}
                        >
                          <Check aria-hidden /> Übernehmen
                        </Button>
                      </div>
                    </div>
                  ) : conflictInfo.canResolve ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2.5"
                      loading={resolving}
                      onClick={requestResolution}
                    >
                      <Sparkles aria-hidden /> Konflikt automatisch auflösen
                    </Button>
                  ) : null}
                </section>
              ) : null}

              {/* Kunde */}
              <section>
                <h3 className="mb-1.5 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
                  Kunde
                </h3>
                <a
                  href={`/customers/${detail.customer.id}`}
                  className="flex items-center gap-2.5 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2.5 transition-colors hover:bg-[var(--color-panel-raised)]"
                >
                  <EntityAvatar
                    id={detail.customer.id}
                    name={`${detail.customer.firstName} ${detail.customer.lastName}`}
                    color={detail.customer.color}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[length:var(--text-sm)] font-medium">
                      {detail.customer.firstName} {detail.customer.lastName}
                    </span>
                    {detail.address ? (
                      <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                        {detail.address.line}
                      </span>
                    ) : null}
                  </span>
                </a>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail.customer.phone ? (
                    <Button asChild variant="secondary" size="sm">
                      <a href={`tel:${detail.customer.phone.replace(/\s/g, '')}`}>
                        <Phone aria-hidden /> Anrufen
                      </a>
                    </Button>
                  ) : null}
                  {detail.address ? (
                    <Button asChild variant="secondary" size="sm">
                      <a
                        href={googleMapsDirectionsUrl(
                          detail.address.latitude != null && detail.address.longitude != null
                            ? { latitude: detail.address.latitude, longitude: detail.address.longitude }
                            : detail.address.line,
                        )}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Navigation aria-hidden /> Navigation
                      </a>
                    </Button>
                  ) : null}
                </div>
                {detail.customer.accessInstructions ? (
                  <p className="mt-2 rounded-[var(--radius-md)] bg-[var(--color-info-soft)] px-3 py-2 text-[length:var(--text-xs)] text-[var(--color-info)]">
                    <MapPin className="mr-1 inline size-3" aria-hidden />
                    {detail.customer.accessInstructions}
                  </p>
                ) : null}
              </section>

              {/* Serie */}
              {detail.series ? (
                <section>
                  <h3 className="mb-1.5 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
                    Wiederholung
                  </h3>
                  <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                    {describeRecurrenceRule(detail.series.rule)}
                  </p>
                </section>
              ) : null}

              {/* Mitarbeiter / Zuweisung */}
              {!soloMode ? (
                <section>
                  <h3 className="mb-1.5 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
                    Mitarbeiter
                  </h3>
                  {canManage ? (
                    <Select
                      value={detail.employee?.id ?? 'NONE'}
                      onValueChange={(value) => assign(value === 'NONE' ? null : value, false)}
                      disabled={pending}
                    >
                      <SelectTrigger aria-label="Mitarbeiter zuweisen">
                        <SelectValue placeholder="Nicht zugewiesen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Nicht zugewiesen</SelectItem>
                        {employees.map((employee) => (
                          <SelectItem key={employee.id} value={employee.id}>
                            {employee.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-[length:var(--text-sm)]">
                      {detail.employee
                        ? `${detail.employee.firstName} ${detail.employee.lastName}`
                        : 'Nicht zugewiesen'}
                    </p>
                  )}
                  {detail.isOwn && detail.assignmentStatus === 'ASSIGNED' ? (
                    <div className="mt-2 flex gap-2">
                      <Button variant="primary" size="sm" onClick={() => respond('ACCEPTED')} disabled={pending}>
                        <Check aria-hidden /> Annehmen
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => respond('DECLINED')} disabled={pending}>
                        <Ban aria-hidden /> Ablehnen
                      </Button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {/* Status */}
              <section>
                <h3 className="mb-1.5 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
                  Status
                </h3>
                {soloMode ? (
                  simpleAppointmentStatus(detail.status) === 'OPEN' ? (
                    <div className="flex flex-wrap gap-2">
                      <QuickCompleteButton
                        appointmentId={appointmentId}
                        label="Termin abschließen"
                        size="md"
                        onCompleted={refresh}
                      />
                      <Button
                        variant="danger"
                        size="md"
                        onClick={() => openCancelDialog('cancel')}
                        disabled={pending}
                      >
                        <Ban aria-hidden /> Absagen
                      </Button>
                    </div>
                  ) : (
                    <StatusPill
                      tone={statusOf(
                        SIMPLE_APPOINTMENT_STATUS,
                        simpleAppointmentStatus(detail.status),
                      ).tone}
                    >
                      {
                        statusOf(
                          SIMPLE_APPOINTMENT_STATUS,
                          simpleAppointmentStatus(detail.status),
                        ).label
                      }
                    </StatusPill>
                  )
                ) : canManage ? (
                  <Select
                    value={detail.status}
                    onValueChange={(value) => changeStatus(value as Parameters<typeof changeStatus>[0])}
                    disabled={pending}
                  >
                    <SelectTrigger aria-label="Status ändern">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(APPOINTMENT_STATUS).map(([value, entry]) => (
                        <SelectItem key={value} value={value}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : detail.isOwn ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => changeStatus('IN_PROGRESS')} disabled={pending || detail.status === 'IN_PROGRESS'}>
                      Einsatz starten
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => changeStatus('COMPLETED')} disabled={pending || detail.status === 'COMPLETED'}>
                      Abschließen
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => changeStatus('NO_SHOW')} disabled={pending}>
                      Nicht angetroffen
                    </Button>
                  </div>
                ) : (
                  <StatusPill tone={statusOf(APPOINTMENT_STATUS, detail.status).tone}>
                    {statusOf(APPOINTMENT_STATUS, detail.status).label}
                  </StatusPill>
                )}
              </section>

              {detail.description ? (
                <section>
                  <h3 className="mb-1.5 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
                    Beschreibung
                  </h3>
                  <p className="text-[length:var(--text-sm)] whitespace-pre-wrap">{detail.description}</p>
                </section>
              ) : null}

              {detail.internalNotes && canManage ? (
                <section>
                  <h3 className="mb-1.5 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
                    Interne Notiz
                  </h3>
                  <p className="text-[length:var(--text-sm)] whitespace-pre-wrap text-[var(--color-ink-muted)]">
                    {detail.internalNotes}
                  </p>
                </section>
              ) : null}

              {detail.cancellationReason ? (
                <p className="rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-danger)]">
                  Absagegrund: {detail.cancellationReason}
                </p>
              ) : null}
            </div>

            {canManage ? (
              <footer className="space-y-2 border-t border-[var(--color-line-subtle)] p-4">
                <div className="flex flex-wrap gap-2">
                  {isCancelled ? (
                    <>
                      {/* Abgesagt: erst wiederherstellen, dann bearbeiten; oder löschen. */}
                      <Button variant="primary" size="sm" onClick={restore} disabled={pending}>
                        <RotateCcw aria-hidden /> Wiederherstellen
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => openCancelDialog('delete')}
                        disabled={pending}
                      >
                        <Trash2 aria-hidden /> Löschen
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                        <Pencil aria-hidden /> Bearbeiten
                      </Button>
                      {!soloMode ? (
                        <>
                          <Button variant="secondary" size="sm" onClick={duplicate} disabled={pending}>
                            <Copy aria-hidden /> Duplizieren
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => openCancelDialog('cancel')}
                          >
                            <Ban aria-hidden /> Absagen
                          </Button>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              </footer>
            ) : null}
          </>
        )}
      </aside>

      {/* Bearbeiten */}
      {editOpen && editTarget ? (
        <AppointmentFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          onChanged={(opts) => {
            load();
            loadConflicts();
            if (opts?.seriesWide) {
              // Serienweite Bearbeitung betrifft viele Termine → kompletter
              // (async) Refetch statt gezieltem Einzel-Upsert.
              if (onChanged) onChanged();
              else router.refresh();
            } else {
              updateCalendar(opts?.appointmentIds ?? [appointmentId]);
            }
          }}
          customers={customers}
          employees={employees}
          editTarget={editTarget}
          fixedEmployeeId={soloMode ? ownEmployeeId : null}
          soloMode={soloMode}
        />
      ) : null}

      {/* Zuweisungs-Warnungen */}
      <ConfirmDialog
        open={assignConflicts !== null}
        onOpenChange={(open) => {
          if (!open) setAssignConflicts(null);
        }}
        title="Trotz Warnungen zuweisen?"
        description={
          <span className="block space-y-1">
            {assignConflicts?.conflicts.map((conflict, index) => (
              <span key={index} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--color-warning)]" aria-hidden />
                {conflict.message}
              </span>
            ))}
          </span>
        }
        confirmLabel="Trotzdem zuweisen"
        loading={pending}
        onConfirm={() => {
          if (assignConflicts) assign(assignConflicts.employeeId, true);
        }}
      />

      {/* Absagen oder Löschen */}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open);
          if (!open) setCancelMode('cancel');
        }}
        title={cancelMode === 'delete' ? 'Termin löschen?' : 'Termin absagen?'}
        destructive
        confirmLabel={cancelMode === 'delete' ? 'Endgültig löschen' : 'Absagen'}
        loading={pending}
        onConfirm={() => {
          startTransition(async () => {
            const scope = detail?.series ? cancelScope : 'single';
            const result =
              cancelMode === 'delete'
                ? await deleteAppointmentAction(appointmentId, scope)
                : await cancelAppointmentAction(appointmentId, scope, cancelReason || undefined);
            if (result.ok) {
              toast.success(cancelMode === 'delete' ? 'Termin gelöscht.' : 'Termin abgesagt.');
              setCancelOpen(false);
              setCancelMode('cancel');
              if (cancelMode === 'delete') {
                // Optimistisch: gelöschte Events sofort per Listener entfernen
                // (kein Refetch/Reload) und Drawer schließen.
                const deletedIds =
                  'deletedIds' in result.data ? (result.data as { deletedIds: string[] }).deletedIds : [];
                if (onDeleted) onDeleted(deletedIds);
                else if (onChanged) onChanged();
                else router.refresh();
                onClose();
              } else {
                // Absage: Drawer-Inhalt neu laden (bleibt sichtbar als abgesagt).
                load();
                loadConflicts();
                if (scope === 'single') {
                  updateCalendar([appointmentId]);
                } else {
                  // Serienweite Absage betrifft viele Termine → Refetch.
                  if (onChanged) onChanged();
                  else router.refresh();
                }
              }
            } else toast.error(result.message);
          });
        }}
      >
        <div className="mt-3 space-y-3">
          {/* Absagen (bleibt sichtbar) vs. Löschen (ganz entfernen). Bereits
              abgesagte Termine kann man nur noch löschen. */}
          {!isCancelled ? (
          <div role="radiogroup" aria-label="Aktion" className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['cancel', 'Absagen', 'bleibt als abgesagt sichtbar'],
                ['delete', 'Löschen', 'wird vollständig entfernt'],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={cancelMode === value}
                onClick={() => setCancelMode(value)}
                className={cn(
                  'rounded-[var(--radius-md)] border px-3 py-2 text-left text-[length:var(--text-sm)] transition-colors',
                  cancelMode === value
                    ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)] font-medium text-[var(--color-danger)]'
                    : 'border-[var(--color-line)] text-[var(--color-ink-muted)]',
                )}
              >
                <span className="block">{label}</span>
                <span className="block text-[length:var(--text-2xs)] font-normal text-[var(--color-ink-subtle)]">
                  {hint}
                </span>
              </button>
            ))}
          </div>
          ) : null}

          {detail?.series ? (
            <div role="radiogroup" aria-label="Umfang" className="space-y-1.5">
              {(
                [
                  ['single', cancelMode === 'delete' ? 'Nur diesen Termin löschen' : 'Nur diesen Termin absagen'],
                  ['following', cancelMode === 'delete' ? 'Diesen und alle folgenden löschen' : 'Diesen und alle folgenden absagen'],
                  ['all', cancelMode === 'delete' ? 'Gesamte Serie löschen' : 'Gesamte Serie beenden'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={cancelScope === value}
                  onClick={() => setCancelScope(value)}
                  className={cn(
                    'block w-full rounded-[var(--radius-md)] border px-3 py-2 text-left text-[length:var(--text-sm)] transition-colors',
                    cancelScope === value
                      ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)] font-medium text-[var(--color-danger)]'
                      : 'border-[var(--color-line)] text-[var(--color-ink-muted)]',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          {/* Hinweis: Löschen einer abgesagten Serie betrifft nur die bereits
              abgesagten Vorkommen (Abgeschlossene bleiben erhalten). */}
          {isCancelled && cancelMode === 'delete' && detail?.series && cancelScope !== 'single' ? (
            <p className="text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
              Betrifft nur die bereits abgesagten Termine dieser Serie – abgeschlossene Einsätze
              bleiben als Historie erhalten.
            </p>
          ) : null}

          {cancelMode === 'cancel' ? (
            <div>
              <Label htmlFor="cancel-reason">Grund (optional)</Label>
              <Textarea
                id="cancel-reason"
                rows={2}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </div>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
