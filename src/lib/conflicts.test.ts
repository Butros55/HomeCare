import { describe, expect, it } from 'vitest';

import {
  checkAppointmentConflicts,
  hasErrors,
  hasWarnings,
  type ConflictCheckInput,
} from './conflicts';

const TZ = 'Europe/Berlin';

/** Kandidat: Mittwoch 22.07.2026 09:00–11:00 Berlin (07:00–09:00 UTC). */
function baseInput(overrides?: Partial<ConflictCheckInput>): ConflictCheckInput {
  return {
    candidate: {
      assignedEmployeeId: 'anna',
      startAt: new Date('2026-07-22T07:00:00.000Z'),
      endAt: new Date('2026-07-22T09:00:00.000Z'),
      durationMinutes: 120,
      routeRelevant: true,
      locationHasCoordinates: true,
      isFlexible: false,
    },
    existingAppointments: [],
    absences: [],
    availabilities: [],
    timezone: TZ,
    ...overrides,
  };
}

describe('checkAppointmentConflicts', () => {
  it('meldet keine Konflikte für einen sauberen Termin', () => {
    expect(checkAppointmentConflicts(baseInput())).toEqual([]);
  });

  it('ungültige Dauer ist ein ERROR und stoppt weitere Prüfungen', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        candidate: {
          ...baseInput().candidate,
          endAt: new Date('2026-07-22T06:00:00.000Z'),
          durationMinutes: -60,
        },
      }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.type).toBe('INVALID_DURATION');
    expect(hasErrors(conflicts)).toBe(true);
  });

  it('erkennt Überschneidungen desselben Mitarbeiters als WARNING', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        existingAppointments: [
          {
            id: 'other',
            startAt: new Date('2026-07-22T08:00:00.000Z'),
            endAt: new Date('2026-07-22T10:00:00.000Z'),
            durationMinutes: 120,
            title: 'Bestandstermin',
          },
        ],
      }),
    );
    expect(conflicts.map((c) => c.type)).toEqual(['OVERLAP']);
    expect(conflicts[0]!.severity).toBe('WARNING');
    expect(conflicts[0]!.relatedAppointmentId).toBe('other');
    expect(hasWarnings(conflicts)).toBe(true);
  });

  it('ignoriert den Kandidaten selbst beim Überschneidungs-Check (Bearbeitung)', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        candidate: { ...baseInput().candidate, id: 'self' },
        existingAppointments: [
          {
            id: 'self',
            startAt: new Date('2026-07-22T07:00:00.000Z'),
            endAt: new Date('2026-07-22T09:00:00.000Z'),
            durationMinutes: 120,
          },
        ],
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it('nicht zugewiesene Termine haben keine Mitarbeiter-Konflikte', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        candidate: { ...baseInput().candidate, assignedEmployeeId: null },
        existingAppointments: [
          {
            id: 'other',
            startAt: new Date('2026-07-22T08:00:00.000Z'),
            endAt: new Date('2026-07-22T10:00:00.000Z'),
            durationMinutes: 120,
          },
        ],
        absences: [
          { startAt: new Date('2026-07-20T00:00:00Z'), endAt: new Date('2026-07-27T00:00:00Z') },
        ],
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it('erkennt Termine während einer Abwesenheit', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        absences: [
          { startAt: new Date('2026-07-20T00:00:00Z'), endAt: new Date('2026-07-27T00:00:00Z') },
        ],
      }),
    );
    expect(conflicts.map((c) => c.type)).toEqual(['ABSENCE']);
  });

  it('erkennt Termine außerhalb der Verfügbarkeit (Mi 09–11 nicht in Mi 12–16)', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        availabilities: [{ weekday: 3, startTime: '12:00', endTime: '16:00' }],
      }),
    );
    expect(conflicts.map((c) => c.type)).toEqual(['OUTSIDE_AVAILABILITY']);
  });

  it('akzeptiert Termine innerhalb der Verfügbarkeit', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        availabilities: [
          { weekday: 3, startTime: '08:00', endTime: '14:00' },
          { weekday: 4, startTime: '08:00', endTime: '10:00' },
        ],
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it('ohne gepflegte Verfügbarkeiten keine Verfügbarkeits-Warnung', () => {
    expect(checkAppointmentConflicts(baseInput({ availabilities: [] }))).toEqual([]);
  });

  it('erkennt unzureichende Fahrzeit vom Vorgänger', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        travel: {
          fromPreviousSeconds: 900, // 15 Min. nötig
          previousEndAt: new Date('2026-07-22T06:55:00.000Z'), // nur 5 Min. Lücke
        },
      }),
    );
    expect(conflicts.map((c) => c.type)).toEqual(['INSUFFICIENT_TRAVEL_TIME']);
    expect(conflicts[0]!.message).toContain('15 Min.');
  });

  it('erkennt unzureichende Fahrzeit zum Nachfolger', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        travel: {
          toNextSeconds: 600,
          nextStartAt: new Date('2026-07-22T09:05:00.000Z'),
        },
      }),
    );
    expect(conflicts.map((c) => c.type)).toEqual(['INSUFFICIENT_TRAVEL_TIME']);
  });

  it('ausreichende Fahrzeit erzeugt keinen Konflikt', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        travel: {
          fromPreviousSeconds: 600,
          previousEndAt: new Date('2026-07-22T06:30:00.000Z'),
          toNextSeconds: 600,
          nextStartAt: new Date('2026-07-22T09:30:00.000Z'),
        },
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it('erkennt Überschreitung der Tageshöchstarbeitszeit', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        maximumMinutesPerDay: 300,
        plannedMinutesSameDay: 240,
      }),
    );
    expect(conflicts.map((c) => c.type)).toEqual(['DAY_MAX_EXCEEDED']);
  });

  it('erkennt Verletzungen des Kundenzeitfensters bei flexiblen Terminen', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        candidate: {
          ...baseInput().candidate,
          isFlexible: true,
          earliestStartAt: new Date('2026-07-22T08:00:00.000Z'),
          latestEndAt: new Date('2026-07-22T08:30:00.000Z'),
        },
      }),
    );
    expect(conflicts.map((c) => c.type)).toEqual([
      'OUTSIDE_CUSTOMER_WINDOW',
      'OUTSIDE_CUSTOMER_WINDOW',
    ]);
  });

  it('meldet fehlende Adresse routenrelevanter Termine als INFO', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        candidate: { ...baseInput().candidate, locationHasCoordinates: false },
      }),
    );
    expect(conflicts).toEqual([
      expect.objectContaining({ type: 'ADDRESS_MISSING', severity: 'INFO' }),
    ]);
    expect(hasErrors(conflicts)).toBe(false);
    expect(hasWarnings(conflicts)).toBe(false);
  });

  it('kombiniert mehrere Konflikte', () => {
    const conflicts = checkAppointmentConflicts(
      baseInput({
        existingAppointments: [
          {
            id: 'other',
            startAt: new Date('2026-07-22T08:30:00.000Z'),
            endAt: new Date('2026-07-22T09:30:00.000Z'),
            durationMinutes: 60,
          },
        ],
        absences: [
          { startAt: new Date('2026-07-22T00:00:00Z'), endAt: new Date('2026-07-23T00:00:00Z') },
        ],
        availabilities: [{ weekday: 1, startTime: '08:00', endTime: '12:00' }],
      }),
    );
    expect(conflicts.map((c) => c.type).sort()).toEqual([
      'ABSENCE',
      'OUTSIDE_AVAILABILITY',
      'OVERLAP',
    ]);
  });
});
