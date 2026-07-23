/**
 * Gemeinsame Theme-Konstanten für Server (Root-Layout liest das Cookie) und
 * Client (Provider schreibt Cookie + localStorage). Bewusst ohne 'use client',
 * damit beide Seiten importieren können.
 *
 * Modell ohne Init-Script: Die Farbtokens sind mit CSS `light-dark()` definiert
 * und folgen `color-scheme` am <html>. Explizite Wahl (hell/dunkel) landet als
 * `data-theme`-Attribut bereits im Server-HTML (Cookie), Systemmodus kommt ganz
 * ohne Attribut aus – dadurch gibt es weder Theme-Flackern noch ein <script>
 * im React-Baum (React 19 meldet client-gerenderte Scripts als Dev-Fehler).
 */

export type ThemePreference = 'light' | 'dark' | 'system';

/** localStorage-Schlüssel (Alt-Bestand; bleibt für Migration/Robustheit). */
export const THEME_STORAGE_KEY = 'hcp.theme';

/** Cookie mit der Präferenz – vom Server fürs erste Paint gelesen. */
export const THEME_COOKIE_NAME = 'hcp-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}
