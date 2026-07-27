'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type PeriodMode = 'month' | 'year' | 'custom';

function parseDate(value: string | null, fallback: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? fallback);
  return match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date();
}

function dateValue(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function bounds(mode: Exclude<PeriodMode, 'custom'>, anchor: Date) {
  if (mode === 'year') {
    return {
      from: `${anchor.getUTCFullYear()}-01-01`,
      to: `${anchor.getUTCFullYear()}-12-31`,
    };
  }
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  return { from: dateValue(start), to: dateValue(end) };
}

/**
 * Schnelle Monats-/Jahresnavigation mit frei wählbarem Zeitraum.
 * Alle weiteren Berichtsfilter bleiben beim Umschalten erhalten.
 */
export function ReportPeriodNavigator({
  defaultFrom,
  defaultTo,
  compact = false,
}: {
  defaultFrom: string;
  defaultTo: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedMode = searchParams.get('period');
  const from = searchParams.get('from') ?? defaultFrom;
  const to = searchParams.get('to') ?? defaultTo;
  const anchor = parseDate(from, defaultFrom);
  const monthBounds = bounds('month', anchor);
  const yearBounds = bounds('year', anchor);
  const inferredMode: PeriodMode =
    from === yearBounds.from && to === yearBounds.to
      ? 'year'
      : from === monthBounds.from && to === monthBounds.to
        ? 'month'
        : 'custom';
  const mode: PeriodMode =
    requestedMode === 'month' || requestedMode === 'year' || requestedMode === 'custom'
      ? requestedMode
      : inferredMode;

  const replacePeriod = React.useCallback(
    (next: { from: string; to: string; mode: PeriodMode }) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('from', next.from);
      params.set('to', next.to);
      params.set('period', next.mode);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const chooseMode = (nextMode: PeriodMode) => {
    if (nextMode === 'custom') {
      replacePeriod({ from, to, mode: nextMode });
      return;
    }
    replacePeriod({ ...bounds(nextMode, anchor), mode: nextMode });
  };

  const move = (amount: number) => {
    if (mode === 'custom') {
      const start = parseDate(from, defaultFrom);
      const end = parseDate(to, defaultTo);
      const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
      start.setUTCDate(start.getUTCDate() + amount * span);
      end.setUTCDate(end.getUTCDate() + amount * span);
      replacePeriod({ from: dateValue(start), to: dateValue(end), mode });
      return;
    }
    const next = new Date(anchor);
    if (mode === 'year') next.setUTCFullYear(next.getUTCFullYear() + amount);
    else next.setUTCMonth(next.getUTCMonth() + amount);
    replacePeriod({ ...bounds(mode, next), mode });
  };

  const jumpToCurrent = () => {
    const today = new Date();
    if (mode === 'custom') {
      const value = dateValue(today);
      replacePeriod({ from: value, to: value, mode });
    } else {
      replacePeriod({ ...bounds(mode, today), mode });
    }
  };

  const periodLabel =
    mode === 'year'
      ? new Intl.DateTimeFormat('de-DE', { year: 'numeric', timeZone: 'UTC' }).format(anchor)
      : mode === 'month'
        ? new Intl.DateTimeFormat('de-DE', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(anchor)
        : `${from} – ${to}`;

  return (
    <div
      className={cn(
        'flex flex-wrap items-end gap-2 rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-panel)] p-2 shadow-[var(--shadow-panel)]',
        compact && 'max-w-full',
      )}
      aria-label="Berichtszeitraum wählen"
    >
      <div className="flex rounded-[var(--radius-lg)] bg-[var(--color-panel-sunken)] p-1">
        {(
          [
            ['month', 'Monat'],
            ['year', 'Jahr'],
            ['custom', 'Individuell'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => chooseMode(value)}
            aria-pressed={mode === value}
            className={cn(
              'rounded-[var(--radius-md)] px-2.5 py-1.5 text-[length:var(--text-xs)] font-medium transition-colors',
              mode === value
                ? 'bg-[var(--color-panel)] text-[var(--color-brand)] shadow-sm'
                : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'custom' ? (
        <>
          <div>
            <Label htmlFor="report-period-from">Von</Label>
            <Input
              id="report-period-from"
              type="date"
              value={from}
              onChange={(event) =>
                replacePeriod({ from: event.target.value || defaultFrom, to, mode })
              }
              className="w-36"
            />
          </div>
          <div>
            <Label htmlFor="report-period-to">Bis</Label>
            <Input
              id="report-period-to"
              type="date"
              value={to}
              onChange={(event) =>
                replacePeriod({ from, to: event.target.value || defaultTo, mode })
              }
              className="w-36"
            />
          </div>
        </>
      ) : (
        <div className="flex min-w-[12rem] items-center justify-between gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => move(-1)}
            aria-label={mode === 'year' ? 'Vorheriges Jahr' : 'Vorheriger Monat'}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <div className="flex items-center gap-2 px-2 text-center">
            <CalendarDays className="size-4 text-[var(--color-brand)]" aria-hidden />
            <span className="text-[length:var(--text-sm)] font-semibold capitalize">
              {periodLabel}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => move(1)}
            aria-label={mode === 'year' ? 'Nächstes Jahr' : 'Nächster Monat'}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}

      <Button type="button" variant="secondary" size="sm" onClick={jumpToCurrent}>
        Heute
      </Button>
    </div>
  );
}
