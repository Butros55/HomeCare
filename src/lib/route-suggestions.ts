/**
 * Intelligente Routen-Vorschläge (reine Logik, unit-getestet).
 *
 * Bausteine:
 *  1. Wochenzeitfenster-Arithmetik in Wandzeit-Minuten (Schnitt, Abzug von
 *     Abwesenheiten). Keine Einträge bedeuten „uneingeschränkt verfügbar".
 *  2. Automatische Abfahrt: statt manueller Abfahrtszeit wird die späteste
 *     empfohlene Abfahrt berechnet, mit der der erste Termin inklusive
 *     Puffer erreichbar bleibt (planRouteWithAutoDeparture).
 *  3. Kandidaten-Bewertung: ein vorgeschlagener Einsatz wird im
 *     15-Minuten-Raster als fester Stopp in die Route eingesetzt; nur
 *     vollständig zulässige Zeitpläne zählen. Ergebnis sind die Auswirkungen
 *     (Mehrfahrt, Wartezeit, Arbeitstag, Abfahrt/Rückkehr).
 *
 * Alle Zeiten UTC; Fenster in Minuten seit Mitternacht (Org-Wandzeit).
 */

import { optimizeRoute, computeSchedule, type Matrix, type OptimizedRoute, type RouteStopInput } from '@/lib/route-optimizer';

// ---------------------------------------------------------------------------
// Zeitfenster (Wandzeit-Minuten)
// ---------------------------------------------------------------------------

/** Halboffenes Fenster [startMinute, endMinute) in Minuten seit Mitternacht. */
export interface MinuteWindow {
  startMinute: number;
  endMinute: number;
}

export const FULL_DAY_WINDOW: MinuteWindow = { startMinute: 0, endMinute: 24 * 60 };

/** "HH:mm" → Minuten seit Mitternacht. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minuten seit Mitternacht → "HH:mm". */
export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/** Slots ("HH:mm"-Paare) → sortierte, zusammengeführte Fenster. Leer → []. */
export function slotsToWindows(
  slots: { startTime: string; endTime: string }[],
): MinuteWindow[] {
  const windows = slots
    .map((slot) => ({ startMinute: timeToMinutes(slot.startTime), endMinute: timeToMinutes(slot.endTime) }))
    .filter((w) => w.endMinute > w.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute);
  // Überlappende/berührende Fenster zusammenführen.
  const merged: MinuteWindow[] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, window.endMinute);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/** Schnittmenge zweier Fensterlisten. */
export function intersectWindows(a: MinuteWindow[], b: MinuteWindow[]): MinuteWindow[] {
  const result: MinuteWindow[] = [];
  for (const wa of a) {
    for (const wb of b) {
      const start = Math.max(wa.startMinute, wb.startMinute);
      const end = Math.min(wa.endMinute, wb.endMinute);
      if (end > start) result.push({ startMinute: start, endMinute: end });
    }
  }
  return result.sort((x, y) => x.startMinute - y.startMinute);
}

/** Blockierte Bereiche (z. B. Abwesenheiten) aus Fenstern herausschneiden. */
export function subtractWindows(windows: MinuteWindow[], blocked: MinuteWindow[]): MinuteWindow[] {
  let current = windows.map((w) => ({ ...w }));
  for (const block of blocked) {
    const next: MinuteWindow[] = [];
    for (const window of current) {
      if (block.endMinute <= window.startMinute || block.startMinute >= window.endMinute) {
        next.push(window);
        continue;
      }
      if (block.startMinute > window.startMinute) {
        next.push({ startMinute: window.startMinute, endMinute: block.startMinute });
      }
      if (block.endMinute < window.endMinute) {
        next.push({ startMinute: block.endMinute, endMinute: window.endMinute });
      }
    }
    current = next;
  }
  return current;
}

/**
 * Verfügbarkeitsfenster für einen Vorschlag: Kundenfenster ∩ Mitarbeiterfenster,
 * minus Abwesenheiten. Leere Eingaben gelten als „ganztägig verfügbar".
 */
