/**
 * Stundenkonto (Konto-Modell, Umbau Juli 2026) – reine Berechnungen.
 *
 * Jeder Kunde hat EIN Konto:
 *  - Gutschriften  = Topup-Zeilen (einmalig, wiederkehrend materialisiert,
 *    Korrektur ±). Zukünftige effectiveOn-Daten sind vorgemerkte Gutschriften.
 *  - Abzüge        = abgeleitet aus abgeschlossenen Terminen (Ist-Zeit aus
 *    freigegebener Zeiterfassung vor Plan-Dauer). Keine Abzugszeilen → ein
 *    Statuswechsel (Storno, Wieder-Öffnen) korrigiert das Konto von selbst.
 *  - Reservierungen = aktive, noch nicht abgeschlossene Termine.
 *
 * Kontostand  = Gutschriften − Geleistet
 * Verplanbar  = Kontostand − Reserviert (kann negativ sein = überbucht)
 *
 * Alle Funktionen sind DB-frei; die Services laden die Datensätze und
 * delegieren hierher (unit-testbar in src/lib/hour-account.test.ts).
 */

export interface TopupLike {
  minutes: number;
  /** Buchungsdatum (UTC-Mitternacht, Datumssemantik). */
  effectiveOn: Date;
}

export interface RecurringGrantLike {
  minutes: number;
  intervalUnit: 'WEEK' | 'MONTH';
  intervalCount: number;
  /** Erste Gutschrift (UTC-Mitternacht). */
  startDate: Date;
  /** Optional: keine Gutschriften nach diesem Datum (inklusiv). */
  endDate?: Date | null;
  active: boolean;
  /** Bis einschließlich dieses Datums sind Gutschriften bereits gebucht. */
  materializedUntil?: Date | null;
}

export interface AccountAppointmentLike {
  durationMinutes: number;
  status:
    | 'DRAFT'
    | 'PLANNED'
    | 'CONFIRMED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'NO_SHOW';
  /** Ist-Minuten aus (freigegebener) Zeiterfassung, falls vorhanden. */
  workedMinutes?: number | null;
  /** Terminbeginn – nur nötig, wenn Reservierungen datumsbegrenzt zählen sollen. */
  startAt?: Date;
}

/** Termin-Status, die Guthaben reservieren (aktiv, noch nicht geleistet). */
export const ACCOUNT_RESERVING_STATUSES = [
  'DRAFT',
  'PLANNED',
  'CONFIRMED',
  'IN_PROGRESS',
] as const;

function isReserving(appointment: AccountAppointmentLike): boolean {
  return (ACCOUNT_RESERVING_STATUSES as readonly string[]).includes(appointment.status);
}

/** Obergrenze gegen Endlosschleifen bei kaputten Regeln (z. B. Intervall 0). */
const MAX_OCCURRENCES = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Monatsschritt in reiner UTC-Arithmetik mit Klemmung ans Monatsende.
 * Bewusst NICHT date-fns `addMonths`: das rechnet in Lokalzeit und verschiebt
 * UTC-Mitternachtsdaten beim Sommerzeitwechsel um eine Stunde.
 */
function addMonthsUtcClamped(start: Date, months: number): Date {
  const targetFirst = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const daysInTarget = new Date(
    Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetFirst.getUTCFullYear(),
      targetFirst.getUTCMonth(),
      Math.min(start.getUTCDate(), daysInTarget),
    ),
  );
}

/**
 * Gutschriftstermine einer wiederkehrenden Aufladung im Fenster
 * (afterExclusive, untilInclusive]. Verankert am Startdatum (kein Drift bei
 * Monatsenden: 31.01. + 1 Monat = 28.02., + 2 Monate = 31.03.).
 */
export function grantOccurrencesBetween(
  grant: RecurringGrantLike,
  afterExclusive: Date | null,
  untilInclusive: Date,
): Date[] {
  if (!grant.active) return [];
  const step = Math.max(1, Math.floor(grant.intervalCount));
  const lastAllowed =
    grant.endDate && grant.endDate < untilInclusive ? grant.endDate : untilInclusive;

  const result: Date[] = [];
  for (let i = 0; i < MAX_OCCURRENCES; i += 1) {
    const occurrence =
      grant.intervalUnit === 'MONTH'
        ? addMonthsUtcClamped(grant.startDate, i * step)
        : new Date(grant.startDate.getTime() + i * step * 7 * DAY_MS);
    if (occurrence > lastAllowed) break;
    if (afterExclusive && occurrence <= afterExclusive) continue;
    result.push(occurrence);
  }
  return result;
}

