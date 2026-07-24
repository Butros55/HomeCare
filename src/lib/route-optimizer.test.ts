import { describe, expect, it } from 'vitest';

import { computeSchedule, optimizeRoute, type Matrix, type OptimizeInput } from './route-optimizer';

/**
 * Testaufbau: Punkte auf einer Linie, Fahrzeit 600 s (10 Min.) je Abschnitt.
 * Matrixindizes: 0 = Start, 1..n = Stopps, n+1 = Ziel.
 */
function linearMatrix(stopCount: number, secondsPerHop = 600): Matrix {
  const size = stopCount + 2;
  // Position: Start=0, Stopp i=i, Ziel=stopCount+1 → Distanz = |i−j| Hops.
  const travelSeconds = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => Math.abs(i - j) * secondsPerHop),
  );
  const distanceMeters = travelSeconds.map((row) => row.map((s) => s * 8)); // ~30 km/h
  return { travelSeconds, distanceMeters };
}

const t = (hours: number, minutes = 0) => new Date(Date.UTC(2026, 6, 22, hours, minutes));

function baseInput(overrides: Partial<OptimizeInput>): OptimizeInput {
  return {
    stops: [],
    matrix: linearMatrix(0),
    departureAt: t(8),
    bufferMinutes: 0,
    returnToEnd: false,
    ...overrides,
  };
}

describe('computeSchedule', () => {
  it('berechnet Ankunft/Beginn/Ende entlang der Matrix', () => {
    const input = baseInput({
      stops: [
        { id: 'a', latitude: 0, longitude: 0, serviceMinutes: 60, fixedStartAt: t(9) },
        { id: 'b', latitude: 0, longitude: 0, serviceMinutes: 30, fixedStartAt: t(10, 30) },
      ],
      matrix: linearMatrix(2),
    });
    const result = computeSchedule([0, 1], input);
    expect(result.feasible).toBe(true);
    // Start 8:00 + 10 Min. → Ankunft 8:10, fester Beginn 9:00, Ende 10:00.
    expect(result.stops[0]!.arrivalAt).toEqual(t(8, 10));
    expect(result.stops[0]!.serviceStartAt).toEqual(t(9));
    expect(result.stops[0]!.serviceEndAt).toEqual(t(10));
    // Weiter: 10:00 + 10 Min. Fahrt → 10:10, fester Beginn 10:30.
    expect(result.stops[1]!.arrivalAt).toEqual(t(10, 10));
    expect(result.stops[1]!.serviceStartAt).toEqual(t(10, 30));
    expect(result.totalServiceMinutes).toBe(90);
    expect(result.totalTravelSeconds).toBe(1200);
  });

  it('meldet verspätete Ankunft an festen Terminen', () => {
    const input = baseInput({
      stops: [
        { id: 'a', latitude: 0, longitude: 0, serviceMinutes: 120, fixedStartAt: t(9) },
        { id: 'b', latitude: 0, longitude: 0, serviceMinutes: 30, fixedStartAt: t(11) },
      ],
      matrix: linearMatrix(2),
    });
    // a endet 11:00, Fahrt 10 Min. → Ankunft 11:10 > fester Beginn 11:00.
    const result = computeSchedule([0, 1], input);
    expect(result.feasible).toBe(false);
    expect(result.warnings.some((w) => w.includes('nach dem festen Beginn'))).toBe(true);
    // Der feste Beginn bleibt verankert – die Anzeige verschiebt ihn NICHT.
    expect(result.stops[1]!.serviceStartAt.getTime()).toBe(t(11).getTime());
  });

  it('wartet bei flexiblen Terminen auf die Fensteröffnung', () => {
    const input = baseInput({
      stops: [
        {
          id: 'flex',
          latitude: 0,
          longitude: 0,
          serviceMinutes: 30,
          earliestStartAt: t(10),
          latestEndAt: t(12),
        },
      ],
      matrix: linearMatrix(1),
    });
    const result = computeSchedule([0], input);
    expect(result.stops[0]!.arrivalAt).toEqual(t(8, 10));
    expect(result.stops[0]!.serviceStartAt).toEqual(t(10));
    expect(result.stops[0]!.waitSeconds).toBe(110 * 60);
    expect(result.feasible).toBe(true);
  });

  it('meldet Verletzung des spätesten Endes', () => {
    const input = baseInput({
      stops: [
        {
          id: 'flex',
          latitude: 0,
          longitude: 0,
          serviceMinutes: 60,
          latestEndAt: t(9),
        },
      ],
      matrix: linearMatrix(1),
    });
    // Ankunft 8:10 + 60 Min. = 9:10 > 9:00.
    const result = computeSchedule([0], input);
    expect(result.feasible).toBe(false);
  });

  it('berücksichtigt den Mindestpuffer zwischen Terminen', () => {
    const input = baseInput({
      stops: [
        { id: 'a', latitude: 0, longitude: 0, serviceMinutes: 30 },
        { id: 'b', latitude: 0, longitude: 0, serviceMinutes: 30 },
      ],
      matrix: linearMatrix(2),
      bufferMinutes: 15,
    });
    const result = computeSchedule([0, 1], input);
    // a: Ankunft 8:10, Ende 8:40; +15 Puffer = 8:55 Abfahrt; +10 Fahrt → 9:05.
    expect(result.stops[1]!.arrivalAt).toEqual(t(9, 5));
  });

  it('berechnet die Rückkehr zum Ziel', () => {
    const input = baseInput({
      stops: [{ id: 'a', latitude: 0, longitude: 0, serviceMinutes: 30 }],
      matrix: linearMatrix(1),
      returnToEnd: true,
    });
    const result = computeSchedule([0], input);
    // Ende 8:40 + 10 Min. Fahrt zum Ziel (Index 2, 1 Hop) → 8:50.
    expect(result.returnArrivalAt).toEqual(t(8, 50));
  });
});

