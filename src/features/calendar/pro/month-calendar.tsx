'use client';

/**
 * ProMonthCalendar — aus StudyMate portiert (MobileMonthCalendar), eingebettet
 * in die Seite statt als Fullscreen-Dialog. Enthält unverändert:
 *
 *  - virtualisierte Monatsliste über ~11 Jahre (analytische Spacer),
 *  - kontinuierlichen Pinch-/Ctrl-Wheel-Zoom mit Stufen dots→bars→chips→full,
 *  - Monat↔Timeline-Morph (gemessenes Overlay, Woche gleitet zum Wochenstreifen),
 *  - Jahr↔Monat-Zoom mit Fokuspunkt,
 *  - animierter „Heute“-Sprung, Haptik-Ticks.
 *
 * Domäne angepasst: Chips sind HomeCare-Termine (Status-Farbwelt), Konflikt-
 * Tage tragen einen roten Ring, Lern-/Prüfungs-Logik der Vorlage entfällt.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { addDays, startOfMonth, startOfWeek, getDaysInMonth, format, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { CaretDown, SquaresFour, ListBullets, Plus, SidebarSimple, CalendarDots } from '@phosphor-icons/react';
import { LayoutGroup, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { primeHaptics, selectionHaptic } from './haptics';
import { useIsLandscapePhone, useIsMobile } from './use-viewport';
import { dayKey, type ProCalendarEvent, type ProEventKind } from './types';
import { ProTimelineCalendar } from './timeline-calendar';
import { ProYearCalendar } from './year-calendar';
import { CalendarViewTabs } from './view-tabs';
import {
  animateScrollTo,
  CALENDAR_YEARS_BEFORE,
  CALENDAR_YEARS_AFTER,
  chipScaleForRowH,
  DATE_CIRCLE_CLASS,
  MONTH_ROW_MIN_HEIGHT_CLASS,
  MONTH_ROW_MIN_PX,
  MONTH_ROW_MAX_PX,
  MONTH_ZOOM_FULL_ROW_H,
  nextMonthZoomMode,
  type MonthDensity,
  type MonthZoomMode,
  nearestMonthZoomStop,
  rowHForMonthZoomMode,
  WEEK_STRIP_HEIGHT_PX,
  WEEK_STRIP_DATE_CIRCLE_OFFSET_PX,
  WEEK_STRIP_GRID_CLASS,
  WEEKDAY_LABEL_CLASS,
  WEEKDAY_LABELS,
} from './layout';

type CalendarViewMode = 'year' | 'month' | 'week' | 'today';

interface ProMonthCalendarProps {
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  selectedKey: string;
  onSelectedKeyChange: (key: string) => void;
  onMonthChange: (month: Date) => void;
  eventsByDay: Map<string, ProCalendarEvent[]>;
  /** Tage mit mindestens einem Konflikt (roter Ring am Datum). */
  conflictDays: Set<string>;
  today: Date;
  /** Verwaltungsansicht: Mitarbeiter-Kennzeichen (Initialen) am Chip zeigen. */
  showEmployee?: boolean;
  /** Termin, der nach dem Anspringen kurz hervorgehoben wird. */
  highlightEventId?: string | null;
  onOpenEvent: (id: string) => void;
  onOpenPanel: (page: 'calendars' | 'day') => void;
  onCreate: (key: string) => void;
  sidePanel?: ReactNode;
}

const ROW_WINDOW_BUFFER = 5;
const VIEW_TRANSITION_MS = 380;
const VIEW_TRANSITION_EASE = [0.22, 1, 0.36, 1] as const;
const DENSITY_TRANSITION_MS = 300;
const ZOOM_TRANSITION_MS = 460;
const ZOOM_EASE = [0.32, 0.72, 0, 1] as const;

interface ZoomTransition {
  token: number;
  phase: 'in' | 'out';
  originX: number;
  originY: number;
}

const MONTH_CHIP_CLASS =
  'block min-w-0 max-w-full overflow-hidden truncate whitespace-nowrap rounded px-1 py-px text-[8.5px] leading-tight sm:px-1.5 sm:text-[10px] lg:px-2 lg:py-1 lg:text-xs';
const MONTH_CHIP_STACK_CLASS = 'relative flex min-h-0 min-w-0 max-w-full flex-col gap-0.5 overflow-hidden sm:gap-1';

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Montag-basierter Wochentagsindex (0 = Montag … 6 = Sonntag). */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

