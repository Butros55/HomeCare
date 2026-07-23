/**
 * Reine Verdienstberechnung.
 *
 * Geldbeträge werden ausschließlich als ganzzahlige Cent geführt. Minuten
 * bleiben – wie im übrigen Stundenmodell – ganzzahlig; gerundet wird erst
 * beim jeweiligen Gesamtbetrag.
 */

export interface PersonalEarningsInput {
  ownCompletedMinutes: number;
  hourlyWageCents: number;
  employeeCompletedMinutes: number;
  employeeCommissionCentsPerHour: number;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} muss eine nicht-negative Ganzzahl sein.`);
  }
}

/** Minuten × Cent/Stunde, kaufmännisch auf den nächsten Cent gerundet. */
export function centsForMinutes(minutes: number, centsPerHour: number): number {
  assertNonNegativeInteger(minutes, 'minutes');
  assertNonNegativeInteger(centsPerHour, 'centsPerHour');
  return Math.round((minutes * centsPerHour) / 60);
}

export function computePersonalEarnings(input: PersonalEarningsInput) {
  const ownEarningsCents = centsForMinutes(
    input.ownCompletedMinutes,
    input.hourlyWageCents,
  );
  const commissionEarningsCents = centsForMinutes(
    input.employeeCompletedMinutes,
    input.employeeCommissionCentsPerHour,
  );

  return {
    ownEarningsCents,
    commissionEarningsCents,
    totalEarningsCents: ownEarningsCents + commissionEarningsCents,
  };
}

export function formatEuroCents(
  cents: number,
  locale = 'de-DE',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}
