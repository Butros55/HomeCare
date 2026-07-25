'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, format, isSameWeek, parseISO, startOfWeek } from 'date-fns';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { getRoutePlanDatesAction } from '@/server/actions/route-actions';

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const iso = (value: Date) => format(value, 'yyyy-MM-dd');

/**
 * Datumsleiste für die Routenplanung (wie die Kalender-Tagesansicht): eine Woche
 * mit Tag-Buttons, zwischen Wochen scrollbar, mit Farbmarker für Tage, an denen
 * bereits eine Route gespeichert ist (freigegeben = voller Punkt, Entwurf = Umriss).
 * Ersetzt den Datums-Picker – man sieht sofort, welche Tage geplant sind.
 */
export function RouteDateStrip({
  date,
  onSelect,
  employeeId,
}: {
  /** Ausgewählter Planungstag (YYYY-MM-DD). */
  date: string;
  onSelect: (date: string) => void;
  employeeId: string;
}) {
  const [weekStart, setWeekStart] = React.useState<Date>(() =>
    startOfWeek(parseISO(date), { weekStartsOn: 1 }),
  );
  // Wandert der ausgewählte Tag aus der sichtbaren Woche, die Woche nachziehen –
  // als Anpassung während des Renderns (statt im Effekt), damit keine kaskadierende
  // Neurenderung entsteht. React verarbeitet das setState sofort neu.
  const [lastDate, setLastDate] = React.useState(date);
  if (date !== lastDate) {
    setLastDate(date);
    const target = startOfWeek(parseISO(date), { weekStartsOn: 1 });
    if (!isSameWeek(weekStart, target, { weekStartsOn: 1 })) setWeekStart(target);
  }

  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const [planned, setPlanned] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    let cancelled = false;
    // Marker der sichtbaren Woche laden. Der Zustand wird ausschließlich im
    // asynchronen Zweig gesetzt (kein synchrones setState im Effekt-Rumpf).
    getRoutePlanDatesAction(employeeId, iso(days[0]!), iso(days[6]!)).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPlanned({});
        return;
      }
      const map: Record<string, string> = {};
      for (const entry of result.data) map[entry.date] = entry.status;
      setPlanned(map);
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId, days]);

  const todayIso = iso(new Date());

  // Den ausgewählten Tag stets vollständig sichtbar in die Leiste scrollen –
  // sonst klebt er (z. B. „Sa") am Rand und wirkt abgeschnitten.
  const selectedDayRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    selectedDayRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [date, weekStart]);

  return (
    <div className="flex items-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-1.5 shadow-[var(--shadow-panel)]">
      <button
        type="button"
        aria-label="Vorige Woche"
        onClick={() => setWeekStart((current) => addDays(current, -7))}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-panel-sunken)]"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>

      <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto scrollbar-none">
        {days.map((day, index) => {
          const dayIso = iso(day);
          const isSelected = dayIso === date;
          const isToday = dayIso === todayIso;
          const status = planned[dayIso];
          return (
            <button
              key={dayIso}
              ref={isSelected ? selectedDayRef : null}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(dayIso)}
              title={
                status ? (status === 'PUBLISHED' ? 'Route freigegeben' : 'Routenentwurf') : undefined
              }
              className={cn(
                'flex min-w-11 flex-1 flex-col items-center gap-0.5 rounded-[var(--radius-md)] px-1.5 py-1.5 transition-colors',
                isSelected
                  ? 'bg-[var(--color-brand)] text-white'
                  : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-panel-sunken)]',
              )}
            >
              <span
                className={cn(
                  'text-[length:var(--text-2xs)] uppercase',
                  isSelected ? 'text-white/80' : 'text-[var(--color-ink-subtle)]',
                )}
              >
                {WEEKDAY_LABELS[index]}
              </span>
              <span
                className={cn(
                  'tabular flex size-6 items-center justify-center rounded-full text-[length:var(--text-sm)] font-semibold',
                  isToday && !isSelected ? 'ring-1 ring-[var(--color-brand)]' : '',
                )}
              >
                {format(day, 'd')}
              </span>
              {/* Marker: gespeicherte Route an diesem Tag. */}
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  status === 'PUBLISHED'
                    ? isSelected
                      ? 'bg-white'
                      : 'bg-[var(--color-brand)]'
                    : status
                      ? isSelected
                        ? 'ring-1 ring-white'
                        : 'ring-1 ring-[var(--color-brand)]'
                      : 'bg-transparent',
                )}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="Nächste Woche"
        onClick={() => setWeekStart((current) => addDays(current, 7))}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-panel-sunken)]"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}
