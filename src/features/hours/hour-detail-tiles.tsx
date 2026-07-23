'use client';

import { ArrowRight, CalendarDays, CheckCircle2, Clock, Users } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { DialogDataSkeleton } from '@/components/layout/page-loading-skeleton';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { StatusPill } from '@/components/ui/status-pill';
import { formatMinutesAsHours } from '@/lib/duration';
import { APPOINTMENT_STATUS, statusOf } from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import {
  getCustomerHourDetailAction,
  getEmployeeHourDetailAction,
  type CustomerHourDetail,
  type EmployeeHourDetail,
} from '@/server/actions/hour-detail-actions';
import { AllocateFromEmployeeButton } from '@/features/hours/allocate-from-employee-button';
import { AllocateHoursButton } from '@/features/hours/allocate-hours-button';

/**
 * Klickbare Stunden-Kennzahlen (Anfrage Juli 2026): Jede Kachel öffnet einen
 * Dialog, der die Zahl vollständig aufschlüsselt (wer, wann, welcher Termin,
 * welche Zuweisung) – inklusive Direktaktionen wie „Stunden zuweisen“.
 */

export type CustomerMetric = 'balance' | 'allocated' | 'planned' | 'completed';

/** Konto-Kennzahlen des Kunden (siehe hours-service.CustomerAccountStats). */
export interface CustomerAccountStatsSerialized {
  creditedMinutes: number;
  completedMinutes: number;
  reservedMinutes: number;
  balanceMinutes: number;
  plannableMinutes: number;
  allocatedMinutes: number;
  hasAccount: boolean;
}

const PLANNED_SET = new Set(['PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED']);
/** Offene (reservierende) Termine im Konto-Modell – ohne COMPLETED. */
const RESERVED_SET = new Set(['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS']);

function TileButton({
  label,
  value,
  hint,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  onClick: () => void;
}) {
  const toneColor = {
    default: 'var(--color-ink)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    danger: 'var(--color-danger)',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] px-4 py-3.5 text-left shadow-[var(--shadow-panel)]',
        'transition-[border-color,box-shadow] hover:border-[var(--color-brand)] hover:shadow-[var(--shadow-popover)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)]',
      )}
    >
      <span className="flex items-center justify-between gap-2 text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">
        {label}
        <ArrowRight
          className="size-3.5 shrink-0 text-[var(--color-ink-subtle)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-brand)]"
          aria-hidden
        />
      </span>
      <span className="tabular mt-1 block text-[length:var(--text-2xl)] leading-tight font-semibold" style={{ color: toneColor }}>
        {value}
      </span>
      {hint ? (
        <span className="mt-0.5 block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">{hint}</span>
      ) : null}
    </button>
  );
}

