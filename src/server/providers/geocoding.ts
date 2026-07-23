import 'server-only';

import { createHash } from 'node:crypto';

import type { LatLng } from '@/lib/geo';
import { parseAddressQuery } from '@/lib/geo';
import type {
  AddressSuggestion,
  GeocodeQuery,
  GeocodingCandidate,
  GeocodingProvider,
} from '@/server/providers/types';

const NOMINATIM_USER_AGENT =
  'HomeCarePlanner/0.1 (Einsatzplanung; Kontakt siehe Betreiber)';

/**
 * Geocoding-Provider.
 *
 *  - mock:      deterministisch, offline, ohne Schlüssel (Tests-Standard).
 *  - nominatim: OpenStreetMap Nominatim – öffentliche Instanz nur sparsam und
 *               mit korrekt gesetztem User-Agent nutzen (docs/routing.md).
 *  - google:    Places Autocomplete (New) + Geocoding API; Schlüssel nur
 *               serverseitig (GOOGLE_MAPS_API_KEY). Ohne Schlüssel fällt die
 *               Auswahl auf Nominatim zurück, damit die Suche nutzbar bleibt.
 *  - mapbox/ors: für Produktion vorgesehen; Schlüssel nur serverseitig.
 *
 * Ergebnisse werden in-memory gecacht (Adressen ändern sich selten; das
 * persistente Ergebnis liegt ohnehin am Address-Datensatz).
 */

