'use client';

/**
 * Leichter Theme-Provider (ersetzt next-themes): hell / dunkel / system über
 * `data-theme` am <html>. Das Init-Script im Root-Layout setzt das Attribut
 * vor der Hydration (kein Flackern); hier läuft nur noch die Umschaltung und
 * der matchMedia-Listener für den Systemmodus.
 *
 * Hintergrund des Wechsels: next-themes rendert ein <script> innerhalb einer
 * React-Komponente, was React 19.2 im Dev-Modus als Fehler meldet (und damit
 * das Next-Overlay öffnet). API bleibt kompatibel: useTheme() → { theme, setTheme }.
 */

import * as React from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'hcp.theme';

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

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(preference: ThemePreference) {
  const resolved = preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference;
  document.documentElement.setAttribute('data-theme', resolved);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemePreference>('system');

  // Gespeicherte Präferenz übernehmen (das Init-Script hat data-theme schon
  // gesetzt). useSyncExternalStore-frei, aber ohne synchronen setState im
  // Effect-Body: der Abgleich läuft im nächsten Frame.
  React.useEffect(() => {
    let raf = 0;
    raf = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setThemeState(stored);
        }
      } catch {
        /* localStorage gesperrt → Systemmodus */
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  // Systemmodus folgt Änderungen des OS-Themes live.
  React.useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = React.useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignorieren */
    }
    applyTheme(next);
  }, []);

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Inline-Init (als String ins Server-HTML): setzt data-theme vor der Hydration,
 * damit die erste Farbe stimmt und nichts flackert.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