export function candidateWindows(input: {
  customerSlots: { startTime: string; endTime: string }[];
  employeeSlots: { startTime: string; endTime: string }[];
  blockedWindows?: MinuteWindow[];
}): MinuteWindow[] {
  const customer = input.customerSlots.length > 0 ? slotsToWindows(input.customerSlots) : [FULL_DAY_WINDOW];
  const employee = input.employeeSlots.length > 0 ? slotsToWindows(input.employeeSlots) : [FULL_DAY_WINDOW];
  const intersection = intersectWindows(customer, employee);
  return input.blockedWindows?.length
    ? subtractWindows(intersection, input.blockedWindows)
    : intersection;
}

/**
 * Fenstergrenzen für einen NEU angelegten flexiblen Termin (aus Vorschlag oder
 * Tagesplanung): das Verfügbarkeitsfenster (Kunde ∩ Mitarbeiter), das den
 * gewählten Einsatz enthält. So bleibt der Termin bei künftigen Umplanungen im
 * selben Rahmen beweglich, statt fest verankert zu sein.
 *
 * Ohne gepflegte Fenster gilt das übergebene Standard-Planungsfenster; liegt
 * der Einsatz (theoretisch) außerhalb jedes Fensters, wird exakt sein eigener
 * Zeitraum verwendet – ein Termin liegt nie außerhalb seines Fensters.
 */
export function enclosingFlexWindow(input: {
  customerSlots: { startTime: string; endTime: string }[];
  employeeSlots: { startTime: string; endTime: string }[];
  startMinute: number;
  endMinute: number;
  fallbackWindow?: MinuteWindow;
}): MinuteWindow {
  const unconstrained = input.customerSlots.length === 0 && input.employeeSlots.length === 0;
  const windows = unconstrained
    ? [input.fallbackWindow ?? FULL_DAY_WINDOW]
    : candidateWindows({ customerSlots: input.customerSlots, employeeSlots: input.employeeSlots });
  const enclosing = windows.find(
    (w) => input.startMinute >= w.startMinute && input.endMinute <= w.endMinute,
  );
  // Kein umschließendes Fenster (z. B. Standardfenster zu eng): exakt der
  // Einsatz selbst – ein Termin liegt nie außerhalb seines eigenen Fensters.
  return enclosing ?? { startMinute: input.startMinute, endMinute: input.endMinute };
}

// ---------------------------------------------------------------------------
// Offener Bedarf & Vorschlagsdauer
// ---------------------------------------------------------------------------

/** Termin-Status, die Budgetminuten reservieren (Bedarf mindern). */
export const RESERVING_STATUSES = [
  'DRAFT',
  'PLANNED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
] as const;

export function isReservingStatus(status: string): boolean {
  return (RESERVING_STATUSES as readonly string[]).includes(status);
}

/** Offene Minuten eines Budgets: korrigiertes Budget minus reservierte Termine. */
export function computeOpenBudgetMinutes(budgetMinutes: number, reservedMinutes: number): number {
  return Math.max(0, budgetMinutes - reservedMinutes);
}

export const MIN_SUGGESTION_MINUTES = 15;

/**
 * Dauer eines Vorschlags: Kunden-Standarddauer, begrenzt durch Budgetrest und
 * das längste Verfügbarkeitsfenster. Unter 15 Minuten entsteht kein Vorschlag.
 */
export function suggestionDurationMinutes(input: {
  defaultDurationMinutes: number;
  openMinutes: number;
  windows: MinuteWindow[];
}): number | null {
  const longestWindow = input.windows.reduce(
    (max, w) => Math.max(max, w.endMinute - w.startMinute),
    0,
  );
  const duration = Math.min(input.defaultDurationMinutes, input.openMinutes, longestWindow);
  return duration >= MIN_SUGGESTION_MINUTES ? Math.floor(duration) : null;
}

// ---------------------------------------------------------------------------
// Automatische Abfahrt
// ---------------------------------------------------------------------------

export interface PlanRouteInput {
  stops: RouteStopInput[];
  matrix: Matrix;
  bufferMinutes: number;
  returnToEnd: boolean;
  /** Frühestmögliche Abfahrt (Simulationsbeginn), z. B. 00:00 Org-Wandzeit als UTC. */
  earliestDepartureAt: Date;
  formatTime?: (date: Date) => string;
}

export interface PlannedRoute extends OptimizedRoute {
  order: number[];
  /** Späteste empfohlene Abfahrt (erster Termin inkl. Puffer erreichbar). */
  latestDepartureAt: Date;
  /** Arbeitstag: Abfahrt bis Rückkehr (bzw. letztes Einsatzende) in Sekunden. */
  workdaySeconds: number;
}

