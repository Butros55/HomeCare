import { describe, expect, it } from 'vitest';

import {
  computeNetPay,
  isCompensationProfileComplete,
  type CompensationProfile,
} from './net-pay';

const employed: CompensationProfile = {
  employmentType: 'EMPLOYED',
  incomeTaxRatePercent: 15,
  churchTaxRatePercent: 9,
  healthInsuranceExtraRatePercent: 2.5,
  hasChildren: false,
  applySolidarity: false,
};

describe('computeNetPay', () => {
  it('lässt beim Minijob brutto = netto (Pauschalabgaben trägt der Arbeitgeber)', () => {
    const result = computeNetPay({
      taxableGrossCents: 50_000,
      taxFreeCents: 0,
      profile: { ...employed, employmentType: 'MINIJOB' },
    });
    expect(result.netCents).toBe(50_000);
    expect(result.deductionsCents).toBe(0);
  });

  it('zieht in abhängiger Beschäftigung Steuer und Sozialabgaben ab', () => {
    const result = computeNetPay({
      taxableGrossCents: 200_000,
      taxFreeCents: 0,
      profile: employed,
    });
    // Lohnsteuer 15 % = 30.000, Kirche 9 % davon = 2.700.
    expect(result.incomeTaxCents).toBe(30_000);
    expect(result.churchTaxCents).toBe(2_700);
    // RV 9,3 % / AV 1,3 % / KV 7,3 %+1,25 % / PV 1,8 %+0,6 %.
    expect(result.pensionCents).toBe(18_600);
    expect(result.unemploymentCents).toBe(2_600);
    expect(result.healthCents).toBe(17_100);
    expect(result.careCents).toBe(4_800);
    expect(result.netCents).toBe(200_000 - result.deductionsCents);
  });

  it('berücksichtigt den Zuschlag für Kinderlose', () => {
    const withChildren = computeNetPay({
      taxableGrossCents: 200_000,
      taxFreeCents: 0,
      profile: { ...employed, hasChildren: true },
    });
    const childless = computeNetPay({
      taxableGrossCents: 200_000,
      taxFreeCents: 0,
      profile: employed,
    });
    expect(childless.careCents).toBeGreaterThan(withChildren.careCents);
  });

  it('kürzt steuerfreie Bestandteile nicht', () => {
    const result = computeNetPay({
      taxableGrossCents: 100_000,
      taxFreeCents: 25_000,
      profile: employed,
    });
    expect(result.grossCents).toBe(125_000);
    // Abzüge nur auf dem steuerpflichtigen Teil.
    const onlyTaxable = computeNetPay({
      taxableGrossCents: 100_000,
      taxFreeCents: 0,
      profile: employed,
    });
    expect(result.deductionsCents).toBe(onlyTaxable.deductionsCents);
    expect(result.netCents).toBe(onlyTaxable.netCents + 25_000);
  });

  it('rechnet für Selbständige ohne Arbeitnehmeranteile', () => {
    const result = computeNetPay({
      taxableGrossCents: 200_000,
      taxFreeCents: 0,
      profile: { ...employed, employmentType: 'SELF_EMPLOYED' },
    });
    expect(result.pensionCents).toBe(0);
    expect(result.healthCents).toBe(0);
    expect(result.incomeTaxCents).toBe(30_000);
  });

  it('erkennt unvollständige Profile', () => {
    expect(isCompensationProfileComplete(null)).toBe(false);
    expect(isCompensationProfileComplete({ employmentType: 'EMPLOYED' })).toBe(false);
    expect(isCompensationProfileComplete({ employmentType: 'MINIJOB' })).toBe(true);
    expect(isCompensationProfileComplete(employed)).toBe(true);
  });
});
