import { describe, expect, it } from 'vitest';

import { centsForMinutes, computePersonalEarnings } from '@/lib/earnings';

describe('Verdienstberechnung', () => {
  it('berechnet Minuten mit einem Cent-Stundensatz und rundet erst das Ergebnis', () => {
    expect(centsForMinutes(90, 2_000)).toBe(3_000);
    expect(centsForMinutes(1, 1_500)).toBe(25);
  });

  it('trennt eigenen Lohn und Mitarbeiter-Provision und bildet die Summe', () => {
    expect(
      computePersonalEarnings({
        ownCompletedMinutes: 300,
        hourlyWageCents: 2_250,
        employeeCompletedMinutes: 480,
        employeeCommissionCentsPerHour: 350,
      }),
    ).toEqual({
      ownEarningsCents: 11_250,
      commissionEarningsCents: 2_800,
      totalEarningsCents: 14_050,
    });
  });

  it('liefert bei nicht hinterlegten Sätzen null Cent', () => {
    expect(
      computePersonalEarnings({
        ownCompletedMinutes: 120,
        hourlyWageCents: 0,
        employeeCompletedMinutes: 240,
        employeeCommissionCentsPerHour: 0,
      }),
    ).toEqual({
      ownEarningsCents: 0,
      commissionEarningsCents: 0,
      totalEarningsCents: 0,
    });
  });

  it('weist negative oder gebrochene Eingaben zurück', () => {
    expect(() => centsForMinutes(-1, 2_000)).toThrow(RangeError);
    expect(() => centsForMinutes(60, 20.5)).toThrow(RangeError);
  });
});
