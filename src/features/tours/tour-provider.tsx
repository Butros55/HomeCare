'use client';

/**
 * Hinweis-Touren (Anfrage Juli 2026): Spotlight-Overlay im Stil moderner
 * Produkt-Touren – das erklärte Element bleibt scharf und hervorgehoben, der
 * Rest wird abgedunkelt und leicht verschwommen. Ein Popover mit Pfeil sitzt
 * automatisch neben dem Ziel, scrollt animiert mit von Schritt zu Schritt und
 * sperrt währenddessen alle anderen Interaktionen.
 *
 *  - Auto-Start beim ersten Besuch einer Seite (Fortschritt am Konto gespeichert)
 *  - „Weiter“/„Zurück“/„Überspringen“ + Fortschrittspunkte; Esc = Überspringen
 *  - `target-click`-Schritte geben NUR das Ziel frei (z. B. „Kunde anlegen“)
 *    und laufen über den Seitenwechsel hinweg weiter
 *  - Theme-Tokens (Brand-Violett, Radien, Schatten), Hell & Dunkel
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { usePathname, useSearchParams } from 'next/navigation';
import * as React from 'react';

import type { NavPermissions, NavUiMode } from '@/components/layout/nav-items';
import { cn } from '@/lib/utils';
import {
  saveTourProgressAction,
  type TourProgressSnapshot,
} from '@/server/actions/tour-actions';
import {
  stepMatchesPath,
  tourForPath,
  TOUR_DEFINITIONS,
  type TourDefinition,
  type TourPlacement,
  type TourStep,
} from './definitions';

interface TourContextValue {
  /** Tour der aktuellen Seite manuell (neu) starten – Hilfe-Button. */
  startCurrentTour: () => void;
  /** Gibt es für die aktuelle Seite überhaupt eine Tour? */
  hasTourForCurrentPage: boolean;
}

const TourContext = React.createContext<TourContextValue>({
  startCurrentTour: () => {},
  hasTourForCurrentPage: false,
});

export function useTour(): TourContextValue {
  return React.useContext(TourContext);
}

