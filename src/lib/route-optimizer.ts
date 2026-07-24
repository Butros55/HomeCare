/**
 * Tagesrouten-Optimierung (Anforderung 17) – reine Logik, unit-getestet.
 *
 * MVP-Heuristik:
 *  1. Feste Termine zeitlich sortieren (bilden das Grundgerüst).
 *  2. Erreichbarkeit entlang der Matrix prüfen (Warnungen, keine Auto-Fixes).
 *  3. Flexible Termine per günstigster Einfügung (Insertionsheuristik)
 *     unter Beachtung ihrer Zeitfenster einfügen.
 *  4. 2-opt nur innerhalb zusammenhängender flexibler Blöcke – feste
 *     Terminzeiten werden niemals durch die Optimierung verletzt.
 *
 * Alle Zeiten UTC; Fahrzeiten in Sekunden; Servicezeiten in Minuten.
 */

export interface RouteStopInput {
  id: string;
  latitude: number;
  longitude: number;
  serviceMinutes: number;
  /** Feste Termine haben eine fixe Startzeit. */
  fixedStartAt?: Date | null;
  /** Flexible Termine: erlaubtes Fenster (Service muss komplett hineinpassen). */
  earliestStartAt?: Date | null;
  latestEndAt?: Date | null;
}

export interface ScheduledStop {
  id: string;
  sequence: number;
  arrivalAt: Date;
  serviceStartAt: Date;
  serviceEndAt: Date;
  departureAt: Date;
  travelSecondsFromPrevious: number;
  distanceMetersFromPrevious: number;
  waitSeconds: number;
  warning: string | null;
}

export interface OptimizedRoute {
  stops: ScheduledStop[];
  departureAt: Date;
  returnArrivalAt: Date | null;
  totalTravelSeconds: number;
  totalDistanceMeters: number;
  totalServiceMinutes: number;
  totalWaitSeconds: number;
  warnings: string[];
  feasible: boolean;
}

export interface Matrix {
  /** [from][to] – Index 0 = Start, 1..n = Stopps (Eingabereihenfolge), n+1 = Ziel. */
  travelSeconds: number[][];
  distanceMeters: number[][];
}

export interface OptimizeInput {
  stops: RouteStopInput[];
  matrix: Matrix;
  departureAt: Date;
  /** Mindestpuffer zwischen Terminen in Minuten. */
  bufferMinutes: number;
  /** true = Route endet am Zielpunkt (letzter Matrixindex). */
  returnToEnd: boolean;
  /** Zeitformatierung für Warntexte (Standard: UTC-Wanduhr; Aufrufer übergibt Zeitzonen-Formatter). */
  formatTime?: (date: Date) => string;
}

