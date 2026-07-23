'use client';

/**
 * ProYearCalendar — aus StudyMate portiert (MobileYearCalendar): scrollbare
 * Jahresansicht im iOS-Stil. Gleiche Datumskreise, Wochenend-Dämpfung und
 * Heute-Hervorhebung wie die Monatsansicht; ein Tipp auf einen Monat zoomt
 * in die Monatsansicht.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { addMonths, getDaysInMonth, isSameDay, startOfMonth, startOfYear, format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { animateScrollTo, CALENDAR_YEARS_BEFORE, CALENDAR_YEARS_AFTER } from './layout';

const YEARS_BEFORE = CALENDAR_YEARS_BEFORE;
const YEARS_AFTER = CALENDAR_YEARS_AFTER;

/** Montag-basierter Wochentagsindex (0 = Montag … 6 = Sonntag). */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function buildMiniRows(month: Date): (number | null)[][] {
  const lead = mondayIndex(startOfMonth(month));
  const days = getDaysInMonth(month);
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

interface ProYearCalendarProps {
  open: boolean;
  today: Date;
  focusYear?: number;
  todayJumpToken?: number;
  onSelectMonth: (month: Date, rect?: DOMRect) => void;
  header: ReactNode;
  onVisibleYearChange?: (year: number) => void;
}

function yearKey(year: number): string {
  return `year-${year}`;
}

export function ProYearCalendar({
  open,
  today,
  focusYear,
  todayJumpToken,
  onSelectMonth,
  header,
  onVisibleYearChange,
}: ProYearCalendarProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const yearEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const didInitialScroll = useRef(false);
  const seenJumpTokenRef = useRef(todayJumpToken);

  // „Heute“ in der Jahresansicht: zum aktuellen Jahr gleiten.
  useEffect(() => {
    if (todayJumpToken === undefined || todayJumpToken === seenJumpTokenRef.current) return;
    seenJumpTokenRef.current = todayJumpToken;
    const sc = scrollRef.current;
    const el = yearEls.current.get(today.getFullYear());
    if (sc && el) {
      animateScrollTo(sc, el.offsetTop);
      onVisibleYearChange?.(today.getFullYear());
    }
  }, [todayJumpToken, today, onVisibleYearChange]);

  const years = useMemo(() => {
    const base = today.getFullYear();
    const list: number[] = [];
    for (let i = -YEARS_BEFORE; i <= YEARS_AFTER; i++) list.push(base + i);
    return list;
  }, [today]);

  const todayMonthStart = useMemo(() => startOfMonth(today), [today]);

  useLayoutEffect(() => {
    if (!open) {
      didInitialScroll.current = false;
      return;
    }
    if (didInitialScroll.current) return;
    const targetYear = focusYear ?? today.getFullYear();
    const doScroll = () => {
      const sc = scrollRef.current;
      const el = yearEls.current.get(targetYear);
      if (sc && el) {
        sc.scrollTop = el.offsetTop;
        didInitialScroll.current = true;
        onVisibleYearChange?.(targetYear);
      }
    };
    doScroll();
    const raf = requestAnimationFrame(doScroll);
    const timer = window.setTimeout(doScroll, 140);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [open, today, focusYear, onVisibleYearChange]);

  const handleScroll = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    const top = sc.scrollTop;
    let current = years[0]!;
    for (const y of years) {
      const el = yearEls.current.get(y);
      if (el && el.offsetTop <= top + 6) current = y;
      else break;
    }
    onVisibleYearChange?.(current);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative min-h-0 flex-1 overflow-y-auto px-3 sm:px-5 lg:px-7"
      >
        {years.map((year) => (
          <div
            key={yearKey(year)}
            ref={(el) => {
              if (el) yearEls.current.set(year, el);
              else yearEls.current.delete(year);
            }}
            className="pt-5 sm:pt-7"
          >
            {/* iOS-Stil: großes Jahr, rot für das aktuelle Jahr, Haarlinie darunter. */}
            <h3
              className={cn(
                'border-b border-border/60 px-1 pb-2 text-3xl font-bold tracking-tight sm:text-4xl',
                year === today.getFullYear() ? 'text-red-500' : 'text-foreground',
              )}
            >
              {year}
            </h3>
            <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-7 sm:mt-5 sm:gap-x-6 sm:gap-y-9 lg:grid-cols-4">
              {Array.from({ length: 12 }, (_, index) => addMonths(startOfYear(new Date(year, 0, 1)), index)).map(
                (month) => {
                  const rows = buildMiniRows(month);
                  const isTodayMonth = isSameDay(startOfMonth(month), todayMonthStart);
                  return (
                    <button
                      key={month.getMonth()}
                      type="button"
                      onClick={(event) => onSelectMonth(month, event.currentTarget.getBoundingClientRect())}
                      className="flex min-w-0 flex-col rounded-xl text-left transition-colors hover:bg-muted/30"
                    >
                      <span
                        className={cn(
                          'mb-1.5 whitespace-nowrap text-[15px] font-bold capitalize sm:text-lg',
                          isTodayMonth ? 'text-red-500' : 'text-foreground',
                        )}
                      >
                        {format(month, 'MMMM', { locale: de })}
                      </span>
                      <div className="grid w-full grid-cols-7 gap-y-1">
                        {rows.flat().map((day, index) => {
                          const isToday =
                            day != null && isSameDay(new Date(month.getFullYear(), month.getMonth(), day), today);
                          return (
                            <span
                              key={index}
                              className={cn(
                                'flex h-4 items-center justify-center text-[10px] font-medium leading-none tabular-nums text-foreground sm:h-5 sm:text-[11px]',
                                day == null && 'opacity-0',
                              )}
                            >
                              {isToday ? (
                                <span className="flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white sm:size-5 sm:text-[10px]">
                                  {day}
                                </span>
                              ) : (
                                day ?? ''
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </button>
                  );
                },
              )}
            </div>
          </div>
        ))}
        <div className="h-12" />
      </div>
    </div>
  );
}
