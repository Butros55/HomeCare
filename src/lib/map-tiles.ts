/**
 * Kartenkacheln – hell/dunkel passend zum App-Theme.
 *
 * Die Standard-OSM-Kacheln sind bunt und knallhell; im dunklen UI wirkt die
 * Karte dadurch wie ein Fremdkörper. Deshalb:
 *
 *  - Standard sind die zurückhaltenden CARTO-Basiskarten (Positron hell,
 *    Dark Matter dunkel). Sie brauchen **keinen Schlüssel** und passen zur
 *    Oberfläche.
 *  - Liegt ein Mapbox-Token vor, laufen die Kacheln über
 *    `/api/map/tiles/…` – der Schlüssel bleibt dabei serverseitig, er landet
 *    nie im Client-Bundle (siehe docs/routing.md).
 *  - `NEXT_PUBLIC_MAP_TILE_URL` überschreibt weiterhin alles (eigener
 *    Tile-Server).
 */

export type MapTheme = 'light' | 'dark';

export interface TileConfiguration {
  url: string;
  attribution: string;
  /** Nur für Direktabrufe bei CARTO nötig. */
  subdomains?: string;
  maxZoom: number;
}

const OSM_ATTRIBUTION = '&copy; OpenStreetMap-Mitwirkende';

/** CARTO-Basiskarten: frei nutzbar, dezent, in hell und dunkel verfügbar. */
export const CARTO_TILES: Record<MapTheme, string> = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; CARTO`;

/** Persönliche Kartendarstellung (Einstellungen → Darstellung). */
export interface MapStylePreference {
  style: 'auto' | 'light' | 'dark' | 'streets' | 'outdoors' | 'satellite';
  /** Beschriftungen anzeigen (Standard: ja). */
  labels?: boolean;
}

const MAPBOX_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; CARTO &copy; Mapbox`;
const SATELLITE_ATTRIBUTION = '&copy; Mapbox &copy; Maxar / Esri';

export function tileConfiguration(
  theme: MapTheme,
  preference?: MapStylePreference,
): TileConfiguration {
  const override = process.env.NEXT_PUBLIC_MAP_TILE_URL;
  if (override) {
    return {
      url: override,
      attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? OSM_ATTRIBUTION,
      maxZoom: 19,
      subdomains: 'abc',
    };
  }

  const style = preference?.style ?? 'auto';
  const resolved = style === 'auto' ? theme : style;
  // Beschriftungen aus? Der Proxy wählt dann die passende „nolabels“-Variante.
  const labelsQuery = preference?.labels === false ? '?labels=0' : '';

  // Ohne eigenen Tile-Server läuft alles über den Proxy: Er liefert Mapbox,
  // wenn ein Token hinterlegt ist, und verweist sonst auf freie Kartenquellen.
  return {
    url: `/api/map/tiles/${resolved}/{z}/{x}/{y}{r}${labelsQuery}`,
    attribution:
      resolved === 'satellite'
        ? SATELLITE_ATTRIBUTION
        : resolved === 'streets' || resolved === 'outdoors'
          ? MAPBOX_ATTRIBUTION
          : (process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? CARTO_ATTRIBUTION),
    maxZoom: 20,
  };
}

/** Zoomstufen, die die Anbieter tatsächlich ausliefern. */
export const MAX_TILE_ZOOM = 20;
export const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;
export { CARTO_ATTRIBUTION, OSM_ATTRIBUTION };
