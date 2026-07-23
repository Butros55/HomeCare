'use client';

/**
 * ProTimelineCalendar — aus StudyMate portiert (MobileTimelineCalendar):
 * Tages-/Wochen-Timeline mit Stundenraster, Jetzt-Linie, trägheitsbasiertem
 * Tage-Swipe (Fling mit Reibung), Wochenstreifen und Reveal-Animationen.
 * Domäne angepasst: Ereignisse sind HomeCare-Termine; ein Klick öffnet den
 * Termin-Drawer, statt Lern-Bannern zeigt der Kopf „ohne Zuordnung“-Hinweise.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent } from 'react';
import { addDays, differenceInCalendarDays, startOfMonth, startOfWeek, format, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarBlank, CaretLeft, ListBullets, Plus, SidebarSimple, Warning } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { selectionHaptic } from './haptics';
import { dayKey, type ProCalendarEvent, type ProEventKind } from './types';
import { CalendarViewTabs } from './view-tabs';
import {
  DATE_CIRCLE_CLASS,
  WEEK_STRIP_GRID_CLASS,
  WEEKDAY_LABEL_CLASS,
  WEEKDAY_LABELS,
  getResponsiveCalendarDayCount,
  shouldShowWeekStrip,
} from './layout';

type CalendarViewMode = 'year' | 'month' | 'week' | 'today';

interface ProTimelineCalendarProps {
  viewMode: 'week' | 'today';
  onViewModeChange: (mode: CalendarViewMode) => void;
  selectedKey: string;
  onSelectedKeyChange: (key: string) => void;
  onMonthChange: (month: Date) => void;
  eventsByDay: Map<string, ProCalendarEvent[]>;
  today: Date;
  onOpenEvent: (id: string) => void;
  onOpenPanel: (page: 'calendars' | 'day') => void;
  onCreate: (key: string) => void;
  showViewTabs?: boolean;
  goToTodayRef?: MutableRefObject<(() => void) | null>;
  suppressWeekStrip?: boolean;
  enteringFromMonth?: boolean;
  landscapeCompact?: boolean;
  forceFullWeek?: boolean;
}

interface ScheduleEntry {
  id: string;
  kind: ProEventKind;
  title: string;
  subtitle: string;
  hasConflict: boolean;
  customerColor: string;
  startMinutes: number;
  endMinutes: number;
}

interface PointerStart {
  x: number;
  y: number;
  startOffset: number;
  lastX: number;
  lastTime: number;
  velocity: number;
  active: boolean;
  blocked: boolean;
}

const TIMELINE_START_MINUTES = 0;
const TIMELINE_END_MINUTES = 24 * 60;
const HOUR_MARKERS = Array.from({ length: 24 }, (_, hour) => hour);
const TIMELINE_HEIGHT_CLASS = 'h-[90rem] lg:h-[105rem] xl:h-[117rem]';
const TIME_GUTTER_WIDTH_PX = 60;
const DAY_RENDER_RADIUS = 8;
const MAX_MOMENTUM_DAYS = 60;
const WEEK_STRIP_RENDER_RADIUS = Math.ceil(MAX_MOMENTUM_DAYS / 7) + 2;
const WEEK_STRIP_PAGE_OFFSETS = Array.from(
  { length: WEEK_STRIP_RENDER_RADIUS * 2 + 1 },
  (_, index) => index - WEEK_STRIP_RENDER_RADIUS,
);
const MOMENTUM_FRICTION = 0.0021;
const SETTLE_VELOCITY = 0.12;
const ENTER_CONTENT_DELAY_MS = 170;
const DAY_COLUMN_OFFSETS = Array.from({ length: DAY_RENDER_RADIUS * 2 + 1 }, (_, index) => index - DAY_RENDER_RADIUS);
const TIMELINE_REVEAL_EASE = [0.22, 1, 0.36, 1] as const;
const timelineRevealHidden = {
  opacity: 0,
  y: 28,
  clipPath: 'inset(12% 0 0 0)',
};
const timelineRevealVisible = {
  opacity: 1,
  y: 0,
  clipPath: 'inset(0% 0 0 0)',
  transition: { duration: 0.44, ease: TIMELINE_REVEAL_EASE },
};

// Ereignisblöcke (Apple-Calendar-Look wie in der Referenz; Farbwelt = Status).
const EVENT_STYLE: Record<ProEventKind, { block: string; rail: string; title: string }> = {
  planned: {
    block:
      'border-sky-300/60 bg-sky-200/75 text-sky-950 shadow-sky-950/5 dark:border-sky-400/40 dark:bg-sky-500/20 dark:text-sky-100 md:shadow-md md:dark:border-sky-400/60 md:dark:bg-sky-500/30',
    rail: 'bg-sky-500',
    title: 'text-sky-950 dark:text-sky-50',
  },
  confirmed: {
    block:
      'border-emerald-300/60 bg-emerald-100/80 text-emerald-950 shadow-emerald-950/5 dark:border-emerald-400/40 dark:bg-emerald-500/20 dark:text-emerald-100 md:shadow-md md:dark:border-emerald-400/60 md:dark:bg-emerald-500/30',
    rail: 'bg-emerald-500',
    title: 'text-emerald-950 dark:text-emerald-50',
  },
  done: {
    block:
      'border-violet-300/60 bg-violet-200/60 text-violet-950 shadow-violet-950/5 dark:border-violet-400/40 dark:bg-violet-500/20 dark:text-violet-100 md:shadow-md md:dark:border-violet-400/60 md:dark:bg-violet-500/30',
    rail: 'bg-violet-500',
    title: 'text-violet-950 dark:text-violet-50',
  },
  open: {
    block:
      'border-amber-300/70 bg-amber-100/85 text-amber-950 shadow-amber-950/5 dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-amber-100 md:shadow-md md:dark:border-amber-400/60 md:dark:bg-amber-500/30',
    rail: 'bg-amber-500',
    title: 'text-amber-950 dark:text-amber-50',
  },
  cancelled: {
    block:
      'border-muted-foreground/20 bg-[repeating-linear-gradient(135deg,var(--color-muted)_0,var(--color-muted)_5px,var(--color-background)_5px,var(--color-background)_10px)] text-muted-foreground shadow-foreground/5 dark:border-border/70 md:shadow-md',
    rail: 'bg-muted-foreground/60',
    title: 'text-muted-foreground line-through',
  },
};

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function formatMinutes(minutes: number): string {
  const bounded = Math.max(0, minutes);
  const hours = Math.floor(bounded / 60);
  const mins = bounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function formatShortWeekday(date: Date): string {
  return format(date, 'EEE', { locale: de }).replace(/\.$/, '');
}

function timelinePercent(minutes: number): number {
  const bounded = Math.max(TIMELINE_START_MINUTES, Math.min(TIMELINE_END_MINUTES, minutes));
  return ((bounded - TIMELINE_START_MINUTES) / (TIMELINE_END_MINUTES - TIMELINE_START_MINUTES)) * 100;
}

function timelinePosition(minutes: number): string {
  return `${timelinePercent(minutes)}%`;
}

function timelineHeight(startMinutes: number, endMinutes: number): string {
  const start = timelinePercent(startMinutes);
  const end = timelinePercent(Math.max(endMinutes, startMinutes + 30));
  return `${Math.max(4.2, end - start)}%`;
}

function eventToScheduleEntry(event: ProCalendarEvent): ScheduleEntry {
  const start = new Date(event.start);
  const end = new Date(event.end);
  return {
    id: event.id,
    kind: event.kind,
    title: event.summary,
    subtitle: event.detail || 'Termin',
    hasConflict: event.hasConflict,
    customerColor: event.customerColor,
    startMinutes: minutesOfDay(start),
    endMinutes: Math.max(minutesOfDay(start) + 30, minutesOfDay(end)),
  };
}

function dayEntries(dayEvents: ProCalendarEvent[]): ScheduleEntry[] {
  return dayEvents.map(eventToScheduleEntry).sort((a, b) => a.startMinutes - b.startMinutes);
}

export function ProTimelineCalendar({
  viewMode,
  onViewModeChange,
  selectedKey,
  onSelectedKeyChange,
  onMonthChange,
  eventsByDay,
  today,
  onOpenEvent,
  onOpenPanel,
  onCreate,
  showViewTabs = false,
  goToTodayRef,
  suppressWeekStrip = false,
  landscapeCompact = false,
  forceFullWeek = false,
  enteringFromMonth = false,
}: ProTimelineCalendarProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragViewportRef = useRef<HTMLDivElement | null>(null);
  const pointerStartRef = useRef<PointerStart | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);
  const activeDayOffsetRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [activeDayOffset, setActiveDayOffset] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [timelineContentVisible, setTimelineContentVisible] = useState(!enteringFromMonth);
  const [weekStripVisible, setWeekStripVisible] = useState(!enteringFromMonth);
  const weekStripViewportRef = useRef<HTMLDivElement | null>(null);
  const weekStripPointerStartRef = useRef<PointerStart | null>(null);
  const weekStripDragOffsetRef = useRef(0);
  const weekStripSuppressClickRef = useRef(false);
  const [weekStripWidth, setWeekStripWidth] = useState(0);
  const [weekStripDragOffset, setWeekStripDragOffset] = useState(0);
  const [isWeekStripDragging, setIsWeekStripDragging] = useState(false);
  const [weekStripTargetWeekKey, setWeekStripTargetWeekKey] = useState<string | null>(null);
  const [weekStripTransitionEnabled, setWeekStripTransitionEnabled] = useState(true);

  const selectedDate = useMemo(() => new Date(`${selectedKey}T00:00:00`), [selectedKey]);
  const [weekStripAnchorStart, setWeekStripAnchorStart] = useState(() =>
    startOfWeek(new Date(`${selectedKey}T00:00:00`), { weekStartsOn: 1 }),
  );
  const activeDate = useMemo(() => addDays(selectedDate, activeDayOffset), [selectedDate, activeDayOffset]);
  const selectedWeekStart = useMemo(() => startOfWeek(selectedDate, { weekStartsOn: 1 }), [selectedDate]);
  const selectedWeekKey = dayKey(selectedWeekStart);
  const weekStripPages = useMemo(() => {
    return WEEK_STRIP_PAGE_OFFSETS.map((weekOffset) => {
      const start = addDays(weekStripAnchorStart, weekOffset * 7);
      return {
        weekOffset,
        days: Array.from({ length: 7 }, (_, index) => addDays(start, index)),
      };
    });
  }, [weekStripAnchorStart]);
  const backMonthLabel = format(activeDate, 'MMMM', { locale: de });
  const nowMinutes = minutesOfDay(new Date());
  const measuredContentWidth =
    contentWidth || Math.max(1, (typeof window === 'undefined' ? 393 : window.innerWidth) - TIME_GUTTER_WIDTH_PX);
  const visibleDayCount =
    forceFullWeek && viewMode === 'week' ? 7 : getResponsiveCalendarDayCount(viewMode, measuredContentWidth);
  const navigationDayStep = 1;
  const showWeekStrip =
    !suppressWeekStrip && !forceFullWeek && shouldShowWeekStrip(visibleDayCount, landscapeCompact);
  const dayColumnWidth = measuredContentWidth / visibleDayCount;
  const centerColumnIndex = DAY_RENDER_RADIUS;
  const activeKey = dayKey(activeDate);
  const visibleTailKey = viewMode === 'week' ? dayKey(addDays(activeDate, visibleDayCount - 1)) : null;
  const activeWeekStart = startOfWeek(activeDate, { weekStartsOn: 1 });
  const activeWeekOffset = Math.round(differenceInCalendarDays(activeWeekStart, weekStripAnchorStart) / 7);
  const targetWeekOffset = weekStripTargetWeekKey
    ? Math.round(
        differenceInCalendarDays(
          startOfWeek(new Date(`${weekStripTargetWeekKey}T00:00:00`), { weekStartsOn: 1 }),
          weekStripAnchorStart,
        ) / 7,
      )
    : null;
  const visibleWeekOffset = targetWeekOffset ?? activeWeekOffset;
  const measuredWeekStripWidth = weekStripWidth || (typeof window === 'undefined' ? 393 : window.innerWidth);
  const weekStripTrackStyle = {
    width: `${weekStripPages.length * measuredWeekStripWidth}px`,
    transform: `translate3d(${
      -(WEEK_STRIP_RENDER_RADIUS + visibleWeekOffset) * measuredWeekStripWidth + weekStripDragOffset
    }px, 0, 0)`,
    transition:
      isWeekStripDragging || !weekStripTransitionEnabled
        ? undefined
        : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: isWeekStripDragging ? 'transform' : undefined,
  };
  const subDayOffset = dragOffset + activeDayOffset * dayColumnWidth;
  const trackStyle = {
    gridTemplateColumns: `repeat(${DAY_COLUMN_OFFSETS.length}, ${dayColumnWidth}px)`,
    transform: `translate3d(${-centerColumnIndex * dayColumnWidth + subDayOffset}px, 0, 0)`,
    width: `${DAY_COLUMN_OFFSETS.length * dayColumnWidth}px`,
    transition:
      isDragging || isAnimating
        ? undefined
        : 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), width 320ms cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: isDragging || isAnimating ? 'transform' : undefined,
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (isWeekStripDragging || weekStripTargetWeekKey) return;
    if (Math.abs(activeWeekOffset) < WEEK_STRIP_RENDER_RADIUS - 2) return;

    setWeekStripTransitionEnabled(false);
    setWeekStripAnchorStart(activeWeekStart);
  }, [activeWeekOffset, activeWeekStart, isWeekStripDragging, weekStripTargetWeekKey]);

  useEffect(() => {
    if (weekStripTransitionEnabled) return;
    const frame = window.requestAnimationFrame(() => setWeekStripTransitionEnabled(true));
    return () => window.cancelAnimationFrame(frame);
  }, [weekStripTransitionEnabled]);

  useEffect(() => {
    if (weekStripTargetWeekKey !== selectedWeekKey) return;
    setWeekStripTargetWeekKey(null);
  }, [selectedWeekKey, weekStripTargetWeekKey]);

  useEffect(() => {
    if (!enteringFromMonth) {
      setTimelineContentVisible(true);
      setWeekStripVisible(true);
      return;
    }

    setTimelineContentVisible(false);
    setWeekStripVisible(false);
    const contentTimer = window.setTimeout(() => setTimelineContentVisible(true), ENTER_CONTENT_DELAY_MS);
    return () => {
      window.clearTimeout(contentTimer);
    };
  }, [enteringFromMonth]);

  useEffect(() => {
    if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    dragOffsetRef.current = 0;
    activeDayOffsetRef.current = 0;
    setDragOffset(0);
    setActiveDayOffset(0);
    setIsDragging(false);
    setIsAnimating(false);
    pointerStartRef.current = null;
    weekStripPointerStartRef.current = null;
    weekStripDragOffsetRef.current = 0;
    setWeekStripDragOffset(0);
    setIsWeekStripDragging(false);
  }, [selectedKey, viewMode]);

  useEffect(() => {
    const measure = () => {
      const width = dragViewportRef.current?.clientWidth;
      if (width) setContentWidth(width);
      const stripWidth = weekStripViewportRef.current?.clientWidth;
      if (stripWidth) setWeekStripWidth(stripWidth);
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (observer && dragViewportRef.current) observer.observe(dragViewportRef.current);
    if (observer && weekStripViewportRef.current) observer.observe(weekStripViewportRef.current);
    window.addEventListener('resize', measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [viewMode]);

  useEffect(() => {
    const scrollToNow = () => {
      const el = scrollRef.current;
      if (!el) return;
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      const nowTop = el.scrollHeight * (nowMinutes / (24 * 60));
      el.scrollTop = Math.min(maxScroll, Math.max(0, nowTop - el.clientHeight * 0.48));
    };
    let innerRaf = 0;
    const raf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(scrollToNow);
    });
    const timer = window.setTimeout(scrollToNow, 160);
    return () => {
      cancelAnimationFrame(raf);
      if (innerRaf) cancelAnimationFrame(innerRaf);
      window.clearTimeout(timer);
    };
     
  }, [viewMode]);

  const clampDayOffset = (offset: number) => Math.max(-MAX_MOMENTUM_DAYS, Math.min(MAX_MOMENTUM_DAYS, offset));

  const clampMotionOffset = (offset: number) => {
    const maxOffset = MAX_MOMENTUM_DAYS * dayColumnWidth;
    return Math.max(-maxOffset, Math.min(maxOffset, offset));
  };

  const cancelMotionAnimation = () => {
    if (!animationFrameRef.current) return;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  };

  const updateMotionOffset = (offset: number, haptic = false) => {
    const bounded = clampMotionOffset(offset);
    const nextDayOffset = clampDayOffset(
      Math.round(-bounded / Math.max(1, dayColumnWidth * navigationDayStep)) * navigationDayStep,
    );
    dragOffsetRef.current = bounded;
    setDragOffset(bounded);

    if (nextDayOffset !== activeDayOffsetRef.current) {
      activeDayOffsetRef.current = nextDayOffset;
      setActiveDayOffset(nextDayOffset);
      if (haptic) selectionHaptic();
    }
  };

  const commitSelectedDate = (date: Date) => {
    onSelectedKeyChange(dayKey(date));
    onMonthChange(startOfMonth(date));
  };

  const selectDate = (date: Date) => {
    cancelMotionAnimation();
    updateMotionOffset(0);
    setIsDragging(false);
    setIsAnimating(false);
    pointerStartRef.current = null;
    if (!isSameDay(date, selectedDate)) selectionHaptic();
    commitSelectedDate(date);
  };

  const animateToDate = (date: Date) => {
    const dayDelta = clampDayOffset(differenceInCalendarDays(date, selectedDate));
    if (dayDelta === 0) {
      selectDate(date);
      return;
    }
    completeSwipe(dayDelta);
  };

  useEffect(() => {
    if (!goToTodayRef) return;
    goToTodayRef.current = () => {
      const delta = differenceInCalendarDays(today, addDays(selectedDate, activeDayOffsetRef.current));
      if (Math.abs(delta) > 21) selectDate(today);
      else animateToDate(today);
    };
    return () => {
      goToTodayRef.current = null;
    };
  });

  const animateMotionTo = (targetOffset: number, duration: number, callback?: () => void) => {
    cancelMotionAnimation();
    const startOffset = dragOffsetRef.current;
    const delta = targetOffset - startOffset;
    const startTime = performance.now();

    setIsDragging(false);
    setIsAnimating(true);

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.max(0, Math.min(1, elapsed / Math.max(1, duration)));
      const eased = 1 - Math.pow(1 - progress, 3);
      updateMotionOffset(startOffset + delta * eased, true);

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      animationFrameRef.current = null;
      setIsAnimating(false);
      callback?.();
    };

    animationFrameRef.current = window.requestAnimationFrame(step);
  };

  const snapBack = () => {
    const travel = Math.abs(dragOffsetRef.current);
    const duration = Math.min(320, Math.max(160, travel * 0.65));
    animateMotionTo(0, duration, () => updateMotionOffset(0));
  };

  const completeSwipe = (targetDayOffset: number) => {
    const boundedTargetDayOffset = clampDayOffset(targetDayOffset);
    const targetOffset = -boundedTargetDayOffset * dayColumnWidth;
    const travel = Math.abs(targetOffset - dragOffsetRef.current);
    const duration = Math.min(
      900,
      Math.max(260, 220 + Math.abs(boundedTargetDayOffset - activeDayOffsetRef.current) * 130 + travel * 0.28),
    );

    animateMotionTo(targetOffset, duration, () => {
      if (boundedTargetDayOffset === 0) {
        updateMotionOffset(0);
        return;
      }
      updateMotionOffset(0);
      commitSelectedDate(addDays(selectedDate, boundedTargetDayOffset));
    });
  };

  const updateWeekStripDragOffset = (offset: number) => {
    const bounded = Math.max(-measuredWeekStripWidth, Math.min(measuredWeekStripWidth, offset));
    weekStripDragOffsetRef.current = bounded;
    setWeekStripDragOffset(bounded);
  };

  const handleWeekStripPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = weekStripPointerStartRef.current;
    if (!start || start.blocked) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const now = event.timeStamp;
    const elapsed = Math.max(1, now - start.lastTime);
    start.velocity = (event.clientX - start.lastX) / elapsed;
    start.lastX = event.clientX;
    start.lastTime = now;

    if (!start.active) {
      if (absY > 10 && absY > absX * 1.2) {
        start.blocked = true;
        return;
      }
      if (absX < 8 || absX < absY * 1.1) return;
      start.active = true;
      weekStripSuppressClickRef.current = true;
      setIsWeekStripDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    updateWeekStripDragOffset(dx);
  };

  const handleWeekStripPointerEnd = () => {
    const start = weekStripPointerStartRef.current;
    weekStripPointerStartRef.current = null;
    setIsWeekStripDragging(false);
    if (!start || start.blocked || !start.active) return;

    const offset = weekStripDragOffsetRef.current;
    const shouldChangeWeek =
      Math.abs(offset) >= measuredWeekStripWidth * 0.2 || Math.abs(start.velocity) >= 0.35;
    updateWeekStripDragOffset(0);

    if (shouldChangeWeek) {
      const weekOffset = offset < 0 || (offset === 0 && start.velocity < 0) ? 1 : -1;
      const targetDate = addDays(selectedDate, weekOffset * 7);
      setWeekStripTargetWeekKey(dayKey(startOfWeek(targetDate, { weekStartsOn: 1 })));
      completeSwipe(weekOffset * 7);
    }

    window.setTimeout(() => {
      weekStripSuppressClickRef.current = false;
    }, 0);
  };

  const handleWeekStripPointerCancel = () => {
    weekStripPointerStartRef.current = null;
    setIsWeekStripDragging(false);
    updateWeekStripDragOffset(0);
    window.setTimeout(() => {
      weekStripSuppressClickRef.current = false;
    }, 0);
  };

  const settleFromRest = () => {
    const nearest = clampDayOffset(
      Math.round(-dragOffsetRef.current / Math.max(1, dayColumnWidth * navigationDayStep)) * navigationDayStep,
    );
    if (nearest === 0) {
      if (Math.abs(dragOffsetRef.current) > 0.5) snapBack();
      return;
    }
    completeSwipe(nearest);
  };

  const startMomentum = (initialVelocity: number) => {
    cancelMotionAnimation();
    setIsDragging(false);
    setIsAnimating(true);

    let velocity = initialVelocity;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min(32, Math.max(1, now - lastTime));
      lastTime = now;

      const projected = dragOffsetRef.current + velocity * dt;
      const bounded = clampMotionOffset(projected);
      updateMotionOffset(bounded, true);

      const hitWall = bounded !== projected;
      const sign = Math.sign(velocity) || 1;
      const speed = Math.abs(velocity) - MOMENTUM_FRICTION * dt;

      if (hitWall || speed <= SETTLE_VELOCITY) {
        animationFrameRef.current = null;
        setIsAnimating(false);
        settleFromRest();
        return;
      }

      velocity = sign * speed;
      animationFrameRef.current = window.requestAnimationFrame(step);
    };

    animationFrameRef.current = window.requestAnimationFrame(step);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.blocked) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const now = event.timeStamp;
    const elapsed = Math.max(1, now - start.lastTime);
    start.velocity = (event.clientX - start.lastX) / elapsed;
    start.lastX = event.clientX;
    start.lastTime = now;

    if (!start.active) {
      if (absY > 10 && absY > absX * 1.2) {
        start.blocked = true;
        return;
      }
      if (absX < 8 || absX < absY * 1.1) return;
      start.active = true;
      setIsDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    updateMotionOffset(start.startOffset + dx, true);
  };

  const handlePointerEnd = () => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.blocked) return;

    if (!start.active) {
      setIsDragging(false);
      settleFromRest();
      return;
    }

    if (Math.abs(start.velocity) > SETTLE_VELOCITY) {
      startMomentum(start.velocity);
      return;
    }

    settleFromRest();
  };

  const handlePointerCancel = () => {
    pointerStartRef.current = null;
    if (isDragging) snapBack();
  };

  const viewToggle = (
    <div className="grid grid-cols-2 rounded-xl border border-border/60 bg-background/55 p-0.5">
      {(
        [
          ['week', CalendarBlank, 'Woche'],
          ['today', ListBullets, 'Tag'],
        ] as [CalendarViewMode, typeof CalendarBlank, string][]
      ).map(([mode, Icon, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => onViewModeChange(mode)}
          className={cn(
            'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 transition-colors sm:px-3',
            viewMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
          aria-label={label}
        >
          <Icon size={16} />
          <span className="hidden text-xs font-semibold sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );

  // Fixierter Tageskopf einer Spalte: Datum + „ohne Zuordnung“-/Konflikt-Hinweis.
  const renderTimelineHeaderColumn = (day: Date) => {
    const key = dayKey(day);
    const isTodayHeader = isSameDay(day, today);
    const dayEvents = eventsByDay.get(key) ?? [];
    const openCount = dayEvents.filter((event) => event.unassigned).length;
    const conflictCount = dayEvents.filter((event) => event.hasConflict).length;
    return (
      <div
        key={key}
        onClick={() => animateToDate(day)}
        className="flex min-h-14 min-w-0 flex-col items-stretch gap-1 overflow-hidden border-r border-border/60 px-2 py-1.5 dark:border-white/10"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm font-semibold capitalize',
              isTodayHeader ? 'text-red-500' : 'text-foreground',
            )}
          >
            {viewMode === 'today'
              ? format(day, 'EEEE - d. MMMM', { locale: de })
              : `${formatShortWeekday(day)} - ${format(day, 'd. MMM', { locale: de })}`}
          </span>
        </div>
        {openCount > 0 && (
          <span className="flex min-w-0 items-center gap-1 overflow-hidden rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
            <Warning size={11} weight="fill" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate normal-case">
              {openCount === 1 ? '1 Termin ohne Zuordnung' : `${openCount} Termine ohne Zuordnung`}
            </span>
          </span>
        )}
        {conflictCount > 0 && (
          <span className="flex min-w-0 items-center gap-1 overflow-hidden rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">
            <Warning size={11} weight="fill" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate normal-case">
              {conflictCount === 1 ? '1 Konflikt' : `${conflictCount} Konflikte`}
            </span>
          </span>
        )}
      </div>
    );
  };

  const renderTimeGutter = () => (
    <div className={cn('relative z-30 border-r border-border/60 bg-background/95 dark:border-white/10', TIMELINE_HEIGHT_CLASS)}>
      {HOUR_MARKERS.map((hour) => (
        <motion.span
          key={hour}
          initial={timelineRevealHidden}
          animate={timelineContentVisible ? timelineRevealVisible : timelineRevealHidden}
          transition={{ delay: timelineContentVisible ? hour * 0.008 : 0, duration: 0.32, ease: TIMELINE_REVEAL_EASE }}
          className={cn(
            'absolute right-2 text-[11px] font-medium text-muted-foreground',
            hour === 0 ? 'translate-y-0' : '-translate-y-1/2',
          )}
          style={{ top: timelinePosition(hour * 60) }}
        >
          {formatMinutes(hour * 60)}
        </motion.span>
      ))}

      <motion.span
        initial={timelineRevealHidden}
        animate={timelineContentVisible ? timelineRevealVisible : timelineRevealHidden}
        transition={{ delay: timelineContentVisible ? 0.1 : 0, duration: 0.3, ease: TIMELINE_REVEAL_EASE }}
        className="absolute right-1 z-40 -translate-y-1/2 rounded-md bg-red-500 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white"
        style={{ top: timelinePosition(nowMinutes) }}
      >
        {formatMinutes(nowMinutes)}
      </motion.span>
    </div>
  );

  const renderTimelineDayColumn = (day: Date) => {
    const key = dayKey(day);
    const entries = dayEntries(eventsByDay.get(key) ?? []);
    return (
      <div key={key} className={cn('relative border-r border-border/60 dark:border-white/10', TIMELINE_HEIGHT_CLASS)}>
        {HOUR_MARKERS.map((hour) => (
          <motion.span
            key={hour}
            initial={{ opacity: 0, y: 18, scaleX: 0.96 }}
            animate={timelineContentVisible ? { opacity: 1, y: 0, scaleX: 1 } : { opacity: 0, y: 18, scaleX: 0.96 }}
            transition={{ delay: timelineContentVisible ? hour * 0.009 : 0, duration: 0.34, ease: TIMELINE_REVEAL_EASE }}
            className="absolute inset-x-0 border-t border-border/45 dark:border-white/10"
            style={{ top: timelinePosition(hour * 60), transformOrigin: 'left center' }}
          />
        ))}

        {entries.map((entry) => {
          const style = EVENT_STYLE[entry.kind];
          return (
            <button
              key={entry.id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenEvent(entry.id);
              }}
              className={cn(
                'absolute left-1.5 right-1.5 z-10 overflow-hidden rounded-md border px-2 py-1.5 text-left shadow-sm transition-[filter] hover:brightness-[0.97]',
                style.block,
                entry.hasConflict && 'ring-2 ring-red-500/70',
              )}
              style={{
                top: timelinePosition(entry.startMinutes),
                height: timelineHeight(entry.startMinutes, entry.endMinutes),
                minHeight: '1.9rem',
              }}
            >
              <span className={cn('absolute bottom-1.5 left-1 top-1.5 w-1 rounded-full', style.rail)} />
              <div className="min-w-0 pl-2">
                <p className={cn('truncate text-sm font-bold leading-tight', style.title)}>{entry.title}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-tight opacity-75">{entry.subtitle}</p>
                <p className="mt-0.5 text-[11px] font-semibold leading-tight opacity-75">
                  {formatMinutes(entry.startMinutes)} - {formatMinutes(entry.endMinutes)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-visible-day-count={visibleDayCount}>
      <div
        className={cn(
          'shrink-0 border-b border-border/50 bg-background/80 px-3 pb-0 backdrop-blur-md sm:px-5 lg:px-7',
          landscapeCompact ? 'pt-1' : 'pt-2',
        )}
      >
        {landscapeCompact ? (
          <div className="flex items-center gap-2 py-1 pl-1">
            <CalendarBlank size={15} weight="bold" className="shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold capitalize text-primary">{backMonthLabel}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <div className="min-w-0">
                {showViewTabs ? (
                  <div className="mb-0.5 flex h-7 min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenPanel('calendars')}
                      aria-label="Kalender-Seitenleiste öffnen"
                      className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10"
                    >
                      <SidebarSimple size={20} />
                    </button>
                    <span className="truncate text-lg font-bold capitalize text-foreground">{backMonthLabel}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onViewModeChange('month')}
                    className="-ml-1 mb-0.5 inline-flex h-7 items-center gap-0.5 rounded-md pr-2 text-sm font-semibold text-primary"
                    aria-label="Zur Monatsansicht"
                  >
                    <CaretLeft size={18} weight="bold" />
                    <span className="capitalize">{backMonthLabel}</span>
                  </button>
                )}
                <div aria-hidden="true" className="h-[2.15rem]" />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {showViewTabs ? (
                <CalendarViewTabs value={viewMode} onChange={onViewModeChange} className="mr-1" />
              ) : (
                viewToggle
              )}
              <button
                type="button"
                onClick={() => onCreate(selectedKey)}
                aria-label="Neuen Termin anlegen"
                className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
              >
                <Plus size={17} weight="bold" />
              </button>
            </div>
          </div>
        )}
        {showWeekStrip && (
          <motion.div
            data-mobile-week-strip="true"
            className={cn(
              '-mx-3 mt-2 overflow-hidden transition-opacity duration-150 sm:-mx-5 lg:-mx-7',
              suppressWeekStrip && 'pointer-events-none opacity-0',
              enteringFromMonth && !weekStripVisible && 'pointer-events-none',
            )}
          >
            <div
              ref={weekStripViewportRef}
              onPointerDown={(event) => {
                if (!event.isPrimary || weekStripTargetWeekKey) return;
                weekStripPointerStartRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                  startOffset: 0,
                  lastX: event.clientX,
                  lastTime: event.timeStamp,
                  velocity: 0,
                  active: false,
                  blocked: false,
                };
              }}
              onPointerMove={handleWeekStripPointerMove}
              onPointerUp={handleWeekStripPointerEnd}
              onPointerCancel={handleWeekStripPointerCancel}
              className="touch-pan-y overflow-hidden"
            >
              <div className="flex" style={weekStripTrackStyle}>
                {weekStripPages.map((page) => (
                  <div
                    key={page.weekOffset}
                    className={cn('grid shrink-0', WEEK_STRIP_GRID_CLASS)}
                    style={{ width: `${measuredWeekStripWidth}px` }}
                  >
                    {page.days.map((day, index) => {
                      const key = dayKey(day);
                      const isTodayDate = isSameDay(day, today);
                      const isVisibleStart = key === activeKey;
                      const isVisibleTail = key === visibleTailKey;
                      const isWeekend = index > 4;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            if (weekStripSuppressClickRef.current) return;
                            animateToDate(day);
                          }}
                          className="flex min-h-16 flex-col items-center justify-center gap-1"
                        >
                          <span className={cn(WEEKDAY_LABEL_CLASS, isWeekend ? 'text-muted-foreground' : 'text-foreground')}>
                            {WEEKDAY_LABELS[index]}
                          </span>
                          <motion.span
                            data-mobile-timeline-active-date={isVisibleStart ? 'true' : undefined}
                            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                            className={cn(
                              'relative text-foreground',
                              DATE_CIRCLE_CLASS,
                              'transition-all duration-200 ease-out',
                              enteringFromMonth && !weekStripVisible && 'opacity-0',
                              isVisibleStart && 'text-white',
                              !isVisibleStart && isTodayDate && 'text-red-500',
                              !isVisibleStart && !isTodayDate && isVisibleTail && 'bg-muted text-foreground',
                              !isVisibleStart && !isTodayDate && !isVisibleTail && isWeekend && 'text-muted-foreground',
                            )}
                          >
                            <AnimatePresence initial={false}>
                              {isVisibleStart && (
                                <motion.span
                                  aria-hidden="true"
                                  initial={{ opacity: 0, scale: 0.55 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.55 }}
                                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                                  className="absolute inset-0 rounded-full bg-red-500 shadow-sm"
                                />
                              )}
                            </AnimatePresence>
                            <span className="relative z-10">{format(day, 'd')}</span>
                          </motion.span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <motion.div
        initial={enteringFromMonth ? timelineRevealHidden : false}
        animate={timelineContentVisible ? timelineRevealVisible : timelineRevealHidden}
        className={cn(
          'shrink-0 overflow-hidden border-b border-border/50 bg-background/95',
          !timelineContentVisible && 'opacity-0',
        )}
      >
        <div className="grid" style={{ gridTemplateColumns: `${TIME_GUTTER_WIDTH_PX}px minmax(0, 1fr)` }}>
          <div className="border-r border-border/60 bg-background/95 dark:border-white/10" />
          <div className="min-w-0 overflow-hidden">
            <div className="grid bg-background/95 text-center backdrop-blur" style={trackStyle}>
              {DAY_COLUMN_OFFSETS.map((offset) => renderTimelineHeaderColumn(addDays(activeDate, offset)))}
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        ref={scrollRef}
        initial={enteringFromMonth ? timelineRevealHidden : false}
        animate={timelineContentVisible ? timelineRevealVisible : timelineRevealHidden}
        onPointerDown={(event) => {
          if (!event.isPrimary) return;
          cancelMotionAnimation();
          setIsAnimating(false);
          pointerStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            startOffset: dragOffsetRef.current,
            lastX: event.clientX,
            lastTime: event.timeStamp,
            velocity: 0,
            active: false,
            blocked: false,
          };
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerCancel}
        className={cn(
          'min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden bg-background',
          !timelineContentVisible && 'pointer-events-none opacity-0',
        )}
      >
        <div className="grid" style={{ gridTemplateColumns: `${TIME_GUTTER_WIDTH_PX}px minmax(0, 1fr)` }}>
          {renderTimeGutter()}
          <div ref={dragViewportRef} className={cn('relative min-w-0 overflow-hidden', TIMELINE_HEIGHT_CLASS)}>
            <motion.span
              initial={{ opacity: 0, y: 16, scaleX: 0.96 }}
              animate={timelineContentVisible ? { opacity: 1, y: 0, scaleX: 1 } : { opacity: 0, y: 16, scaleX: 0.96 }}
              transition={{ delay: timelineContentVisible ? 0.14 : 0, duration: 0.32, ease: TIMELINE_REVEAL_EASE }}
              className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
              style={{ top: timelinePosition(nowMinutes), transformOrigin: 'left center' }}
            />
            <div className="grid" style={trackStyle}>
              {DAY_COLUMN_OFFSETS.map((offset) => renderTimelineDayColumn(addDays(activeDate, offset)))}
            </div>
          </div>
        </div>
        <div className="h-10" />
      </motion.div>
    </div>
  );
}
