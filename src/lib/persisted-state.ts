'use client';

import * as React from 'react';

/**
 * Boolean-State, der in localStorage überlebt (z. B. eingeklappte Sidebar).
 * useSyncExternalStore: SSR liefert den Fallback, der Client liest den
 * gespeicherten Wert nach der Hydration – ohne setState-im-Effect.
 */
export function usePersistedBoolean(key: string, fallback: boolean) {
  const subscribe = React.useCallback((onStoreChange: () => void) => {
    const handler = (event: StorageEvent) => {
      if (event.key === null || event.key === key) onStoreChange();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key]);

  const getSnapshot = React.useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === 'true';
    } catch {
      return fallback;
    }
  }, [key, fallback]);

  const getServerSnapshot = React.useCallback(() => fallback, [fallback]);

  const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = React.useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, String(next));
        // storage-Events feuern nur tab-übergreifend – lokal manuell auslösen.
        window.dispatchEvent(new StorageEvent('storage', { key }));
      } catch {
        // localStorage nicht verfügbar (Private Mode) – ohne Persistenz weiter.
      }
    },
    [key],
  );

  return [value, update] as const;
}
