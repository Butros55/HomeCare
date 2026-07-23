'use client';

import dynamic from 'next/dynamic';
import * as React from 'react';

import { Skeleton } from '@/components/ui/misc';

/**
 * Kundenkarte (Leaflet). Wird clientseitig nachgeladen – Leaflet kann nicht
 * serverseitig rendern. Tile-Provider ist konfigurierbar (Anforderung 16);
 * Standard sind OSM-Tiles (nur für Entwicklung, siehe docs/routing.md).
 */
const LeafletMap = dynamic(() => import('./leaflet-map').then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[var(--radius-lg)]" />,
});

export function CustomerLocationMap({
  latitude,
  longitude,
  label,
  color,
  addressLine,
  tall = false,
}: {
  latitude: number | null;
  longitude: number | null;
  label: string;
  color?: string | null;
  addressLine?: string | null;
  tall?: boolean;
}) {
  const height = tall ? 'h-96' : 'h-56';
  if (latitude == null || longitude == null) {
    return (
      <div
        className={`flex ${height} items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-panel-sunken)] p-4 text-center text-[length:var(--text-sm)] text-[var(--color-ink-muted)]`}
      >
        Keine Koordinaten vorhanden – Adresse speichern, um sie zu geokodieren.
      </div>
    );
  }
  return (
    <div className={`${height} overflow-hidden rounded-[var(--radius-lg)]`}>
      <LeafletMap
        markers={[{ id: 'customer', latitude, longitude, label, color: color ?? '#6c5ce7', subtitle: addressLine ?? undefined }]}
      />
    </div>
  );
}
