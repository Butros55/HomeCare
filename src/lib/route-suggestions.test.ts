import { describe, expect, it } from 'vitest';

import type { Matrix, RouteStopInput } from './route-optimizer';
import {
  candidateWindows,
  computeOpenBudgetMinutes,
  enclosingFlexWindow,
  evaluateCandidate,
  intersectWindows,
  minutesToTime,
  planRouteWithAutoDeparture,
  sliceMatrix,
  slotsToWindows,
  subtractWindows,
  suggestionDurationMinutes,
  timeToMinutes,
} from './route-suggestions';

const t = (hours: number, minutes = 0) => new Date(Date.UTC(2026, 6, 22, hours, minutes));
const DAY_START = t(0);

/** Punkte auf einer Linie, 600 s (10 Min.) und 5 km je Hop. */
function linearMatrix(size: number, secondsPerHop = 600): Matrix {
  const travelSeconds = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => Math.abs(i - j) * secondsPerHop),
  );
  return {
    travelSeconds,
    distanceMeters: travelSeconds.map((row) => row.map((s) => s * 8)),
  };
}

// ---------------------------------------------------------------------------
// Zeitfenster
// ---------------------------------------------------------------------------

describe('Zeitfenster-Arithmetik', () => {
  it('parst und formatiert HH:mm', () => {
    expect(timeToMinutes('08:30')).toBe(510);
    expect(minutesToTime(510)).toBe('08:30');
  });

  it('führt überlappende Slots zusammen und sortiert', () => {
    const windows = slotsToWindows([
      { startTime: '13:00', endTime: '15:00' },
      { startTime: '08:00', endTime: '10:00' },
      { startTime: '09:30', endTime: '11:00' },
    ]);
    expect(windows).toEqual([
      { startMinute: 480, endMinute: 660 },
      { startMinute: 780, endMinute: 900 },
    ]);
  });

  it('bildet Schnittmengen', () => {
    const a = [{ startMinute: 480, endMinute: 720 }];
    const b = [
      { startMinute: 400, endMinute: 540 },
      { startMinute: 600, endMinute: 900 },
    ];
    expect(intersectWindows(a, b)).toEqual([
      { startMinute: 480, endMinute: 540 },
      { startMinute: 600, endMinute: 720 },
    ]);
  });

  it('schneidet blockierte Bereiche heraus (Abwesenheiten)', () => {
    const windows = [{ startMinute: 480, endMinute: 1020 }];
    const blocked = [{ startMinute: 600, endMinute: 720 }];
    expect(subtractWindows(windows, blocked)).toEqual([
      { startMinute: 480, endMinute: 600 },
      { startMinute: 720, endMinute: 1020 },
    ]);
  });

  it('leere Kunden- UND Mitarbeiterverfügbarkeit bedeutet ganztägig', () => {
    const windows = candidateWindows({ customerSlots: [], employeeSlots: [] });
    expect(windows).toEqual([{ startMinute: 0, endMinute: 1440 }]);
  });

  it('kombiniert Kunde ∩ Mitarbeiter und zieht Abwesenheiten ab', () => {
    const windows = candidateWindows({
      customerSlots: [{ startTime: '08:00', endTime: '16:00' }],
      employeeSlots: [{ startTime: '10:00', endTime: '18:00' }],
      blockedWindows: [{ startMinute: timeToMinutes('12:00'), endMinute: timeToMinutes('13:00') }],
    });
    expect(windows).toEqual([
      { startMinute: 600, endMinute: 720 },
      { startMinute: 780, endMinute: 960 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Bedarf & Dauer
// ---------------------------------------------------------------------------

describe('Budget & Vorschlagsdauer', () => {
  it('offener Bedarf = korrigiertes Budget minus reservierte Termine, nie negativ', () => {
    expect(computeOpenBudgetMinutes(600, 480)).toBe(120);
    expect(computeOpenBudgetMinutes(600, 900)).toBe(0);
  });

  it('Dauer = min(Standard, Budgetrest, längstes Fenster)', () => {
    const windows = [{ startMinute: 480, endMinute: 570 }]; // 90 Minuten
    expect(
      suggestionDurationMinutes({ defaultDurationMinutes: 120, openMinutes: 200, windows }),
    ).toBe(90);
    expect(
      suggestionDurationMinutes({ defaultDurationMinutes: 120, openMinutes: 45, windows }),
    ).toBe(45);
  });

  it('unter 15 verbleibenden Minuten entsteht kein Vorschlag', () => {
    const windows = [{ startMinute: 480, endMinute: 960 }];
    expect(
      suggestionDurationMinutes({ defaultDurationMinutes: 120, openMinutes: 10, windows }),
    ).toBeNull();
    expect(suggestionDurationMinutes({ defaultDurationMinutes: 120, openMinutes: 60, windows: [] })).toBeNull();
  });
});

describe('enclosingFlexWindow', () => {
  it('liefert das Verfügbarkeitsfenster, das den Einsatz enthält', () => {
    const window = enclosingFlexWindow({
      customerSlots: [
        { startTime: '08:00', endTime: '10:00' },
        { startTime: '13:00', endTime: '17:00' },
      ],
      employeeSlots: [{ startTime: '09:00', endTime: '18:00' }],
      startMinute: timeToMinutes('14:00'),
      endMinute: timeToMinutes('15:00'),
    });
    expect(window).toEqual({ startMinute: timeToMinutes('13:00'), endMinute: timeToMinutes('17:00') });
  });

  it('nutzt ohne gepflegte Fenster das Standard-Planungsfenster', () => {
    const fallback = { startMinute: 6 * 60, endMinute: 22 * 60 };
    const window = enclosingFlexWindow({
      customerSlots: [],
      employeeSlots: [],
      startMinute: timeToMinutes('10:45'),
      endMinute: timeToMinutes('12:45'),
      fallbackWindow: fallback,
    });
    expect(window).toEqual(fallback);
  });

  it('fällt auf den Einsatz selbst zurück, wenn kein Fenster ihn umschließt', () => {
    const window = enclosingFlexWindow({
      customerSlots: [{ startTime: '08:00', endTime: '09:00' }],
      employeeSlots: [],
      startMinute: timeToMinutes('10:00'),
      endMinute: timeToMinutes('11:00'),
    });
    expect(window).toEqual({ startMinute: timeToMinutes('10:00'), endMinute: timeToMinutes('11:00') });
  });
});

// ---------------------------------------------------------------------------
// Automatische Abfahrt
// ---------------------------------------------------------------------------

describe('planRouteWithAutoDeparture', () => {
  it('berechnet die späteste Abfahrt: Terminbeginn minus Fahrzeit minus Puffer', () => {
    const stops: RouteStopInput[] = [
      { id: 'a', latitude: 0, longitude: 0, serviceMinutes: 60, fixedStartAt: t(9) },
    ];
    const result = planRouteWithAutoDeparture({
      stops,
      matrix: linearMatrix(3),
      bufferMinutes: 10,
      returnToEnd: false,
      earliestDepartureAt: DAY_START,
    });
    // Beginn 9:00 − 10 Min. Fahrt − 10 Min. Puffer = 8:40.
    expect(result.latestDepartureAt).toEqual(t(8, 40));
    // Zeitplan bleibt unverändert: Einsatz weiterhin 9:00–10:00.
    expect(result.stops[0]!.serviceStartAt).toEqual(t(9));
    expect(result.feasible).toBe(true);
  });

  it('lässt nachfolgende Termine durch die Verschiebung unverändert', () => {
    const stops: RouteStopInput[] = [
      { id: 'a', latitude: 0, longitude: 0, serviceMinutes: 60, fixedStartAt: t(9) },
      { id: 'b', latitude: 0, longitude: 0, serviceMinutes: 30, fixedStartAt: t(11) },
    ];
    const result = planRouteWithAutoDeparture({
      stops,
      matrix: linearMatrix(4),
      bufferMinutes: 0,
      returnToEnd: true,
      earliestDepartureAt: DAY_START,
    });
    expect(result.latestDepartureAt).toEqual(t(8, 50));
    expect(result.stops.map((s) => s.serviceStartAt)).toEqual([t(9), t(11)]);
    // Arbeitstag: Abfahrt 8:50 bis Rückkehr 11:30 + 10 Min. = 11:40 → 170 Minuten.
    expect(result.returnArrivalAt).toEqual(t(11, 40));
    expect(result.workdaySeconds).toBe(170 * 60);
  });

  it('ohne Verschiebespielraum bleibt die früheste Abfahrt bestehen', () => {
    const stops: RouteStopInput[] = [
      { id: 'a', latitude: 0, longitude: 0, serviceMinutes: 30 }, // ohne Anker
    ];
    const result = planRouteWithAutoDeparture({
      stops,
      matrix: linearMatrix(3),
      bufferMinutes: 10,
      returnToEnd: false,
      earliestDepartureAt: t(8),
    });
    expect(result.latestDepartureAt).toEqual(t(8));
  });

  it('leere Stoppliste ergibt eine leere gültige Route', () => {
    const result = planRouteWithAutoDeparture({
      stops: [],
      matrix: linearMatrix(2),
      bufferMinutes: 10,
      returnToEnd: true,
      earliestDepartureAt: DAY_START,
    });
    expect(result.stops).toEqual([]);
    expect(result.feasible).toBe(true);
    expect(result.workdaySeconds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Kandidaten-Bewertung
// ---------------------------------------------------------------------------

/** Aufbau: Punkte [Start, Basis-Stopp, Kandidat, Ziel] auf einer Linie. */
function candidateSetup(candidateHops: number) {
  // Punktliste: Start(0), Basis(1), Kandidat(1 + candidateHops)?? – wir bauen
  // die Matrix explizit über Positionswerte.
  const positions = [0, 1, 1 + candidateHops, 0]; // Ziel = Start
  const size = positions.length;
  const travelSeconds = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => Math.abs(positions[i]! - positions[j]!) * 600),
  );
  const matrix: Matrix = {
    travelSeconds,
    distanceMeters: travelSeconds.map((row) => row.map((s) => s * 8)),
  };
  const baseStops: RouteStopInput[] = [
    { id: 'base', latitude: 0, longitude: 0, serviceMinutes: 60, fixedStartAt: t(10) },
  ];
  const baseMatrix = sliceMatrix(matrix, [0, 1, 3]);
  const baseRoute = planRouteWithAutoDeparture({
    stops: baseStops,
    matrix: baseMatrix,
    bufferMinutes: 0,
    returnToEnd: true,
    earliestDepartureAt: DAY_START,
  });
  return { matrix, baseStops, baseRoute };
}

const minuteToUtc = (minute: number) => new Date(DAY_START.getTime() + minute * 60_000);

describe('evaluateCandidate', () => {
  it('findet einen zulässigen Termin im 15-Minuten-Raster innerhalb des Fensters', () => {
    const { matrix, baseStops, baseRoute } = candidateSetup(1);
    const result = evaluateCandidate({
      baseStops,
      baseRoute,
      candidate: {
        id: 'cand',
        serviceMinutes: 60,
        windows: [{ startMinute: timeToMinutes('08:00'), endMinute: timeToMinutes('18:00') }],
      },
      matrix,
      bufferMinutes: 0,
      returnToEnd: true,
      earliestDepartureAt: DAY_START,
      minuteToUtc,
    });
    expect(result.feasible).toBe(true);
    expect(result.startAt!.getUTCMinutes() % 15).toBe(0);
    expect(result.impact!.extraTravelSeconds).toBeGreaterThan(0);
    // Einsatz liegt vollständig im Fenster.
    expect(result.startAt!.getTime()).toBeGreaterThanOrEqual(minuteToUtc(480).getTime());
    expect(result.endAt!.getTime()).toBeLessThanOrEqual(minuteToUtc(1080).getTime());
  });

  it('nähere Kunden erhalten bei sonst gleichen Bedingungen den besseren Wert', () => {
    const near = candidateSetup(1);
    const far = candidateSetup(6);
    const windows = [{ startMinute: timeToMinutes('08:00'), endMinute: timeToMinutes('18:00') }];
    const evalNear = evaluateCandidate({
      baseStops: near.baseStops,
      baseRoute: near.baseRoute,
      candidate: { id: 'near', serviceMinutes: 60, windows },
      matrix: near.matrix,
      bufferMinutes: 0,
      returnToEnd: true,
      earliestDepartureAt: DAY_START,
      minuteToUtc,
    });
    const evalFar = evaluateCandidate({
      baseStops: far.baseStops,
      baseRoute: far.baseRoute,
      candidate: { id: 'far', serviceMinutes: 60, windows },
      matrix: far.matrix,
      bufferMinutes: 0,
      returnToEnd: true,
      earliestDepartureAt: DAY_START,
      minuteToUtc,
    });
    expect(evalNear.feasible).toBe(true);
    expect(evalFar.feasible).toBe(true);
    expect(evalNear.score).toBeLessThan(evalFar.score);
    expect(evalNear.impact!.extraTravelSeconds).toBeLessThan(evalFar.impact!.extraTravelSeconds);
  });

  it('erzeugt KEINEN Vorschlag, wenn jede Rasterzeit mit dem festen Termin kollidiert', () => {
    const { matrix, baseStops, baseRoute } = candidateSetup(1);
    // Fenster erlaubt nur 10:00–11:00 – exakt der belegte feste Termin.
    const result = evaluateCandidate({
      baseStops,
      baseRoute,
      candidate: {
        id: 'cand',
        serviceMinutes: 60,
        windows: [{ startMinute: timeToMinutes('10:00'), endMinute: timeToMinutes('11:00') }],
      },
      matrix,
      bufferMinutes: 0,
      returnToEnd: true,
      earliestDepartureAt: DAY_START,
      minuteToUtc,
    });
    expect(result.feasible).toBe(false);
    expect(result.route).toBeNull();
  });

  it('meldet Einfügeposition und neue Abfahrts-/Rückkehrzeiten', () => {
    const { matrix, baseStops, baseRoute } = candidateSetup(1);
    const result = evaluateCandidate({
      baseStops,
      baseRoute,
      candidate: {
        id: 'cand',
        serviceMinutes: 30,
        windows: [{ startMinute: timeToMinutes('11:30'), endMinute: timeToMinutes('13:00') }],
      },
      matrix,
      bufferMinutes: 0,
      returnToEnd: true,
      earliestDepartureAt: DAY_START,
      minuteToUtc,
    });
    expect(result.feasible).toBe(true);
    // Kandidat kann nur nach dem festen 10:00–11:00-Termin liegen.
    expect(result.position).toBe(2);
    expect(result.insertAfterStopId).toBe('base');
    expect(result.impact!.departureAt).toBeInstanceOf(Date);
    expect(result.impact!.previousDepartureAt).toEqual(baseRoute.latestDepartureAt);
  });
});
