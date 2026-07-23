export const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

/**
 * Shared navigable range (in years) for the month AND year calendars, so both
 * scroll the same distance — you can reach any month whose year the year view
 * shows. The month view virtualizes its week rows (placeholder-sized off-screen
 * months) so the full span stays smooth. The week/day timeline is swipe-based
 * and effectively unbounded, so it needs no explicit range.
 */
export const CALENDAR_YEARS_BEFORE = 4
export const CALENDAR_YEARS_AFTER = 6

export const WEEK_STRIP_HEIGHT_PX = 64
export const DATE_CIRCLE_SIZE_PX = 36
export const WEEKDAY_LABEL_HEIGHT_PX = 11
export const WEEK_STRIP_GAP_PX = 4
export const WEEK_STRIP_DATE_CIRCLE_OFFSET_PX =
  (WEEK_STRIP_HEIGHT_PX - WEEKDAY_LABEL_HEIGHT_PX - WEEK_STRIP_GAP_PX - DATE_CIRCLE_SIZE_PX) / 2
  + WEEKDAY_LABEL_HEIGHT_PX
  + WEEK_STRIP_GAP_PX

export const WEEK_STRIP_GRID_CLASS = 'grid grid-cols-7 px-4 text-center'
export const WEEKDAY_LABEL_CLASS = 'text-[11px] font-semibold leading-none'
export const DATE_CIRCLE_CLASS = 'flex size-9 items-center justify-center rounded-full text-lg font-semibold leading-none'

/**
 * Month cell density. `detail` shows full event chips with titles and roomy
 * cells; `compact` collapses events into coloured dots and shrinks the grid so
 * more weeks fit at a glance. The month view animates between the two.
 */
export type MonthDensity = 'detail' | 'compact'

/** Roomier than before so `detail` cells actually breathe on wide screens. */
export const MONTH_ROW_MIN_HEIGHT_CLASS =
  'min-h-[6.25rem] sm:min-h-[7.75rem] lg:min-h-[9.5rem] xl:min-h-[11rem]'

/** Tight rows for the dot-only compact month. */
export const MONTH_ROW_MIN_HEIGHT_COMPACT_CLASS =
  'min-h-[3.1rem] sm:min-h-[3.6rem] lg:min-h-[4.25rem] xl:min-h-[4.75rem]'

export function getMonthRowMinHeightClass(density: MonthDensity): string {
  return density === 'compact' ? MONTH_ROW_MIN_HEIGHT_COMPACT_CLASS : MONTH_ROW_MIN_HEIGHT_CLASS
}

/**
 * Continuous month-view pinch zoom. The week-row height is a single CSS var
 * driven live by the pinch; as it grows the event presentation morphs through
 * these stages (matching Apple Calendar): coloured dots → coloured bars →
 * titled chips → titled chips with the time.
 */
export type MonthZoomMode = 'dots' | 'bars' | 'chips' | 'full'

export interface MonthZoomStop {
  mode: MonthZoomMode
  rowH: number
}

/** Snap targets (row height in px). Releasing the pinch settles onto the
 * nearest of these — except above the last one, where zoom is free. */
export const MONTH_ZOOM_STOPS: MonthZoomStop[] = [
  { mode: 'dots', rowH: 56 },
  { mode: 'bars', rowH: 88 },
  { mode: 'chips', rowH: 128 },
  { mode: 'full', rowH: 172 },
]

export const MONTH_ROW_MIN_PX = 52
/** Beyond the 'full' stop the rows keep growing freely (no snapping). */
export const MONTH_ROW_MAX_PX = 320
export const MONTH_ZOOM_FULL_ROW_H = MONTH_ZOOM_STOPS[MONTH_ZOOM_STOPS.length - 1]!.rowH

/** Which presentation stage a given row height renders. */
export function monthZoomModeForRowH(rowH: number): MonthZoomMode {
  if (rowH < 74) return 'dots'
  if (rowH < 108) return 'bars'
  if (rowH < 150) return 'chips'
  return 'full'
}

/**
 * Text scale (0.8 … 1) for the detail chips, so the boxes shrink as the rows get
 * tighter and grow back to their full/current size (capped at 1 = the size at the
 * `chips` stop and above) when there's room — driven off the live row height.
 */
export function chipScaleForRowH(rowH: number): number {
  return Math.max(0.8, Math.min(1, 0.8 + (rowH - 88) / 200))
}