const CHIP_CLASS_BY_KIND: Record<ProEventKind, string> = {
  planned: 'bg-sky-500/20 text-sky-700 dark:text-sky-200',
  confirmed: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-200',
  done: 'bg-violet-500/20 text-violet-700 dark:text-violet-200',
  open: 'bg-amber-500/25 text-amber-800 dark:text-amber-200',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

const DOT_CLASS_BY_KIND: Record<ProEventKind, string> = {
  planned: 'bg-sky-500',
  confirmed: 'bg-emerald-500',
  done: 'bg-violet-500',
  open: 'bg-amber-500',
  cancelled: 'bg-muted-foreground/50',
};

/** Initialen aus einem Namen ("Sofia Lorenz" → "SL"). */
function nameInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

interface DayChip {
  key: string;
  label: string;
  cls: string;
  dot: string;
  sub?: string;
  isSeries: boolean;
  isFlexible: boolean;
  hasConflict: boolean;
  /** Verwaltungsansicht: Initialen des zuständigen Mitarbeiters (sonst null). */
  employeeInitials: string | null;
  /** Termin nach dem Anspringen kurz hervorheben. */
  highlighted: boolean;
}

/**
 * Termin-Chip der Monatsansicht mit Markern oben rechts: Konflikt (auffällige
 * rote Plakette + roter Rahmen) und Serie (subtiles Wiederholungs-Icon).
 */
function ProMonthChip({ chip }: { chip: DayChip }) {
  const showMarkers = chip.hasConflict || chip.isSeries || chip.isFlexible;
  const markerCount = (chip.hasConflict ? 1 : 0) + (chip.isSeries ? 1 : 0) + (chip.isFlexible ? 1 : 0);
  return (
    <span
      className={cn(
        MONTH_CHIP_CLASS,
        'relative',
        chip.cls,
        chip.hasConflict &&
          'ring-1 ring-inset ring-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)]',
        chip.highlighted && 'animate-pulse ring-2 ring-[var(--color-brand)]',
      )}
      title={
        chip.hasConflict
          ? 'Hinweis: bitte prüfen'
          : [chip.isFlexible ? 'Flexibler Termin' : null, chip.isSeries ? 'Serientermin' : null]
              .filter(Boolean)
              .join(' · ') || undefined
      }
    >
      <span
        className={cn(
          'flex items-center gap-1',
          showMarkers && (markerCount > 1 ? 'pr-5' : 'pr-3.5'),
        )}
      >
        {chip.employeeInitials ? (
          <span
            className="grid size-3.5 shrink-0 place-items-center rounded-full bg-black/25 text-[7px] font-bold leading-none"
            title="Mitarbeiter"
          >
            {chip.employeeInitials}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{chip.label}</span>
      </span>
      {showMarkers && (
        <span className="pointer-events-none absolute top-1/2 right-0.5 flex -translate-y-1/2 items-center gap-0.5">
          {chip.hasConflict && (
            <span className="grid size-3 place-items-center rounded-full bg-[var(--color-danger)] text-[7px] font-bold text-white">
              !
            </span>
          )}
          {chip.isFlexible && (
            <span className="text-[9px] leading-none opacity-70" aria-hidden title="Flexibel">
              ↔
            </span>
          )}
          {chip.isSeries && (
            <span className="text-[9px] leading-none opacity-70" aria-hidden>
              ↻
            </span>
          )}
        </span>
      )}
    </span>
  );
}

interface TransitionRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TransitionCell {
  key: string;
  dateLabel: string;
  isBlank: boolean;
  isWeekend: boolean;
  isToday: boolean;
  isSelected: boolean;
  isCrossMonth: boolean;
  chips: DayChip[];
  extra: number;
}

interface MonthTransitionItem {
  id: string;
  kind: 'label' | 'row';
  relation: 'above' | 'selected' | 'below';
  rect: TransitionRect;
  focusOffsetTop?: number;
  variant?: 'header-title';
  label?: string;
  cells?: TransitionCell[];
}

interface MonthViewTransition {
  id: number;
  phase: 'month-to-timeline' | 'timeline-to-month';
  targetTop: number;
  rootWidth: number;
  density: MonthDensity;
  zoomMode: MonthZoomMode;
  items: MonthTransitionItem[];
}

interface PendingReverseTransition {
  id: number;
  selectedKey: string;
  sourceTop: number;
}

interface MeasureMonthItemsOptions {
  phase: MonthViewTransition['phase'];
  targetTop: number;
  selectedKey: string;
  highlightKey: string;
  selectedMonthLabel?: string;
}

function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function rectRelativeTo(rect: DOMRect, rootRect: DOMRect): TransitionRect {
  return {
    top: rect.top - rootRect.top,
    left: rect.left - rootRect.left,
    width: rect.width,
    height: rect.height,
  };
}

function buildMonthRows(month: Date): (Date | null)[][] {
  const lead = mondayIndex(startOfMonth(month));
  const daysInMonth = getDaysInMonth(month);
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

function transitionTarget(item: MonthTransitionItem, transition: MonthViewTransition) {
  const distance = Math.max(120, item.rect.height * 1.35);

  if (transition.phase === 'month-to-timeline') {
    if (item.variant === 'header-title') {
      return { y: 0, opacity: 0 };
    }

    if (item.relation === 'selected') {
      const initialFocusOffset =
        (item.focusOffsetTop ?? WEEK_STRIP_DATE_CIRCLE_OFFSET_PX) - WEEK_STRIP_DATE_CIRCLE_OFFSET_PX;
      const targetFocusOffset = transition.targetTop - item.rect.top - WEEK_STRIP_DATE_CIRCLE_OFFSET_PX;
      return {
        initial: {
          y: initialFocusOffset,
          opacity: 1,
          height: WEEK_STRIP_HEIGHT_PX,
        },
        animate: {
          y: targetFocusOffset,
          opacity: 1,
          height: WEEK_STRIP_HEIGHT_PX,
        },
      };
    }
    return {
      y: item.relation === 'above' ? -distance : distance,
      opacity: 0,
    };
  }

  if (item.relation === 'selected') {
    const focusedTop = item.rect.top + (item.focusOffsetTop ?? 0);
    return {
      initial: {
        y: transition.targetTop - focusedTop,
        opacity: 1,
        height: WEEK_STRIP_HEIGHT_PX,
      },
      animate: { y: 0, opacity: 1, height: item.rect.height },
    };
  }

  return {
    initial: {
      y: item.relation === 'above' ? -distance : distance,
      opacity: 0,
    },
    animate: { y: 0, opacity: 1 },
  };
}

function MonthTransitionOverlay({ transition }: { transition: MonthViewTransition | null }) {
  if (!transition) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden" aria-hidden="true">
      {transition.items.map((item) => {
        const target = transitionTarget(item, transition);
        const baseInitial = 'initial' in target ? target.initial : { y: 0, opacity: 1 };
        const animate = 'animate' in target ? target.animate : target;

        const rowIsSelected = item.kind === 'row' && item.relation === 'selected';
        const rowIsTimelineStrip = transition.phase === 'month-to-timeline' && rowIsSelected;
        const fadeMonthRowOutQuickly =
          transition.phase === 'month-to-timeline' && item.kind === 'row' && !rowIsSelected;
        const initial = fadeMonthRowOutQuickly ? { ...baseInitial, opacity: 0.28 } : baseInitial;
        const itemTransition = rowIsSelected
          ? {
              duration: VIEW_TRANSITION_MS / 1000,
              ease: VIEW_TRANSITION_EASE,
              opacity: { duration: 0.18, ease: 'easeOut' as const },
            }
          : {
              duration: VIEW_TRANSITION_MS / 1000,
              ease: VIEW_TRANSITION_EASE,
              opacity: { duration: fadeMonthRowOutQuickly ? 0.12 : 0.34, ease: 'easeOut' as const },
            };

        return (
          <motion.div
            key={`${transition.id}-${item.id}`}
            initial={initial}
            animate={animate}
            transition={itemTransition}
            className={cn(
              'absolute transform-gpu overflow-hidden',
              rowIsSelected && transition.phase === 'timeline-to-month' && 'bg-background/90 backdrop-blur-md',
            )}
            style={{
              top: item.rect.top,
              left: rowIsTimelineStrip ? 0 : item.rect.left,
              width: rowIsTimelineStrip ? transition.rootWidth : item.rect.width,
              height: item.rect.height,
              willChange: rowIsSelected ? 'transform, opacity, height' : 'transform, opacity',
            }}
          >
            {item.kind === 'label' ? (
              <div
                className={cn(
                  'h-full capitalize',
                  item.variant === 'header-title'
                    ? 'text-[clamp(1.45rem,6vw,2rem)] font-bold leading-tight tracking-tight text-foreground'
                    : 'px-4 pb-1 pt-3 text-lg font-semibold text-primary',
                )}
              >
                {item.label}
              </div>
            ) : (
              <div className={cn('h-full', WEEK_STRIP_GRID_CLASS)}>
                {(item.cells ?? []).map((cell) => {
                  if (cell.isBlank) {
                    return (
                      <div
                        key={cell.key}
                        className={cn(
                          rowIsTimelineStrip ? 'min-h-16' : MONTH_ROW_MIN_HEIGHT_CLASS,
                          'min-w-0 border-t border-border/30',
                        )}
                      />
                    );
                  }

                  const detailsInitialOpacity = transition.phase === 'timeline-to-month' ? 0 : 1;
                  const detailsAnimateOpacity = transition.phase === 'timeline-to-month' ? 1 : 0;
                  const detailsDuration = transition.phase === 'timeline-to-month' ? 0.22 : 0.16;
                  const backgroundInitialOpacity = transition.phase === 'timeline-to-month' ? 0 : 1;
                  const backgroundAnimateOpacity = transition.phase === 'timeline-to-month' ? 1 : 0;
                  const crossMonthFade = cell.isCrossMonth
                    ? {
                        initial: { opacity: transition.phase === 'month-to-timeline' ? 0 : 1 },
                        animate: { opacity: transition.phase === 'month-to-timeline' ? 1 : 0 },
                        transition: { duration: VIEW_TRANSITION_MS / 1000, ease: VIEW_TRANSITION_EASE },
                      }
                    : {};
                  return (
                    <motion.div
                      key={cell.key}
                      initial={
                        rowIsSelected
                          ? { opacity: 0.86, y: transition.phase === 'month-to-timeline' ? 0 : 14 }
                          : undefined
                      }
                      animate={rowIsSelected ? { opacity: 1, y: 0 } : undefined}
                      transition={{
                        duration: rowIsSelected ? VIEW_TRANSITION_MS / 1000 : 0,
                        ease: VIEW_TRANSITION_EASE,
                      }}
                      className={cn(
                        rowIsTimelineStrip
                          ? 'min-h-16 items-center justify-start border-0 px-0 pb-0 pt-[1.35rem] text-center'
                          : MONTH_ROW_MIN_HEIGHT_CLASS,
                        'relative flex min-w-0 flex-col overflow-hidden',
                        !rowIsTimelineStrip && 'gap-0.5 border-t border-border/30 px-0.5 text-left',
                        !rowIsTimelineStrip && (transition.density === 'compact' ? 'pb-0.5 pt-1' : 'pb-1 pt-1.5'),
                      )}
                    >
                      {!rowIsTimelineStrip && !cell.isCrossMonth && (
                        <motion.span
                          aria-hidden="true"
                          initial={{ opacity: backgroundInitialOpacity }}
                          animate={{ opacity: backgroundAnimateOpacity }}
                          transition={{ duration: detailsDuration, ease: 'easeOut' }}
                          className={cn('pointer-events-none absolute inset-0', cell.isWeekend && 'bg-muted/20')}
                        />
                      )}
                      <motion.span
                        {...crossMonthFade}
                        className={cn(
                          'relative mx-auto shrink-0',
                          DATE_CIRCLE_CLASS,
                          cell.isSelected
                            ? 'text-white'
                            : cell.isCrossMonth && cell.isWeekend
                              ? 'text-muted-foreground'
                              : 'text-foreground',
                        )}
                      >
                        {cell.isSelected && (
                          <motion.span
                            aria-hidden="true"
                            initial={{ opacity: 0, scale: 0.55 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                            className="absolute inset-0 rounded-full bg-red-500 shadow-sm"
                          />
                        )}
                        <span className="relative z-10">{cell.dateLabel}</span>
                      </motion.span>
                      {!rowIsTimelineStrip && transition.zoomMode === 'dots' && (
                        <motion.div
                          initial={{ opacity: detailsInitialOpacity, y: transition.phase === 'timeline-to-month' ? 7 : 0 }}
                          animate={{ opacity: detailsAnimateOpacity, y: 0 }}
                          transition={{ duration: detailsDuration, ease: VIEW_TRANSITION_EASE }}
                          className="mx-auto mt-1 flex min-h-0 w-full max-w-full flex-wrap content-start items-center justify-center gap-1 overflow-hidden text-center"
                        >
                          {cell.chips.map((chip) => (
                            <span key={chip.key} className={cn('size-2 shrink-0 rounded-full', chip.dot)} />
                          ))}
                          {cell.extra > 0 && (
                            <span className="text-[8px] font-medium leading-none text-muted-foreground">+{cell.extra}</span>
                          )}
                        </motion.div>
                      )}
                      {!rowIsTimelineStrip && transition.zoomMode === 'bars' && (
                        <motion.div
                          initial={{ opacity: detailsInitialOpacity, y: transition.phase === 'timeline-to-month' ? 7 : 0 }}
                          animate={{ opacity: detailsAnimateOpacity, y: 0 }}
                          transition={{ duration: detailsDuration, ease: VIEW_TRANSITION_EASE }}
                          className="mt-1 flex w-full flex-col gap-1 overflow-hidden"
                        >
                          {cell.chips.map((chip) => (
                            <span key={chip.key} className={cn('h-1.5 w-full rounded-full', chip.dot)} />
                          ))}
                        </motion.div>
                      )}
                      {!rowIsTimelineStrip && transition.zoomMode !== 'dots' && transition.zoomMode !== 'bars' && (
                        <motion.div
                          initial={{ opacity: detailsInitialOpacity, y: transition.phase === 'timeline-to-month' ? 7 : 0 }}
                          animate={{ opacity: detailsAnimateOpacity, y: 0 }}
                          transition={{ duration: detailsDuration, ease: VIEW_TRANSITION_EASE }}
                          className={MONTH_CHIP_STACK_CLASS}
                        >
                          {cell.chips.map((chip) => (
                            <ProMonthChip key={chip.key} chip={chip} />
                          ))}
                          {cell.extra > 0 && (
                            <span className="block min-w-0 max-w-full truncate px-1 text-[8.5px] leading-tight text-muted-foreground">
                              +{cell.extra}
                            </span>
                          )}
                        </motion.div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

/** Telefon-Bottom-Bar: „Heute“ springt zum heutigen Tag, „Kalender“ öffnet das Panel. */
function CalendarMobileBottomBar({
  onToday,
  onOpenCalendars,
}: {
  onToday: () => void;
  onOpenCalendars: () => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-40 flex items-stretch gap-2 border-t border-border/50 bg-background/92 px-4 pb-[calc(env(safe-area-inset-bottom)+0.4rem)] pt-2 backdrop-blur-md">
      <button
        type="button"
        onClick={onToday}
        className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 active:bg-primary/15"
      >
        <CalendarDots size={20} weight="bold" />
        Heute
      </button>
      <button
        type="button"
        onClick={onOpenCalendars}
        className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 active:bg-primary/15"
      >
        <SidebarSimple size={20} />
        Kalender
      </button>
    </div>
  );
}

export function ProMonthCalendar({
  viewMode,
  onViewModeChange,
  selectedKey,
  onSelectedKeyChange,
  onMonthChange,
  eventsByDay,
  conflictDays,
  today,
  showEmployee = false,
  highlightEventId = null,
  onOpenEvent,
  onOpenPanel,
  onCreate,
  sidePanel,
}: ProMonthCalendarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didInitialScroll = useRef(false);
  const transitionIdRef = useRef(0);
  const transitionTimerRef = useRef<number | null>(null);
  const correctedTransitionIdRef = useRef<number | null>(null);
  const [viewTransition, setViewTransition] = useState<MonthViewTransition | null>(null);
  const [pendingReverseTransition, setPendingReverseTransition] = useState<PendingReverseTransition | null>(null);
  const [zoom, setZoom] = useState<ZoomTransition | null>(null);
  const zoomTimerRef = useRef<number | null>(null);
  const [yearTodayJumpToken, setYearTodayJumpToken] = useState(0);
  const timelineGoToTodayRef = useRef<(() => void) | null>(null);
  const lastZoomOriginRef = useRef<{ x: number; y: number }>({ x: 50, y: 32 });

  const baseYear = today.getFullYear() - CALENDAR_YEARS_BEFORE;
  const months = useMemo(() => {
    const list: Date[] = [];
    const yearsSpan = CALENDAR_YEARS_BEFORE + CALENDAR_YEARS_AFTER;
    for (let y = 0; y <= yearsSpan; y++) {
      for (let m = 0; m < 12; m++) list.push(new Date(baseYear + y, m, 1));
    }
    return list;
  }, [baseYear]);
  const monthsByKey = useMemo(() => new Map(months.map((m) => [monthKey(m), m])), [months]);
  const monthIndexOf = (d: Date) => {
    const idx = (d.getFullYear() - baseYear) * 12 + d.getMonth();
    return Math.max(0, Math.min(months.length - 1, idx));
  };
  const monthMetrics = useMemo(() => {
    const cumRows = new Array<number>(months.length + 1);
    cumRows[0] = 0;
    for (let i = 0; i < months.length; i++) cumRows[i + 1] = cumRows[i]! + buildMonthRows(months[i]!).length;
    return { cumRows };
  }, [months]);
  const [labelHeight, setLabelHeight] = useState(44);
  const labelHeightRef = useRef(44);
  labelHeightRef.current = labelHeight;
  const monthTopPx = (index: number) =>
    monthMetrics.cumRows[index]! * rowHRef.current + index * labelHeightRef.current;
  const measureLabelHeight = () => {
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-transition-kind="label"]');
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    if (h > 0) {
      labelHeightRef.current = h;
      if (Math.abs(h - labelHeight) > 0.5) setLabelHeight(h);
    }
  };

  const [rowWindow, setRowWindow] = useState(() => {
    const idx = monthIndexOf(startOfMonth(dateFromKey(selectedKey)));
    return {
      start: Math.max(0, idx - ROW_WINDOW_BUFFER),
      end: Math.min(months.length - 1, idx + ROW_WINDOW_BUFFER),
    };
  });
  const rowWindowRef = useRef(rowWindow);
  rowWindowRef.current = rowWindow;
  const monthElCacheRef = useRef<Map<string, ReactNode>>(new Map());
  const monthElSigRef = useRef<unknown[]>([]);
  const isZoomingRef = useRef(false);
  const topSpacerHeight = `calc(var(--month-row-h) * ${monthMetrics.cumRows[rowWindow.start]} + ${rowWindow.start * labelHeight}px)`;
  const bottomSpacerHeight = `calc(var(--month-row-h) * ${monthMetrics.cumRows[months.length]! - monthMetrics.cumRows[rowWindow.end + 1]!} + ${(months.length - (rowWindow.end + 1)) * labelHeight}px)`;

  const [visibleLabel, setVisibleLabel] = useState(() => format(today, 'yyyy', { locale: de }));
  const [visibleYear, setVisibleYear] = useState(() => today.getFullYear());
  const [zoomMode, setZoomMode] = useState<MonthZoomMode>('chips');
  const monthDensity: MonthDensity = zoomMode === 'dots' ? 'compact' : 'detail';
  const zoomModeRef = useRef<MonthZoomMode>('chips');
  const rowHRef = useRef<number>(rowHForMonthZoomMode('chips'));
  const zoomAnimRef = useRef<number | null>(null);
  const wheelSnapTimerRef = useRef<number | null>(null);
  const monthsInnerRef = useRef<HTMLDivElement | null>(null);
  const zoomAnchorRef = useRef<{ key: string; pivotViewportY: number; baseRowH: number } | null>(null);
  const pinchStateRef = useRef<{ active: boolean; startDist: number; startRowH: number }>({
    active: false,
    startDist: 0,
    startRowH: 0,
  });
  const pinchPendingScaleRef = useRef<number | null>(null);
  const pinchRafRef = useRef<number | null>(null);
  const isLandscapePhone = useIsLandscapePhone();
  const isMobile = useIsMobile();
  const showViewTabs = !isMobile;
  const isTimelineMode = viewMode === 'week' || viewMode === 'today';

  useEffect(() => {
    primeHaptics();
  }, []);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
      if (zoomTimerRef.current) window.clearTimeout(zoomTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (viewMode !== 'month') {
      didInitialScroll.current = false;
      return;
    }
    if (didInitialScroll.current) return;
    const selectedDate = new Date(`${selectedKey}T00:00:00`);
    const targetMonth = startOfMonth(selectedDate);
    const targetIndex = monthIndexOf(targetMonth);
    const doScroll = () => {
      const sc = scrollRef.current;
      if (!sc) return;
      measureLabelHeight();
      const start = Math.max(0, targetIndex - ROW_WINDOW_BUFFER);
      const end = Math.min(months.length - 1, targetIndex + ROW_WINDOW_BUFFER);
      if (rowWindowRef.current.start !== start || rowWindowRef.current.end !== end) {
        rowWindowRef.current = { start, end };
        setRowWindow({ start, end });
      }
      sc.scrollTop = monthTopPx(targetIndex);
      didInitialScroll.current = true;
      setVisibleLabel(format(targetMonth, 'yyyy', { locale: de }));
      setVisibleYear(targetMonth.getFullYear());
    };
    doScroll();
    const raf1 = requestAnimationFrame(doScroll);
    const timer = window.setTimeout(doScroll, 140);
    return () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(timer);
    };
     
  }, [selectedKey, viewMode]);

  useEffect(() => {
    if (viewMode !== 'month') return;
    const onResize = () => measureLabelHeight();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
     
  }, [viewMode]);

  const syncFromScroll = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    const top = sc.scrollTop;
    const rowH = rowHRef.current;
    const labelH = labelHeightRef.current;
    const posAt = (i: number) => monthMetrics.cumRows[i]! * rowH + i * labelH;
    let lo = 0;
    let hi = months.length - 1;
    let topIndex = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (posAt(mid) <= top + 6) {
        topIndex = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const viewportBottom = top + sc.clientHeight;
    lo = topIndex;
    hi = months.length - 1;
    let bottomIndex = topIndex;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (posAt(mid) < viewportBottom) {
        bottomIndex = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const current = months[topIndex]!;
    setVisibleLabel(format(current, 'yyyy', { locale: de }));
    setVisibleYear(current.getFullYear());

    if (isZoomingRef.current) return;
    const start = Math.max(0, topIndex - ROW_WINDOW_BUFFER);
    const end = Math.min(months.length - 1, bottomIndex + ROW_WINDOW_BUFFER);
    const cur = rowWindowRef.current;
    if (start !== cur.start || end !== cur.end) setRowWindow({ start, end });
  };
  const handleScroll = () => syncFromScroll();

  function buildChips(key: string): { chips: DayChip[]; extra: number } {
    const chips: DayChip[] = [];
    for (const ev of eventsByDay.get(key) ?? []) {
      chips.push({
        key: ev.id,
        label: ev.summary,
        cls: CHIP_CLASS_BY_KIND[ev.kind],
        dot: DOT_CLASS_BY_KIND[ev.kind],
        sub: format(new Date(ev.start), 'HH:mm'),
        isSeries: ev.isSeries,
        isFlexible: ev.isFlexible,
        hasConflict: ev.hasConflict,
        employeeInitials: showEmployee && ev.employeeName ? nameInitials(ev.employeeName) : null,
        highlighted: ev.id === highlightEventId,
      });
    }
    const MAX = 3;
    return { chips: chips.slice(0, MAX), extra: Math.max(0, chips.length - MAX) };
  }

  function buildTransitionCell(
    day: Date | null,
    rowIndex: number,
    cellIndex: number,
    highlightKey: string,
    isCrossMonth = false,
  ): TransitionCell {
    if (!day) {
      return {
        key: `blank-${rowIndex}-${cellIndex}`,
        dateLabel: '',
        isBlank: true,
        isWeekend: cellIndex > 4,
        isToday: false,
        isSelected: false,
        isCrossMonth: false,
        chips: [],
        extra: 0,
      };
    }

    const key = dayKey(day);
    const { chips, extra } = isCrossMonth ? { chips: [], extra: 0 } : buildChips(key);
    return {
      key,
      dateLabel: String(day.getDate()),
      isBlank: false,
      isWeekend: cellIndex > 4,
      isToday: isSameDay(day, today),
      isSelected: key === highlightKey,
      isCrossMonth,
      chips,
      extra,
    };
  }

  function buildSelectedWeekCells(
    itemMonth: Date,
    selectedKeyValue: string,
    highlightKey: string,
    rowIndex: number,
  ): TransitionCell[] {
    const weekStart = startOfWeek(dateFromKey(selectedKeyValue), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, cellIndex) => {
      const day = addDays(weekStart, cellIndex);
      const isCrossMonth =
        day.getMonth() !== itemMonth.getMonth() || day.getFullYear() !== itemMonth.getFullYear();
      return buildTransitionCell(day, rowIndex, cellIndex, highlightKey, isCrossMonth);
    });
  }

  const clearViewTransition = (phase: MonthViewTransition['phase']) => {
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    const linger = phase === 'month-to-timeline' ? VIEW_TRANSITION_MS + 200 : VIEW_TRANSITION_MS + 70;
    transitionTimerRef.current = window.setTimeout(() => {
      setViewTransition(null);
      transitionTimerRef.current = null;
    }, linger);
  };

  const measureWeekStripDateTop = () => {
    const root = rootRef.current;
    if (!root) return 84;
    const rootRect = root.getBoundingClientRect();
    const activeTimelineDate = root.querySelector('[data-mobile-timeline-active-date="true"]');
    const activeDateRect = activeTimelineDate?.getBoundingClientRect();
    if (activeDateRect) {
      return activeDateRect.top - rootRect.top;
    }
    const weekStrip = root.querySelector('[data-mobile-week-strip="true"]');
    const stripRect = weekStrip?.getBoundingClientRect();
    return (stripRect ? stripRect.top - rootRect.top : 84) + WEEK_STRIP_DATE_CIRCLE_OFFSET_PX;
  };

  const measureMonthItems = (
    selectedDayElement: HTMLElement | null,
    options: MeasureMonthItemsOptions,
  ): MonthViewTransition | null => {
    const root = rootRef.current;
    const scroller = scrollRef.current;
    const selectedRow = selectedDayElement?.closest<HTMLElement>('[data-mobile-month-row="true"]');
    if (!root || !scroller || !selectedRow) return null;

    const rootRect = root.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const selectedRect = selectedRow.getBoundingClientRect();
    const selectedDateNumber = selectedDayElement?.querySelector<HTMLElement>(
      '[data-mobile-month-day-number="true"]',
    );
    const selectedNumberRect = selectedDateNumber?.getBoundingClientRect();
    const selectedFocusOffsetTop = selectedNumberRect ? selectedNumberRect.top - selectedRect.top : 6;
    const selectedItemId = selectedRow.dataset.transitionItemId;
    const items: MonthTransitionItem[] = [];
    const headerTitle = root.querySelector<HTMLElement>('[data-mobile-month-header-title="true"]');
    const headerTitleRect = headerTitle?.getBoundingClientRect();

    if (options.phase === 'month-to-timeline' && headerTitleRect) {
      items.push({
        id: 'header-title',
        kind: 'label',
        relation: 'above',
        rect: rectRelativeTo(headerTitleRect, rootRect),
        variant: 'header-title',
        label: options.selectedMonthLabel || headerTitle?.textContent?.trim() || visibleLabel,
      });
    }

    for (const element of Array.from(
      scroller.querySelectorAll<HTMLElement>('[data-mobile-month-transition-item="true"]'),
    )) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) continue;

      const id = element.dataset.transitionItemId;
      const itemMonthKey = element.dataset.monthKey;
      if (!id || !itemMonthKey) continue;

      const itemMonth = monthsByKey.get(itemMonthKey);
      if (!itemMonth) continue;

      const relation = id === selectedItemId ? 'selected' : rect.top < selectedRect.top ? 'above' : 'below';
      const kind = element.dataset.transitionKind === 'label' ? 'label' : 'row';
      const baseItem = {
        id,
        kind,
        relation,
        rect: rectRelativeTo(rect, rootRect),
        focusOffsetTop: relation === 'selected' ? selectedFocusOffsetTop : undefined,
      } satisfies Pick<MonthTransitionItem, 'id' | 'kind' | 'relation' | 'rect' | 'focusOffsetTop'>;

      if (kind === 'label') {
        items.push({
          ...baseItem,
          label: format(itemMonth, itemMonth.getMonth() === 0 ? 'MMMM yyyy' : 'MMMM', { locale: de }),
        });
        continue;
      }

      const rowIndex = Number(element.dataset.rowIndex ?? 0);
      const row = buildMonthRows(itemMonth)[rowIndex] ?? [];
      const cells =
        relation === 'selected'
          ? buildSelectedWeekCells(itemMonth, options.selectedKey, options.highlightKey, rowIndex)
          : row.map((day, cellIndex) => buildTransitionCell(day, rowIndex, cellIndex, options.highlightKey));
      items.push({ ...baseItem, cells });
    }

    if (items.length === 0) return null;

    return {
      id: ++transitionIdRef.current,
      phase: options.phase,
      targetTop: options.targetTop,
      rootWidth: rootRect.width,
      density: monthDensity,
      zoomMode,
      items,
    };
  };

  const startMonthToTimelineTransition = (
    targetMode: Exclude<CalendarViewMode, 'month'>,
    nextSelectedKey: string,
    selectedDayElement: HTMLElement | null,
  ) => {
    const selectedDate = dateFromKey(nextSelectedKey);
    const selectedMonthLabel = format(selectedDate, 'MMMM yyyy', { locale: de });
    const measured = measureMonthItems(selectedDayElement, {
      phase: 'month-to-timeline',
      targetTop: measureWeekStripDateTop(),
      selectedKey: nextSelectedKey,
      highlightKey: nextSelectedKey,
      selectedMonthLabel,
    });
    if (measured) {
      setViewTransition(measured);
      clearViewTransition('month-to-timeline');
    } else {
      setViewTransition(null);
    }
    onSelectedKeyChange(nextSelectedKey);
    onMonthChange(startOfMonth(selectedDate));
    onViewModeChange(targetMode);
  };

  const startTimelineToMonthTransition = () => {
    const sourceTop = measureWeekStripDateTop();
    setPendingReverseTransition({
      id: ++transitionIdRef.current,
      selectedKey,
      sourceTop,
    });
    onViewModeChange('month');
  };

  const clearZoomLater = () => {
    if (zoomTimerRef.current) window.clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = window.setTimeout(() => {
      setZoom(null);
      zoomTimerRef.current = null;
    }, ZOOM_TRANSITION_MS + 40);
  };

  const originFromRect = (rect: DOMRect | null): { x: number; y: number } | undefined => {
    const root = rootRef.current;
    if (!rect || !root) return undefined;
    const r = root.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return undefined;
    return {
      x: ((rect.left + rect.width / 2 - r.left) / r.width) * 100,
      y: ((rect.top + rect.height / 2 - r.top) / r.height) * 100,
    };
  };

  const startZoom = (phase: ZoomTransition['phase'], origin?: { x: number; y: number }) => {
    const focal = origin ?? lastZoomOriginRef.current;
    lastZoomOriginRef.current = focal;
    setZoom({ token: ++transitionIdRef.current, phase, originX: focal.x, originY: focal.y });
    clearZoomLater();
  };

  const handleViewModeChange = (mode: CalendarViewMode) => {
    if (mode === viewMode) return;
    selectionHaptic();
    const targetIsTimeline = mode === 'week' || mode === 'today';
    const currentIsTimeline = viewMode === 'week' || viewMode === 'today';

    if (viewMode === 'month' && targetIsTimeline) {
      const selectedButton = scrollRef.current?.querySelector<HTMLElement>(`[data-day-key="${selectedKey}"]`) ?? null;
      startMonthToTimelineTransition(mode, selectedKey, selectedButton);
      return;
    }

    if (currentIsTimeline && mode === 'month') {
      startTimelineToMonthTransition();
      return;
    }

    if (viewMode === 'year' && mode === 'month') startZoom('in');
    else if (viewMode === 'month' && mode === 'year') startZoom('out');

    onViewModeChange(mode);
  };

  const handleSelectMonthFromYear = (month: Date, rect?: DOMRect) => {
    selectionHaptic();
    const nextKey = dayKey(startOfMonth(month));
    onSelectedKeyChange(nextKey);
    onMonthChange(startOfMonth(month));
    startZoom('in', originFromRect(rect ?? null));
    onViewModeChange('month');
  };

  useLayoutEffect(() => {
    if (!pendingReverseTransition || viewMode !== 'month') return;

    const selectedButton =
      scrollRef.current?.querySelector<HTMLElement>(
        `[data-day-key="${pendingReverseTransition.selectedKey}"]`,
      ) ?? null;
    const measured = measureMonthItems(selectedButton, {
      phase: 'timeline-to-month',
      targetTop: pendingReverseTransition.sourceTop,
      selectedKey: pendingReverseTransition.selectedKey,
      highlightKey: dayKey(today),
    });
    if (measured) {
      setViewTransition({
        ...measured,
        id: pendingReverseTransition.id,
      });
      clearViewTransition('timeline-to-month');
    }
    setPendingReverseTransition(null);
  });

  // ----- Kontinuierlicher Pinch-Zoom -----
  const setRowHeightVar = (rowH: number) => {
    const sc = scrollRef.current;
    if (!sc) return;
    sc.style.setProperty('--month-row-h', `${rowH}px`);
    sc.style.setProperty('--chip-scale', chipScaleForRowH(rowH).toFixed(3));
  };

  const dayKeyAt = (viewportY: number): string | null => {
    const scroller = scrollRef.current;
    if (!scroller) return null;
    const scrollerRect = scroller.getBoundingClientRect();
    let best: { key: string; distance: number } | null = null;
    for (const el of Array.from(scroller.querySelectorAll<HTMLElement>('[data-day-key]'))) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) continue;
      const key = el.dataset.dayKey;
      if (!key) continue;
      const distance = Math.abs(rect.top - viewportY);
      if (!best || distance < best.distance) best = { key, distance };
    }
    return best?.key ?? null;
  };

  const viewportCenterY = (): number => {
    const scroller = scrollRef.current;
    if (!scroller) return 0;
    const r = scroller.getBoundingClientRect();
    return r.top + Math.min(r.height * 0.42, 220);
  };

  const captureZoomAnchor = (viewportY: number) => {
    const scroller = scrollRef.current;
    const key = dayKeyAt(viewportY);
    const el = key && scroller ? scroller.querySelector<HTMLElement>(`[data-day-key="${key}"]`) : null;
    zoomAnchorRef.current =
      key && scroller && el
        ? {
            key,
            pivotViewportY: el.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
            baseRowH: rowHRef.current,
          }
        : null;
  };

  const pinPivot = () => {
    const scroller = scrollRef.current;
    const a = zoomAnchorRef.current;
    if (!scroller || !a) return;
    const el = scroller.querySelector<HTMLElement>(`[data-day-key="${a.key}"]`);
    if (!el) return;
    const nowTop = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += nowTop - a.pivotViewportY;
  };

  const applyZoom = (rowH: number) => {
    const clamped = Math.max(MONTH_ROW_MIN_PX, Math.min(MONTH_ROW_MAX_PX, rowH));
    rowHRef.current = clamped;
    setRowHeightVar(clamped);
    const nextMode = nextMonthZoomMode(clamped, zoomModeRef.current);
    if (nextMode !== zoomModeRef.current) {
      zoomModeRef.current = nextMode;
      setZoomMode(nextMode);
      selectionHaptic();
    }
    pinPivot();
  };

  const commitZoom = () => {
    pinPivot();
    zoomAnchorRef.current = null;
    isZoomingRef.current = false;
    syncFromScroll();
  };

  const cancelZoomAnim = () => {
    if (zoomAnimRef.current) window.cancelAnimationFrame(zoomAnimRef.current);
    zoomAnimRef.current = null;
  };

  const animateZoomTo = (target: number) => {
    cancelZoomAnim();
    isZoomingRef.current = true;
    if (!zoomAnchorRef.current) captureZoomAnchor(viewportCenterY());
    const start = rowHRef.current;
    const delta = target - start;
    if (Math.abs(delta) < 0.5) {
      applyZoom(target);
      commitZoom();
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / DENSITY_TRANSITION_MS));
      applyZoom(start + delta * (1 - Math.pow(1 - p, 3)));
      if (p < 1) {
        zoomAnimRef.current = window.requestAnimationFrame(step);
      } else {
        zoomAnimRef.current = null;
        commitZoom();
      }
    };
    zoomAnimRef.current = window.requestAnimationFrame(step);
  };

  const settleZoom = () => {
    if (rowHRef.current > MONTH_ZOOM_FULL_ROW_H + 4) {
      commitZoom();
      return;
    }
    animateZoomTo(nearestMonthZoomStop(rowHRef.current).rowH);
  };

  const handleDensityChange = (mode: MonthDensity) => {
    captureZoomAnchor(viewportCenterY());
    animateZoomTo(rowHForMonthZoomMode(mode === 'compact' ? 'dots' : 'chips'));
  };

  const flushPinch = () => {
    pinchRafRef.current = null;
    const st = pinchStateRef.current;
    const scale = pinchPendingScaleRef.current;
    if (!st.active || scale == null) return;
    applyZoom(st.startRowH * scale);
  };

  const touchZoomFnRef = useRef<{
    start: (e: TouchEvent) => void;
    move: (e: TouchEvent) => void;
    end: (e: TouchEvent) => void;
  }>({
    start: () => {},
    move: () => {},
    end: () => {},
  });
  touchZoomFnRef.current = {
    start: (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const [a, b] = [event.touches[0]!, event.touches[1]!];
      cancelZoomAnim();
      isZoomingRef.current = true;
      captureZoomAnchor((a.clientY + b.clientY) / 2);
      pinchStateRef.current = {
        active: true,
        startDist: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
        startRowH: rowHRef.current,
      };
      pinchPendingScaleRef.current = null;
      event.preventDefault();
    },
    move: (event: TouchEvent) => {
      const st = pinchStateRef.current;
      if (!st.active || event.touches.length !== 2) return;
      event.preventDefault();
      const [a, b] = [event.touches[0]!, event.touches[1]!];
      pinchPendingScaleRef.current = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / st.startDist;
      if (pinchRafRef.current == null) pinchRafRef.current = window.requestAnimationFrame(flushPinch);
    },
    end: (event: TouchEvent) => {
      const st = pinchStateRef.current;
      if (!st.active || event.touches.length >= 2) return;
      st.active = false;
      if (pinchRafRef.current != null) {
        window.cancelAnimationFrame(pinchRafRef.current);
        pinchRafRef.current = null;
      }
      if (pinchPendingScaleRef.current != null) applyZoom(st.startRowH * pinchPendingScaleRef.current);
      pinchPendingScaleRef.current = null;
      settleZoom();
    },
  };
  const stableTouchStart = useRef((e: TouchEvent) => touchZoomFnRef.current.start(e)).current;
  const stableTouchMove = useRef((e: TouchEvent) => touchZoomFnRef.current.move(e)).current;
  const stableTouchEnd = useRef((e: TouchEvent) => touchZoomFnRef.current.end(e)).current;

  const wheelZoomFnRef = useRef<(event: WheelEvent) => void>(() => {});
  wheelZoomFnRef.current = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    cancelZoomAnim();
    isZoomingRef.current = true;
    if (!zoomAnchorRef.current) captureZoomAnchor(event.clientY);
    applyZoom(rowHRef.current * (1 - event.deltaY * 0.01));
    if (wheelSnapTimerRef.current) window.clearTimeout(wheelSnapTimerRef.current);
    wheelSnapTimerRef.current = window.setTimeout(() => settleZoom(), 200);
  };
  const stableWheelZoom = useRef((event: WheelEvent) => wheelZoomFnRef.current(event)).current;
  const attachMonthScroller = (el: HTMLDivElement | null) => {
    if (scrollRef.current === el) return;
    const prev = scrollRef.current;
    if (prev) {
      prev.removeEventListener('wheel', stableWheelZoom);
      prev.removeEventListener('touchstart', stableTouchStart);
      prev.removeEventListener('touchmove', stableTouchMove);
      prev.removeEventListener('touchend', stableTouchEnd);
      prev.removeEventListener('touchcancel', stableTouchEnd);
    }
    scrollRef.current = el;
    if (el) {
      el.addEventListener('wheel', stableWheelZoom, { passive: false });
      el.addEventListener('touchstart', stableTouchStart, { passive: false });
      el.addEventListener('touchmove', stableTouchMove, { passive: false });
      el.addEventListener('touchend', stableTouchEnd, { passive: false });
      el.addEventListener('touchcancel', stableTouchEnd, { passive: false });
      el.style.setProperty('--month-row-h', `${rowHRef.current}px`);
      el.style.setProperty('--chip-scale', chipScaleForRowH(rowHRef.current).toFixed(3));
    }
  };

  useEffect(
    () => () => {
      cancelZoomAnim();
      if (wheelSnapTimerRef.current) window.clearTimeout(wheelSnapTimerRef.current);
       
    },
    [],
  );

  useLayoutEffect(() => {
    if (!viewTransition || viewTransition.phase !== 'month-to-timeline') return;
    if (correctedTransitionIdRef.current === viewTransition.id) return;

    const root = rootRef.current;
    const activeDate = root?.querySelector('[data-mobile-timeline-active-date="true"]');
    if (!root || !activeDate) return;

    correctedTransitionIdRef.current = viewTransition.id;
    const actualTop = activeDate.getBoundingClientRect().top - root.getBoundingClientRect().top;
    if (Math.abs(actualTop - viewTransition.targetTop) <= 0.5) return;

    setViewTransition((prev) =>
      prev && prev.id === viewTransition.id ? { ...prev, targetTop: actualTop } : prev,
    );
  }, [viewTransition]);

  const handleGoToToday = () => {
    if (isTimelineMode && timelineGoToTodayRef.current) {
      timelineGoToTodayRef.current();
      return;
    }
    onSelectedKeyChange(dayKey(today));
    onMonthChange(startOfMonth(today));
    setVisibleLabel(format(today, 'yyyy', { locale: de }));
    setVisibleYear(today.getFullYear());
    if (viewMode === 'month') {
      const sc = scrollRef.current;
      if (sc) {
        const idx = monthIndexOf(startOfMonth(today));
        setRowWindow({
          start: Math.max(0, idx - ROW_WINDOW_BUFFER),
          end: Math.min(months.length - 1, idx + ROW_WINDOW_BUFFER),
        });
        animateScrollTo(sc, monthTopPx(idx));
      }
    } else if (viewMode === 'year') {
      setYearTodayJumpToken((token) => token + 1);
    }
  };

  const densityToggle = (
    <div className="grid grid-cols-2 rounded-xl border border-border/60 bg-background/55 p-0.5">
      {(
        [
          ['compact', SquaresFour, 'Kompakt'],
          ['detail', ListBullets, 'Detail'],
        ] as [MonthDensity, typeof SquaresFour, string][]
      ).map(([mode, Icon, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => handleDensityChange(mode)}
          className={cn(
            'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 transition-colors sm:px-3',
            monthDensity === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
          aria-label={label}
          aria-pressed={monthDensity === mode}
        >
          <Icon size={16} />
          <span className="hidden text-xs font-semibold sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );

  const yearHeader = (
    <div className="shrink-0 border-b border-border/50 bg-background/80 px-3 pb-2 pt-2 backdrop-blur-md sm:px-5 lg:px-7">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {showViewTabs && (
            <button
              type="button"
              onClick={() => onOpenPanel('calendars')}
              aria-label="Kalender-Seitenleiste öffnen"
              className="-ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-xl text-primary transition-colors hover:bg-primary/10"
            >
              <SidebarSimple size={22} />
            </button>
          )}
          <h2 className="min-w-0 flex-1 truncate whitespace-nowrap text-[clamp(1.45rem,6vw,2rem)] font-bold tracking-tight">
            {visibleYear}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {showViewTabs && <CalendarViewTabs value={viewMode} onChange={handleViewModeChange} className="mr-1" />}
          <button
            type="button"
            onClick={() => onCreate(selectedKey)}
            aria-label="Neuen Termin anlegen"
            className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
          >
            <Plus size={16} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );

  const zoomOrigin = zoom ? `${zoom.originX}% ${zoom.originY}%` : '50% 32%';
  const renderYearBlock = !isLandscapePhone && (viewMode === 'year' || zoom?.phase === 'in');
  const renderMonthBlock = !isLandscapePhone && (viewMode === 'month' || zoom?.phase === 'out');
  const zoomTransitionProps = { duration: ZOOM_TRANSITION_MS / 1000, ease: ZOOM_EASE };
  const monthZoomMotion = zoom
    ? zoom.phase === 'in'
      ? { initial: { scale: 0.18, opacity: 0 }, animate: { scale: 1, opacity: 1 } }
      : { initial: { scale: 1, opacity: 1 }, animate: { scale: 0.18, opacity: 0 } }
    : { initial: false as const, animate: { scale: 1, opacity: 1 } };
  const yearZoomMotion = zoom
    ? zoom.phase === 'in'
      ? { initial: { scale: 1, opacity: 1 }, animate: { scale: 2.2, opacity: 0 } }
      : { initial: { scale: 2.2, opacity: 0 }, animate: { scale: 1, opacity: 1 } }
    : { initial: false as const, animate: { scale: 1, opacity: 1 } };

  const monthCacheSig: unknown[] = [zoomMode, eventsByDay, conflictDays, today];
  if (
    monthCacheSig.length !== monthElSigRef.current.length ||
    monthCacheSig.some((v, i) => v !== monthElSigRef.current[i])
  ) {
    monthElCacheRef.current = new Map();
    monthElSigRef.current = monthCacheSig;
  }

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      style={{ WebkitTextSizeAdjust: '100%', textSizeAdjust: '100%' } as CSSProperties}
    >
      <LayoutGroup id="pro-plan-calendar">
        {!isLandscapePhone && (renderYearBlock || renderMonthBlock) && (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {renderYearBlock && (
              <motion.div
                key="year-stage"
                className="absolute inset-0 z-0 flex min-h-0 flex-col"
                style={{ transformOrigin: zoomOrigin, willChange: zoom ? 'transform, opacity' : undefined }}
                initial={yearZoomMotion.initial}
                animate={yearZoomMotion.animate}
                transition={zoomTransitionProps}
              >
                <ProYearCalendar
                  open
                  today={today}
                  focusYear={visibleYear}
                  todayJumpToken={yearTodayJumpToken}
                  onSelectMonth={handleSelectMonthFromYear}
                  onVisibleYearChange={setVisibleYear}
                  header={yearHeader}
                />
              </motion.div>
            )}

            {renderMonthBlock && (
              <motion.div
                key="month-stage"
                className="absolute inset-0 z-10 flex min-h-0 flex-col"
                style={{ transformOrigin: zoomOrigin, willChange: zoom ? 'transform, opacity' : undefined }}
                initial={monthZoomMotion.initial}
                animate={monthZoomMotion.animate}
                transition={zoomTransitionProps}
              >
                <div className="flex min-h-0 flex-1 flex-col">
                  {/* Sticky-Header: Jahres-Label + Dichte-Umschalter + Wochentagszeile */}
                  <div className="shrink-0 border-b border-border/50 bg-background/80 px-3 pb-0 pt-2 backdrop-blur-md sm:px-5 lg:px-7">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span aria-hidden="true" className="mb-0.5 block h-6 opacity-0">
                          Monat
                        </span>
                        <div className="flex min-w-0 items-center gap-1.5">
                          {showViewTabs && (
                            <button
                              type="button"
                              data-tour="calendar-side-panel-button"
                              onClick={() => onOpenPanel('calendars')}
                              aria-label="Kalender-Seitenleiste öffnen"
                              className="-ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-xl text-primary transition-colors hover:bg-primary/10"
                            >
                              <SidebarSimple size={22} />
                            </button>
                          )}
                          {showViewTabs ? (
                            <h2
                              data-mobile-month-header-title="true"
                              className="min-w-0 flex-1 truncate whitespace-nowrap text-[clamp(1.45rem,6vw,2rem)] font-bold capitalize leading-tight tracking-tight"
                            >
                              {visibleLabel}
                            </h2>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleViewModeChange('year')}
                              aria-label="Jahresansicht öffnen"
                              className="flex min-w-0 flex-1 items-center gap-1 text-left"
                            >
                              <h2
                                data-mobile-month-header-title="true"
                                className="min-w-0 truncate whitespace-nowrap text-[clamp(1.45rem,6vw,2rem)] font-bold capitalize leading-tight tracking-tight"
                              >
                                {visibleLabel}
                              </h2>
                              <CaretDown size={16} weight="bold" className="shrink-0 text-primary" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {showViewTabs && (
                          <span data-tour="calendar-view-tabs">
                            <CalendarViewTabs value={viewMode} onChange={handleViewModeChange} className="mr-1" />
                          </span>
                        )}
                        {densityToggle}
                        <button
                          type="button"
                          data-tour="calendar-create-button"
                          onClick={() => onCreate(selectedKey)}
                          aria-label="Neuen Termin anlegen"
                          className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
                        >
                          <Plus size={16} weight="bold" />
                        </button>
                      </div>
                    </div>
                    <motion.div
                      data-mobile-week-strip="true"
                      className={cn(
                        '-mx-3 mt-2 text-[11px] font-semibold text-muted-foreground sm:-mx-5 lg:-mx-7',
                        WEEK_STRIP_GRID_CLASS,
                      )}
                    >
                      {WEEKDAY_LABELS.map((w, index) => (
                        <div
                          key={w}
                          className={cn(
                            'flex h-6 items-center justify-center',
                            WEEKDAY_LABEL_CLASS,
                            index > 4 ? 'text-muted-foreground' : 'text-foreground',
                          )}
                        >
                          {w}
                        </div>
                      ))}
                    </motion.div>
                  </div>

                  <div
                    ref={attachMonthScroller}
                    onScroll={handleScroll}
                    style={
                      {
                        '--month-row-h': `${rowHRef.current}px`,
                        '--chip-scale': chipScaleForRowH(rowHRef.current).toFixed(3),
                      } as CSSProperties
                    }
                    className={cn(
                      'relative min-h-0 flex-1 touch-pan-y overflow-y-auto [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                      (pendingReverseTransition || viewTransition?.phase === 'timeline-to-month') && 'opacity-0',
                    )}
                  >
                    <div ref={monthsInnerRef}>
                      <div aria-hidden="true" style={{ height: topSpacerHeight }} />
                      {months.slice(rowWindow.start, rowWindow.end + 1).map((m) => {
                        const key = monthKey(m);
                        const cached = monthElCacheRef.current.get(key);
                        if (cached !== undefined) return cached;
                        const rows = buildMonthRows(m);

                        const el = (
                          <div key={key}>
                            <div
                              data-mobile-month-transition-item="true"
                              data-transition-item-id={`label-${key}`}
                              data-transition-kind="label"
                              data-month-key={key}
                              className="sticky top-0 z-20 bg-background px-4 pb-1 pt-2 text-lg font-semibold capitalize text-primary sm:px-6 sm:pt-3 sm:text-xl lg:px-8 lg:text-2xl"
                            >
                              {format(m, 'MMMM', { locale: de })}
                            </div>
                            <div>
                              {rows.map((row, rowIndex) => (
                                <div
                                  key={`${key}-row-${rowIndex}`}
                                  data-mobile-month-transition-item="true"
                                  data-mobile-month-row="true"
                                  data-transition-item-id={`row-${key}-${rowIndex}`}
                                  data-transition-kind="row"
                                  data-month-key={key}
                                  data-row-index={rowIndex}
                                  className={WEEK_STRIP_GRID_CLASS}
                                >
                                  {row.map((day, idx) => {
                                    if (!day) {
                                      return (
                                        <div
                                          key={`${key}-e${rowIndex}-${idx}`}
                                          style={{ minHeight: 'var(--month-row-h)' }}
                                          className="min-w-0 border-t border-border/30"
                                        />
                                      );
                                    }
                                    const dKey = dayKey(day);
                                    const isToday = isSameDay(day, today);
                                    const hasConflict = conflictDays.has(dKey);
                                    const { chips, extra } = buildChips(dKey);
                                    return (
                                      <button
                                        key={dKey}
                                        data-day-key={dKey}
                                        type="button"
                                        onClick={(event: MouseEvent<HTMLButtonElement>) => {
                                          startMonthToTimelineTransition('today', dKey, event.currentTarget);
                                        }}
                                        style={{ minHeight: 'var(--month-row-h)' }}
                                        className={cn(
                                          'relative flex min-w-0 flex-col gap-0.5 border-t border-r border-border/30 px-0.5 pb-1 pt-1 text-left transition-colors duration-150 hover:bg-primary/[0.04] active:bg-primary/10 sm:px-1.5',
                                          zoomMode === 'dots' ? 'overflow-visible' : 'overflow-hidden',
                                          (idx % 7 === 5 || idx % 7 === 6) && 'bg-muted/20',
                                        )}
                                      >
                                        <span
                                          data-mobile-month-day-number="true"
                                          className={cn(
                                            'mx-auto shrink-0',
                                            DATE_CIRCLE_CLASS,
                                            isToday
                                              ? 'bg-red-500 text-white shadow-sm'
                                              : hasConflict
                                                ? 'font-bold text-red-600 ring-2 ring-inset ring-red-500 dark:text-red-400'
                                                : 'text-foreground',
                                          )}
                                        >
                                          {day.getDate()}
                                        </span>
                                        {(chips.length > 0 || extra > 0) && (
                                          <div className="relative min-h-0 w-full flex-1">
                                            <div
                                              className={cn(
                                                'absolute inset-0 flex flex-wrap content-center items-center justify-center gap-1 px-0.5 text-center transition-[opacity,transform] duration-200 ease-out',
                                                zoomMode === 'dots'
                                                  ? 'opacity-100 scale-100'
                                                  : 'pointer-events-none scale-[1.35] opacity-0',
                                              )}
                                            >
                                              {chips.map((c) => (
                                                <span key={c.key} className={cn('size-2 shrink-0 rounded-full', c.dot)} />
                                              ))}
                                              {extra > 0 && (
                                                <span className="text-[8px] font-medium leading-none text-muted-foreground">
                                                  +{extra}
                                                </span>
                                              )}
                                            </div>
                                            <div
                                              className={cn(
                                                'absolute inset-x-0 top-0 flex origin-top flex-col gap-1 overflow-hidden transition-[opacity,transform] duration-200 ease-out',
                                                zoomMode === 'dots'
                                                  ? 'pointer-events-none scale-90 opacity-0'
                                                  : 'scale-100 opacity-100',
                                              )}
                                            >
                                              {chips.map((c) => (
                                                <span
                                                  key={c.key}
                                                  role="button"
                                                  tabIndex={0}
                                                  aria-label={`Termin ${c.label} öffnen`}
                                                  title={
                                                    c.hasConflict
                                                      ? 'Hinweis: bitte prüfen'
                                                      : [c.isFlexible ? 'Flexibler Termin' : null, c.isSeries ? 'Serientermin' : null]
                                                          .filter(Boolean)
                                                          .join(' · ') || undefined
                                                  }
                                                  onClick={(event) => {
                                                    // Termin öffnen statt in den Tag zu wechseln.
                                                    event.stopPropagation();
                                                    onOpenEvent(c.key);
                                                  }}
                                                  onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                      event.preventDefault();
                                                      event.stopPropagation();
                                                      onOpenEvent(c.key);
                                                    }
                                                  }}
                                                  className={cn(
                                                    'relative block w-full min-w-0 max-w-full cursor-pointer overflow-hidden text-left leading-tight transition-[max-height,background-color,border-radius,padding] duration-200 ease-out',
                                                    zoomMode === 'bars'
                                                      ? cn('max-h-1.5 rounded-full', c.dot)
                                                      : cn(
                                                          'max-h-8 rounded px-1',
                                                          c.cls,
                                                          zoomMode === 'full' ? 'py-1' : 'py-px',
                                                          c.hasConflict &&
                                                            'ring-1 ring-inset ring-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)]',
                                                          c.highlighted &&
                                                            'animate-pulse ring-2 ring-[var(--color-brand)]',
                                                        ),
                                                  )}
                                                >
                                                  <span
                                                    className={cn(
                                                      'flex items-center gap-1 font-medium leading-tight transition-opacity duration-150 ease-out text-[length:calc(9px*var(--chip-scale))] sm:text-[length:calc(10px*var(--chip-scale))]',
                                                      zoomMode === 'bars' ? 'opacity-0' : 'opacity-100',
                                                      (c.hasConflict || c.isSeries || c.isFlexible) && 'pr-3.5',
                                                    )}
                                                  >
                                                    {c.employeeInitials ? (
                                                      <span
                                                        className="grid size-3.5 shrink-0 place-items-center rounded-full bg-black/25 text-[7px] font-bold leading-none"
                                                        title="Mitarbeiter"
                                                      >
                                                        {c.employeeInitials}
                                                      </span>
                                                    ) : null}
                                                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                                                  </span>
                                                  {c.sub && (
                                                    <span
                                                      className={cn(
                                                        'mt-0.5 block truncate font-semibold leading-tight transition-opacity duration-150 ease-out text-[length:calc(8px*var(--chip-scale))]',
                                                        zoomMode === 'full' ? 'opacity-70' : 'opacity-0',
                                                      )}
                                                    >
                                                      {c.sub}
                                                    </span>
                                                  )}
                                                  {/* Marker oben rechts: Konflikt (rot), flexibel (↔), Serie (↻). */}
                                                  {zoomMode !== 'bars' && (c.hasConflict || c.isSeries || c.isFlexible) && (
                                                    <span className="pointer-events-none absolute top-0.5 right-0.5 flex items-center gap-0.5">
                                                      {c.hasConflict && (
                                                        <span className="grid size-3 place-items-center rounded-full bg-[var(--color-danger)] text-[7px] font-bold text-white">
                                                          !
                                                        </span>
                                                      )}
                                                      {c.isFlexible && (
                                                        <span className="text-[9px] leading-none opacity-70" aria-hidden>
                                                          ↔
                                                        </span>
                                                      )}
                                                      {c.isSeries && (
                                                        <span className="text-[9px] leading-none opacity-70" aria-hidden>
                                                          ↻
                                                        </span>
                                                      )}
                                                    </span>
                                                  )}
                                                </span>
                                              ))}
                                              {extra > 0 && (
                                                <span
                                                  className={cn(
                                                    'block min-w-0 max-w-full truncate overflow-hidden px-1 text-[8.5px] leading-tight text-muted-foreground transition-[max-height,opacity] duration-200 ease-out',
                                                    zoomMode === 'bars' ? 'max-h-0 opacity-0' : 'max-h-4 opacity-100',
                                                  )}
                                                >
                                                  +{extra}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                        monthElCacheRef.current.set(key, el);
                        return el;
                      })}
                      <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />
                      <div className="h-12" />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {(isLandscapePhone || isTimelineMode) && (
          <div className="flex min-h-0 flex-1 flex-col">
            <ProTimelineCalendar
              viewMode={isTimelineMode ? (viewMode as 'week' | 'today') : 'week'}
              onViewModeChange={handleViewModeChange}
              selectedKey={selectedKey}
              onSelectedKeyChange={onSelectedKeyChange}
              onMonthChange={onMonthChange}
              eventsByDay={eventsByDay}
              today={today}
              showEmployee={showEmployee}
              highlightEventId={highlightEventId}
              onOpenEvent={onOpenEvent}
              onOpenPanel={onOpenPanel}
              onCreate={onCreate}
              suppressWeekStrip={false}
              enteringFromMonth={!isLandscapePhone && viewTransition?.phase === 'month-to-timeline'}
              landscapeCompact={isLandscapePhone}
              forceFullWeek={isLandscapePhone}
              showViewTabs={showViewTabs}
              goToTodayRef={timelineGoToTodayRef}
            />
          </div>
        )}
      </LayoutGroup>
      <MonthTransitionOverlay transition={viewTransition} />
      {!isLandscapePhone && !showViewTabs && (
        <CalendarMobileBottomBar onToday={handleGoToToday} onOpenCalendars={() => onOpenPanel('calendars')} />
      )}
      {sidePanel}
    </div>
  );
}