/**
 * Route planen und die Abfahrt automatisch bestimmen:
 *  1. Simulation ab frühester Abfahrt (Anker: feste Zeiten & Fensteröffnungen).
 *  2. Späteste Abfahrt = Einsatzbeginn des ersten Stopps − Fahrzeit − Puffer.
 *  3. Zeitplan mit identischer Reihenfolge ab dieser Abfahrt neu berechnen –
 *     alle nachfolgenden Zeiten bleiben unverändert, nur die Anfangswartezeit
 *     entfällt.
 */
export function planRouteWithAutoDeparture(input: PlanRouteInput): PlannedRoute {
  const probe = optimizeRoute({
    stops: input.stops,
    matrix: input.matrix,
    departureAt: input.earliestDepartureAt,
    bufferMinutes: input.bufferMinutes,
    returnToEnd: input.returnToEnd,
    formatTime: input.formatTime,
  });

  if (probe.stops.length === 0) {
    return {
      ...probe,
      latestDepartureAt: input.earliestDepartureAt,
      workdaySeconds: 0,
    };
  }

  const first = probe.stops[0]!;
  // Verschiebung = Anfangswartezeit minus gewünschter Puffer vor dem ersten Termin.
  const shiftSeconds = Math.max(0, first.waitSeconds - input.bufferMinutes * 60);
  const latestDepartureAt = new Date(input.earliestDepartureAt.getTime() + shiftSeconds * 1000);

  const finalSchedule =
    shiftSeconds > 0
      ? computeSchedule(probe.order, {
          stops: input.stops,
          matrix: input.matrix,
          departureAt: latestDepartureAt,
          bufferMinutes: input.bufferMinutes,
          returnToEnd: input.returnToEnd,
          formatTime: input.formatTime,
        })
      : probe;

  const lastEnd =
    finalSchedule.returnArrivalAt ??
    finalSchedule.stops[finalSchedule.stops.length - 1]?.serviceEndAt ??
    latestDepartureAt;

  return {
    ...finalSchedule,
    order: probe.order,
    latestDepartureAt,
    workdaySeconds: Math.max(0, Math.round((lastEnd.getTime() - latestDepartureAt.getTime()) / 1000)),
  };
}

// ---------------------------------------------------------------------------
// Kandidaten-Bewertung (Vorschlag in Route einsetzen)
// ---------------------------------------------------------------------------

/** Teilmatrix über die angegebenen Punktindizes der vollen Matrix. */
export function sliceMatrix(full: Matrix, indices: number[]): Matrix {
  return {
    travelSeconds: indices.map((i) => indices.map((j) => full.travelSeconds[i]?.[j] ?? 0)),
    distanceMeters: indices.map((i) => indices.map((j) => full.distanceMeters[i]?.[j] ?? 0)),
  };
}

export const SUGGESTION_GRID_MINUTES = 15;

export interface CandidateEvaluationInput {
  /** Bestehende (ausgewählte) Stopps der Route. */
  baseStops: RouteStopInput[];
  /** Basisroute (gleiche Stopps, gleiche Matrix ohne Kandidat) zum Vergleich. */
  baseRoute: PlannedRoute;
  candidate: {
    id: string;
    serviceMinutes: number;
    /** Erlaubte Fenster (Wandzeit-Minuten) am Planungstag. */
    windows: MinuteWindow[];
  };
  /** Matrix über [Start, ...baseStops, Kandidat, Ziel]. */
  matrix: Matrix;
  bufferMinutes: number;
  returnToEnd: boolean;
  earliestDepartureAt: Date;
  /** Wandzeit-Minuten → UTC-Zeitpunkt am Planungstag (Zeitzonenlogik des Aufrufers). */
  minuteToUtc: (minute: number) => Date;
  formatTime?: (date: Date) => string;
  gridStepMinutes?: number;
}

export interface SuggestionImpact {
  extraTravelSeconds: number;
  extraDistanceMeters: number;
  extraWaitSeconds: number;
  /** Veränderung des gesamten Arbeitstags (Abfahrt→Rückkehr) in Sekunden. */
  workdayDeltaSeconds: number;
  departureAt: Date;
  returnAt: Date | null;
  previousDepartureAt: Date | null;
  previousReturnAt: Date | null;
}