/** Funnel: macht die Konto-Beziehungen sichtbar (Solo ohne Zuweisung). */
export function HourFunnel({
  stats,
  showAllocation = true,
}: {
  stats: CustomerAccountStatsSerialized;
  showAllocation?: boolean;
}) {
  const max = Math.max(
    stats.creditedMinutes,
    stats.completedMinutes + stats.reservedMinutes,
    stats.allocatedMinutes,
    1,
  );
  const rows = [
    {
      key: 'credited',
      label: 'Aufgeladen',
      minutes: stats.creditedMinutes,
      color: 'var(--color-brand)',
      explain: 'alle Gutschriften (einmalig, wiederkehrend, Korrekturen)',
    },
    ...(showAllocation
      ? [
          {
            key: 'allocated',
            label: 'Zugewiesen',
            minutes: stats.allocatedMinutes,
            color: 'var(--color-info, #2f80ed)',
            explain:
              stats.balanceMinutes - stats.allocatedMinutes > 0
                ? `${formatMinutesAsHours(stats.balanceMinutes - stats.allocatedMinutes)} noch keinem Mitarbeiter zugeteilt`
                : 'vollständig an Mitarbeiter verteilt',
          },
        ]
      : []),
    {
      key: 'reserved',
      label: 'Geplant',
      minutes: stats.reservedMinutes,
      color: 'var(--color-warning)',
      explain:
        stats.plannableMinutes > 0
          ? `${formatMinutesAsHours(stats.plannableMinutes)} verplanbar`
          : stats.plannableMinutes < 0
            ? `${formatMinutesAsHours(-stats.plannableMinutes)} über dem Guthaben!`
            : 'Guthaben vollständig verplant',
    },
    {
      key: 'completed',
      label: 'Geleistet',
      minutes: stats.completedMinutes,
      color: 'var(--color-success)',
      explain: 'abgeschlossene Einsätze – vom Konto abgezogen',
    },
  ];
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[5.5rem_4rem_1fr] items-center gap-2 text-[length:var(--text-sm)] sm:grid-cols-[6.5rem_4.5rem_1fr]">
          <span className="text-[var(--color-ink-muted)]">{row.label}</span>
          <span className="tabular text-right font-semibold">{formatMinutesAsHours(row.minutes)}</span>
          <span className="min-w-0">
            <span className="block h-2 overflow-hidden rounded-full bg-[var(--color-panel-sunken)]">
              <span
                className="block h-full rounded-full transition-[width]"
                style={{ width: `${Math.min(100, (row.minutes / max) * 100)}%`, backgroundColor: row.color }}
              />
            </span>
            <span className="mt-0.5 block truncate text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
              {row.explain}
            </span>
          </span>
        </div>
      ))}
      {showAllocation ? (
        <p className="pt-1 text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
          Das Konto wird durch Aufladungen gefüllt; „Zugewiesen“ (an Mitarbeiter) und „Geplant“
          (in Terminen) schöpfen daraus, abgeschlossene Einsätze ziehen die Stunden ab.
        </p>
      ) : (
        <p className="pt-1 text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
          Aufladungen füllen das Konto, Termine reservieren Guthaben und abgeschlossene Einsätze
          ziehen die Stunden ab.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kunde
// ---------------------------------------------------------------------------

export function CustomerHourTiles({
  customerId,
  stats,
  canAllocate,
  showFunnel = false,
  showAllocation = true,
}: {
  customerId: string;
  stats: CustomerAccountStatsSerialized;
  canAllocate: boolean;
  showFunnel?: boolean;
  /** Solo-Modus: Zuweisungs-Schritt komplett ausblenden. */
  showAllocation?: boolean;
}) {
  const [metric, setMetric] = React.useState<CustomerMetric | null>(null);
  const [detail, setDetail] = React.useState<CustomerHourDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!metric || detail) return;
    let cancelled = false;
    getCustomerHourDetailAction(customerId).then((result) => {
      if (cancelled) return;
      if (result.ok) setDetail(result.data);
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [metric, detail, customerId]);

  const close = () => setMetric(null);

  return (
    <>
      <div className={cn('grid grid-cols-2 gap-3', showAllocation ? 'xl:grid-cols-4' : 'xl:grid-cols-4')}>
        <TileButton
          label="Kontostand"
          value={formatMinutesAsHours(stats.balanceMinutes)}
          hint={
            stats.plannableMinutes >= 0
              ? `${formatMinutesAsHours(stats.plannableMinutes)} verplanbar`
              : `${formatMinutesAsHours(-stats.plannableMinutes)} überbucht`
          }
          tone={stats.balanceMinutes < 0 || stats.plannableMinutes < 0 ? 'danger' : 'default'}
          onClick={() => setMetric('balance')}
        />
        {showAllocation ? (
          <TileButton
            label="Zugewiesen"
            value={formatMinutesAsHours(stats.allocatedMinutes)}
            hint={
              stats.balanceMinutes - stats.allocatedMinutes > 0
                ? `${formatMinutesAsHours(stats.balanceMinutes - stats.allocatedMinutes)} offen`
                : 'vollständig verteilt'
            }
            tone={stats.balanceMinutes - stats.allocatedMinutes > 0 ? 'warning' : 'success'}
            onClick={() => setMetric('allocated')}
          />
        ) : null}
        <TileButton
          label="Geplant"
          value={formatMinutesAsHours(stats.reservedMinutes)}
          hint="offene Termine (reserviert)"
          onClick={() => setMetric('planned')}
        />
        <TileButton
          label="Geleistet"
          value={formatMinutesAsHours(stats.completedMinutes)}
          hint="vom Konto abgezogen"
          tone="success"
          onClick={() => setMetric('completed')}
        />
      </div>

      {showFunnel ? (
        <div className="rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-4 shadow-[var(--shadow-panel)]">
          <HourFunnel stats={stats} showAllocation={showAllocation} />
        </div>
      ) : null}

      <Dialog open={metric !== null} onOpenChange={(open) => (!open ? close() : null)}>
        <DialogContent
          title={
            metric === 'balance'
              ? 'Stundenkonto – Gutschriften'
              : metric === 'allocated'
                ? 'Zugewiesene Stunden'
                : metric === 'planned'
                  ? 'Geplante Termine'
                  : 'Geleistete Stunden'
          }
        >
          {error ? (
            <p className="py-6 text-center text-[length:var(--text-sm)] text-[var(--color-danger)]">{error}</p>
          ) : !detail || !metric ? (
            <DialogDataSkeleton />
          ) : (
            <div className="max-h-[55dvh] space-y-3 overflow-y-auto pr-1">
              <CustomerMetricDetail metric={metric} detail={detail} stats={stats} />
            </div>
          )}
          {metric === 'allocated' && canAllocate ? (
            <div className="flex justify-end border-t border-[var(--color-line-subtle)] pt-3">
              <AllocateHoursButton customerId={customerId} label="Stunden zuweisen" icon="clock" size="sm" />
            </div>
          ) : null}
          {metric === 'planned' ? (
            <div className="flex justify-end border-t border-[var(--color-line-subtle)] pt-3">
              <Link
                href={`/calendar?kunde=${customerId}&neu=1`}
                className="text-[length:var(--text-sm)] font-medium text-[var(--color-brand)] hover:underline"
              >
                Termin für diesen Kunden anlegen →
              </Link>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DetailRow({
  primary,
  secondary,
  minutes,
  minutesHint,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  minutes: number;
  minutesHint?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-[length:var(--text-sm)] font-medium">{primary}</span>
        {secondary ? (
          <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">{secondary}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-right">
        <span className="tabular block text-[length:var(--text-sm)] font-semibold">{formatMinutesAsHours(minutes)}</span>
        {minutesHint ? (
          <span className="block text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">{minutesHint}</span>
        ) : null}
      </span>
    </li>
  );
}

function EmptyHint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <p className="flex items-center justify-center gap-2 py-6 text-center text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
      <span className="[&_svg]:size-4" aria-hidden>{icon}</span>
      {text}
    </p>
  );
}

function CustomerMetricDetail({
  metric,
  detail,
  stats,
}: {
  metric: CustomerMetric;
  detail: CustomerHourDetail;
  stats: CustomerAccountStatsSerialized;
}) {
  if (metric === 'balance') {
    if (detail.topups.length === 0) {
      return <EmptyHint icon={<Clock />} text="Noch keine Aufladung auf dem Stundenkonto." />;
    }
    return (
      <>
        <ul className="space-y-1.5">
          {detail.topups.map((topup) => (
            <DetailRow
              key={topup.id}
              primary={topup.label}
              secondary={topup.dateLabel}
              minutes={topup.minutes}
            />
          ))}
        </ul>
        <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
          Aufgeladen gesamt: <strong className="tabular">{formatMinutesAsHours(stats.creditedMinutes)}</strong> –
          davon {formatMinutesAsHours(stats.completedMinutes)} geleistet, Kontostand{' '}
          <strong className="tabular">{formatMinutesAsHours(stats.balanceMinutes)}</strong>.
        </p>
      </>
    );
  }

  if (metric === 'allocated') {
    if (detail.allocations.length === 0) {
      return <EmptyHint icon={<Users />} text="Noch keine Stunden an Mitarbeiter zugewiesen." />;
    }
    const unallocated = stats.balanceMinutes - stats.allocatedMinutes;
    return (
      <>
        <ul className="space-y-1.5">
          {detail.allocations.map((allocation) => (
            <DetailRow
              key={allocation.id}
              primary={
                <Link href={`/employees/${allocation.employeeId}`} className="hover:text-[var(--color-brand)]">
                  {allocation.employeeName}
                </Link>
              }
              secondary={`${allocation.fromPool ? `weitergegeben von ${allocation.fromPool}` : 'aus dem Stundenkonto'} · gültig ${allocation.validLabel}`}
              minutes={allocation.minutes}
            />
          ))}
        </ul>
        {unallocated > 0 ? (
          <p className="rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] px-3 py-2 text-[length:var(--text-xs)]">
            Noch <strong className="tabular">{formatMinutesAsHours(unallocated)}</strong> ohne Mitarbeiter –
            unten direkt zuweisen.
          </p>
        ) : null}
      </>
    );
  }

  const reserved = detail.appointments.filter((appointment) => RESERVED_SET.has(appointment.status));
  const completed = detail.appointments.filter((appointment) => appointment.status === 'COMPLETED');
  const list = metric === 'planned' ? reserved : completed;

  if (list.length === 0) {
    return (
      <EmptyHint
        icon={metric === 'planned' ? <CalendarDays /> : <CheckCircle2 />}
        text={metric === 'planned' ? 'Keine offenen Termine geplant.' : 'Noch keine abgeschlossenen Einsätze.'}
      />
    );
  }
  return (
    <>
      <ul className="space-y-1.5">
        {list.map((appointment) => (
          <DetailRow
            key={appointment.id}
            primary={
              <Link href={`/calendar?termin=${appointment.id}`} className="hover:text-[var(--color-brand)]">
                {appointment.dateLabel} · {appointment.title}
              </Link>
            }
            secondary={
              <>
                {appointment.employeeName ?? (
                  <span className="text-[var(--color-warning)]">keine Zuordnung</span>
                )}
                {' · '}
                {statusOf(APPOINTMENT_STATUS, appointment.status).label}
              </>
            }
            minutes={
              metric === 'completed'
                ? (appointment.workedMinutes ?? appointment.durationMinutes)
                : appointment.durationMinutes
            }
            minutesHint={
              metric === 'completed' && appointment.workedMinutes != null ? 'Ist-Zeit' : undefined
            }
          />
        ))}
      </ul>
      {metric === 'planned' && stats.plannableMinutes < 0 ? (
        <p className="rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] px-3 py-2 text-[length:var(--text-xs)]">
          <strong className="tabular">{formatMinutesAsHours(-stats.plannableMinutes)}</strong> mehr geplant als
          Guthaben – Konto aufladen oder Termine reduzieren.
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Mitarbeiter
// ---------------------------------------------------------------------------

export type EmployeeMetric = 'allocated' | 'planned' | 'completed' | 'missing';

export function EmployeeHourTiles({
  employeeId,
  periodKind,
  labels,
  stats,
  canAllocate,
}: {
  employeeId: string;
  periodKind: 'week' | 'month';
  /** Anzeige-Beschriftungen der 4 Kacheln (Seite bestimmt Zeitraum-Suffix). */
  labels: { target: string; allocated: string; planned: string; missing: string };
  stats: {
    targetMinutes: number | null;
    allocatedMinutes: number;
    forwardedMinutes: number;
    plannedMinutes: number;
    completedMinutes: number;
    missingByAllocation: number;
    missingByPlanning: number;
  };
  canAllocate: boolean;
}) {
  const [metric, setMetric] = React.useState<EmployeeMetric | null>(null);
  const [detail, setDetail] = React.useState<EmployeeHourDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!metric || detail) return;
    let cancelled = false;
    getEmployeeHourDetailAction(employeeId, periodKind).then((result) => {
      if (cancelled) return;
      if (result.ok) setDetail(result.data);
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [metric, detail, employeeId, periodKind]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] px-4 py-3.5 shadow-[var(--shadow-panel)]">
          <span className="block text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">Ziel ({labels.target})</span>
          <span className="tabular mt-1 block text-[length:var(--text-2xl)] leading-tight font-semibold">
            {stats.targetMinutes != null ? formatMinutesAsHours(stats.targetMinutes) : '—'}
          </span>
          <span className="mt-0.5 block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">Sollstunden</span>
        </div>
        <TileButton
          label={`Zugewiesen (${labels.allocated})`}
          value={formatMinutesAsHours(stats.allocatedMinutes)}
          hint={
            stats.forwardedMinutes > 0
              ? `${formatMinutesAsHours(stats.forwardedMinutes)} weitergegeben`
              : 'aus Kunden-Stundenkonten'
          }
          onClick={() => setMetric('allocated')}
        />
        <TileButton
          label={`Geplant (${labels.planned})`}
          value={formatMinutesAsHours(stats.plannedMinutes)}
          hint={`Geleistet: ${formatMinutesAsHours(stats.completedMinutes)}`}
          onClick={() => setMetric('planned')}
        />
        <TileButton
          label={`Fehlend zum Ziel (${labels.missing})`}
          value={formatMinutesAsHours(stats.missingByAllocation)}
          hint={`nach Planung: ${formatMinutesAsHours(stats.missingByPlanning)}`}
          tone={stats.missingByAllocation > 0 ? 'warning' : 'success'}
          onClick={() => setMetric('missing')}
        />
      </div>

      <Dialog open={metric !== null} onOpenChange={(open) => (!open ? setMetric(null) : null)}>
        <DialogContent
          title={
            metric === 'allocated'
              ? 'Zugewiesene Stunden'
              : metric === 'planned'
                ? 'Geplante Termine'
                : metric === 'completed'
                  ? 'Geleistete Einsätze'
                  : 'Fehlende Stunden zum Ziel'
          }
          description={detail ? detail.periodLabel : undefined}
        >
          {error ? (
            <p className="py-6 text-center text-[length:var(--text-sm)] text-[var(--color-danger)]">{error}</p>
          ) : !detail || !metric ? (
            <DialogDataSkeleton />
          ) : (
            <div className="max-h-[55dvh] space-y-3 overflow-y-auto pr-1">
              <EmployeeMetricDetail metric={metric} detail={detail} stats={stats} />
            </div>
          )}
          {canAllocate && (metric === 'allocated' || metric === 'missing') ? (
            <div className="flex justify-end border-t border-[var(--color-line-subtle)] pt-3">
              <AllocateFromEmployeeButton employeeId={employeeId} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmployeeMetricDetail({
  metric,
  detail,
  stats,
}: {
  metric: EmployeeMetric;
  detail: EmployeeHourDetail;
  stats: { missingByAllocation: number; missingByPlanning: number; targetMinutes: number | null };
}) {
  if (metric === 'allocated' || metric === 'missing') {
    return (
      <>
        {metric === 'missing' ? (
          <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            {stats.targetMinutes == null
              ? 'Kein Stundenziel hinterlegt – im Mitarbeiterprofil pflegen.'
              : stats.missingByAllocation > 0
                ? `Es fehlen ${formatMinutesAsHours(stats.missingByAllocation)} Zuweisung zum Ziel. Unten die bereits erhaltenen Stunden:`
                : 'Ziel erreicht – alle Sollstunden sind zugewiesen.'}
          </p>
        ) : null}
        {detail.received.length === 0 ? (
          <EmptyHint icon={<Users />} text="Keine Stundenzuweisungen im Zeitraum." />
        ) : (
          <ul className="space-y-1.5">
            {detail.received.map((allocation) => (
              <DetailRow
                key={allocation.id}
                primary={
                  <Link href={`/customers/${allocation.customerId}?tab=stunden`} className="hover:text-[var(--color-brand)]">
                    {allocation.customerName}
                  </Link>
                }
                secondary={`${allocation.fromPool ? `weitergegeben von ${allocation.fromPool}` : 'aus dem Stundenkonto'} · gültig ${allocation.validLabel}`}
                minutes={allocation.minutes}
              />
            ))}
          </ul>
        )}
        {detail.forwarded.length > 0 ? (
          <>
            <h3 className="pt-1 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
              Selbst weitergegeben
            </h3>
            <ul className="space-y-1.5">
              {detail.forwarded.map((allocation) => (
                <DetailRow
                  key={allocation.id}
                  primary={allocation.toName}
                  secondary={`für ${allocation.customerName}`}
                  minutes={-allocation.minutes}
                />
              ))}
            </ul>
          </>
        ) : null}
      </>
    );
  }

  const list =
    metric === 'completed'
      ? detail.appointments.filter((appointment) => appointment.status === 'COMPLETED')
      : detail.appointments.filter((appointment) => PLANNED_SET.has(appointment.status));

  if (list.length === 0) {
    return <EmptyHint icon={<CalendarDays />} text="Keine Termine im Zeitraum." />;
  }
  return (
    <ul className="space-y-1.5">
      {list.map((appointment) => (
        <DetailRow
          key={appointment.id}
          primary={
            <Link href={`/calendar?termin=${appointment.id}`} className="hover:text-[var(--color-brand)]">
              {appointment.dateLabel} · {appointment.customerName}
            </Link>
          }
          secondary={
            <>
              {appointment.title} ·{' '}
              <StatusPill size="sm" tone={statusOf(APPOINTMENT_STATUS, appointment.status).tone}>
                {statusOf(APPOINTMENT_STATUS, appointment.status).label}
              </StatusPill>
            </>
          }
          minutes={
            metric === 'completed'
              ? (appointment.workedMinutes ?? appointment.durationMinutes)
              : appointment.durationMinutes
          }
          minutesHint={metric === 'completed' && appointment.workedMinutes != null ? 'Ist-Zeit' : undefined}
        />
      ))}
    </ul>
  );
}