describe('optimizeRoute', () => {
  it('sortiert feste Termine chronologisch, unabhängig von der Eingabereihenfolge', () => {
    const input = baseInput({
      stops: [
        { id: 'later', latitude: 0, longitude: 0, serviceMinutes: 30, fixedStartAt: t(13) },
        { id: 'early', latitude: 0, longitude: 0, serviceMinutes: 30, fixedStartAt: t(9) },
      ],
      matrix: linearMatrix(2),
    });
    const result = optimizeRoute(input);
    expect(result.stops.map((s) => s.id)).toEqual(['early', 'later']);
    expect(result.feasible).toBe(true);
  });

  it('fügt flexible Termine an der fahrzeitgünstigsten zulässigen Stelle ein', () => {
    // Stopps liegen auf einer Linie: Start(0) – f1(1) – flex(2) – f2(3) – Ziel(4).
    // Ohne Einfügung: Start→f1→f2 = 1+2 Hops. Flex gehört zwischen f1 und f2.
    const input = baseInput({
      stops: [
        { id: 'f1', latitude: 0, longitude: 0, serviceMinutes: 30, fixedStartAt: t(9) },
        {
          id: 'flex',
          latitude: 0,
          longitude: 0,
          serviceMinutes: 30,
          earliestStartAt: t(8),
          latestEndAt: t(16),
        },
        { id: 'f2', latitude: 0, longitude: 0, serviceMinutes: 30, fixedStartAt: t(12) },
      ],
      matrix: linearMatrix(3),
    });
    const result = optimizeRoute(input);
    expect(result.stops.map((s) => s.id)).toEqual(['f1', 'flex', 'f2']);
    expect(result.feasible).toBe(true);
  });

  it('verletzt niemals feste Zeiten durch die Optimierung (Fenster zwingt flex nach hinten)', () => {
    const input = baseInput({
      stops: [
        { id: 'f1', latitude: 0, longitude: 0, serviceMinutes: 30, fixedStartAt: t(9) },
        {
          id: 'flexLate',
          latitude: 0,
          longitude: 0,
          serviceMinutes: 30,
          earliestStartAt: t(13),
          latestEndAt: t(15),
        },
        { id: 'f2', latitude: 0, longitude: 0, serviceMinutes: 30, fixedStartAt: t(10, 30) },
      ],
      matrix: linearMatrix(3),
    });
    const result = optimizeRoute(input);
    // flexLate darf f2 (10:30) nicht verzögern → muss ans Ende.
    expect(result.stops.map((s) => s.id)).toEqual(['f1', 'f2', 'flexLate']);
    expect(result.feasible).toBe(true);
  });

  it('2-opt reduziert die Fahrzeit rein flexibler Routen', () => {
    // Linie: Start(0) a(1) b(2) c(3) Ziel(4); Einfügereihenfolge absichtlich wild
    // durch identische Fenster – Optimum ist die lineare Reihenfolge a,b,c.
    const input = baseInput({
      stops: [
        { id: 'b', latitude: 0, longitude: 0, serviceMinutes: 10 },
        { id: 'c', latitude: 0, longitude: 0, serviceMinutes: 10 },
        { id: 'a', latitude: 0, longitude: 0, serviceMinutes: 10 },
      ],
      // stops-Index: 0=b(Pos2), 1=c(Pos3), 2=a(Pos1)
      matrix: {
        travelSeconds: [
          // Start, b, c, a, Ziel – Positionen: Start=0, b=2, c=3, a=1, Ziel=4
          [0, 1200, 1800, 600, 2400],
          [1200, 0, 600, 600, 1200],
          [1800, 600, 0, 1200, 600],
          [600, 600, 1200, 0, 1800],
          [2400, 1200, 600, 1800, 0],
        ],
        distanceMeters: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0)),
      },
      returnToEnd: true,
    });
    const result = optimizeRoute(input);
    expect(result.stops.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    // Optimal: 600+600+600+600 = 2400 s.
    expect(result.totalTravelSeconds).toBe(2400);
  });

  it('meldet unlösbare Routen mit Warnung statt sie zu verstecken', () => {
    const input = baseInput({
      stops: [
        { id: 'f1', latitude: 0, longitude: 0, serviceMinutes: 120, fixedStartAt: t(9) },
        { id: 'f2', latitude: 0, longitude: 0, serviceMinutes: 30, fixedStartAt: t(9, 30) },
      ],
      matrix: linearMatrix(2),
    });
    const result = optimizeRoute(input);
    expect(result.feasible).toBe(false);
    expect(result.warnings.some((w) => w.includes('Keine vollständig zulässige Route'))).toBe(true);
  });

  it('leere Eingabe ergibt eine leere, gültige Route', () => {
    const result = optimizeRoute(baseInput({ stops: [], matrix: linearMatrix(0) }));
    expect(result.stops).toEqual([]);
    expect(result.feasible).toBe(true);
  });
});
