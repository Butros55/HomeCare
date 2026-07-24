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

/**
 * Der Proxy entscheidet serverseitig, ob Mapbox verfügbar ist – der Client
 * kennt weder Token noch Anbieter.
 */
const PROXY_TILES: Record<MapTheme, string> = {
  light: '/api/map/tiles/light/{z}/{x}/{y}{r}',
  dark: '/api/map/tiles/dark/{z}/{x}/{y}{r}',
};

/** Persönliche Kartendarstellung (Einstellungen → Darstellung). */
export interface MapStylePreference {
  style: 'auto' | 'light' | 'dark' | 'streets' | 'satellite' | 'custom';
  /** Nur für `custom`: Mapbox-Stil als „username/style-id“. */
  customRef?: string | null;
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

  // Eigener Mapbox-Stil: die Referenz wandert als geprüfter Query-Parameter
  // zum Proxy – der Schlüssel bleibt serverseitig.
  if (style === 'custom' && preference?.customRef) {
    return {
      url: `/api/map/tiles/custom/{z}/{x}/{y}{r}?ref=${encodeURIComponent(preference.customRef)}`,
      attribution: MAPBOX_ATTRIBUTION,
      maxZoom: 20,
    };
  }
  if (style === 'streets' || style === 'satellite') {
    return {
      url: `/api/map/tiles/${style}/{z}/{x}/{y}{r}`,
      attribution: style === 'satellite' ? SATELLITE_ATTRIBUTION : MAPBOX_ATTRIBUTION,
      maxZoom: 20,
    };
  }
  const resolved: MapTheme = style === 'light' || style === 'dark' ? style : theme;

  // Ohne eigenen Tile-Server läuft alles über den Proxy: Er liefert Mapbox,
  // wenn ein Token hinterlegt ist, und verweist sonst direkt auf CARTO.
  return {
    url: PROXY_TILES[resolved],
    attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? CARTO_ATTRIBUTION,
    maxZoom: 20,
  };
}

/** Zoomstufen, die die Anbieter tatsächlich ausliefern. */
export const MAX_TILE_ZOOM = 20;
export const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;
export { CARTO_ATTRIBUTION, OSM_ATTRIBUTION };
