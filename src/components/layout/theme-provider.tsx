'use client';

/**
 * Leichter Theme-Provider (hell / dunkel / system) ohne Init-Script.
 *
 * Arbeitsteilung:
 *  - CSS: Alle Farbtokens sind `light-dark()`-Werte und folgen `color-scheme`.
 *    Ohne `data-theme`-Attribut gilt `color-scheme: light dark` → das System
 *    entscheidet (inkl. Live-Wechsel des OS-Themes, ganz ohne JS-Listener).
 *  - Server: Das Root-Layout liest das Präferenz-Cookie und rendert bei
 *    expliziter Wahl `data-theme` direkt ins HTML → korrektes erstes Paint.
 *  - Client (hier): verwaltet nur noch die Präferenz, setzt/entfernt das
 *    Attribut bei Umschaltung und persistiert Cookie + localStorage.
 *
 * Hintergrund: Ein <script> im React-Baum (next-themes-Ansatz) meldet React 19
 * im Dev-Modus als Fehler – deshalb kommt dieses Setup ohne Script aus.
 * API bleibt kompatibel: useTheme() → { theme, setTheme }.
 */

import * as React from 'react';

import {
  isThemePreference,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@/lib/theme';

export type { ThemePreference };
export { THEME_STORAGE_KEY };

interface ThemeContextValue {
  /** Gewählte Präferenz (nicht der aufgelöste Modus). */
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return React.useContext(ThemeContext);
}

function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === 'system') {
    // Kein Attribut = `color-scheme: light dark` → OS entscheidet (auch live).
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }
}

function persistTheme(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* localStorage gesperrt → Cookie reicht */
  }
  try {
    document.cookie = `${THEME_COOKIE_NAME}=${preference}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* ignorieren */
  }
}

function readStoredPreference(): ThemePreference | null {
  try {
    const cookieMatch = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${THEME_COOKIE_NAME}=`));
    const fromCookie = cookieMatch?.slice(THEME_COOKIE_NAME.length + 1);
    if (isThemePreference(fromCookie)) return fromCookie;
  } catch {
    /* ignorieren */
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    /* ignorieren */
  }
  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemePreference>('system');

  // Gespeicherte Präferenz übernehmen (das Server-HTML trägt das Attribut für
  // explizite Wahl bereits). Abgleich im nächsten Frame, damit kein synchroner
  // setState im Effect-Body läuft; migriert Alt-Bestand aus localStorage ins Cookie.
  React.useEffect(() => {
    let raf = 0;
    raf = window.requestAnimationFrame(() => {
      const stored = readStoredPreference();
      if (stored) {
        setThemeState(stored);
        applyTheme(stored);
        persistTheme(stored);
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const setTheme = React.useCallback((next: ThemePreference) => {
    setThemeState(next);
    persistTheme(next);
    applyTheme(next);
  }, []);

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
