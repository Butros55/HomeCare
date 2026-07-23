/**
 * Dauer-Parser und -Formatierung.
 *
 * Intern werden alle Zeitmengen als ganzzahlige Minuten gespeichert –
 * niemals als Gleitkommastunden. Diese Datei ist die einzige Stelle, die
 * zwischen Benutzereingaben ("2,5", "2:30", "150 Minuten") und Minuten
 * übersetzt. Vollständig unit-getestet in duration.test.ts.
 */

/** Obergrenze für eine einzelne Eingabe: 10.000 Stunden. Schützt vor Tippfehlern. */
export const MAX_INPUT_MINUTES = 600_000;

export type ParseDurationResult =
  | { ok: true; minutes: number }
  | { ok: false; error: 'EMPTY' | 'INVALID' | 'NEGATIVE' | 'TOO_LARGE' };

/**
 * Parst eine Benutzereingabe zu Minuten.
 *
 * Unterstützte Formate (Standard-Einheit: Stunden):
 *  - "2"           → 120
 *  - "2,5" / "2.5" → 150
 *  - "2:30"        → 150
 *  - "150 Minuten" / "150 min" / "150m" → 150
 *  - "2 h" / "2 Std" / "2 Stunden"      → 120
 *  - "1h 30min" / "1 Std 30 Min"        → 90
 */
export function parseDurationInput(raw: string): ParseDurationResult {
  const input = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (input === '') return { ok: false, error: 'EMPTY' };
  if (input.startsWith('-')) return { ok: false, error: 'NEGATIVE' };

  let minutes: number | null = null;

  // "H:MM" (auch "10:05"); Minutenanteil 0–59
  const colonMatch = /^(\d{1,4}):([0-5]\d)$/.exec(input);
  if (colonMatch) {
    minutes = Number(colonMatch[1]) * 60 + Number(colonMatch[2]);
  }

  // Kombiniert: "1h 30min", "1 std 30 min", "1h30m"
  if (minutes === null) {
    const comboMatch =
      /^(\d{1,4})\s*(?:h|std\.?|stunden?)\s*(\d{1,3})\s*(?:m|min\.?|minuten?)?$/.exec(input);
    if (comboMatch) {
      minutes = Number(comboMatch[1]) * 60 + Number(comboMatch[2]);
    }
  }

  // Nur Minuten: "150 minuten", "90 min", "45m"
  if (minutes === null) {
    const minMatch = /^(\d{1,6})\s*(?:m|min\.?|minuten?)$/.exec(input);
    if (minMatch) {
      minutes = Number(minMatch[1]);
    }
  }

  // Stunden mit optionaler Einheit: "2", "2,5", "2.5", "2 h", "2,5 std"
  if (minutes === null) {
    const hourMatch = /^(\d{1,7})(?:[.,](\d{1,4}))?\s*(?:h|std\.?|stunden?)?$/.exec(input);
    if (hourMatch) {
      const whole = Number(hourMatch[1]);
      const fractionRaw = hourMatch[2];
      const fraction = fractionRaw ? Number(`0.${fractionRaw}`) : 0;
      // Auf ganze Minuten runden ("0,33 h" → 20 Minuten).
      minutes = Math.round((whole + fraction) * 60);
    }
  }

  if (minutes === null || Number.isNaN(minutes)) return { ok: false, error: 'INVALID' };
  if (minutes > MAX_INPUT_MINUTES) return { ok: false, error: 'TOO_LARGE' };
  return { ok: true, minutes };
}

/** 150 → "2,5 h" (de-DE, höchstens 2 Nachkommastellen, ohne unnötige Nullen). */
export function formatMinutesAsHours(minutes: number, locale = 'de-DE'): string {
  const hours = minutes / 60;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(hours);
  return `${formatted} h`;
}

/** 150 → "2,50 h" (feste 2 Nachkommastellen – für Kennzahlkarten). */
export function formatMinutesAsDecimalHours(minutes: number, locale = 'de-DE'): string {
  const hours = minutes / 60;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(hours);
  return `${formatted} h`;
}

/** 150 → "2:30 h"; 45 → "0:45 h". */
export function formatMinutesAsClock(minutes: number): string {
  const sign = minutes < 0 ? '−' : '';
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${m.toString().padStart(2, '0')} h`;
}

/** 90 → "1 Std. 30 Min."; 45 → "45 Min."; 120 → "2 Std." */
export function formatMinutesVerbose(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const sign = minutes < 0 ? '−' : '';
  if (h === 0) return `${sign}${m} Min.`;
  if (m === 0) return `${sign}${h} Std.`;
  return `${sign}${h} Std. ${m} Min.`;
}
