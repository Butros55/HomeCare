/**
 * Datums- und Zeitraum-Helfer.
 *
 * Konvention: Zeitstempel liegen in UTC in der Datenbank; alles, was ein
 * "Datum" ist (Budgetzeiträume, Serientage, Routendatum), wird als
 * UTC-Mitternacht gespeichert. Anzeige und Wandtzeit-Berechnungen laufen
 * über die Organisations-Zeitzone (@date-fns/tz).
 */
import { TZDate } from '@date-fns/tz';
import { addDays, addMonths } from 'date-fns';

import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from '@/lib/app-config';

/** Halboffener Zeitraum [start, end) in UTC. */
export interface Period {
  start: Date;
  end: Date;
}

/** true, wenn sich [aStart, aEnd) und [bStart, bEnd) überschneiden. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** UTC-Mitternacht für ein Kalenderdatum. */
export function utcDate(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/** Schneidet einen Zeitstempel auf UTC-Mitternacht ab. */
export function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Kalenderdatum (J/M/T) eines UTC-Zeitpunkts in einer Zeitzone. */
export function calendarDayInZone(date: Date, timezone: string): { year: number; month: number; day: number } {
  const zoned = new TZDate(date, timezone);
  return { year: zoned.getFullYear(), month: zoned.getMonth() + 1, day: zoned.getDate() };
}

/**
 * Wandtzeit → UTC: Kalenderdatum + "HH:mm" in einer Zeitzone.
 * Beispiel: (2026-03-29, "02:30", Europe/Berlin) landet korrekt hinter der DST-Lücke.
 */
export function zonedWallTimeToUtc(
  year: number,
  month1: number,
  day: number,
  time: string,
  timezone: string,
): Date {
  const [h, m] = time.split(':').map(Number);
  const zoned = new TZDate(year, month1 - 1, day, h ?? 0, m ?? 0, 0, 0, timezone);
  return new Date(zoned.getTime());
}

/** Beginn des Tages (00:00 der Zeitzone) als UTC-Zeitpunkt. */
export function startOfDayInZone(date: Date, timezone: string): Date {
  const { year, month, day } = calendarDayInZone(date, timezone);
  return zonedWallTimeToUtc(year, month, day, '00:00', timezone);
}

/** Tageszeitraum [00:00, +1 Tag) der Zeitzone als UTC-Zeitraum. */
export function dayPeriodInZone(date: Date, timezone: string): Period {
  const start = startOfDayInZone(date, timezone);
  const { year, month, day } = calendarDayInZone(date, timezone);
  const nextDay = addDays(new Date(Date.UTC(year, month - 1, day)), 1);
  const end = zonedWallTimeToUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    '00:00',
    timezone,
  );
  return { start, end };
}

/** Monatszeitraum der Zeitzone als UTC-Zeitraum. */
export function monthPeriodInZone(date: Date, timezone: string): Period {
  const { year, month } = calendarDayInZone(date, timezone);
  const start = zonedWallTimeToUtc(year, month, 1, '00:00', timezone);
  const next = addMonths(new Date(Date.UTC(year, month - 1, 1)), 1);
  const end = zonedWallTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, 1, '00:00', timezone);
  return { start, end };
}

/** Wochenzeitraum (Mo 00:00 bis Mo 00:00) der Zeitzone als UTC-Zeitraum. */
export function weekPeriodInZone(date: Date, timezone: string): Period {
  const { year, month, day } = calendarDayInZone(date, timezone);
  const zonedMidnight = new TZDate(year, month - 1, day, 0, 0, 0, 0, timezone);
  // getDay(): 0 = Sonntag … 6 = Samstag → Montag als Wochenstart.
  const offsetToMonday = (zonedMidnight.getDay() + 6) % 7;
  const mondayUtcRef = addDays(new Date(Date.UTC(year, month - 1, day)), -offsetToMonday);
  const start = zonedWallTimeToUtc(
    mondayUtcRef.getUTCFullYear(),
    mondayUtcRef.getUTCMonth() + 1,
    mondayUtcRef.getUTCDate(),
    '00:00',
    timezone,
  );
  const nextMonday = addDays(mondayUtcRef, 7);
  const end = zonedWallTimeToUtc(
    nextMonday.getUTCFullYear(),
    nextMonday.getUTCMonth() + 1,
    nextMonday.getUTCDate(),
    '00:00',
    timezone,
  );
  return { start, end };
}

/** ISO-Wochentag (1 = Montag … 7 = Sonntag) eines UTC-Zeitpunkts in einer Zeitzone. */
export function isoWeekdayInZone(date: Date, timezone: string): number {
  const zoned = new TZDate(date, timezone);
  return ((zoned.getDay() + 6) % 7) + 1;
}

/** Minuten seit Mitternacht (Wandtzeit) eines UTC-Zeitpunkts in einer Zeitzone. */
export function minutesOfDayInZone(date: Date, timezone: string): number {
  const zoned = new TZDate(date, timezone);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

// ---------------------------------------------------------------------------
// Anzeige-Formatierung (de-DE Standard)
// ---------------------------------------------------------------------------

export function formatDate(
  date: Date,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatDateShort(
  date: Date,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

export function formatWeekday(
  date: Date,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'long' }).format(date);
}

export function formatTime(
  date: Date,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateTime(
  date: Date,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE,
): string {
  return `${formatDate(date, timezone, locale)}, ${formatTime(date, timezone, locale)}`;
}

/** "22.07.2026" → als Eingabewert für <input type="date">: "2026-07-22". */
export function toDateInputValue(date: Date, timezone: string = DEFAULT_TIMEZONE): string {
  const { year, month, day } = calendarDayInZone(date, timezone);
  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

/** "2026-07-22" (aus <input type="date">) → UTC-Mitternacht. */
export function fromDateInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = utcDate(Number(y), Number(m), Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}