const cache = new Map<string, { candidates: GeocodingCandidate[]; cachedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 5_000;

function cacheKey(provider: string, query: GeocodeQuery): string {
  return [provider, query.street, query.houseNumber, query.postalCode, query.city, query.countryCode]
    .join('|')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Mock: Hash der Adresse → stabile Koordinate im Umkreis von Münster.
// ---------------------------------------------------------------------------

const MOCK_CENTER = { latitude: 51.9607, longitude: 7.6261 };

/** Stabile Koordinate aus einem Adress-String (Hash → Umkreis Münster). */
function mockCoordinateFor(normalized: string): { latitude: number; longitude: number } {
  const digest = createHash('sha256').update(normalized.toLowerCase()).digest();
  const latOffset = (digest.readUInt16BE(0) / 65_535 - 0.5) * 0.08;
  const lngOffset = (digest.readUInt16BE(2) / 65_535 - 0.5) * 0.12;
  return {
    latitude: Number((MOCK_CENTER.latitude + latOffset).toFixed(6)),
    longitude: Number((MOCK_CENTER.longitude + lngOffset).toFixed(6)),
  };
}

/** Straßenliste für Offline-Autocomplete (Demo-Raum Münster). */
const MOCK_STREETS: { street: string; postalCode: string; city: string }[] = [
  { street: 'Prinzipalmarkt', postalCode: '48143', city: 'Münster' },
  { street: 'Salzstraße', postalCode: '48143', city: 'Münster' },
  { street: 'Königsstraße', postalCode: '48143', city: 'Münster' },
  { street: 'Ludgeristraße', postalCode: '48143', city: 'Münster' },
  { street: 'Servatiiplatz', postalCode: '48143', city: 'Münster' },
  { street: 'Warendorfer Straße', postalCode: '48145', city: 'Münster' },
  { street: 'Kanalstraße', postalCode: '48147', city: 'Münster' },
  { street: 'Steinfurter Straße', postalCode: '48149', city: 'Münster' },
  { street: 'Weseler Straße', postalCode: '48151', city: 'Münster' },
  { street: 'Hammer Straße', postalCode: '48153', city: 'Münster' },
  { street: 'Wolbecker Straße', postalCode: '48155', city: 'Münster' },
  { street: 'Hafenweg', postalCode: '48155', city: 'Münster' },
  { street: 'Albersloher Weg', postalCode: '48155', city: 'Münster' },
  { street: 'Bremer Straße', postalCode: '48155', city: 'Münster' },
  { street: 'Grevener Straße', postalCode: '48159', city: 'Münster' },
];

class MockGeocodingProvider implements GeocodingProvider {
  readonly name = 'mock';

  async geocodeAddress(query: GeocodeQuery): Promise<GeocodingCandidate[]> {
    const normalized = `${query.street} ${query.houseNumber}, ${query.postalCode} ${query.city}`.trim();
    if (!query.street || !query.city) return [];
    // "unbekannt" im Straßennamen simuliert einen Fehlschlag (für Tests/Demos).
    if (/unbekannt/i.test(query.street)) return [];

    const candidate: GeocodingCandidate = {
      ...mockCoordinateFor(normalized),
      displayName: normalized,
      quality: 'exact',
    };

    // "mehrdeutig" im Straßennamen liefert zwei Kandidaten (Auswahl-Dialog).
    if (/mehrdeutig/i.test(query.street)) {
      return [
        candidate,
        {
          latitude: Number((candidate.latitude + 0.01).toFixed(6)),
          longitude: Number((candidate.longitude + 0.01).toFixed(6)),
          displayName: `${normalized} (Alternative)`,
          quality: 'approximate',
        },
      ];
    }
    return [candidate];
  }

  async reverseGeocode(position: LatLng): Promise<string | null> {
    return `Koordinate ${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
  }

  async suggestAddresses(query: string): Promise<AddressSuggestion[]> {
    const { street: streetQuery, houseNumber } = parseAddressQuery(query);
    if (streetQuery.length < 3) return [];

    const needle = streetQuery.toLowerCase();
    const matches = MOCK_STREETS.filter((entry) =>
      entry.street.toLowerCase().includes(needle),
    ).slice(0, 4);

    // Freie Eingaben bleiben nutzbar: unbekannte Straßen als generische Vorschläge.
    const base =
      matches.length > 0
        ? matches
        : [
            {
              street: streetQuery.charAt(0).toUpperCase() + streetQuery.slice(1),
              postalCode: '48143',
              city: 'Münster',
            },
            {
              street: streetQuery.charAt(0).toUpperCase() + streetQuery.slice(1),
              postalCode: '48155',
              city: 'Münster',
            },
          ];

    return base.map((entry) => {
      const label = `${entry.street}${houseNumber ? ` ${houseNumber}` : ''}, ${entry.postalCode} ${entry.city}`;
      return {
        label,
        street: entry.street,
        houseNumber,
        postalCode: entry.postalCode,
        city: entry.city,
        countryCode: 'DE',
        ...mockCoordinateFor(`${entry.street} ${houseNumber}, ${entry.postalCode} ${entry.city}`),
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Nominatim (OpenStreetMap)
// ---------------------------------------------------------------------------

class NominatimGeocodingProvider implements GeocodingProvider {
  readonly name = 'nominatim';
  private readonly baseUrl =
    process.env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org';

  async geocodeAddress(query: GeocodeQuery): Promise<GeocodingCandidate[]> {
    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '0',
      limit: '5',
      street: `${query.houseNumber} ${query.street}`.trim(),
      postalcode: query.postalCode,
      city: query.city,
      country: query.countryCode || 'DE',
    });
    const response = await fetch(`${this.baseUrl}/search?${params}`, {
      headers: {
        // Nominatim-Policy verlangt einen identifizierenden User-Agent.
        'User-Agent': NOMINATIM_USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      type?: string;
    }>;
    return data.map((item) => ({
      latitude: Number(item.lat),
      longitude: Number(item.lon),
      displayName: item.display_name,
      quality: item.type === 'house' ? ('exact' as const) : ('approximate' as const),
    }));
  }

  async reverseGeocode(position: LatLng): Promise<string | null> {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(position.latitude),
      lon: String(position.longitude),
    });
    const response = await fetch(`${this.baseUrl}/reverse?${params}`, {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { display_name?: string };
    return data.display_name ?? null;
  }

  async suggestAddresses(query: string): Promise<AddressSuggestion[]> {
    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      limit: '6',
      countrycodes: 'de',
      q: query,
    });
    const response = await fetch(`${this.baseUrl}/search?${params}`, {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      lat: string;
      lon: string;
      address?: Record<string, string>;
    }>;

    const seen = new Set<string>();
    const suggestions: AddressSuggestion[] = [];
    for (const item of data) {
      const address = item.address ?? {};
      const street = address.road ?? address.pedestrian ?? address.square ?? '';
      const city =
        address.city ?? address.town ?? address.village ?? address.municipality ?? '';
      if (!street || !city) continue;
      const houseNumber = address.house_number ?? '';
      const postalCode = address.postcode ?? '';
      const label = `${street}${houseNumber ? ` ${houseNumber}` : ''}, ${postalCode ? `${postalCode} ` : ''}${city}`;
      if (seen.has(label)) continue;
      seen.add(label);
      suggestions.push({
        label,
        street,
        houseNumber,
        postalCode,
        city,
        countryCode: 'DE',
        latitude: Number(item.lat),
        longitude: Number(item.lon),
      });
      if (suggestions.length >= 5) break;
    }
    return suggestions;
  }
}

// ---------------------------------------------------------------------------
// Google (Places Autocomplete (New) + Geocoding API)
// ---------------------------------------------------------------------------

/** Adresskomponenten aus einer Google-Antwort in unsere Felder übersetzen. */
function parseGoogleComponents(
  components: { longName: string; shortName: string; types: string[] }[],
): { street: string; houseNumber: string; postalCode: string; city: string; countryCode: string } {
  const byType = (type: string) => components.find((c) => c.types.includes(type));
  return {
    street: byType('route')?.longName ?? '',
    houseNumber: byType('street_number')?.longName ?? '',
    postalCode: byType('postal_code')?.longName ?? '',
    city:
      byType('locality')?.longName ??
      byType('postal_town')?.longName ??
      byType('administrative_area_level_3')?.longName ??
      '',
    countryCode: byType('country')?.shortName ?? 'DE',
  };
}

class GoogleGeocodingProvider implements GeocodingProvider {
  readonly name = 'google';
  /** Places (New) nicht freigeschaltet? Dann dauerhaft Geocoding-API nutzen. */
  private placesUnavailable = false;

  constructor(private readonly apiKey: string) {}

  private qualityFor(locationType: string | undefined): GeocodingCandidate['quality'] {
    if (locationType === 'ROOFTOP') return 'exact';
    if (locationType === 'RANGE_INTERPOLATED') return 'interpolated';
    return 'approximate';
  }

  /** Geocoding-API-Aufruf (address → Kandidaten mit Komponenten). */
  private async fetchGeocode(address: string, countryCode: string) {
    const params = new URLSearchParams({
      address,
      components: `country:${(countryCode || 'DE').toUpperCase()}`,
      language: 'de',
      key: this.apiKey,
    });
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      status: string;
      results?: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number }; location_type?: string };
        address_components: { long_name: string; short_name: string; types: string[] }[];
      }>;
    };
    if (data.status !== 'OK' || !data.results) return [];
    return data.results;
  }

  async geocodeAddress(query: GeocodeQuery): Promise<GeocodingCandidate[]> {
    const address = `${query.street} ${query.houseNumber}, ${query.postalCode} ${query.city}`.trim();
    const results = await this.fetchGeocode(address, query.countryCode);
    const candidates = results.map((item) => ({
      latitude: item.geometry.location.lat,
      longitude: item.geometry.location.lng,
      displayName: item.formatted_address,
      quality: this.qualityFor(item.geometry.location_type),
    }));
    // Nur die beste Qualitätsstufe behalten: Google liefert sonst neben dem
    // exakten Treffer auch gröbere Varianten (Straße/Ort) als Pseudo-Duplikate.
    const rank = { exact: 0, interpolated: 1, approximate: 2 } as const;
    const best = Math.min(...candidates.map((c) => rank[c.quality]));
    return candidates.filter((c) => rank[c.quality] === best).slice(0, 3);
  }

  async reverseGeocode(position: LatLng): Promise<string | null> {
    const params = new URLSearchParams({
      latlng: `${position.latitude},${position.longitude}`,
      language: 'de',
      key: this.apiKey,
    });
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      results?: Array<{ formatted_address?: string }>;
    };
    return data.results?.[0]?.formatted_address ?? null;
  }

  async suggestAddresses(query: string): Promise<AddressSuggestion[]> {
    if (!this.placesUnavailable) {
      try {
        return await this.suggestViaPlaces(query);
      } catch {
        // Places API (New) nicht freigeschaltet/erreichbar → Geocoding-API.
        this.placesUnavailable = true;
      }
    }
    return this.suggestViaGeocoding(query);
  }

  /** Places Autocomplete (New) + Place Details – liefert Koordinate + Komponenten. */
  private async suggestViaPlaces(query: string): Promise<AddressSuggestion[]> {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
      },
      body: JSON.stringify({
        input: query,
        languageCode: 'de',
        regionCode: 'DE',
        includedRegionCodes: ['de'],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Places autocomplete ${response.status}`);
    const data = (await response.json()) as {
      suggestions?: Array<{ placePrediction?: { placeId: string } }>;
    };
    const placeIds = (data.suggestions ?? [])
      .map((s) => s.placePrediction?.placeId)
      .filter((id): id is string => Boolean(id))
      .slice(0, 5);

    const details = await Promise.all(
      placeIds.map(async (placeId) => {
        try {
          const detailResponse = await fetch(
            `https://places.googleapis.com/v1/places/${placeId}?languageCode=de&regionCode=DE`,
            {
              headers: {
                'X-Goog-Api-Key': this.apiKey,
                'X-Goog-FieldMask': 'location,addressComponents',
              },
              signal: AbortSignal.timeout(5_000),
            },
          );
          if (!detailResponse.ok) return null;
          return (await detailResponse.json()) as {
            location?: { latitude: number; longitude: number };
            addressComponents?: { longText: string; shortText: string; types: string[] }[];
          };
        } catch {
          return null;
        }
      }),
    );

    const seen = new Set<string>();
    const suggestions: AddressSuggestion[] = [];
    for (const detail of details) {
      if (!detail?.location || !detail.addressComponents) continue;
      const parsed = parseGoogleComponents(
        detail.addressComponents.map((c) => ({
          longName: c.longText,
          shortName: c.shortText,
          types: c.types,
        })),
      );
      if (!parsed.street || !parsed.city) continue;
      const label = `${parsed.street}${parsed.houseNumber ? ` ${parsed.houseNumber}` : ''}, ${parsed.postalCode ? `${parsed.postalCode} ` : ''}${parsed.city}`;
      if (seen.has(label)) continue;
      seen.add(label);
      suggestions.push({
        label,
        ...parsed,
        latitude: detail.location.latitude,
        longitude: detail.location.longitude,
      });
    }
    return suggestions;
  }

  /** Fallback ohne Places-Freischaltung: Freitextsuche über die Geocoding-API. */
  private async suggestViaGeocoding(query: string): Promise<AddressSuggestion[]> {
    const results = await this.fetchGeocode(query, 'DE');
    const seen = new Set<string>();
    const suggestions: AddressSuggestion[] = [];
    for (const item of results) {
      const parsed = parseGoogleComponents(
        item.address_components.map((c) => ({
          longName: c.long_name,
          shortName: c.short_name,
          types: c.types,
        })),
      );
      if (!parsed.street || !parsed.city) continue;
      const label = `${parsed.street}${parsed.houseNumber ? ` ${parsed.houseNumber}` : ''}, ${parsed.postalCode ? `${parsed.postalCode} ` : ''}${parsed.city}`;
      if (seen.has(label)) continue;
      seen.add(label);
      suggestions.push({
        label,
        ...parsed,
        latitude: item.geometry.location.lat,
        longitude: item.geometry.location.lng,
      });
      if (suggestions.length >= 5) break;
    }
    return suggestions;
  }
}

// ---------------------------------------------------------------------------

let providerInstance: GeocodingProvider | null = null;

export function getGeocodingProvider(): GeocodingProvider {
  if (providerInstance) return providerInstance;
  const configured = (process.env.GEOCODING_PROVIDER ?? 'mock').toLowerCase();
  switch (configured) {
    case 'google': {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      // Ohne Schlüssel bewusst Nominatim statt Mock: echte Adressen bleiben findbar.
      providerInstance = apiKey
        ? new GoogleGeocodingProvider(apiKey)
        : new NominatimGeocodingProvider();
      break;
    }
    case 'nominatim':
      providerInstance = new NominatimGeocodingProvider();
      break;
    case 'mock':
    default:
      // mapbox/ors: Adapter-Skelette folgen bei Bedarf; ohne Schlüssel
      // fällt die Anwendung bewusst auf den Mock zurück (docs/routing.md).
      providerInstance = new MockGeocodingProvider();
      break;
  }
  return providerInstance;
}

/** Geocoding mit Cache; niemals bei jedem Seitenaufruf erneut aufrufen. */
export async function geocodeAddressCached(query: GeocodeQuery): Promise<GeocodingCandidate[]> {
  const provider = getGeocodingProvider();
  const key = cacheKey(provider.name, query);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.candidates;

  const candidates = await provider.geocodeAddress(query);
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { candidates, cachedAt: Date.now() });
  return candidates;
}

// Autocomplete-Vorschläge kurz cachen (schont v. a. Nominatim beim Tippen).
const suggestCache = new Map<string, { suggestions: AddressSuggestion[]; cachedAt: number }>();
const SUGGEST_TTL_MS = 10 * 60 * 1000;
const SUGGEST_CACHE_MAX = 500;

export async function suggestAddressesCached(query: string): Promise<AddressSuggestion[]> {
  const provider = getGeocodingProvider();
  const key = `${provider.name}|${query.trim().toLowerCase()}`;
  const cached = suggestCache.get(key);
  if (cached && Date.now() - cached.cachedAt < SUGGEST_TTL_MS) return cached.suggestions;

  const suggestions = await provider.suggestAddresses(query.trim());
  if (suggestCache.size >= SUGGEST_CACHE_MAX) {
    const oldest = suggestCache.keys().next().value;
    if (oldest) suggestCache.delete(oldest);
  }
  suggestCache.set(key, { suggestions, cachedAt: Date.now() });
  return suggestions;
}

/** Nur für Tests. */
export function clearGeocodingCache(): void {
  cache.clear();
  suggestCache.clear();
}
