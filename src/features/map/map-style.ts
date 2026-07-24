'use client';

import * as React from 'react';

/**
 * Kartendarstellung als persönliche Einstellung (Einstellungen → Darstellung).
 *
 * Die Wahl liegt im localStorage des Geräts – wie das Farbschema ist sie
 * Geschmackssache der Person, nicht der Organisation. `auto` folgt dem
 * App-Design (hell/dunkel); die übrigen Stile sind feste Vorgaben, `custom`
 * erlaubt einen eigenen Mapbox-Stil („username/style-id“). Die Kacheln laufen
 * weiterhin über den Server-Proxy – Schlüssel bleiben serverseitig.
 */

export type MapStyleId = 'auto' | 'light' | 'dark' | 'streets' | 'satellite' | 'custom';

export const MAP_STYLE_OPTIONS: { value: MapStyleId; label: string; hint: string }[] = [
  { value: 'auto', label: 'Automatisch', hint: 'folgt dem App-Design' },
  { value: 'light', label: 'Hell (dezent)', hint: 'zurückhaltende Basiskarte' },
  { value: 'dark', label: 'Dunkel (dezent)', hint: 'dunkle Basiskarte' },
  { value: 'streets', label: 'Straßen', hint: 'klassische Straßenkarte' },
  { value: 'satellite', label: 'Satellit', hint: 'Luftbild mit Straßen' },
  { value: 'custom', label: 'Eigener Stil', hint: 'eigener Mapbox-Stil' },
];

const STYLE_KEY = 'hcp.map.style';
const CUSTOM_REF_KEY = 'hcp.map.customRef';

/** „mapbox://styles/user/id“, vollständige Studio-URL oder direkt „user/id“ → „user/id“. */
export function normalizeCustomStyleRef(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match =
    /^mapbox:\/\/styles\/([\w.-]+)\/([\w.-]+)$/i.exec(trimmed) ??
    /^https?:\/\/(?:api|studio)\.mapbox\.com\/styles(?:\/v1)?\/([\w.-]+)\/([\w.-]+)/i.exec(trimmed) ??
    /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

function usePersistedString(key: string, fallback: string) {
  const subscribe = React.useCallback((onStoreChange: () => void) => {
    const handler = (event: StorageEvent) => {
      if (event.key === null || event.key === key) onStoreChange();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key]);

  const getSnapshot = React.useCallback(() => {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }, [key, fallback]);

  const getServerSnapshot = React.useCallback(() => fallback, [fallback]);
  const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = React.useCallback(
    (next: string) => {
      try {
        window.localStorage.setItem(key, next);
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

const STYLE_IDS: readonly string[] = ['auto', 'light', 'dark', 'streets', 'satellite', 'custom'];

export function useMapStyle() {
  const [rawStyle, setRawStyle] = usePersistedString(STYLE_KEY, 'auto');
  const [customRef, setCustomRef] = usePersistedString(CUSTOM_REF_KEY, '');
  const style: MapStyleId = STYLE_IDS.includes(rawStyle) ? (rawStyle as MapStyleId) : 'auto';
  return {
    style,
    customRef,
    setStyle: (next: MapStyleId) => setRawStyle(next),
    setCustomRef,
  };
}
