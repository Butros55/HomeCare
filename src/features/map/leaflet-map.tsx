'use client';

import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';

import { useTheme } from '@/components/layout/theme-provider';
import { routeWeightPx, useMapSettings } from '@/features/map/map-style';
import { tileConfiguration, type MapTheme } from '@/lib/map-tiles';

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

/**
 * Aufgelöster Hell/Dunkel-Modus. Der Theme-Provider kennt nur die Präferenz –
 * bei „System" entscheidet die Medienabfrage, inklusive Live-Wechsel.
 */
function useResolvedTheme(): MapTheme {
  const { theme } = useTheme();
  const [systemDark, setSystemDark] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(query.matches);
    const initial = window.requestAnimationFrame(update);
    query.addEventListener('change', update);
    return () => {
      window.cancelAnimationFrame(initial);
      query.removeEventListener('change', update);
    };
  }, []);

  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return systemDark ? 'dark' : 'light';
}

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

export interface MapCircle {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  color?: string;
}

function FitBounds({
  markers,
  path,
  circle,
}: {
  markers: MapMarker[];
  path?: [number, number][];
  circle?: MapCircle;
}) {
  const map = useMap();
  React.useEffect(() => {
    // Ein Umkreis bestimmt den Ausschnitt (auch ohne weitere Marker).
    if (circle) {
      const bounds = L.latLng(circle.latitude, circle.longitude).toBounds(circle.radiusMeters * 2);
      const withMarkers = markers.reduce(
        (acc, m) => acc.extend([m.latitude, m.longitude]),
        L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast()),
      );
      map.fitBounds(withMarkers, { padding: [28, 28] });
      return;
    }
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
  }, [map, markers, path, circle]);
  return null;
}

/**
 * Karte an ihre Containergröße anpassen. Die Routen-Ansicht gibt der Karte eine
 * flexible Höhe (die Sticky-Spalte richtet sich nach der Fensterhöhe, damit
 * Karte und Kennzahlen immer zusammen in die Ansicht passen). Ändert sich diese
 * Höhe, muss Leaflet neu vermessen – sonst bleiben nach dem Verkleinern oder
 * Vergrößern graue Kachelränder stehen.
 */
function InvalidateOnResize() {
  const map = useMap();
  React.useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export function LeafletMap({
  markers,
  polyline,
  roadPath,
  loadingRoad = false,
  circle,
}: {
  markers: MapMarker[];
  /**
   * Stopp-Reihenfolge (Luftlinie) – wird NICHT mehr als Linie gezeichnet
   * (keine irreführende Fluglinie), dient nur noch dem Kartenausschnitt, solange
   * die echte Strecke lädt.
   */
  polyline?: [number, number][];
  /** Tatsächlich zu fahrende Strecke (Straßenverlauf) – das einzige gezeichnete Wegband. */
  roadPath?: [number, number][];
  /** Strecke wird gerade geladen → subtiler Ladehinweis statt Fluglinie. */
  loadingRoad?: boolean;
  /** Umkreis (z. B. Zuständigkeitsgebiet). */
  circle?: MapCircle;
}) {
  const center: [number, number] =
    markers.length > 0 ? [markers[0]!.latitude, markers[0]!.longitude] : [51.9607, 7.6261];
  const hasRoad = Boolean(roadPath && roadPath.length > 1);
  const mapTheme = useResolvedTheme();
  // Persönliche Kartendarstellung (Einstellungen → Darstellung) – wirkt sofort.
  const { settings } = useMapSettings();
  const tiles = tileConfiguration(mapTheme, { style: settings.style, labels: settings.labels });
  const routeColor = settings.routeColor;
  const routeWeight = routeWeightPx(settings.routeWeight);

  return (
    <div className="relative h-full w-full">
    <MapContainer
      center={center}
      zoom={13}
      className="h-full w-full"
      scrollWheelZoom={false}
      attributionControl
    >
      {/* key: erzwingt den Austausch der Ebene beim Theme-Wechsel. */}
      <TileLayer
        key={tiles.url}
        url={tiles.url}
        attribution={tiles.attribution}
        maxZoom={tiles.maxZoom}
        detectRetina
        {...(tiles.subdomains ? { subdomains: tiles.subdomains } : {})}
      />

      {/* Echte Fahrstrecke: breite helle Kontur unter der farbigen Linie,
          damit sie auf jedem Kartenhintergrund lesbar bleibt. Farbe und
          Stärke kommen aus der persönlichen Kartendarstellung. */}
      {hasRoad ? (
        <>
          <Polyline
            positions={roadPath!}
            pathOptions={{
              color: '#ffffff',
              weight: routeWeight + 4,
              opacity: 0.9,
              lineJoin: 'round',
            }}
          />
          <Polyline
            positions={roadPath!}
            pathOptions={{ color: routeColor, weight: routeWeight, opacity: 0.95, lineJoin: 'round' }}
          />
        </>
      ) : null}
      {circle ? (
        <Circle
          center={[circle.latitude, circle.longitude]}
          radius={circle.radiusMeters}
          pathOptions={{
            color: circle.color ?? '#6c5ce7',
            weight: 2,
            opacity: 0.9,
            fillColor: circle.color ?? '#6c5ce7',
            fillOpacity: 0.12,
          }}
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
      <FitBounds markers={markers} path={hasRoad ? roadPath : polyline} circle={circle} />
      <InvalidateOnResize />
    </MapContainer>
      {/* Subtiler Ladehinweis, solange die echte Strecke berechnet wird –
          statt kurz die (irreführende) Fluglinie aufflackern zu lassen. */}
      {loadingRoad && !hasRoad ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-[500] flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-subtle)] bg-[color-mix(in_srgb,var(--color-panel)_90%,transparent)] px-2.5 py-1 text-[length:var(--text-2xs)] text-[var(--color-ink-muted)] shadow-[var(--shadow-panel)] backdrop-blur">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Strecke wird berechnet…
          </span>
        </div>
      ) : null}
    </div>
  );
}
