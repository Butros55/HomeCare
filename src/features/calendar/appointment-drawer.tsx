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
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label, Textarea } from '@/components/ui/input';
import { EntityAvatar, Spinner } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { formatDateTime, formatTime, toDateInputValue } from '@/lib/dates';
import { formatMinutesVerbose } from '@/lib/duration';
import { googleMapsDirectionsUrl } from '@/lib/geo';
import { describeRecurrenceRule } from '@/lib/recurrence';
import { APPOINTMENT_STATUS, ASSIGNMENT_STATUS, statusOf } from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import {
  assignEmployeeAction,
  cancelAppointmentAction,
  duplicateAppointmentAction,
  getAppointmentDetailAction,
  respondToAssignmentAction,
  updateAppointmentStatusAction,
} from '@/server/actions/appointment-actions';
import {
  AppointmentFormDialog,
  type AppointmentEditTarget,
} from '@/features/calendar/appointment-form-dialog';

type Detail = Extract<
  Awaited<ReturnType<typeof getAppointmentDetailAction>>,
  { ok: true }
>['data'];

/** Detail-Drawer eines Termins mit allen Aktionen (Anforderung 13). */
export function AppointmentDrawer({
  appointmentId,
  onClose,
  canManage,
  employees,
  customers,
}: {
  appointmentId: string;
  onClose: () => void;
  canManage: boolean;
  employees: { id: string; name: string }[];
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelScope, setCancelScope] = React.useState<'single' | 'following' | 'all'>('single');
  const [cancelReason, setCancelReason] = React.useState('');
  const [pending, startTransition] = React.useTransition();
  const [assignConflicts, setAssignConflicts] = React.useState<{
    employeeId: string | null;
    conflicts: { message: string }[];
  } | null>(null);

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
  }, [load]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const refresh = () => {
    load();
    router.refresh();
  };

  const changeStatus = (status: Parameters<typeof updateAppointmentStatusAction>[1]) => {
    startTransition(async () => {
      const result = await updateAppointmentStatusAction(appointmentId, status);
      if (result.ok) {
        toast.success('Status aktualisiert.');
        refresh();
      } else toast.error(result.message);
    });
  };

  const assign = (employeeId: string | null, confirmed: boolean) => {
    startTransition(async () => {
      const result = await assignEmployeeAction(appointmentId, employeeId, confirmed);
      if (!result.ok) {
        toast.error(result.message);
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
        refresh();
      } else toast.error(result.message);
    });
  };

  const editTarget: AppointmentEditTarget | null = detail
    ? {
        appointmentId: detail.id,
        isSeriesMember: Boolean(detail.series),
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
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
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
                  <StatusPill size="sm" tone={statusOf(APPOINTMENT_STATUS, detail.status).tone}>
                    {statusOf(APPOINTMENT_STATUS, detail.status).label}
                  </StatusPill>
                  <StatusPill size="sm" tone={statusOf(ASSIGNMENT_STATUS, detail.assignmentStatus).tone}>
                    {statusOf(ASSIGNMENT_STATUS, detail.assignmentStatus).label}
                  </StatusPill>
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

              {/* Status */}
              <section>
                <h3 className="mb-1.5 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
                  Status
                </h3>
                {canManage ? (
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
                  <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                    <Pencil aria-hidden /> Bearbeiten
                  </Button>
                  <Button variant="secondary" size="sm" onClick={duplicate} disabled={pending}>
                    <Copy aria-hidden /> Duplizieren
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setCancelOpen(true)}
                    disabled={detail.status === 'CANCELLED'}
                  >
                    <Ban aria-hidden /> Absagen
                  </Button>
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
          onOpenChange={(open) => {
            setEditOpen(open);
            if (!open) refresh();
          }}
          customers={customers}
          employees={employees}
          editTarget={editTarget}
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

      {/* Absagen */}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Termin absagen?"
        destructive
        confirmLabel="Absagen"
        loading={pending}
        onConfirm={() => {
          startTransition(async () => {
            const result = await cancelAppointmentAction(
              appointmentId,
              detail?.series ? cancelScope : 'single',
              cancelReason || undefined,
            );
            if (result.ok) {
              toast.success('Termin abgesagt.');
              setCancelOpen(false);
              refresh();
            } else toast.error(result.message);
          });
        }}
      >
        <div className="mt-3 space-y-3">
          {detail?.series ? (
            <div role="radiogroup" aria-label="Absageumfang" className="space-y-1.5">
              {(
                [
                  ['single', 'Nur diesen Termin absagen'],
                  ['following', 'Diesen und alle folgenden absagen'],
                  ['all', 'Gesamte Serie beenden'],
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
          <div>
            <Label htmlFor="cancel-reason">Grund (optional)</Label>
            <Textarea
              id="cancel-reason"
              rows={2}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
