import { describe, expect, it } from 'vitest';

import { centsForMinutes, computePersonalEarnings, computeRouteEarnings } from '@/lib/earnings';

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

describe('Routen-/Tagesverdienst (computeRouteEarnings)', () => {
  it('rechnet den steuerfreien Zuschlag in den Stundenverdienst ein', () => {
    // 60 Min. × (20,00 € Lohn + 3,00 € Zuschlag) = 23,00 €.
    expect(
      computeRouteEarnings({
        serviceMinutes: 60,
        distanceMeters: 0,
        hourlyWageCents: 2_000,
        taxFreeBonusCentsPerHour: 300,
        mileageRatePerKmCents: 0,
      }),
    ).toEqual({ wageCents: 2_300, mileageCents: 0, totalCents: 2_300 });
  });

  it('addiert das Kilometergeld zum Lohn', () => {
    // 120 Min. × 21,00 €/Std. = 42,00 € + 10 km × 0,30 € = 3,00 € → 45,00 €.
    expect(
      computeRouteEarnings({
        serviceMinutes: 120,
        distanceMeters: 10_000,
        hourlyWageCents: 1_800,
        taxFreeBonusCentsPerHour: 300,
        mileageRatePerKmCents: 30,
      }),
    ).toEqual({ wageCents: 4_200, mileageCents: 300, totalCents: 4_500 });
  });

  it('behandelt einen fehlenden Zuschlag wie 0 (abwärtskompatibel)', () => {
    expect(
      computeRouteEarnings({
        serviceMinutes: 90,
        distanceMeters: 0,
        hourlyWageCents: 2_000,
        mileageRatePerKmCents: 0,
      }),
    ).toEqual({ wageCents: 3_000, mileageCents: 0, totalCents: 3_000 });
  });
});
