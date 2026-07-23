/**
 * Geografie-Helfer (rein, unit-getestet in geo.test.ts).
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Strukturierter Standort (Org-/Mitarbeiter-Start & -Ziel, Routenpunkte). */
export interface StructuredLocation {
  label?: string;
  street?: string;
  houseNumber?: string;
  addressAddition?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

/** Großkreisdistanz (Haversine) in Metern. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h)));
}

/**
 * Fahrzeitschätzung für den Mock-Routing-Provider: Luftlinie × Umwegfaktor 1,3
 * bei ~30 km/h Stadtverkehr, plus 60 s fixe Rüstzeit (Parken etc.).
 * Deterministisch – Grundlage aller Tests ohne externe API.
 */
export function estimateTravelSeconds(a: LatLng, b: LatLng): number {
  const distance = haversineMeters(a, b) * 1.3;
  const speedMetersPerSecond = 30_000 / 3600;
  return Math.round(distance / speedMetersPerSecond) + 60;
}

/** Straßendistanz-Schätzung passend zu estimateTravelSeconds. */
export function estimateDistanceMeters(a: LatLng, b: LatLng): number {
  return Math.round(haversineMeters(a, b) * 1.3);
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;
}

export function formatTravelSeconds(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

/** Einzeilige Adresse aus einem strukturierten Standort (null-tolerant für DB-Zeilen). */
export function formatLocationLine(
  location:
    | {
        street?: string | null;
        houseNumber?: string | null;
        postalCode?: string | null;
        city?: string | null;
      }
    | null
    | undefined,
): string {
  if (!location) return '';
  const parts: string[] = [];
  const street = [location.street, location.houseNumber].filter(Boolean).join(' ');
  if (street) parts.push(street);
  const city = [location.postalCode, location.city].filter(Boolean).join(' ');
  if (city) parts.push(city);
  return parts.join(', ');
}

/**
 * Zerlegt eine Adresssuche-Eingabe in Straße und optionale Hausnummer.
 * "Warendorfer Straße 85" → { street: "Warendorfer Straße", houseNumber: "85" }.
 * Text nach einem Komma (z. B. Ort) wird für die Straßensuche ignoriert.
 */
export function parseAddressQuery(query: string): { street: string; houseNumber: string } {
  const firstSegment = (query.split(',')[0] ?? '').trim();
  const match = /^(.*?)\s+(\d{1,4}\s?[a-zA-Z]?)$/.exec(firstSegment);
  if (match) {
    return { street: match[1]!.trim(), houseNumber: match[2]!.replace(/\s+/g, '') };
  }
  return { street: firstSegment, houseNumber: '' };
}

/** Google-Maps-Navigations-URL (öffnet mobil die App, am Desktop einen Tab). */
export function googleMapsDirectionsUrl(destination: LatLng | string): string {
  const dest =
    typeof destination === 'string'
      ? encodeURIComponent(destination)
      : `${destination.latitude},${destination.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

/** Google-Maps-Suche (Adresse anzeigen statt navigieren). */
export function googleMapsSearchUrl(query: LatLng | string): string {
  const q =
    typeof query === 'string' ? encodeURIComponent(query) : `${query.latitude},${query.longitude}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
