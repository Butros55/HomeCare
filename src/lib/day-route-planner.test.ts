import { describe, expect, it } from 'vitest';

import { buildDayVariants, DEFAULT_TARGET_MINUTES, type DayPlanCandidate } from './day-route-planner';
import type { Matrix, RouteStopInput } from './route-optimizer';

const t = (hours: number, minutes = 0) => new Date(Date.UTC(2026, 6, 24, hours, minutes));
const DAY_START = t(0);

/** Punkte auf einer Linie, 600 s (10 Min.) je Hop. */
function linearMatrix(size: number, secondsPerHop = 600): Matrix {
  const travelSeconds = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => Math.abs(i - j) * secondsPerHop),
  );
  return {
    travelSeconds,
    distanceMeters: travelSeconds.map((row) => row.map((s) => s * 8)),
  };
}

function candidate(id: string, overrides: Partial<DayPlanCandidate> = {}): DayPlanCandidate {
  return {
    id,
    latitude: 0,
    longitude: 0,
    serviceMinutes: 60,
    earliestStartAt: t(6),
    latestEndAt: t(22),
    isPreferred: false,
    hasAllocation: false,
    ...overrides,
  };
}

const baseOptions = {
  bufferMinutes: 0,
  returnToEnd: true,
  earliestDepartureAt: DAY_START,
  latestReturnAt: null,
  targetWorkMinutes: null,
  maxTotalServiceMinutes: null,
};

describe('buildDayVariants', () => {
  it('füllt aus leerer Basis bis zur Zielarbeitszeit auf', () => {
    // Matrix: [Start, K1, K2, K3, Ziel]
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const variants = buildDayVariants({
      baseStops: [],
      candidates,
      fullMatrix: linearMatrix(5),
      options: { ...baseOptions, targetWorkMinutes: 120 },
    });

    const compact = variants.find((v) => v.objective === 'compact')!;
    expect(compact.route.feasible).toBe(true);
    // Ziel 120 Min. → zwei 60-Minuten-Einsätze reichen.
    expect(compact.selectedCandidateIds).toHaveLength(2);
    expect(compact.route.totalServiceMinutes).toBe(120);

    // „Volle Auslastung" nimmt alles Machbare mit.
    const full = variants.find((v) => v.objective === 'full');
    if (full) {
      expect(full.selectedCandidateIds).toHaveLength(3);
      expect(full.route.totalServiceMinutes).toBe(180);
    }
  });

  it('respektiert die späteste Rückkehr als harte Grenze', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const variants = buildDayVariants({
      baseStops: [],
      candidates,
      fullMatrix: linearMatrix(5),
      options: {
        ...baseOptions,
        // Fenster öffnet 06:00; ~1 Einsatz + Rückfahrt passt bis 08:00.
        latestReturnAt: t(8),
        targetWorkMinutes: DEFAULT_TARGET_MINUTES,
      },
    });
    for (const variant of variants) {
      const end = variant.route.returnArrivalAt ?? variant.route.stops.at(-1)?.serviceEndAt;
      if (variant.route.stops.length > 0) {
        expect(end!.getTime()).toBeLessThanOrEqual(t(8).getTime());
      }
    }
  });

  it('lässt feste Basistermine unangetastet und plant um sie herum', () => {
    const fixedStart = t(10);
    const baseStops: RouteStopInput[] = [
      {
        id: 'fix-1',
        latitude: 0,
        longitude: 0,
        serviceMinutes: 60,
        fixedStartAt: fixedStart,
      },
    ];
    // Matrix: [Start, Fix, K1, Ziel]
    const variants = buildDayVariants({
      baseStops,
      candidates: [candidate('a')],
      fullMatrix: linearMatrix(4),
      options: { ...baseOptions, targetWorkMinutes: 120 },
    });
    for (const variant of variants) {
      const fixedStop = variant.route.stops.find((s) => s.id === 'fix-1');
      expect(fixedStop).toBeDefined();
      expect(fixedStop!.serviceStartAt.getTime()).toBe(fixedStart.getTime());
      expect(variant.route.feasible).toBe(true);
    }
  });

  it('bevorzugt zugewiesene Kunden bei gleicher Lage', () => {
    const candidates = [
      candidate('far-normal'),
      candidate('allocated', { hasAllocation: true }),
      candidate('near-normal'),
    ];
    const variants = buildDayVariants({
      baseStops: [],
      candidates,
      fullMatrix: linearMatrix(5),
      options: { ...baseOptions, targetWorkMinutes: 60 },
    });
    const compact = variants.find((v) => v.objective === 'compact')!;
    expect(compact.selectedCandidateIds).toEqual(['allocated']);
  });

  it('dedupliziert Varianten mit identischer Auswahl', () => {
    // Nur ein Kandidat → alle Ziele wählen dieselbe Menge → eine Variante.
    const variants = buildDayVariants({
      baseStops: [],
      candidates: [candidate('only')],
      fullMatrix: linearMatrix(3),
      options: { ...baseOptions, targetWorkMinutes: 60 },
    });
    expect(variants.length).toBeGreaterThanOrEqual(1);
    const signatures = variants.map((v) => [...v.selectedCandidateIds].sort().join('|'));
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('meldet leere Route, wenn kein Kandidat in die Grenzen passt', () => {
    const variants = buildDayVariants({
      baseStops: [],
      candidates: [candidate('a', { earliestStartAt: t(9), latestEndAt: t(10) })],
      fullMatrix: linearMatrix(3),
      options: { ...baseOptions, latestReturnAt: t(7) },
    });
    for (const variant of variants) {
      expect(variant.route.stops).toHaveLength(0);
    }
  });
});
