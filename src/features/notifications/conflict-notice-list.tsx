'use client';

import { AlertTriangle, CalendarClock, Check, Megaphone, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  applyConflictResolutionAction,
  reportScopeConflictsAction,
} from '@/server/actions/conflict-actions';
import type { OrgConflictDto } from '@/server/services/conflict-service';

/**
 * Aktuelle Terminkonflikte in den Benachrichtigungen: konkret benannt (welche
 * Termine, wann) und – wo flexible Termine beteiligt sind – mit einem Klick
 * automatisch auflösbar. Berechtigte Leitung kann die offenen Konflikte per
 * Sammelaktion „Konflikte melden" an die betroffenen Mitarbeiter senden.
 */
export function ConflictNoticeList({
  conflicts,
  canReport,
}: {
  conflicts: OrgConflictDto[];
  /** Leitung mit `appointments.manage`: Sammelaktion „Konflikte melden" sichtbar. */
  canReport: boolean;
}) {
  const router = useRouter();
  const [reporting, setReporting] = React.useState(false);

  if (conflicts.length === 0) return null;

  const report = () => {
    setReporting(true);
    reportScopeConflictsAction(
      conflicts.map((conflict) => ({ employeeId: conflict.employeeId, date: conflict.date })),
    ).then((result) => {
      setReporting(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const { reported, alreadyReported, skippedNoAccount } = result.data;
      if (reported === 0 && alreadyReported > 0 && skippedNoAccount === 0) {
        toast.info('Alle Konflikte wurden bereits kürzlich gemeldet.');
      } else if (reported === 0 && skippedNoAccount > 0 && alreadyReported === 0) {
        toast.warning(
          `Keine Meldung möglich – ${skippedNoAccount} Konflikt${skippedNoAccount === 1 ? '' : 'e'} betreffen Mitarbeiter ohne Konto.`,
        );
      } else {
        const parts = [`${reported} gemeldet`];
        if (alreadyReported > 0) parts.push(`${alreadyReported} bereits gemeldet`);
        if (skippedNoAccount > 0) parts.push(`${skippedNoAccount} ohne Mitarbeiterkonto`);
        toast.success(parts.join(' · '));
      }
      router.refresh();
    });
  };

  return (
    <section className="mb-4" aria-labelledby="conflict-notices-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2
          id="conflict-notices-title"
          className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-semibold text-[var(--color-warning)]"
        >
          <AlertTriangle className="size-4" aria-hidden />
          {conflicts.length === 1 ? 'Ein Terminkonflikt' : `${conflicts.length} Terminkonflikte`}
        </h2>
        {canReport ? (
          <Button variant="secondary" size="sm" loading={reporting} onClick={report}>
            <Megaphone aria-hidden /> Konflikte melden
          </Button>
        ) : null}
      </div>
      <ul className="space-y-2">
        {conflicts.map((conflict, index) => (
          <ConflictCard key={`${conflict.employeeId}-${conflict.date}-${index}`} conflict={conflict} />
        ))}
      </ul>
    </section>
  );
}

function ConflictCard({ conflict }: { conflict: OrgConflictDto }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const resolve = () => {
    setPending(true);
    applyConflictResolutionAction(conflict.employeeId, conflict.date).then((result) => {
      setPending(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        result.data.appliedCount > 0
          ? `${result.data.appliedCount} Termin${result.data.appliedCount === 1 ? '' : 'e'} umgeplant.`
          : 'Keine Termine mussten verschoben werden.',
      );
      router.refresh();
    });
  };

  return (
    <li className="rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[length:var(--text-sm)] font-medium">
          {conflict.kind === 'ABSENCE' ? 'Termin während Abwesenheit' : 'Überschneidung'} ·{' '}
          {conflict.employeeName}
        </span>
        <span className="flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
          <CalendarClock className="size-3.5" aria-hidden />
          {conflict.dateLabel}
        </span>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-[length:var(--text-sm)]">
        {conflict.appointments.map((appointment) => (
          <li key={appointment.id}>
            <Link
              href={`/calendar?termin=${appointment.id}`}
              className="hover:text-[var(--color-brand)]"
            >
              {appointment.timeLabel} · {appointment.customerName} ({appointment.title})
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/calendar?termin=${conflict.appointments[0]?.id ?? ''}`}>Im Kalender öffnen</Link>
        </Button>
        {conflict.canResolve ? (
          <Button variant="secondary" size="sm" loading={pending} onClick={resolve}>
            {pending ? <Check aria-hidden /> : <Sparkles aria-hidden />} Automatisch auflösen
          </Button>
        ) : null}
      </div>
    </li>
  );
}
