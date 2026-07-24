/**
 * Tages-Routen-Generator (reine Logik, unit-getestet).
 *
 * Anders als die Einzel-Vorschläge (ein Kunde in eine bestehende Route
 * einsetzen) baut dieser Planer eine KOMPLETTE Tagesroute: feste Termine bleiben
 * verankert, flexible Termine werden umgeplant, und aus dem offenen Kundenbedarf
 * werden passende Einsätze aufgefüllt – bis eine Zielvorgabe (Stunden, späteste
 * Rückkehr) erreicht ist.
 *
 * Es werden mehrere Varianten mit unterschiedlichen Zielen erzeugt, damit die
 * Leitung die für den Tag beste Route auswählen kann:
 *  - `compact`  „Wenig Fahrt"      – bis zur Zielarbeitszeit, minimale Fahrt.
 *  - `full`     „Volle Auslastung" – so viele Stunden wie zulässig.
 *  - `early`    „Früh zu Hause"    – kürzerer Tag, möglichst frühe Rückkehr.
 *
 * Alle Zeiten UTC; Fahrzeiten in Sekunden; Servicezeiten in Minuten. Der Planer
 * ist rein: er kennt weder Datenbank noch Zeitzone – der Aufrufer liefert die
 * Matrix, die Fenster als UTC-Zeitpunkte und einen Zeitformatierer.
 */

import type { Matrix, RouteStopInput } from '@/lib/route-optimizer';
import { planRouteWithAutoDeparture, sliceMatrix, type PlannedRoute } from '@/lib/route-suggestions';

/** Ein noch nicht eingeplanter, möglicher Einsatz aus offenem Kundenbedarf. */
export interface DayPlanCandidate {
  id: string;
  latitude: number;
  longitude: number;
  serviceMinutes: number;
  /** Frühester Beginn (UTC) aus dem breitesten Verfügbarkeitsfenster. */
  earliestStartAt: Date;
  /** Spätestes Ende (UTC) aus demselben Fenster. */
  latestEndAt: Date;
  /** Wunschmitarbeiter des Kunden – wird bevorzugt aufgenommen. */
  isPreferred: boolean;
  /** Stunden bereits diesem Mitarbeiter zugewiesen – wird bevorzugt aufgenommen. */
  hasAllocation: boolean;
}

export type DayVariantObjective = 'compact' | 'full' | 'early';

export interface DayPlanOptions {
  bufferMinutes: number;
  returnToEnd: boolean;
  /** Frühestmögliche Abfahrt / Simulationsbeginn (z. B. 00:00 Org-Wandzeit oder Nutzer-Abfahrt). */
  earliestDepartureAt: Date;
  /** Harte Obergrenze für die Rückkehr (Nutzerwunsch „zuhause bis"). null = keine. */
  latestReturnAt: Date | null;
  /** Zielarbeitszeit in Minuten (Kunden-Servicezeit). null = Standardziel. */
  targetWorkMinutes: number | null;
  /** Absolute Obergrenze der gesamten Servicezeit (Tageshöchstarbeitszeit). null = keine. */
  maxTotalServiceMinutes: number | null;
  formatTime?: (date: Date) => string;
}

export interface DayVariant {
  objective: DayVariantObjective;
  /** IDs der zusätzlich aufgenommenen Kandidaten (in Auswahlreihenfolge). */
  selectedCandidateIds: string[];
  route: PlannedRoute;
}

/** Standard-Zielarbeitszeit, wenn der Nutzer keine angibt (6 Stunden). */
export const DEFAULT_TARGET_MINUTES = 6 * 60;

/** Bewertungsboni, damit Wunschmitarbeiter/zugewiesene Kunden zuerst kommen. */
const PREFERRED_BONUS = 300;
const ALLOCATION_BONUS = 600;

function candidateToStop(candidate: DayPlanCandidate): RouteStopInput {
  return {
    id: candidate.id,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    serviceMinutes: candidate.serviceMinutes,
    // Flexibel im breitesten Verfügbarkeitsfenster – die Engine wählt die Zeit.
    fixedStartAt: null,
    earliestStartAt: candidate.earliestStartAt,
    latestEndAt: candidate.latestEndAt,
  };
}

/** Zeitpunkt, zu dem der Tag endet (Rückkehr, sonst letztes Einsatzende). */
function routeEnd(route: PlannedRoute, fallback: Date): Date {
  return route.returnArrivalAt ?? route.stops.at(-1)?.serviceEndAt ?? fallback;
}

