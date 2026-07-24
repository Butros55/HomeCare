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

/** Kilometer × Cent/km (Kilometergeld), kaufmännisch gerundet. Meter müssen nicht ganzzahlig teilbar sein. */
export function centsForKilometers(meters: number, centsPerKm: number): number {
  if (!Number.isFinite(meters) || meters < 0) {
    throw new RangeError('meters muss eine nicht-negative Zahl sein.');
  }
  assertNonNegativeInteger(centsPerKm, 'centsPerKm');
  return Math.round((meters / 1000) * centsPerKm);
}

export interface RouteEarningsInput {
  /** Reine Kundenzeit der Route in Minuten. */
  serviceMinutes: number;
  /** Gefahrene Strecke der Route in Metern. */
  distanceMeters: number;
  hourlyWageCents: number;
  /** Kilometergeld je km in Cent (nur eigene Fahrten – 0 = kein Kilometergeld). */
  mileageRatePerKmCents: number;
}

/**
 * Verdienst einer geplanten Tagesroute: Lohn für die Kundenzeit plus optionales
 * Kilometergeld für die gefahrene Strecke. Wird in der Routenplanung und im
 * Generator als Kennzahl angezeigt.
 */
export function computeRouteEarnings(input: RouteEarningsInput) {
  const wageCents = centsForMinutes(input.serviceMinutes, input.hourlyWageCents);
  const mileageCents = centsForKilometers(input.distanceMeters, input.mileageRatePerKmCents);
  return { wageCents, mileageCents, totalCents: wageCents + mileageCents };
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