const MONTH_ZOOM_MODE_ORDER: MonthZoomMode[] = ['dots', 'bars', 'chips', 'full']
/** Row-height boundaries between consecutive modes (must match the thresholds
 * in `monthZoomModeForRowH`). */
const MONTH_ZOOM_BOUNDARIES = [74, 108, 150]
/** Dead-band around each boundary. The pinch scale is derived from discrete
 * finger-distance samples, so the live row height jitters; without a dead-band
 * that jitter flips the mode back and forth across a boundary every frame,
 * which restarts the dots↔bars cross-fade on every visible cell and flickers
 * the whole grid. */
const MONTH_ZOOM_HYSTERESIS_PX = 9

/**
 * Hysteresis-aware version of {@link monthZoomModeForRowH}: the presentation
 * stage only changes once the row height moves a margin PAST the boundary in the
 * direction of travel, so small jitter around a threshold can't oscillate the
 * mode (and re-trigger the cross-fade) during a live pinch.
 */
export function nextMonthZoomMode(rowH: number, current: MonthZoomMode): MonthZoomMode {
  const target = monthZoomModeForRowH(rowH)
  if (target === current) return current
  const currentIndex = MONTH_ZOOM_MODE_ORDER.indexOf(current)
  const targetIndex = MONTH_ZOOM_MODE_ORDER.indexOf(target)
  if (targetIndex > currentIndex) {
    // Growing: require rowH clear of the boundary just above `current`.
    const boundary = MONTH_ZOOM_BOUNDARIES[currentIndex]!
    return rowH >= boundary + MONTH_ZOOM_HYSTERESIS_PX ? target : current
  }
  // Shrinking: require rowH clear of the boundary just below `current`.
  const boundary = MONTH_ZOOM_BOUNDARIES[currentIndex - 1]!
  return rowH <= boundary - MONTH_ZOOM_HYSTERESIS_PX ? target : current
}

/** Nearest snap stop to a row height (used on pinch release below 'full'). */
export function nearestMonthZoomStop(rowH: number): MonthZoomStop {
  return MONTH_ZOOM_STOPS.reduce((best, stop) =>
    Math.abs(stop.rowH - rowH) < Math.abs(best.rowH - rowH) ? stop : best,
  )
}

export function rowHForMonthZoomMode(mode: MonthZoomMode): number {
  return (MONTH_ZOOM_STOPS.find((stop) => stop.mode === mode) ?? MONTH_ZOOM_STOPS[2]!).rowH
}

export type ResponsiveCalendarViewMode = 'month' | 'week' | 'today'

/**
 * Fast animated scroll used by the "Heute" jump. Long distances teleport to
 * within one viewport-ish window of the target first, so the visible glide is
 * always quick (~0.4s) no matter how many months/years away today is.
 */
export function animateScrollTo(scroller: HTMLElement, targetTop: number, duration = 420): void {
  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const target = Math.max(0, Math.min(maxTop, targetTop))
  let start = scroller.scrollTop
  const glideWindow = 1600
  if (Math.abs(target - start) > glideWindow) {
    start = target + Math.sign(start - target) * glideWindow
    scroller.scrollTop = start
  }
  const delta = target - start
  if (Math.abs(delta) < 1) {
    scroller.scrollTop = target
    return
  }
  const t0 = performance.now()
  const step = (now: number) => {
    // Clamp low to 0: the first rAF can fire with a frame timestamp slightly
    // before `t0`, giving a negative progress → the cubic ease goes negative and
    // the scroll jumps backwards for one frame before easing in.
    const progress = Math.max(0, Math.min(1, (now - t0) / duration))
    const eased = 1 - Math.pow(1 - progress, 3)
    scroller.scrollTop = start + delta * eased
    if (progress < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/** Number of timeline columns that remain readable at the available width. */
export function getResponsiveCalendarDayCount(
  viewMode: ResponsiveCalendarViewMode,
  contentWidth: number,
): number {
  if (viewMode === 'today') return 1
  if (contentWidth >= 1000) return 7
  if (contentWidth >= 760) return 5
  if (contentWidth >= 560) return 3
  return 2
}

/**
 * Whether the week timeline should show its swipeable week strip. Once every
 * day of the week is visible at once (wide web window or a phone in landscape)
 * the strip is redundant — the day columns themselves scroll continuously — so
 * it is hidden and navigation glides day-by-day instead of snapping by week.
 */
export function shouldShowWeekStrip(visibleDayCount: number, isLandscapePhone: boolean): boolean {
  if (isLandscapePhone) return false
  return visibleDayCount < 7
}
