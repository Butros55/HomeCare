/**
 * Serientermin-Logik auf RRULE-Basis (RFC 5545), rein und unit-getestet.
 *
 * Zeitzonen-Strategie: RRULE wird in "floating time" auf UTC-Mitternachts-
 * Daten expandiert (nur das Kalenderdatum zählt); die konkrete Startzeit
 * entsteht anschließend über zonedWallTimeToUtc in der Serien-Zeitzone.
 * Damit bleibt ein „9:00-Termin“ auch über DST-Wechsel hinweg um 9:00 Wandzeit.
 */
import { RRule, type Weekday } from 'rrule';

import { toUtcDateOnly, zonedWallTimeToUtc } from '@/lib/dates';

export type RecurrenceFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY_DATE'
  | 'MONTHLY_WEEKDAY';

export interface RecurrenceOptions {
  frequency: RecurrenceFrequency;
  /** Für WEEKLY: gewählte ISO-Wochentage (1=Mo…7=So); leer = Wochentag des Starts. */
  weekdays?: number[];
  /** Ende: Datum (inklusive), Anzahl oder offen. */
  endDate?: Date | null;
  count?: number | null;
}

/** Erzeugt den RRULE-String (ohne DTSTART – der steht separat am Datensatz). */
export function buildRecurrenceRule(options: RecurrenceOptions, startDate: Date): string {
  const parts: string[] = [];
  switch (options.frequency) {
    case 'DAILY':
      parts.push('FREQ=DAILY', 'INTERVAL=1');
      break;
    case 'WEEKLY':
    case 'BIWEEKLY': {
      parts.push('FREQ=WEEKLY', `INTERVAL=${options.frequency === 'BIWEEKLY' ? 2 : 1}`);
      const weekdays =
        options.weekdays && options.weekdays.length > 0
          ? options.weekdays
          : [((startDate.getUTCDay() + 6) % 7) + 1];
      const byday = weekdays
        .slice()
        .sort((a, b) => a - b)
        .map((day) => ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][day - 1])
        .join(',');
      parts.push(`BYDAY=${byday}`);
      break;
    }
    case 'MONTHLY_DATE':
      parts.push('FREQ=MONTHLY', 'INTERVAL=1', `BYMONTHDAY=${startDate.getUTCDate()}`);
      break;
    case 'MONTHLY_WEEKDAY': {
      const weekday = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][(startDate.getUTCDay() + 6) % 7];
      const ordinal = Math.ceil(startDate.getUTCDate() / 7);
      // 5. Vorkommen = „letztes“ (robust für kurze Monate).
      parts.push('FREQ=MONTHLY', 'INTERVAL=1', `BYDAY=${ordinal >= 5 ? -1 : ordinal}${weekday}`);
      break;
    }
  }
  if (options.count) {
    parts.push(`COUNT=${options.count}`);
  } else if (options.endDate) {
    const until = toUtcDateOnly(options.endDate);
    const y = until.getUTCFullYear();
    const m = (until.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = until.getUTCDate().toString().padStart(2, '0');
    // UNTIL inklusiv: Ende des Tages in UTC.
    parts.push(`UNTIL=${y}${m}${d}T235959Z`);
  }
  return parts.join(';');
}

/** Parst einen gespeicherten RRULE-String; wirft bei ungültiger Regel. */
export function parseRecurrenceRule(rule: string, startDate: Date): RRule {
  const options = RRule.parseString(rule);
  options.dtstart = toUtcDateOnly(startDate);
  return new RRule(options);
}

export function isValidRecurrenceRule(rule: string): boolean {
  try {
    const parsed = RRule.parseString(rule);
    // rrule parst nachsichtig ("FREQ=KAPUTT" → freq undefined) – streng prüfen.
    return typeof parsed.freq === 'number' && parsed.freq >= 0 && parsed.freq <= 6;
  } catch {
    return false;
  }
}

/**
 * Kalenderdaten (UTC-Mitternacht) aller Vorkommen im Bereich [from, to].
 * from/to sind Datums-Grenzen (inklusive).
 */
export function expandOccurrenceDates(
  rule: string,
  startDate: Date,
  from: Date,
  to: Date,
): Date[] {
  const rrule = parseRecurrenceRule(rule, startDate);
  return rrule
    .between(toUtcDateOnly(from), new Date(toUtcDateOnly(to).getTime() + 86_399_999), true)
    .map((date) => toUtcDateOnly(date));
}

/** Konkrete Start-/Endzeit eines Vorkommens (Wandzeit → UTC, DST-sicher). */
export function occurrenceTimes(
  occurrenceDate: Date,
  startTime: string,
  durationMinutes: number,
  timezone: string,
): { startAt: Date; endAt: Date } {
  const startAt = zonedWallTimeToUtc(
    occurrenceDate.getUTCFullYear(),
    occurrenceDate.getUTCMonth() + 1,
    occurrenceDate.getUTCDate(),
    startTime,
    timezone,
  );
  return { startAt, endAt: new Date(startAt.getTime() + durationMinutes * 60_000) };
}

const WEEKDAY_NAMES = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
];

/** Menschlich lesbare Beschreibung einer Regel (für Formulare & Drawer). */
export function describeRecurrenceRule(rule: string): string {
  let parsed: ReturnType<typeof RRule.parseString>;
  try {
    parsed = RRule.parseString(rule);
  } catch {
    return 'Ungültige Wiederholungsregel';
  }

  const interval = parsed.interval ?? 1;
  let base: string;
  switch (parsed.freq) {
    case RRule.DAILY:
      base = interval === 1 ? 'Täglich' : `Alle ${interval} Tage`;
      break;
    case RRule.WEEKLY: {
      const days = Array.isArray(parsed.byweekday)
        ? parsed.byweekday
            .map((d) => (typeof d === 'number' ? d : (d as Weekday).weekday))
            .sort((a, b) => a - b)
            .map((d) => WEEKDAY_NAMES[d])
            .join(', ')
        : null;
      base =
        interval === 1
          ? `Wöchentlich${days ? ` am ${days}` : ''}`
          : `Alle ${interval} Wochen${days ? ` am ${days}` : ''}`;
      break;
    }
    case RRule.MONTHLY: {
      if (parsed.bymonthday) {
        const day = Array.isArray(parsed.bymonthday) ? parsed.bymonthday[0] : parsed.bymonthday;
        base = `Monatlich am ${day}.`;
      } else if (parsed.byweekday) {
        const entry = (Array.isArray(parsed.byweekday) ? parsed.byweekday[0] : parsed.byweekday) as Weekday;
        const n = entry.n ?? 1;
        const name = WEEKDAY_NAMES[entry.weekday];
        base = n === -1 ? `Monatlich am letzten ${name}` : `Monatlich am ${n}. ${name}`;
      } else {
        base = 'Monatlich';
      }
      break;
    }
    default:
      base = 'Wiederkehrend';
  }

  if (parsed.count) return `${base}, ${parsed.count}× insgesamt`;
  if (parsed.until) {
    const until = parsed.until;
    return `${base}, bis ${until.getUTCDate().toString().padStart(2, '0')}.${(until.getUTCMonth() + 1)
      .toString()
      .padStart(2, '0')}.${until.getUTCFullYear()}`;
  }
  return `${base}, ohne Enddatum`;
}
