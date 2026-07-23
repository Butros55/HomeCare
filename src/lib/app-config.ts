/**
 * Zentrale Anwendungskonfiguration.
 *
 * Der Produktname ist bewusst konfigurierbar (Arbeitsname "HomeCare Planner").
 * Serverseitig gilt APP_NAME, im Client NEXT_PUBLIC_APP_NAME.
 */
export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? 'HomeCare Planner';

export const APP_SHORT_NAME = APP_NAME.split(/\s+/)[0] ?? 'HomeCare';

/** Basis-URL für absolute Links (Einladungen, Passwort-Reset, Benachrichtigungen). */
export const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export const DEFAULT_TIMEZONE = 'Europe/Berlin';
export const DEFAULT_LOCALE = 'de-DE';

/** Materialisierungshorizont für Serientermine (Tage im Voraus). */
export const SERIES_MATERIALIZATION_DAYS = 120;