export interface CandidateEvaluation {
  candidateId: string;
  feasible: boolean;
  startAt: Date | null;
  endAt: Date | null;
  /** 1-basierte Position des Kandidaten in der neuen Stoppliste. */
  position: number | null;
  /** Stopp-ID, nach der eingefügt wird (null = erster Stopp). */
  insertAfterStopId: string | null;
  route: PlannedRoute | null;
  impact: SuggestionImpact | null;
  /** Interner Vergleichswert (kleiner = besser). */
  score: number;
}

function routePenalty(route: PlannedRoute, base: PlannedRoute): number {
  const extraTravel = route.totalTravelSeconds - base.totalTravelSeconds;
  const extraWait = route.totalWaitSeconds - base.totalWaitSeconds;
  const workdayDelta = route.workdaySeconds - base.workdaySeconds;
  return extraTravel + Math.max(0, extraWait) * 0.3 + Math.max(0, workdayDelta) * 0.2;
}

/**
 * Kandidat im Zeitraster in die Route einsetzen und die beste zulässige
 * Variante ermitteln. Harte Regeln: fester Zeitplan bleibt einhaltbar,
 * Kandidat liegt vollständig in einem erlaubten Fenster, keine Überschneidung
 * (implizit über den Zeitplan – ein unzulässiger Plan wird verworfen).
 */
export function evaluateCandidate(input: CandidateEvaluationInput): CandidateEvaluation {
  const step = input.gridStepMinutes ?? SUGGESTION_GRID_MINUTES;
  const infeasible: CandidateEvaluation = {
    candidateId: input.candidate.id,
    feasible: false,
    startAt: null,
    endAt: null,
    position: null,
    insertAfterStopId: null,
    route: null,
    impact: null,
    score: Number.POSITIVE_INFINITY,
  };

  let best: CandidateEvaluation = infeasible;

  for (const window of input.candidate.windows) {
    const firstSlot = Math.ceil(window.startMinute / step) * step;
    for (
      let minute = firstSlot;
      minute + input.candidate.serviceMinutes <= window.endMinute;
      minute += step
    ) {
      const fixedStartAt = input.minuteToUtc(minute);
      const stops: RouteStopInput[] = [
        ...input.baseStops,
        {
          id: input.candidate.id,
          latitude: 0,
          longitude: 0,
          serviceMinutes: input.candidate.serviceMinutes,
          fixedStartAt,
        },
      ];
      const planned = planRouteWithAutoDeparture({
        stops,
        matrix: input.matrix,
        bufferMinutes: input.bufferMinutes,
        returnToEnd: input.returnToEnd,
        earliestDepartureAt: input.earliestDepartureAt,
        formatTime: input.formatTime,
      });
      if (!planned.feasible) continue;

      const candidateStop = planned.stops.find((stop) => stop.id === input.candidate.id);
      if (!candidateStop) continue;

      const score = routePenalty(planned, input.baseRoute);
      if (score < best.score) {
        const position = candidateStop.sequence;
        const before = planned.stops.find((stop) => stop.sequence === position - 1);
        best = {
          candidateId: input.candidate.id,
          feasible: true,
          startAt: candidateStop.serviceStartAt,
          endAt: candidateStop.serviceEndAt,
          position,
          insertAfterStopId: before?.id ?? null,
          route: planned,
          impact: {
            extraTravelSeconds: planned.totalTravelSeconds - input.baseRoute.totalTravelSeconds,
            extraDistanceMeters:
              planned.totalDistanceMeters - input.baseRoute.totalDistanceMeters,
            extraWaitSeconds: planned.totalWaitSeconds - input.baseRoute.totalWaitSeconds,
            workdayDeltaSeconds: planned.workdaySeconds - input.baseRoute.workdaySeconds,
            departureAt: planned.latestDepartureAt,
            returnAt: planned.returnArrivalAt,
            previousDepartureAt:
              input.baseRoute.stops.length > 0 ? input.baseRoute.latestDepartureAt : null,
            previousReturnAt: input.baseRoute.returnArrivalAt,
          },
          score,
        };
      }
    }
  }

  return best;
}
