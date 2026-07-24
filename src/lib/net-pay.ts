/**
 * Überschlag von Brutto zu Netto.
 *
 * WICHTIG: Das ist eine **Schätzung zur Orientierung**, keine Lohnabrechnung
 * und keine Steuerberatung. Die exakte Lohnsteuer ergibt sich aus den amtlichen
 * Lohnsteuertabellen (Jahresausgleich, Freibeträge, Kinderfreibeträge …) und
 * lässt sich hier bewusst nicht nachbilden. Der Steuersatz wird deshalb als
 * Eingabe erwartet und nicht geraten.
 *
 * Abgebildete Fälle:
 *  - `MINIJOB`: geringfügige Beschäftigung mit Pauschalabgaben des Arbeitgebers –
 *    für die beschäftigte Person bleibt brutto = netto.
 *  - `EMPLOYED`: sozialversicherungspflichtige Beschäftigung – Arbeitnehmer-
 *    anteile zur Sozialversicherung plus geschätzte Lohnsteuer (+ Soli/Kirche).
 *  - `SELF_EMPLOYED`: selbständig – kein Arbeitnehmeranteil, stattdessen
 *    geschätzte Einkommensteuer und selbst getragene Vorsorgeaufwendungen.
 */

export type EmploymentType = 'MINIJOB' | 'EMPLOYED' | 'SELF_EMPLOYED';

/** Arbeitnehmeranteile der Sozialversicherung in Prozent (Stand 2025). */
export const SOCIAL_CONTRIBUTION_RATES = {
  /** Rentenversicherung: 18,6 % gesamt, hälftig getragen. */
  pension: 9.3,
  /** Arbeitslosenversicherung: 2,6 % gesamt, hälftig getragen. */
  unemployment: 1.3,
  /** Krankenversicherung: 14,6 % gesamt, hälftig getragen (ohne Zusatzbeitrag). */
  health: 7.3,
  /** Pflegeversicherung: 3,6 % gesamt, hälftig getragen. */
  care: 1.8,
  /** Zuschlag für Kinderlose ab 23 – trägt die beschäftigte Person allein. */
  careChildlessSurcharge: 0.6,
} as const;

/** Solidaritätszuschlag auf die Lohnsteuer (greift erst über der Freigrenze). */
export const SOLIDARITY_RATE_PERCENT = 5.5;

export interface CompensationProfile {
  employmentType: EmploymentType;
  /**
   * Geschätzter Lohn-/Einkommensteuersatz in Prozent auf das steuerpflichtige
   * Brutto. Kommt aus den Einstellungen – wird nie geraten.
   */
  incomeTaxRatePercent: number;
  /** Kirchensteuer in Prozent der Lohnsteuer (0, 8 oder 9). */
  churchTaxRatePercent: number;
  /** Kassenindividueller Zusatzbeitrag in Prozent (gesamt, hälftig getragen). */
  healthInsuranceExtraRatePercent: number;
  /** Ohne Kinder greift der Pflegeversicherungs-Zuschlag. */
  hasChildren: boolean;
  /** Solidaritätszuschlag berücksichtigen. */
  applySolidarity: boolean;
}

export interface NetPayInput {
  /** Steuerpflichtiges Brutto in Cent (Stundenlohn × Stunden, Provision …). */
  taxableGrossCents: number;
  /** Steuerfreie Bestandteile in Cent (z. B. pauschale Auslagenerstattung). */
  taxFreeCents: number;
  profile: CompensationProfile;
}

export interface NetPayBreakdown {
  taxableGrossCents: number;
  taxFreeCents: number;
  /** Brutto gesamt inklusive steuerfreier Bestandteile. */
  grossCents: number;
  incomeTaxCents: number;
  solidarityCents: number;
  churchTaxCents: number;
  pensionCents: number;
  unemploymentCents: number;
  healthCents: number;
  careCents: number;
  /** Summe aller Abzüge. */
  deductionsCents: number;
  netCents: number;
}

function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}

/**
 * Liefert `null`, wenn das Profil unvollständig ist – dann zeigt die
 * Oberfläche bewusst kein Netto an, statt eine Zahl zu erfinden.
 */
export function isCompensationProfileComplete(
  profile: Partial<CompensationProfile> | null | undefined,
): profile is CompensationProfile {
  if (!profile?.employmentType) return false;
  if (profile.employmentType === 'MINIJOB') return true;
  return (
    typeof profile.incomeTaxRatePercent === 'number' &&
    profile.incomeTaxRatePercent >= 0 &&
    profile.incomeTaxRatePercent <= 60
  );
}

export function computeNetPay(input: NetPayInput): NetPayBreakdown {
  const taxableGrossCents = Math.max(0, Math.round(input.taxableGrossCents));
  const taxFreeCents = Math.max(0, Math.round(input.taxFreeCents));
  const grossCents = taxableGrossCents + taxFreeCents;
  const { profile } = input;

  const empty = {
    taxableGrossCents,
    taxFreeCents,
    grossCents,
    incomeTaxCents: 0,
    solidarityCents: 0,
    churchTaxCents: 0,
    pensionCents: 0,
    unemploymentCents: 0,
    healthCents: 0,
    careCents: 0,
    deductionsCents: 0,
    netCents: grossCents,
  };

  // Minijob mit Pauschalabgaben: die beschäftigte Person zahlt nichts.
  if (profile.employmentType === 'MINIJOB') return empty;

  const incomeTaxCents = percentOf(taxableGrossCents, profile.incomeTaxRatePercent);
  const solidarityCents = profile.applySolidarity
    ? percentOf(incomeTaxCents, SOLIDARITY_RATE_PERCENT)
    : 0;
  const churchTaxCents = percentOf(incomeTaxCents, profile.churchTaxRatePercent);

  // Sozialversicherungsanteile fallen nur in abhängiger Beschäftigung an;
  // Selbständige tragen ihre Vorsorge selbst und außerhalb dieser Rechnung.
  const employed = profile.employmentType === 'EMPLOYED';
  const careRate =
    SOCIAL_CONTRIBUTION_RATES.care +
    (profile.hasChildren ? 0 : SOCIAL_CONTRIBUTION_RATES.careChildlessSurcharge);
  const healthRate =
    SOCIAL_CONTRIBUTION_RATES.health + profile.healthInsuranceExtraRatePercent / 2;

  const pensionCents = employed
    ? percentOf(taxableGrossCents, SOCIAL_CONTRIBUTION_RATES.pension)
    : 0;
  const unemploymentCents = employed
    ? percentOf(taxableGrossCents, SOCIAL_CONTRIBUTION_RATES.unemployment)
    : 0;
  const healthCents = employed ? percentOf(taxableGrossCents, healthRate) : 0;
  const careCents = employed ? percentOf(taxableGrossCents, careRate) : 0;

  const deductionsCents =
    incomeTaxCents +
    solidarityCents +
    churchTaxCents +
    pensionCents +
    unemploymentCents +
    healthCents +
    careCents;

  return {
    taxableGrossCents,
    taxFreeCents,
    grossCents,
    incomeTaxCents,
    solidarityCents,
    churchTaxCents,
    pensionCents,
    unemploymentCents,
    healthCents,
    careCents,
    deductionsCents,
    // Steuerfreie Bestandteile bleiben ungekürzt.
    netCents: Math.max(0, grossCents - deductionsCents),
  };
}
