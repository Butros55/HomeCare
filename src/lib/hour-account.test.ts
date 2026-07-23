import { describe, expect, it } from 'vitest';

import {
  computeHourAccount,
  grantOccurrencesBetween,
  plannableMinutesAt,
  projectedGrantMinutes,
  type AccountAppointmentLike,
  type RecurringGrantLike,
} from '@/lib/hour-account';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const monthlyGrant = (overrides: Partial<RecurringGrantLike> = {}): RecurringGrantLike => ({
  minutes: 120,
  intervalUnit: 'MONTH',
  intervalCount: 1,
  startDate: utc(2026, 1, 1),
  endDate: null,
  active: true,
  materializedUntil: null,
  ...overrides,
});

describe('grantOccurrencesBetween', () => {
  it('liefert monatliche Gutschriften ab Start bis inklusive Stichtag', () => {
    expect(grantOccurrencesBetween(monthlyGrant(), null, utc(2026, 3, 15))).toEqual([
      utc(2026, 1, 1),
      utc(2026, 2, 1),
      utc(2026, 3, 1),
    ]);
  });

  it('respektiert afterExclusive (bereits materialisierte Gutschriften)', () => {
    expect(
      grantOccurrencesBetween(monthlyGrant(), utc(2026, 2, 1), utc(2026, 4, 1)),
    ).toEqual([utc(2026, 3, 1), utc(2026, 4, 1)]);
  });

  it('klemmt Monatsenden ohne Drift (31. → 28. Februar → 31. März)', () => {
    expect(
      grantOccurrencesBetween(monthlyGrant({ startDate: utc(2026, 1, 31) }), null, utc(2026, 3, 31)),
    ).toEqual([utc(2026, 1, 31), utc(2026, 2, 28), utc(2026, 3, 31)]);
  });

  it('unterstützt Wochenintervalle mit intervalCount', () => {
    expect(
      grantOccurrencesBetween(
        monthlyGrant({ intervalUnit: 'WEEK', intervalCount: 2, startDate: utc(2026, 6, 1) }),
        null,
        utc(2026, 6, 30),
      ),
    ).toEqual([utc(2026, 6, 1), utc(2026, 6, 15), utc(2026, 6, 29)]);
  });

  it('endet mit endDate (inklusiv) und liefert nichts für inaktive Regeln', () => {
    expect(
      grantOccurrencesBetween(
        monthlyGrant({ endDate: utc(2026, 2, 1) }),
        null,
        utc(2026, 12, 1),
      ),
    ).toEqual([utc(2026, 1, 1), utc(2026, 2, 1)]);
    expect(
      grantOccurrencesBetween(monthlyGrant({ active: false }), null, utc(2026, 12, 1)),
    ).toEqual([]);
  });

  it('liefert nichts vor dem Startdatum', () => {
    expect(grantOccurrencesBetween(monthlyGrant(), null, utc(2025, 12, 31))).toEqual([]);
  });

  it('überlebt kaputte Intervalle (0) ohne Endlosschleife', () => {
    const occurrences = grantOccurrencesBetween(
      monthlyGrant({ intervalCount: 0 }),
      null,
      utc(2026, 3, 1),
    );
    expect(occurrences).toEqual([utc(2026, 1, 1), utc(2026, 2, 1), utc(2026, 3, 1)]);
  });
});

describe('projectedGrantMinutes', () => {
  it('summiert nur noch nicht materialisierte Gutschriften', () => {
    const grants = [
      monthlyGrant({ materializedUntil: utc(2026, 7, 1) }), // Aug + Sep offen
      monthlyGrant({ minutes: 60, materializedUntil: null, startDate: utc(2026, 9, 1) }), // Sep
    ];
    expect(projectedGrantMinutes(grants, utc(2026, 9, 30))).toBe(2 * 120 + 60);
  });
});

describe('computeHourAccount', () => {
  const appointments: AccountAppointmentLike[] = [
    { durationMinutes: 90, status: 'COMPLETED', workedMinutes: null },
    { durationMinutes: 60, status: 'COMPLETED', workedMinutes: 45 }, // Ist vor Plan
    { durationMinutes: 120, status: 'PLANNED' },
    { durationMinutes: 30, status: 'DRAFT' },
    { durationMinutes: 500, status: 'CANCELLED' },
    { durationMinutes: 500, status: 'NO_SHOW' },
  ];

  it('berechnet Kontostand und Verplanbar aus Gutschriften und Terminen', () => {
    const summary = computeHourAccount({
      topups: [
        { minutes: 300, effectiveOn: utc(2026, 6, 1) },
        { minutes: 120, effectiveOn: utc(2026, 7, 1) },
        { minutes: -30, effectiveOn: utc(2026, 7, 10) }, // Korrektur
        { minutes: 600, effectiveOn: utc(2026, 8, 1) }, // vorgemerkt (Zukunft)
      ],
      appointments,
      until: utc(2026, 7, 23),
    });
    expect(summary.creditedMinutes).toBe(300 + 120 - 30);
    expect(summary.completedMinutes).toBe(90 + 45);
    expect(summary.reservedMinutes).toBe(120 + 30);
    expect(summary.balanceMinutes).toBe(390 - 135);
    expect(summary.plannableMinutes).toBe(390 - 135 - 150);
  });

  it('kann überbucht (negativ) sein', () => {
    const summary = computeHourAccount({
      topups: [{ minutes: 60, effectiveOn: utc(2026, 7, 1) }],
      appointments: [{ durationMinutes: 120, status: 'PLANNED' }],
      until: utc(2026, 7, 23),
    });
    expect(summary.plannableMinutes).toBe(-60);
  });
});

describe('plannableMinutesAt', () => {
  it('zählt zukünftige wiederkehrende Gutschriften bis zum Planungsdatum mit', () => {
    const value = plannableMinutesAt({
      topups: [{ minutes: 120, effectiveOn: utc(2026, 7, 1) }],
      grants: [monthlyGrant({ materializedUntil: utc(2026, 7, 23) })],
      appointments: [
        { durationMinutes: 120, status: 'COMPLETED', workedMinutes: null },
        { durationMinutes: 60, status: 'PLANNED' },
      ],
      date: utc(2026, 9, 10),
    });
    // 120 gebucht + 2×120 (01.08., 01.09.) − 120 geleistet − 60 reserviert
    expect(value).toBe(120 + 240 - 120 - 60);
  });

  it('klemmt bei 0 (nie negativ für Kapazitätsrechnungen)', () => {
    expect(
      plannableMinutesAt({
        topups: [],
        grants: [],
        appointments: [{ durationMinutes: 45, status: 'PLANNED' }],
        date: utc(2026, 7, 23),
      }),
    ).toBe(0);
  });
});
