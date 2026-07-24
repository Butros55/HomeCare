'use client';

import * as React from 'react';

/**
 * Kartendarstellung als persönliche Einstellung (Einstellungen → Darstellung).
 *
 * Die Wahl liegt im localStorage des Geräts – wie das Farbschema ist sie
 * Geschmackssache der Person, nicht der Organisation. `auto` folgt dem
 * App-Design (hell/dunkel). Zusätzlich zur Grundkarte sind Beschriftungen und
 * die Routenlinie (Farbe, Stärke) einstellbar – alles wirkt sofort auf jede
 * Karte in der Anwendung. Die Kacheln laufen weiterhin über den Server-Proxy,
 * Schlüssel bleiben serverseitig.
 */

export type MapStyleId = 'auto' | 'light' | 'dark' | 'streets' | 'outdoors' | 'satellite';

export const MAP_STYLE_OPTIONS: { value: MapStyleId; label: string; hint: string }[] = [
  { value: 'auto', label: 'Automatisch', hint: 'folgt dem App-Design' },
  { value: 'light', label: 'Hell', hint: 'dezente helle Basiskarte' },
  { value: 'dark', label: 'Dunkel', hint: 'dezente dunkle Basiskarte' },
  { value: 'streets', label: 'Straßen', hint: 'klassische Straßenkarte' },
  { value: 'outdoors', label: 'Gelände', hint: 'Gelände und Wege' },
  { value: 'satellite', label: 'Satellit', hint: 'Luftbild' },
];

/** Farbwahl für die Routenlinie – Standard ist die Markenfarbe. */
export const ROUTE_COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: '#6c5ce7', label: 'Lila (Standard)' },
  { value: '#3e6de0', label: 'Blau' },
  { value: '#0ea5a3', label: 'Türkis' },
  { value: '#10b981', label: 'Grün' },
  { value: '#f59e0b', label: 'Orange' },
  { value: '#f43f5e', label: 'Rot' },
  { value: '#111827', label: 'Schwarz' },
];

export type RouteWeightId = 'thin' | 'normal' | 'bold';

export const ROUTE_WEIGHT_OPTIONS: { value: RouteWeightId; label: string; weight: number }[] = [
  { value: 'thin', label: 'Schmal', weight: 3.5 },
  { value: 'normal', label: 'Normal', weight: 5 },
  { value: 'bold', label: 'Kräftig', weight: 7 },
];

export interface MapSettings {
  style: MapStyleId;
  /** Ortsnamen/Beschriftungen auf der Karte anzeigen. */
  labels: boolean;
  routeColor: string;
  routeWeight: RouteWeightId;
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  style: 'auto',
  labels: true,
  routeColor: '#6c5ce7',
  routeWeight: 'normal',
};

const STYLE_KEY = 'hcp.map.style';
const LABELS_KEY = 'hcp.map.labels';
const ROUTE_COLOR_KEY = 'hcp.map.routeColor';
const ROUTE_WEIGHT_KEY = 'hcp.map.routeWeight';

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

const STYLE_IDS: readonly string[] = ['auto', 'light', 'dark', 'streets', 'outdoors', 'satellite'];
const WEIGHT_IDS: readonly string[] = ['thin', 'normal', 'bold'];
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function useMapSettings() {
  const [rawStyle, setRawStyle] = usePersistedString(STYLE_KEY, DEFAULT_MAP_SETTINGS.style);
  const [rawLabels, setRawLabels] = usePersistedString(LABELS_KEY, 'true');
  const [rawColor, setRawColor] = usePersistedString(ROUTE_COLOR_KEY, DEFAULT_MAP_SETTINGS.routeColor);
  const [rawWeight, setRawWeight] = usePersistedString(
    ROUTE_WEIGHT_KEY,
    DEFAULT_MAP_SETTINGS.routeWeight,
  );

  // Unbekannte/alte Werte (z. B. entferntes „custom") fallen still auf den Standard.
  const settings: MapSettings = {
    style: STYLE_IDS.includes(rawStyle) ? (rawStyle as MapStyleId) : 'auto',
    labels: rawLabels !== 'false',
    routeColor: COLOR_PATTERN.test(rawColor) ? rawColor : DEFAULT_MAP_SETTINGS.routeColor,
    routeWeight: WEIGHT_IDS.includes(rawWeight) ? (rawWeight as RouteWeightId) : 'normal',
  };

  return {
    settings,
    setStyle: (next: MapStyleId) => setRawStyle(next),
    setLabels: (next: boolean) => setRawLabels(String(next)),
    setRouteColor: (next: string) => setRawColor(next),
    setRouteWeight: (next: RouteWeightId) => setRawWeight(next),
  };
}

/** Linienstärke in Pixeln für die gewählte Stufe. */
export function routeWeightPx(weight: RouteWeightId): number {
  return ROUTE_WEIGHT_OPTIONS.find((option) => option.value === weight)?.weight ?? 5;
}