interface ActiveTour {
  tour: TourDefinition;
  stepIndex: number;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PADDING = 6;
const POPOVER_GAP = 14;
const POPOVER_WIDTH = 330;

function findTargetElement(anchor: string | undefined): HTMLElement | null {
  if (!anchor) return null;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`),
  );
  // Responsive Duplikate: das aktuell sichtbare Element gewinnt.
  return (
    candidates.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) ?? null
  );
}

function measure(el: HTMLElement): TargetRect {
  const rect = el.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/**
 * Popover-Position: bevorzugte Seite, bei Platzmangel geflippt, im Viewport
 * geklemmt. Sehr große Ziele (ganze Listen/Bereiche) bekommen das Popover
 * ZENTRIERT über dem Spotlight – seitlich wäre kein Platz und unten liefe es
 * aus dem Bild (der „Weiter“-Button war dann abgeschnitten).
 */
function popoverPosition(
  rect: TargetRect | null,
  preferred: TourPlacement | undefined,
  popH: number,
): { top: number; left: number; placement: TourPlacement | 'center'; arrowOffset: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(POPOVER_WIDTH, vw - 24);
  const centered = () => ({
    top: Math.max(12, Math.min(vh - popH - 12, vh / 2 - popH / 2)),
    left: Math.max(12, vw / 2 - width / 2),
    placement: 'center' as const,
    arrowOffset: -1,
  });

  if (!rect) return centered();

  // Riesige Ziele: Popover mittig auf dem Spotlight platzieren (leicht nach
  // unten versetzt, damit die Überschrift des Bereichs sichtbar bleibt).
  const huge = rect.height > vh * 0.55 || (rect.width > vw * 0.8 && rect.height > vh * 0.4);
  if (huge) {
    const centerTop = Math.max(
      12,
      Math.min(vh - popH - 12, rect.top + Math.min(rect.height * 0.35, vh * 0.3)),
    );
    return { top: centerTop, left: Math.max(12, vw / 2 - width / 2), placement: 'center', arrowOffset: -1 };
  }

  const fits: Record<TourPlacement, boolean> = {
    bottom: rect.top + rect.height + POPOVER_GAP + popH <= vh - 12,
    top: rect.top - POPOVER_GAP - popH >= 12,
    right: rect.left + rect.width + POPOVER_GAP + width <= vw - 12,
    left: rect.left - POPOVER_GAP - width >= 12,
  };
  const order: TourPlacement[] = preferred
    ? [preferred, 'bottom', 'right', 'top', 'left']
    : ['bottom', 'right', 'top', 'left'];
  const placement = order.find((p) => fits[p]);
  // Keine Seite passt (kleines Fenster) → zentriert statt abgeschnitten.
  if (!placement) return centered();

  let top: number;
  let left: number;
  if (placement === 'bottom' || placement === 'top') {
    top = placement === 'bottom' ? rect.top + rect.height + POPOVER_GAP : rect.top - POPOVER_GAP - popH;
    left = rect.left + rect.width / 2 - width / 2;
  } else {
    top = rect.top + rect.height / 2 - popH / 2;
    left = placement === 'right' ? rect.left + rect.width + POPOVER_GAP : rect.left - POPOVER_GAP - width;
  }
  left = Math.max(12, Math.min(left, vw - width - 12));
  top = Math.max(12, Math.min(top, vh - popH - 12));

  // Pfeil zeigt auf die Zielmitte (Offset entlang der Popover-Kante).
  const arrowOffset =
    placement === 'bottom' || placement === 'top'
      ? Math.max(18, Math.min(width - 18, rect.left + rect.width / 2 - left))
      : Math.max(18, Math.min(popH - 18, rect.top + rect.height / 2 - top));

  return { top, left, placement, arrowOffset };
}

export function TourProvider({
  permissions,
  uiMode,
  initialProgress,
  children,
}: {
  permissions: NavPermissions;
  uiMode: NavUiMode;
  initialProgress: TourProgressSnapshot[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Routen-Matching inkl. Query, damit z. B. die Einstellungs-Tabs
  // (?tab=leitung / ?tab=mitglieder / ?tab=datenschutz) eigene Touren tragen.
  const location = React.useMemo(() => {
    const query = searchParams?.toString() ?? '';
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const reducedMotion = useReducedMotion();
  const [active, setActive] = React.useState<ActiveTour | null>(null);
  const [rect, setRect] = React.useState<TargetRect | null>(null);
  const [popH, setPopH] = React.useState(180);
  const [targetReady, setTargetReady] = React.useState(false);
  const popRef = React.useRef<HTMLDivElement | null>(null);
  const progressRef = React.useRef<Map<string, TourProgressSnapshot>>(
    new Map(initialProgress.map((entry) => [entry.tourId, entry])),
  );
  // Pro Seitenbesuch höchstens ein Auto-Start (kein Tour-Ping-Pong).
  const autoStartedPathRef = React.useRef<string | null>(null);
  const activeRef = React.useRef<ActiveTour | null>(null);
  React.useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const currentTour = React.useMemo(
    () => tourForPath(location, permissions, uiMode),
    [location, permissions, uiMode],
  );

  const persist = React.useCallback(
    (tour: TourDefinition, status: 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED', stepId: string | null) => {
      progressRef.current.set(tour.id, {
        tourId: tour.id,
        version: tour.version,
        status,
        currentStepId: stepId,
      });
      void saveTourProgressAction({
        tourId: tour.id,
        version: tour.version,
        status,
        currentStepId: stepId,
      });
    },
    [],
  );

  const startTour = React.useCallback(
    (tour: TourDefinition, stepIndex = 0) => {
      setActive({ tour, stepIndex });
      persist(tour, 'IN_PROGRESS', tour.steps[stepIndex]?.id ?? null);
    },
    [persist],
  );

  const endTour = React.useCallback(
    (status: 'COMPLETED' | 'SKIPPED') => {
      const current = activeRef.current;
      if (!current) return;
      persist(current.tour, status, null);
      setActive(null);
      setRect(null);
    },
    [persist],
  );

  const goToStep = React.useCallback(
    (index: number) => {
      const current = activeRef.current;
      if (!current) return;
      if (index >= current.tour.steps.length) {
        endTour('COMPLETED');
        return;
      }
      if (index < 0) return;
      setActive({ tour: current.tour, stepIndex: index });
      persist(current.tour, 'IN_PROGRESS', current.tour.steps[index]?.id ?? null);
    },
    [endTour, persist],
  );

  // ---- Auto-Start beim ersten Besuch -------------------------------------
  React.useEffect(() => {
    if (activeRef.current) {
      // Cross-Page-Flow: Läuft eine Tour und passt der aktuelle Schritt nicht
      // mehr zur Route, zum nächsten Schritt springen, der zur Route passt.
      const { tour, stepIndex } = activeRef.current;
      const step = tour.steps[stepIndex];
      if (step && !stepMatchesPath(step, tour, location)) {
        const nextIndex = tour.steps.findIndex(
          (candidate, index) => index > stepIndex && stepMatchesPath(candidate, tour, location),
        );
        if (nextIndex >= 0) goToStep(nextIndex);
        else endTour('COMPLETED');
      }
      return;
    }
    if (!currentTour) return;
    if (autoStartedPathRef.current === location) return;

    const saved = progressRef.current.get(currentTour.id);
    const isDone = saved && saved.version >= currentTour.version && saved.status !== 'IN_PROGRESS';
    if (isDone) return;

    autoStartedPathRef.current = location;
    // Immer bei Schritt 1 beginnen: eine unterbrochene Tour mitten drin
    // fortzusetzen (z. B. bei „Schritt 4 von 8“) wirkt ohne den Kontext der
    // ersten Schritte verwirrend – der Neustart ist kurz und verständlicher.
    const timer = window.setTimeout(() => startTour(currentTour, 0), 650);
    return () => window.clearTimeout(timer);
  }, [location, currentTour, startTour, goToStep, endTour]);

  const step: TourStep | null = active ? (active.tour.steps[active.stepIndex] ?? null) : null;
  const stepOnRoute = active && step ? stepMatchesPath(step, active.tour, location) : false;

  // ---- Ziel messen: Scroll + laufende Neuvermessung ------------------------
  React.useEffect(() => {
    if (!active || !step || !stepOnRoute) return;
    let cancelled = false;
    let raf = 0;
    let attempts = 0;
    const track = (el: HTMLElement | null) => {
      if (cancelled) return;
      if (el) setRect(measure(el));
      raf = window.requestAnimationFrame(() => track(el && el.isConnected ? el : findTargetElement(step.target)));
    };

    const locate = () => {
      if (cancelled) return;
      const el = findTargetElement(step.target);
      if (!step.target) {
        setTargetReady(true);
        track(null);
        return;
      }
      if (!el) {
        attempts += 1;
        if (attempts > 40) {
          // Ziel existiert nicht (z. B. leere Liste) → Schritt überspringen.
          goToStep((activeRef.current?.stepIndex ?? 0) + 1);
          return;
        }
        raf = window.requestAnimationFrame(locate);
        return;
      }
      el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
      // Nach dem Scrollen stabilisieren, dann Popover einblenden.
      window.setTimeout(() => {
        if (cancelled) return;
        setTargetReady(true);
        track(el);
      }, reducedMotion ? 60 : 420);
    };
    // Reset + Suche asynchron in EINEM Frame: kein synchroner setState im
    // Effect-Body und keine Race zwischen Reset und „ready“.
    window.requestAnimationFrame(() => {
      if (cancelled) return;
      setTargetReady(false);
      setRect(null);
      locate();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.tour.id, active?.stepIndex, stepOnRoute]);

  // Popover-Höhe messen (für Flip/Klemmen) – pro Schritt einmal nach dem Mount.
  React.useEffect(() => {
    const el = popRef.current;
    if (!el) return;
    const measureHeight = () => {
      const h = el.getBoundingClientRect().height;
      setPopH((current) => (h > 0 && Math.abs(h - current) > 2 ? h : current));
    };
    const raf = window.requestAnimationFrame(measureHeight);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureHeight);
    observer?.observe(el);
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [step?.id, targetReady]);

  // ---- Tastatur: Esc = Überspringen, Pfeile = Navigation -------------------
  React.useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        endTour('SKIPPED');
        return;
      }
      if (step?.interaction !== 'target-click') {
        if (event.key === 'ArrowRight' || event.key === 'Enter') {
          event.preventDefault();
          goToStep((activeRef.current?.stepIndex ?? 0) + 1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          goToStep((activeRef.current?.stepIndex ?? 0) - 1);
        }
      }
      // Tab & Co. bleiben im Overlay (Fokus liegt auf dem Popover).
      if (event.key === 'Tab') event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, step, endTour, goToStep]);

  // Fokus auf das Popover ziehen (zugänglicher modaler Dialog).
  React.useEffect(() => {
    if (!active || !targetReady) return;
    const timer = window.setTimeout(() => {
      popRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [active, targetReady, step?.id]);

  // target-click: Klick auf das freigegebene Ziel führt weiter.
  const handleTargetClickCapture = React.useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    const currentStep = current.tour.steps[current.stepIndex];
    if (currentStep?.interaction !== 'target-click') return;
    // Navigation übernimmt das Ziel selbst (Link/Button); der Routenwechsel-
    // Effekt oben schaltet danach auf den nächsten passenden Schritt.
    window.setTimeout(() => {
      const still = activeRef.current;
      if (!still) return;
      const stillStep = still.tour.steps[still.stepIndex];
      if (stillStep?.id === currentStep.id) {
        // Kein Routenwechsel (gleiche Seite) → normal weiterschalten.
        goToStep(still.stepIndex + 1);
      }
    }, 400);
  }, [goToStep]);

  const startCurrentTour = React.useCallback(() => {
    if (!currentTour) return;
    autoStartedPathRef.current = pathname;
    startTour(currentTour, 0);
  }, [currentTour, pathname, startTour]);

  const contextValue = React.useMemo<TourContextValue>(
    () => ({ startCurrentTour, hasTourForCurrentPage: Boolean(currentTour) }),
    [startCurrentTour, currentTour],
  );

  // ---- Geometrie ----------------------------------------------------------
  const spot = rect
    ? {
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
      }
    : null;
  const pop = active && step && targetReady ? popoverPosition(spot, step.placement, popH) : null;
  const isTargetClick = step?.interaction === 'target-click';
  const stepNumber = active ? active.stepIndex + 1 : 0;
  const stepCount = active ? active.tour.steps.length : 0;
  const overlayVisible = Boolean(active && step && stepOnRoute);
  // Root ist pointer-transparent; NUR die Dim-Flächen/Sperren/Popover fangen
  // Klicks – so bleibt das Spotlight-Loch für `target-click` wirklich frei.
  const dimClass = 'pointer-events-auto absolute bg-slate-950/45 backdrop-blur-[2px]';
  const spring = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 380, damping: 34 };

  return (
    <TourContext.Provider value={contextValue}>
      {children}
      <AnimatePresence>
        {overlayVisible ? (
          <motion.div
            key={`tour-${active!.tour.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.25 }}
            className="pointer-events-none fixed inset-0 z-[95]"
            role="dialog"
            aria-modal="true"
            aria-label={step!.title}
            data-tour-overlay=""
          >
            {/* Vier Abdunkelungs-Flächen um das Spotlight – das Ziel bleibt scharf.
                Sie fangen alle Klicks ab; nur das Loch lässt Klicks durch. */}
            {spot ? (
              <>
                <motion.div animate={{ height: Math.max(0, spot.top) }} transition={spring} className={cn(dimClass, 'inset-x-0 top-0')} initial={false} />
                <motion.div
                  initial={false}
                  animate={{ top: spot.top, height: spot.height, width: Math.max(0, spot.left) }}
                  transition={spring}
                  className={cn(dimClass, 'left-0')}
                />
                <motion.div
                  initial={false}
                  animate={{ top: spot.top, height: spot.height, left: spot.left + spot.width }}
                  transition={spring}
                  className={cn(dimClass, 'right-0')}
                />
                <motion.div
                  initial={false}
                  animate={{ top: spot.top + spot.height }}
                  transition={spring}
                  className={cn(dimClass, 'inset-x-0 bottom-0')}
                />
                {/* Spotlight-Rahmen */}
                <motion.div
                  initial={false}
                  animate={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
                  transition={spring}
                  className="pointer-events-none absolute rounded-[var(--radius-lg)] ring-2 ring-[var(--color-brand)] shadow-[0_0_0_4px_var(--color-brand-ring)]"
                />
                {/* Bei reinen Erklär-Schritten auch das Ziel selbst sperren. */}
                {!isTargetClick ? (
                  <motion.div
                    initial={false}
                    animate={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
                    transition={spring}
                    className="pointer-events-auto absolute"
                  />
                ) : null}
              </>
            ) : (
              <div className={cn(dimClass, 'inset-0')} />
            )}

            {/* Klick auf das freigegebene Ziel erkennen (Capture auf window-Ebene
                funktioniert nicht durch das Loch – daher globaler Listener). */}
            {isTargetClick && spot ? (
              <TargetClickListener spot={spot} onTargetClick={handleTargetClickCapture} />
            ) : null}

            {/* Hinweis-Popover mit Pfeil */}
            <AnimatePresence mode="wait">
              {pop && step ? (
                <motion.div
                  key={step.id}
                  ref={popRef}
                  tabIndex={-1}
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1, top: pop.top, left: pop.left }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
                  transition={spring}
                  className="pointer-events-auto absolute z-10 outline-none"
                  style={{ width: Math.min(POPOVER_WIDTH, window.innerWidth - 24) }}
                >
                  <div className="relative max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-4 shadow-[var(--shadow-popover)]">
                    {/* Pfeil (entfällt bei zentrierter Platzierung über großen Zielen) */}
                    {spot && pop.placement !== 'center' && pop.arrowOffset >= 0 ? (
                      <span
                        aria-hidden
                        className={cn(
                          'absolute size-3 rotate-45 border-[var(--color-line-subtle)] bg-[var(--color-panel)]',
                          pop.placement === 'bottom' && '-top-1.5 border-t border-l',
                          pop.placement === 'top' && '-bottom-1.5 border-b border-r',
                          pop.placement === 'right' && '-left-1.5 border-b border-l',
                          pop.placement === 'left' && '-right-1.5 border-t border-r',
                        )}
                        style={
                          pop.placement === 'bottom' || pop.placement === 'top'
                            ? { left: pop.arrowOffset - 6 }
                            : { top: pop.arrowOffset - 6 }
                        }
                      />
                    ) : null}

                    <p className="text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-brand)] uppercase">
                      Schritt {stepNumber} von {stepCount}
                    </p>
                    <h3 className="mt-1 text-[length:var(--text-lg)] font-semibold text-[var(--color-ink)]">
                      {step.title}
                    </h3>
                    <div className="mt-1.5 text-[length:var(--text-sm)] leading-relaxed text-[var(--color-ink-muted)] [&_p+p]:mt-1.5">
                      {step.body}
                    </div>

                    {isTargetClick ? (
                      <p className="mt-3 flex items-center gap-1.5 text-[length:var(--text-xs)] font-medium text-[var(--color-brand)]">
                        <span className="relative flex size-2">
                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--color-brand)] opacity-60" />
                          <span className="relative inline-flex size-2 rounded-full bg-[var(--color-brand)]" />
                        </span>
                        Klicke auf das markierte Element, um fortzufahren
                      </p>
                    ) : null}

                    <div className="mt-4 flex items-center gap-2">
                      {/* Fortschrittspunkte */}
                      <div className="flex flex-1 items-center gap-1">
                        {Array.from({ length: stepCount }, (_, index) => (
                          <span
                            key={index}
                            className={cn(
                              'h-1.5 rounded-full transition-all duration-300',
                              index === active!.stepIndex
                                ? 'w-5 bg-[var(--color-brand)]'
                                : 'w-1.5 bg-[var(--color-line-strong)]',
                            )}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => endTour('SKIPPED')}
                        className="rounded-full px-2.5 py-1.5 text-[length:var(--text-xs)] font-medium text-[var(--color-ink-subtle)] transition-colors hover:text-[var(--color-ink)]"
                      >
                        Überspringen
                      </button>
                      {!isTargetClick ? (
                        <>
                          {active!.stepIndex > 0 ? (
                            <button
                              type="button"
                              onClick={() => goToStep(active!.stepIndex - 1)}
                              className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-panel-raised)]"
                            >
                              Zurück
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => goToStep(active!.stepIndex + 1)}
                            className="rounded-full bg-[var(--color-brand)] px-3.5 py-1.5 text-[length:var(--text-xs)] font-semibold text-white shadow-[0_4px_12px_var(--color-brand-ring)] transition-colors hover:bg-[var(--color-brand-hover)]"
                          >
                            {stepNumber === stepCount ? 'Fertig' : 'Weiter'}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </TourContext.Provider>
  );
}

/**
 * Erkennt Klicks innerhalb des Spotlight-Lochs (dort liegt kein Overlay-Element,
 * der Klick geht direkt an die App – z. B. den „Kunde anlegen“-Button).
 */
function TargetClickListener({
  spot,
  onTargetClick,
}: {
  spot: { top: number; left: number; width: number; height: number };
  onTargetClick: () => void;
}) {
  const spotRef = React.useRef(spot);
  React.useEffect(() => {
    spotRef.current = spot;
  }, [spot]);
  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const s = spotRef.current;
      if (
        event.clientX >= s.left &&
        event.clientX <= s.left + s.width &&
        event.clientY >= s.top &&
        event.clientY <= s.top + s.height
      ) {
        onTargetClick();
      }
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [onTargetClick]);
  return null;
}

/** Hilfe-Button für die Topbar: startet die Tour der aktuellen Seite neu. */
export function TourHelpButton() {
  const { startCurrentTour, hasTourForCurrentPage } = useTour();
  if (!hasTourForCurrentPage) return null;
  return (
    <button
      type="button"
      onClick={startCurrentTour}
      aria-label="Hinweise zu dieser Seite anzeigen"
      title="Hinweise zu dieser Seite"
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] pointer-coarse:size-11 transition-colors hover:bg-[var(--color-panel-raised)] hover:text-[var(--color-ink)]"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    </button>
  );
}

export { TOUR_DEFINITIONS };
