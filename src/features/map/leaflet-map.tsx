'use client';

import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import * as React from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  subtitle?: string;
  color: string;
  /** Nummer im Pin (Routen-Stopps). */
  sequence?: number;
}

const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? '&copy; OpenStreetMap-Mitwirkende';

/** Farbiger Punkt-/Nummern-Pin als DivIcon (keine Bild-Assets nötig). */
function markerIcon(color: string, sequence?: number): L.DivIcon {
  const inner =
    sequence != null
      ? `<span style="color:#fff;font:600 11px/1 system-ui">${sequence}</span>`
      : '';
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgb(0 0 0/.35)">${inner}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

function FitBounds({ markers, path }: { markers: MapMarker[]; path?: [number, number][] }) {
  const map = useMap();
  React.useEffect(() => {
    if (markers.length === 0) return;
    if (markers.length === 1 && !path?.length) {
      map.setView([markers[0]!.latitude, markers[0]!.longitude], 15);
      return;
    }
    // Die Strecke kann über die Stopps hinausragen (Umwege, Auffahrten).
    const points: [number, number][] = [
      ...markers.map((m) => [m.latitude, m.longitude] as [number, number]),
      ...(path ?? []),
    ];
    map.fitBounds(L.latLngBounds(points), { padding: [28, 28] });
  }, [map, markers, path]);
  return null;
}

export function LeafletMap({
  markers,
  polyline,
  roadPath,
}: {
  markers: MapMarker[];
  /** Luftlinie zwischen den Stopps – Ersatz, solange keine Strecke vorliegt. */
  polyline?: [number, number][];
  /** Tatsächlich zu fahrende Strecke (Straßenverlauf) – hat Vorrang. */
  roadPath?: [number, number][];
}) {
  const center: [number, number] =
    markers.length > 0 ? [markers[0]!.latitude, markers[0]!.longitude] : [51.9607, 7.6261];
  const hasRoad = Boolean(roadPath && roadPath.length > 1);

  return (
    <MapContainer
      center={center}
      zoom={13}
      className="h-full w-full"
      scrollWheelZoom={false}
      attributionControl
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />

      {/* Echte Fahrstrecke: breite helle Kontur unter der farbigen Linie,
          damit sie auf jedem Kartenhintergrund lesbar bleibt. */}
      {hasRoad ? (
        <>
          <Polyline
            positions={roadPath!}
            pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9, lineJoin: 'round' }}
          />
          <Polyline
            positions={roadPath!}
            pathOptions={{ color: '#6c5ce7', weight: 5, opacity: 0.95, lineJoin: 'round' }}
          />
        </>
      ) : polyline && polyline.length > 1 ? (
        <Polyline
          positions={polyline}
          pathOptions={{ color: '#6c5ce7', weight: 3, opacity: 0.7, dashArray: '6 8' }}
        />
      ) : null}
      {markers.map((marker) => (
        <Marker
          key={marker.id}
          position={[marker.latitude, marker.longitude]}
          icon={markerIcon(marker.color, marker.sequence)}
        >
          <Popup>
            <strong>{marker.label}</strong>
            {marker.subtitle ? (
              <>
                <br />
                {marker.subtitle}
              </>
            ) : null}
          </Popup>
        </Marker>
      ))}
      <FitBounds markers={markers} path={hasRoad ? roadPath : polyline} />
    </MapContainer>
  );
}
