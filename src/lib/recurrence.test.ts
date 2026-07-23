import { describe, expect, it } from 'vitest';

import { utcDate } from './dates';
import {
  buildRecurrenceRule,
  describeRecurrenceRule,
  expandOccurrenceDates,
  isValidRecurrenceRule,
  occurrenceTimes,
} from './recurrence';

describe('buildRecurrenceRule', () => {
  const monday = utcDate(2026, 7, 20); // Montag

  it('täglich', () => {
    expect(buildRecurrenceRule({ frequency: 'DAILY' }, monday)).toBe('FREQ=DAILY;INTERVAL=1');
  });

  it('wöchentlich mit Standard-Wochentag aus dem Start', () => {
    expect(buildRecurrenceRule({ frequency: 'WEEKLY' }, monday)).toBe(
      'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
    );
  });

  it('wöchentlich mit gewählten Wochentagen', () => {
    expect(buildRecurrenceRule({ frequency: 'WEEKLY', weekdays: [4, 1] }, monday)).toBe(
      'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH',
    );
  });

  it('alle zwei Wochen', () => {
    expect(buildRecurrenceRule({ frequency: 'BIWEEKLY' }, monday)).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    );
  });

  it('monatlich am gleichen Datum', () => {
    expect(buildRecurrenceRule({ frequency: 'MONTHLY_DATE' }, utcDate(2026, 7, 15))).toBe(
      'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15',
    );
  });

  it('monatlich am gleichen Wochentag (3. Montag)', () => {
    expect(buildRecurrenceRule({ frequency: 'MONTHLY_WEEKDAY' }, utcDate(2026, 7, 20))).toBe(
      'FREQ=MONTHLY;INTERVAL=1;BYDAY=3MO',
    );
  });

  it('Ende nach Anzahl', () => {
    expect(buildRecurrenceRule({ frequency: 'DAILY', count: 10 }, monday)).toBe(
      'FREQ=DAILY;INTERVAL=1;COUNT=10',
    );
  });

  it('Ende nach Datum (inklusive)', () => {
    expect(
      buildRecurrenceRule({ frequency: 'WEEKLY', endDate: utcDate(2026, 9, 30) }, monday),
    ).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20260930T235959Z');
  });
});

describe('expandOccurrenceDates', () => {
  it('wöchentliche Serie liefert die richtigen Kalendertage', () => {
    const dates = expandOccurrenceDates(
      'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH',
      utcDate(2026, 7, 20),
      utcDate(2026, 7, 20),
      utcDate(2026, 8, 2),
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-07-20',
      '2026-07-23',
      '2026-07-27',
      '2026-07-30',
    ]);
  });

  it('respektiert COUNT', () => {
    const dates = expandOccurrenceDates(
      'FREQ=DAILY;INTERVAL=1;COUNT=3',
      utcDate(2026, 7, 20),
      utcDate(2026, 7, 1),
      utcDate(2026, 8, 31),
    );
    expect(dates).toHaveLength(3);
  });

  it('respektiert UNTIL inklusive', () => {
    const dates = expandOccurrenceDates(
      'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20260803T235959Z',
      utcDate(2026, 7, 20),
      utcDate(2026, 7, 1),
      utcDate(2026, 12, 31),
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-07-20',
      '2026-07-27',
      '2026-08-03',
    ]);
  });

  it('14-tägig überspringt die Zwischenwoche', () => {
    const dates = expandOccurrenceDates(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
      utcDate(2026, 7, 20),
      utcDate(2026, 7, 20),
      utcDate(2026, 8, 31),
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-07-20',
      '2026-08-03',
      '2026-08-17',
      '2026-08-31',
    ]);
  });

  it('monatlich am letzten Freitag', () => {
    const dates = expandOccurrenceDates(
      'FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR',
      utcDate(2026, 1, 30),
      utcDate(2026, 1, 1),
      utcDate(2026, 3, 31),
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-01-30',
      '2026-02-27',
      '2026-03-27',
    ]);
  });
});

describe('occurrenceTimes (DST-sicher)', () => {
  it('Winterzeit: 9:00 Berlin = 8:00 UTC', () => {
    const { startAt, endAt } = occurrenceTimes(utcDate(2026, 1, 12), '09:00', 120, 'Europe/Berlin');
    expect(startAt.toISOString()).toBe('2026-01-12T08:00:00.000Z');
    expect(endAt.toISOString()).toBe('2026-01-12T10:00:00.000Z');
  });

  it('Sommerzeit: 9:00 Berlin = 7:00 UTC', () => {
    const { startAt } = occurrenceTimes(utcDate(2026, 7, 20), '09:00', 60, 'Europe/Berlin');
    expect(startAt.toISOString()).toBe('2026-07-20T07:00:00.000Z');
  });

  it('Wandzeit bleibt über den DST-Wechsel stabil (März 2026)', () => {
    // 2026: DST-Beginn in Europa am 29. März.
    const before = occurrenceTimes(utcDate(2026, 3, 23), '09:00', 60, 'Europe/Berlin');
    const after = occurrenceTimes(utcDate(2026, 3, 30), '09:00', 60, 'Europe/Berlin');
    expect(before.startAt.toISOString()).toBe('2026-03-23T08:00:00.000Z'); // MEZ
    expect(after.startAt.toISOString()).toBe('2026-03-30T07:00:00.000Z'); // MESZ
  });
});

describe('describeRecurrenceRule', () => {
  it('beschreibt gängige Regeln deutsch', () => {
    expect(describeRecurrenceRule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH')).toBe(
      'Wöchentlich am Montag, Donnerstag, ohne Enddatum',
    );
    expect(describeRecurrenceRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;COUNT=8')).toBe(
      'Alle 2 Wochen am Freitag, 8× insgesamt',
    );
    expect(describeRecurrenceRule('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15')).toBe(
      'Monatlich am 15., ohne Enddatum',
    );
    expect(describeRecurrenceRule('FREQ=MONTHLY;INTERVAL=1;BYDAY=3MO')).toBe(
      'Monatlich am 3. Montag, ohne Enddatum',
    );
    expect(describeRecurrenceRule('FREQ=DAILY;INTERVAL=1;UNTIL=20260930T235959Z')).toBe(
      'Täglich, bis 30.09.2026',
    );
  });

  it('meldet ungültige Regeln', () => {
    expect(isValidRecurrenceRule('FREQ=KAPUTT')).toBe(false);
    expect(describeRecurrenceRule('UNSINN')).toBe('Ungültige Wiederholungsregel');
  });
});
