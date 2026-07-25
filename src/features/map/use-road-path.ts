'use client';

import * as React from 'react';

import { getRoutePathAction } from '@/server/actions/route-actions';

/**
 * Lädt die tatsächliche Fahrstrecke (Straßenverlauf) zu einer Stopp-Reihenfolge
 * und meldet, solange sie berechnet wird. So zeigt die Karte einen subtilen
 * Ladehinweis statt kurz die (irreführende) Fluglinie aufflackern zu lassen.
 *
 * `roadPath` ist nur gesetzt, wenn ein echter Straßenverlauf vorliegt und zur
 * aktuellen Punktfolge passt; ansonsten `undefined` (dann keine Linie).
 */
export function useRoadPath(polyline: [number, number][]): {
  roadPath: [number, number][] | undefined;
  loadingRoad: boolean;
} {
  const pathKey = React.useMemo(
    () => polyline.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(';'),
    [polyline],
  );
  const [state, setState] = React.useState<{
    key: string;
    coordinates: [number, number][];
    road: boolean;
  } | null>(null);

  React.useEffect(() => {
    if (polyline.length < 2) return;
    let cancelled = false;
    const points = polyline.map(([latitude, longitude]) => ({ latitude, longitude }));
    getRoutePathAction({ points }).then((result) => {
      if (cancelled || !result.ok) return;
      setState({ key: pathKey, coordinates: result.data.coordinates, road: result.data.road });
    });
    return () => {
      cancelled = true;
    };
  }, [pathKey, polyline]);

  const resolved = state && state.key === pathKey;
  return {
    roadPath: resolved && state!.road ? state!.coordinates : undefined,
    loadingRoad: polyline.length > 1 && !resolved,
  };
}