/**
 * Varianten für die Tagesroute erzeugen. Die volle Matrix ist über
 * `[Start, ...baseStops, ...candidates, Ziel]` indiziert (Ziel = letzter Punkt).
 */
export function buildDayVariants(input: {
  baseStops: RouteStopInput[];
  candidates: DayPlanCandidate[];
  fullMatrix: Matrix;
  options: DayPlanOptions;
}): DayVariant[] {
  const { baseStops, candidates, fullMatrix, options } = input;
  const baseCount = baseStops.length;
  const destIndex = 1 + baseCount + candidates.length;

  /** Route für eine Kandidatenauswahl planen (Teilmatrix aus der vollen Matrix). */
  const planSubset = (selectedIdx: number[]): PlannedRoute => {
    const stops = [...baseStops, ...selectedIdx.map((j) => candidateToStop(candidates[j]!))];
    const indices = [
      0,
      ...baseStops.map((_, i) => 1 + i),
      ...selectedIdx.map((j) => 1 + baseCount + j),
      destIndex,
    ];
    return planRouteWithAutoDeparture({
      stops,
      matrix: sliceMatrix(fullMatrix, indices),
      bufferMinutes: options.bufferMinutes,
      returnToEnd: options.returnToEnd,
      earliestDepartureAt: options.earliestDepartureAt,
      formatTime: options.formatTime,
    });
  };

  const withinReturn = (route: PlannedRoute): boolean =>
    !options.latestReturnAt ||
    routeEnd(route, options.earliestDepartureAt).getTime() <= options.latestReturnAt.getTime();
  const withinMax = (route: PlannedRoute): boolean =>
    !options.maxTotalServiceMinutes || route.totalServiceMinutes <= options.maxTotalServiceMinutes;

  const target = options.targetWorkMinutes ?? DEFAULT_TARGET_MINUTES;

  const buildGreedy = (objective: DayVariantObjective): DayVariant => {
    const selected: number[] = [];
    const inSelected = new Set<number>();
    let current = planSubset([]);
    // „compact" füllt bis zum Ziel, „early" bewusst kürzer, „full" bis nichts mehr passt.
    const stopTarget =
      objective === 'compact'
        ? target
        : objective === 'early'
          ? Math.round(target * 0.6)
          : Number.POSITIVE_INFINITY;

    for (;;) {
      if (objective !== 'full' && current.totalServiceMinutes >= stopTarget) break;

      let best: { j: number; route: PlannedRoute; score: number } | null = null;
      for (let j = 0; j < candidates.length; j += 1) {
        if (inSelected.has(j)) continue;
        const route = planSubset([...selected, j]);
        if (!route.feasible || !withinReturn(route) || !withinMax(route)) continue;

        const marginalTravel = route.totalTravelSeconds - current.totalTravelSeconds;
        const addedService = Math.max(1, route.totalServiceMinutes - current.totalServiceMinutes);
        const laterHomeSeconds =
          (routeEnd(route, options.earliestDepartureAt).getTime() -
            routeEnd(current, options.earliestDepartureAt).getTime()) /
          1000;
        const bonus =
          (candidates[j]!.isPreferred ? PREFERRED_BONUS : 0) +
          (candidates[j]!.hasAllocation ? ALLOCATION_BONUS : 0);

        let score: number;
        if (objective === 'compact') {
          score = marginalTravel / addedService - bonus;
        } else if (objective === 'full') {
          score = marginalTravel - bonus;
        } else {
          // „early": jede zusätzliche Serviceminute soll die Heimkehr kaum verzögern.
          score = laterHomeSeconds / addedService - bonus;
        }

        if (best === null || score < best.score) best = { j, route, score };
      }

      if (!best) break;
      selected.push(best.j);
      inSelected.add(best.j);
      current = best.route;
    }

    return {
      objective,
      selectedCandidateIds: selected.map((j) => candidates[j]!.id),
      route: current,
    };
  };

  const variants = [buildGreedy('compact'), buildGreedy('full'), buildGreedy('early')];

  // Doppelte (identische Auswahl) entfernen – Reihenfolge = Priorität der Ziele.
  const seen = new Set<string>();
  const distinct: DayVariant[] = [];
  for (const variant of variants) {
    const signature = [...variant.selectedCandidateIds].sort().join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    distinct.push(variant);
  }
  return distinct;
}
