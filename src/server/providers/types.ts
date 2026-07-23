import type { LatLng, StructuredLocation } from '@/lib/geo';

/**
 * Provider-Abstraktion für Karten, Geocoding und Routing (Anforderung 16).
 * Konfiguration ausschließlich serverseitig über Umgebungsvariablen –
 * API-Schlüssel erreichen niemals den Client.
 */

export interface GeocodingCandidate {
  latitude: number;
  longitude: number;
  /** Anzeigename des Treffers (z. B. normalisierte Adresse). */
  displayName: string;
  /** exact | interpolated | approximate */
  quality: 'exact' | 'interpolated' | 'approximate';
}

export interface GeocodeQuery {
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  countryCode: string;
}

/** Vorschlag der Adress-Autovervollständigung (füllt Formularfelder + Koordinate). */
export interface AddressSuggestion {
  /** Anzeigetext, z. B. "Warendorfer Straße 85, 48145 Münster". */
  label: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

export interface GeocodingProvider {
  readonly name: string;
  /** Liefert 0..n Kandidaten; >1 gleichwertige = mehrdeutig (Auswahl im UI). */
  geocodeAddress(query: GeocodeQuery): Promise<GeocodingCandidate[]>;
  reverseGeocode(position: LatLng): Promise<string | null>;
  /** Autocomplete während der Eingabe ("Warendorfer 8…" → Vorschläge). */
  suggestAddresses(query: string): Promise<AddressSuggestion[]>;
}

export interface RouteLeg {
  travelSeconds: number;
  distanceMeters: number;
}

export interface RoutingProvider {
  readonly name: string;
  /** Fahrzeit/Distanz für eine Punktfolge (n-1 Legs). */
  computeRoute(points: LatLng[]): Promise<RouteLeg[]>;
  /** Vollständige Matrix zwischen allen Punkten (matrix[i][j] = i → j). */
  computeRouteMatrix(points: LatLng[]): Promise<RouteLeg[][]>;
}

export interface MapProvider {
  readonly name: string;
  /** Konfiguration für die eingebettete Leaflet-Karte (Tiles, Attribution). */
  getEmbedConfiguration(): { tileUrl: string; attribution: string; maxZoom: number };
  /** Externe Navigations-URL (Google-Maps-Deep-Link). */
  getNavigationUrl(destination: LatLng | string): string;
}

export type { LatLng, StructuredLocation };
