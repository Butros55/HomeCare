import { describe, expect, it } from 'vitest';

import {
  availabilityFormSchema,
  availabilitySlotsOverlap,
} from '@/server/validation/employee';

/**
 * Verfügbarkeits-Zeitfenster: Überschneidungen und exakte Duplikate desselben
 * Wochentags müssen abgelehnt werden; aneinandergrenzende Fenster und Fenster
 * an verschiedenen Wochentagen sind erlaubt.
 */
describe('availabilitySlotsOverlap', () => {
  it('erkennt eine echte Überschneidung am selben Wochentag', () => {
    expect(
      availabilitySlotsOverlap([
        { weekday: 1, startTime: '08:00', endTime: '12:00' },
        { weekday: 1, startTime: '10:00', endTime: '14:00' },
      ]),
    ).toBe(true);
  });

  it('erkennt ein exaktes Duplikat', () => {
    expect(
      availabilitySlotsOverlap([
        { weekday: 3, startTime: '09:00', endTime: '11:00' },
        { weekday: 3, startTime: '09:00', endTime: '11:00' },
      ]),
    ).toBe(true);
  });

  it('erlaubt aneinandergrenzende Fenster (Ende = nächster Beginn)', () => {
    expect(
      availabilitySlotsOverlap([
        { weekday: 2, startTime: '08:00', endTime: '12:00' },
        { weekday: 2, startTime: '12:00', endTime: '16:00' },
      ]),
    ).toBe(false);
  });

  it('erlaubt gleiche Zeiten an verschiedenen Wochentagen', () => {
    expect(
      availabilitySlotsOverlap([
        { weekday: 1, startTime: '08:00', endTime: '12:00' },
        { weekday: 2, startTime: '08:00', endTime: '12:00' },
      ]),
    ).toBe(false);
  });

  it('erkennt eine Überschneidung auch bei mehr als zwei Fenstern', () => {
    expect(
      availabilitySlotsOverlap([
        { weekday: 5, startTime: '06:00', endTime: '08:00' },
        { weekday: 5, startTime: '13:00', endTime: '17:00' },
        { weekday: 5, startTime: '16:30', endTime: '18:00' },
      ]),
    ).toBe(true);
  });
});

describe('availabilityFormSchema – Overlap-Refinement', () => {
  it('weist überschneidende Fenster zurück', () => {
    const result = availabilityFormSchema.safeParse({
      employeeId: 'emp-1',
      slots: [
        { weekday: 1, startTime: '08:00', endTime: '12:00' },
        { weekday: 1, startTime: '11:00', endTime: '13:00' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('akzeptiert überschneidungsfreie Fenster', () => {
    const result = availabilityFormSchema.safeParse({
      employeeId: 'emp-1',
      slots: [
        { weekday: 1, startTime: '08:00', endTime: '12:00' },
        { weekday: 1, startTime: '13:00', endTime: '17:00' },
        { weekday: 2, startTime: '08:00', endTime: '12:00' },
      ],
    });
    expect(result.success).toBe(true);
  });
});