/** Summe der noch nicht materialisierten Gutschriften bis `untilInclusive`. */
export function projectedGrantMinutes(
  grants: RecurringGrantLike[],
  untilInclusive: Date,
): number {
  return grants.reduce((sum, grant) => {
    const after = grant.materializedUntil ?? null;
    return sum + grantOccurrencesBetween(grant, after, untilInclusive).length * grant.minutes;
  }, 0);
}

export interface HourAccountSummary {
  /** Gutschriften bis `until` (gebuchte Topups; ggf. + Projektion, s. Service). */
  creditedMinutes: number;
  /** Geleistete Minuten (COMPLETED; Ist-Zeit vor Plan-Dauer). */
  completedMinutes: number;
  /** Reservierte Minuten aktiver, nicht abgeschlossener Termine. */
  reservedMinutes: number;
  /** Kontostand = Gutschriften − Geleistet. */
  balanceMinutes: number;
  /** Verplanbar = Kontostand − Reserviert (negativ = überbucht). */
  plannableMinutes: number;
}

export function computeHourAccount(input: {
  topups: TopupLike[];
  appointments: AccountAppointmentLike[];
  /** Stichtag: Gutschriften mit effectiveOn > until zählen (noch) nicht. */
  until: Date;
  /** Zusätzliche (projizierte) Gutschriften, z. B. für Planungsdaten in der Zukunft. */
  extraCreditMinutes?: number;
  /**
   * Optional: Reservierungen nur bis vor diesen Zeitpunkt zählen (exklusiv).
   * Für Planungsrechnungen zum Tag D gilt: Gutschriften ≤ D und Reservierungen
   * < Tagesende D – Termine NACH D werden von den Gutschriften nach D gedeckt
   * und dort geprüft. Ohne Angabe zählen alle aktiven Reservierungen.
   */
  reservedBefore?: Date;
}): HourAccountSummary {
  const creditedMinutes =
    input.topups
      .filter((topup) => topup.effectiveOn <= input.until)
      .reduce((sum, topup) => sum + topup.minutes, 0) + (input.extraCreditMinutes ?? 0);
  const completedMinutes = input.appointments
    .filter((a) => a.status === 'COMPLETED')
    .reduce((sum, a) => sum + (a.workedMinutes ?? a.durationMinutes), 0);
  const reservedMinutes = input.appointments
    .filter(isReserving)
    .filter((a) => !input.reservedBefore || !a.startAt || a.startAt < input.reservedBefore)
    .reduce((sum, a) => sum + a.durationMinutes, 0);
  const balanceMinutes = creditedMinutes - completedMinutes;
  return {
    creditedMinutes,
    completedMinutes,
    reservedMinutes,
    balanceMinutes,
    plannableMinutes: balanceMinutes - reservedMinutes,
  };
}

/**
 * Verplanbare Minuten für ein Planungsdatum in der Zukunft: gebuchte
 * Gutschriften bis zum Datum + noch nicht materialisierte wiederkehrende
 * Gutschriften bis zum Datum − Geleistet − Reserviert. Nie negativ (für
 * Vorschlags-/Kapazitätsrechnungen).
 */
export function plannableMinutesAt(input: {
  topups: TopupLike[];
  grants: RecurringGrantLike[];
  appointments: AccountAppointmentLike[];
  date: Date;
  /** Reservierungen nur vor diesem Zeitpunkt zählen (typisch: Tagesende von `date`). */
  reservedBefore?: Date;
}): number {
  const summary = computeHourAccount({
    topups: input.topups,
    appointments: input.appointments,
    until: input.date,
    extraCreditMinutes: projectedGrantMinutes(input.grants, input.date),
    reservedBefore: input.reservedBefore,
  });
  return Math.max(0, summary.plannableMinutes);
}