const defaultFmt = (date: Date) =>
  `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;

/** Zeitplan für eine gegebene Reihenfolge simulieren (Kern der Heuristik). */
export function computeSchedule(
  order: number[], // Stop-Indizes (0-basiert auf stops-Array)
  input: OptimizeInput,
): OptimizedRoute {
  const { stops, matrix, bufferMinutes } = input;
  const fmt = input.formatTime ?? defaultFmt;
  const startIndex = 0;
  const endIndex = stops.length + 1;
  const matrixIndex = (stopIndex: number) => stopIndex + 1;

  const scheduled: ScheduledStop[] = [];
  const warnings: string[] = [];
  let feasible = true;

  let currentMatrixIndex = startIndex;
  let currentTime = input.departureAt;
  let totalTravel = 0;
  let totalDistance = 0;
  let totalWait = 0;

  order.forEach((stopIndex, position) => {
    const stop = stops[stopIndex]!;
    const travel = matrix.travelSeconds[currentMatrixIndex]?.[matrixIndex(stopIndex)] ?? 0;
    const distance = matrix.distanceMeters[currentMatrixIndex]?.[matrixIndex(stopIndex)] ?? 0;
    const arrival = new Date(currentTime.getTime() + travel * 1000);

    let serviceStart: Date;
    let warning: string | null = null;

    if (stop.fixedStartAt) {
      // Feste Termine sind zeitlich verankert: Der Beginn wird NIE verschoben –
      // eine zu späte Ankunft wird gemeldet (Route unzulässig), aber die
      // angezeigten Zeiten bleiben die vereinbarten.
      serviceStart = stop.fixedStartAt;
      if (arrival > stop.fixedStartAt) {
        const lateMinutes = Math.ceil((arrival.getTime() - stop.fixedStartAt.getTime()) / 60_000);
        warning = `Ankunft ${lateMinutes} Min. nach dem festen Beginn (${fmt(stop.fixedStartAt)} geplant).`;
        feasible = false;
      }
    } else {
      serviceStart = arrival;
      if (stop.earliestStartAt && serviceStart < stop.earliestStartAt) {
        serviceStart = stop.earliestStartAt; // warten bis Fensteröffnung
      }
    }

    const serviceEnd = new Date(serviceStart.getTime() + stop.serviceMinutes * 60_000);
    if (!stop.fixedStartAt && stop.latestEndAt && serviceEnd > stop.latestEndAt) {
      warning = `Einsatz endet nach dem spätesten Ende (${fmt(stop.latestEndAt)}).`;
      feasible = false;
    }

    const wait = Math.max(0, Math.round((serviceStart.getTime() - arrival.getTime()) / 1000));
    totalTravel += travel;
    totalDistance += distance;
    totalWait += wait;

    scheduled.push({
      id: stop.id,
      sequence: position + 1,
      arrivalAt: arrival,
      serviceStartAt: serviceStart,
      serviceEndAt: serviceEnd,
      departureAt: serviceEnd,
      travelSecondsFromPrevious: travel,
      distanceMetersFromPrevious: distance,
      waitSeconds: wait,
      warning,
    });
    if (warning) warnings.push(`Stopp ${position + 1}: ${warning}`);

    currentMatrixIndex = matrixIndex(stopIndex);
    // Bei verspäteter Ankunft an einem festen Termin (serviceEnd < arrival
    // möglich, da der Beginn verankert bleibt) darf die Zeit nicht rückwärts laufen.
    currentTime = new Date(Math.max(serviceEnd.getTime(), arrival.getTime()) + bufferMinutes * 60_000);
  });

  let returnArrivalAt: Date | null = null;
  if (input.returnToEnd && order.length > 0) {
    const travel = matrix.travelSeconds[currentMatrixIndex]?.[endIndex] ?? 0;
    const distance = matrix.distanceMeters[currentMatrixIndex]?.[endIndex] ?? 0;
    totalTravel += travel;
    totalDistance += distance;
    const lastEnd = scheduled[scheduled.length - 1]!.serviceEndAt;
    returnArrivalAt = new Date(lastEnd.getTime() + travel * 1000);
  }

  return {
    stops: scheduled,
    departureAt: input.departureAt,
    returnArrivalAt,
    totalTravelSeconds: totalTravel,
    totalDistanceMeters: totalDistance,
    totalServiceMinutes: order.reduce((sum, i) => sum + stops[i]!.serviceMinutes, 0),
    totalWaitSeconds: totalWait,
    warnings,
    feasible,
  };
}

function routeCost(route: OptimizedRoute): number {
  // Verletzungen dominieren, danach Fahrzeit, dann Wartezeit.
  return route.warnings.length * 1_000_000 + route.totalTravelSeconds + route.totalWaitSeconds / 10;
}

/** Haupteinstieg: feste sortieren → flexible einfügen → 2-opt in Blöcken. */
export function optimizeRoute(input: OptimizeInput): OptimizedRoute & { order: number[] } {
  const { stops } = input;
  if (stops.length === 0) {
    return {
      ...computeSchedule([], input),
      order: [],
    };
  }

  const fixedIndices = stops
    .map((stop, index) => ({ stop, index }))
    .filter((entry) => entry.stop.fixedStartAt)
    .sort((a, b) => a.stop.fixedStartAt!.getTime() - b.stop.fixedStartAt!.getTime())
    .map((entry) => entry.index);
  const flexibleIndices = stops
    .map((stop, index) => ({ stop, index }))
    .filter((entry) => !entry.stop.fixedStartAt)
    // Frühe Fenster zuerst einfügen – stabil und deterministisch.
    .sort((a, b) => {
      const aKey = a.stop.earliestStartAt?.getTime() ?? 0;
      const bKey = b.stop.earliestStartAt?.getTime() ?? 0;
      return aKey - bKey || a.index - b.index;
    })
    .map((entry) => entry.index);

  // 1–2: Grundgerüst aus festen Terminen.
  let order = [...fixedIndices];

  // 3: Insertionsheuristik für flexible Termine.
  for (const flexibleIndex of flexibleIndices) {
    let best: { order: number[]; cost: number } | null = null;
    for (let position = 0; position <= order.length; position += 1) {
      const candidate = [...order.slice(0, position), flexibleIndex, ...order.slice(position)];
      const schedule = computeSchedule(candidate, input);
      const cost = routeCost(schedule);
      if (!best || cost < best.cost) best = { order: candidate, cost };
    }
    order = best!.order;
  }

  // 4: 2-opt nur innerhalb flexibler Blöcke (feste Anker unangetastet).
  const isFlexible = (stopIndex: number) => !stops[stopIndex]!.fixedStartAt;
  let improved = true;
  let guard = 0;
  while (improved && guard < 50) {
    improved = false;
    guard += 1;
    for (let i = 0; i < order.length - 1; i += 1) {
      if (!isFlexible(order[i]!)) continue;
      for (let j = i + 1; j < order.length && isFlexible(order[j]!); j += 1) {
        const candidate = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        if (routeCost(computeSchedule(candidate, input)) < routeCost(computeSchedule(order, input))) {
          order = candidate;
          improved = true;
        }
      }
    }
  }

  const result = computeSchedule(order, input);
  if (!result.feasible) {
    result.warnings.push(
      'Keine vollständig zulässige Route gefunden – feste Zeiten oder Zeitfenster werden verletzt.',
    );
  }
  return { ...result, order };
}
