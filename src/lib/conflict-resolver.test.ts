import { describe, expect, it } from 'vitest';

import { resolveDayOverlaps, type ResolverAppointment } from '@/lib/conflict-resolver';

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 23, h, m));

const appt = (overrides: Partial<ResolverAppointment> & { id: string; start: Date; durationMinutes: number }): ResolverAppointment => ({
  id: overrides.id,
  startAt: overrides.start,
  endAt: new Date(overrides.start.getTime() + overrides.durationMinutes * 60_000),
  durationMinutes: overrides.durationMinutes,
  isFlexible: overrides.isFlexible ?? false,
  earliestStartAt: overrides.earliestStartAt ?? null,
  latestEndAt: overrides.latestEndAt ?? null,
});

const DAY = { dayStart: at(6), dayEnd: at(22) };

describe('resolveDayOverlaps', () => {
  it('meldet keine Änderungen ohne Überschneidung', () => {
    const result = resolveDayOverlaps(
      [
        appt({ id: 'a', start: at(8), durationMinutes: 60 }),
        appt({ id: 'b', start: at(10), durationMinutes: 60 }),
      ],
      DAY,
    );
    expect(result.hadOverlap).toBe(false);
    expect(result.moves).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('verschiebt einen flexiblen Termin hinter einen fixen (überschneidungsfrei)', () => {
    const result = resolveDayOverlaps(
      [
        appt({ id: 'fix', start: at(9), durationMinutes: 120 }), // 09:00–11:00 fix
        appt({ id: 'flex', start: at(10), durationMinutes: 60, isFlexible: true }), // 10:00–11:00 überlappt
      ],
      DAY,
    );
    expect(result.hadOverlap).toBe(true);
    expect(result.unresolved).toEqual([]);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]!.id).toBe('flex');
    // Direkt nach dem fixen Termin: 11:00.
    expect(result.moves[0]!.newStart.getTime()).toBe(at(11).getTime());
  });

  it('respektiert das Fenster und meldet zu enge Termine als ungelöst', () => {
    const result = resolveDayOverlaps(
      [
        appt({ id: 'fix', start: at(9), durationMinutes: 120 }), // 09:00–11:00
        appt({
          id: 'flex',
          start: at(9, 30),
          durationMinutes: 60,
          isFlexible: true,
          earliestStartAt: at(9),
          latestEndAt: at(11), // muss bis 11:00 fertig sein → passt nicht neben dem Fixtermin
        }),
      ],
      DAY,
    );
    expect(result.hadOverlap).toBe(true);
    expect(result.moves).toEqual([]);
    expect(result.unresolved).toEqual(['flex']);
  });

  it('lässt zwei überlappende fixe Termine unverändert und meldet sie', () => {
    const result = resolveDayOverlaps(
      [
        appt({ id: 'f1', start: at(9), durationMinutes: 120 }),
        appt({ id: 'f2', start: at(10), durationMinutes: 120 }),
      ],
      DAY,
    );
    expect(result.hadOverlap).toBe(true);
    expect(result.moves).toEqual([]);
    expect(result.unresolved.sort()).toEqual(['f1', 'f2']);
  });

  it('ordnet mehrere flexible Termine kompakt hintereinander', () => {
    const result = resolveDayOverlaps(
      [
        appt({ id: 'fix', start: at(9), durationMinutes: 60 }), // 09:00–10:00
        appt({ id: 'x', start: at(9), durationMinutes: 30, isFlexible: true }),
        appt({ id: 'y', start: at(9, 15), durationMinutes: 30, isFlexible: true }),
      ],
      DAY,
    );
    expect(result.hadOverlap).toBe(true);
    expect(result.unresolved).toEqual([]);
    // Beide flexiblen landen nach dem Fixtermin: 10:00 und 10:30.
    const byId = new Map(result.moves.map((move) => [move.id, move.newStart.getTime()]));
    expect(byId.get('x')).toBe(at(10).getTime());
    expect(byId.get('y')).toBe(at(10, 30).getTime());
  });

  it('verschiebt einen flexiblen Termin aus einer Abwesenheit heraus', () => {
    const result = resolveDayOverlaps(
      [appt({ id: 'flex', start: at(9), durationMinutes: 60, isFlexible: true })],
      { ...DAY, blockedIntervals: [{ start: at(8, 30), end: at(10) }] },
    );
    expect(result.hadOverlap).toBe(true);
    expect(result.moves).toHaveLength(1);
    // Direkt nach der Abwesenheit (10:00) platziert.
    expect(result.moves[0]!.newStart.getTime()).toBe(at(10).getTime());
  });

  it('meldet einen fixen Termin in einer Abwesenheit als ungelöst', () => {
    const result = resolveDayOverlaps(
      [appt({ id: 'fix', start: at(9), durationMinutes: 60 })],
      { ...DAY, blockedIntervals: [{ start: at(8, 30), end: at(10) }] },
    );
    expect(result.hadOverlap).toBe(true);
    expect(result.moves).toEqual([]);
  });

  it('berücksichtigt einen Puffer zwischen Terminen', () => {
    const result = resolveDayOverlaps(
      [
        appt({ id: 'fix', start: at(9), durationMinutes: 60 }), // 09:00–10:00
        appt({ id: 'flex', start: at(9, 30), durationMinutes: 60, isFlexible: true }),
      ],
      { ...DAY, bufferMinutes: 15 },
    );
    // 15 Min Puffer → frühester Start 10:15.
    expect(result.moves[0]!.newStart.getTime()).toBe(at(10, 15).getTime());
  });
});
