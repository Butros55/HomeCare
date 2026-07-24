'use client';

import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/panel';
import { formatDate } from '@/lib/dates';
import { formatMinutesAsHours } from '@/lib/duration';
import type { AccountHistoryEntryDto } from '@/server/services/account-service';

/** Erste Anzahl sichtbarer Bewegungen und Schrittweite von „Mehr anzeigen". */
const HISTORY_PAGE = 10;

function monthLabel(monthIso: string): string {
  const [year, month] = monthIso.split('-').map(Number);
  if (!year || !month) return monthIso;
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/**
 * Monatswechsler für das Stundenkonto. Setzt `?monat=YYYY-MM` und erhält die
 * übrigen Query-Parameter (u. a. `?tab=stunden`).
 */
export function AccountMonthSwitcher({
  monthIso,
  prevMonthIso,
  nextMonthIso,
  currentMonthIso,
}: {
  monthIso: string;
  prevMonthIso: string;
  nextMonthIso: string;
  /** Aktueller Kalendermonat – für den „Heute"-Sprung. */
  currentMonthIso: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hrefFor = (month: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('monat', month);
    return `${pathname}?${params.toString()}`;
  };
  const go = (month: string) => router.push(hrefFor(month), { scroll: false });

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Vorheriger Monat" onClick={() => go(prevMonthIso)}>
          <ChevronLeft aria-hidden />
        </Button>
        <span className="min-w-[8.5rem] text-center text-[length:var(--text-base)] font-semibold">
          {monthLabel(monthIso)}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Nächster Monat" onClick={() => go(nextMonthIso)}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
      {monthIso !== currentMonthIso ? (
        <Button variant="ghost" size="sm" onClick={() => go(currentMonthIso)}>
          Aktueller Monat
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Kontobewegungen eines Monats – zeigt zunächst 10 Einträge und blendet über
 * „Mehr anzeigen" jeweils die nächsten 10 ein.
 */
export function AccountHistoryList({
  entries,
  timezone,
}: {
  entries: AccountHistoryEntryDto[];
  timezone: string;
}) {
  // Reset bei Monatswechsel über den `key` des Aufrufers (Remount) – kein Effekt.
  const [visible, setVisible] = React.useState(HISTORY_PAGE);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Clock />}
        title="Keine Bewegungen in diesem Monat"
        description="Aufladungen und Termine dieses Monats erscheinen hier."
      />
    );
  }

  const shown = entries.slice(0, visible);
  const remaining = entries.length - shown.length;

  return (
    <>
      <ul className="divide-y divide-[var(--color-line-subtle)]">
        {shown.map((entry) => (
          <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[length:var(--text-sm)]">
                {entry.appointmentId ? (
                  <Link
                    href={`/calendar?termin=${entry.appointmentId}`}
                    className="hover:text-[var(--color-brand)]"
                  >
                    {entry.label}
                  </Link>
                ) : (
                  entry.label
                )}
                {entry.pending ? (
                  <span className="text-[var(--color-ink-subtle)]"> · vorgemerkt</span>
                ) : null}
              </div>
              <div className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                {formatDate(new Date(entry.dateIso), timezone)}
              </div>
            </div>
            <span
              className="tabular shrink-0 font-semibold"
              style={{
                color:
                  entry.minutes > 0
                    ? 'var(--color-success)'
                    : entry.minutes < 0
                      ? 'var(--color-danger)'
                      : 'var(--color-ink)',
              }}
            >
              {entry.minutes >= 0 ? '+' : '−'}
              {formatMinutesAsHours(Math.abs(entry.minutes))}
            </span>
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <div className="mt-3 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setVisible((current) => current + HISTORY_PAGE)}
          >
            Mehr anzeigen ({remaining})
          </Button>
        </div>
      ) : null}
    </>
  );
}
