import 'server-only';

import type { LatLng } from '@/lib/geo';
import { estimateDistanceMeters, estimateTravelSeconds } from '@/lib/geo';
import { decodePolyline } from '@/lib/polyline';
import type { RouteLeg, RoutePath, RoutingProvider } from '@/server/providers/types';

/** Externe Routing-Aufrufe dürfen die Seite nie hängen lassen. */
const PATH_TIMEOUT_MS = Number(process.env.ROUTING_TIMEOUT_MS ?? 8000);

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PATH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Luftlinie als Ersatz, wenn kein Dienst eine echte Geometrie liefert. */
function straightLinePath(points: LatLng[], provider: string): RoutePath {
  let distanceMeters = 0;
  let travelSeconds = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    distanceMeters += estimateDistanceMeters(points[i]!, points[i + 1]!);
    travelSeconds += estimateTravelSeconds(points[i]!, points[i + 1]!);
  }
  return {
    coordinates: points.map((point) => [point.latitude, point.longitude] as [number, number]),
    road: false,
    provider,
    distanceMeters: Math.round(distanceMeters),
    travelSeconds: Math.round(travelSeconds),
  };
}

/**
 * Routing-Provider (Anforderung 16/17).
 *
 *  - mock: deterministische Haversine-Schätzung (30 km/h × Umwegfaktor) –
 *          Standard in Entwicklung und Tests, keine externen Aufrufe.
 *  - osrm: OSRM /table & /route (öffentlicher Demo-Server nur sparsam nutzen).
 *  - google/mapbox/ors/graphhopper: für Produktion vorgesehen (Schlüssel nur
 *          serverseitig, docs/routing.md).
 *
 * Fahrzeitmatrizen werden kurz gecacht (Koordinaten+Provider als Schlüssel),
 * damit UI-Interaktionen keine erneuten Anfragen auslösen.
 */

class MockRoutingProvider implements RoutingProvider {
  readonly name = 'mock';

  async computeRoute(points: LatLng[]): Promise<RouteLeg[]> {
    const legs: RouteLeg[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      legs.push({
        travelSeconds: estimateTravelSeconds(points[i]!, points[i + 1]!),
        distanceMeters: estimateDistanceMeters(points[i]!, points[i + 1]!),
      });
    }
    return legs;
  }

  async computeRouteMatrix(points: LatLng[]): Promise<RouteLeg[][]> {
    return points.map((from) =>
      points.map((to) =>
        from === to
          ? { travelSeconds: 0, distanceMeters: 0 }
          : {
              travelSeconds: estimateTravelSeconds(from, to),
              distanceMeters: estimateDistanceMeters(from, to),
            },
      ),
    );
  }

  async computeRoutePath(points: LatLng[]): Promise<RoutePath> {
    return straightLinePath(points, this.name);
  }
}

class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'osrm';
  private readonly baseUrl = process.env.OSRM_BASE_URL ?? 'https://router.project-osrm.org';

  async computeRoute(points: LatLng[]): Promise<RouteLeg[]> {
    const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const response = await fetch(
      `${this.baseUrl}/route/v1/driving/${coords}?overview=false&steps=false`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) throw new Error(`OSRM route ${response.status}`);
    const data = (await response.json()) as {
      routes?: { legs: { duration: number; distance: number }[] }[];
    };
    const legs = data.routes?.[0]?.legs ?? [];
    return legs.map((leg) => ({
      travelSeconds: Math.round(leg.duration),
      distanceMeters: Math.round(leg.distance),
    }));
  }

  async computeRouteMatrix(points: LatLng[]): Promise<RouteLeg[][]> {
    const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const response = await fetch(
      `${this.baseUrl}/table/v1/driving/${coords}?annotations=duration,distance`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) throw new Error(`OSRM table ${response.status}`);
    const data = (await response.json()) as {
      durations?: number[][];
      distances?: number[][];
    };
    const durations = data.durations ?? [];
    const distances = data.distances ?? [];
    return durations.map((row, i) =>
      row.map((duration, j) => ({
        travelSeconds: Math.round(duration ?? 0),
        distanceMeters: Math.round(distances[i]?.[j] ?? 0),
      })),
    );
  }

  /** `overview=full` liefert den vollständigen Straßenverlauf als Polyline. */
  async computeRoutePath(points: LatLng[]): Promise<RoutePath> {
    const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const data = (await fetchJson(
      `${this.baseUrl}/route/v1/driving/${coords}?overview=full&geometries=polyline&steps=false`,
    )) as {
      routes?: { geometry?: string; distance?: number; duration?: number }[];
    };
    const route = data.routes?.[0];
    const coordinates = route?.geometry ? decodePolyline(route.geometry, 5) : [];
    if (coordinates.length < 2) return straightLinePath(points, this.name);
    return {
      coordinates,
      road: true,
      provider: this.name,
      distanceMeters: Math.round(route?.distance ?? 0),
      travelSeconds: Math.round(route?.duration ?? 0),
    };
  }
}

/** Mapbox Directions – liefert die Geometrie feiner aufgelöst (polyline6). */
class MapboxRoutingProvider implements RoutingProvider {
  readonly name = 'mapbox';
  private readonly token = process.env.MAPBOX_ACCESS_TOKEN ?? '';

  private async directions(points: LatLng[]) {
    const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
    return (await fetchJson(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
        `?geometries=polyline6&overview=full&steps=false&access_token=${encodeURIComponent(this.token)}`,
    )) as {
      routes?: {
        geometry?: string;
        distance?: number;
        duration?: number;
        legs?: { distance?: number; duration?: number }[];
      }[];
    };
  }

  async computeRoute(points: LatLng[]): Promise<RouteLeg[]> {
    const data = await this.directions(points);
    const legs = data.routes?.[0]?.legs ?? [];
    return legs.map((leg) => ({
      travelSeconds: Math.round(leg.duration ?? 0),
      distanceMeters: Math.round(leg.distance ?? 0),
    }));
  }

  async computeRouteMatrix(points: LatLng[]): Promise<RouteLeg[][]> {
    const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const data = (await fetchJson(
      `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}` +
        `?annotations=duration,distance&access_token=${encodeURIComponent(this.token)}`,
    )) as { durations?: number[][]; distances?: number[][] };
    const durations = data.durations ?? [];
    const distances = data.distances ?? [];
    return durations.map((row, i) =>
      row.map((duration, j) => ({
        travelSeconds: Math.round(duration ?? 0),
        distanceMeters: Math.round(distances[i]?.[j] ?? 0),
      })),
    );
  }

  async computeRoutePath(points: LatLng[]): Promise<RoutePath> {
    const data = await this.directions(points);
    const route = data.routes?.[0];
    const coordinates = route?.geometry ? decodePolyline(route.geometry, 6) : [];
    if (coordinates.length < 2) return straightLinePath(points, this.name);
    return {
      coordinates,
      road: true,
      provider: this.name,
      distanceMeters: Math.round(route?.distance ?? 0),
      travelSeconds: Math.round(route?.duration ?? 0),
    };
  }
}

/** GraphHopper – Punktfolge als wiederholte `point`-Parameter. */
class GraphhopperRoutingProvider implements RoutingProvider {
  readonly name = 'graphhopper';
  private readonly key = process.env.GRAPHHOPPER_API_KEY ?? '';

  private async route(points: LatLng[]) {
    const query = points
      .map((p) => `point=${encodeURIComponent(`${p.latitude},${p.longitude}`)}`)
      .join('&');
    return (await fetchJson(
      `https://graphhopper.com/api/1/route?${query}&profile=car&points_encoded=true` +
        `&instructions=false&calc_points=true&key=${encodeURIComponent(this.key)}`,
    )) as {
      paths?: { points?: string; distance?: number; time?: number }[];
    };
  }

  async computeRoute(points: LatLng[]): Promise<RouteLeg[]> {
    // GraphHopper liefert keine Leg-Aufschlüsselung – paarweise abfragen.
    const legs: RouteLeg[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const data = await this.route([points[i]!, points[i + 1]!]);
      const path = data.paths?.[0];
      legs.push({
        travelSeconds: Math.round((path?.time ?? 0) / 1000),
        distanceMeters: Math.round(path?.distance ?? 0),
      });
    }
    return legs;
  }

  async computeRouteMatrix(points: LatLng[]): Promise<RouteLeg[][]> {
    const data = (await fetchJson(
      `https://graphhopper.com/api/1/matrix?key=${encodeURIComponent(this.key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: points.map((p) => [p.longitude, p.latitude]),
          out_arrays: ['times', 'distances'],
          profile: 'car',
        }),
      },
    )) as { times?: number[][]; distances?: number[][] };
    const times = data.times ?? [];
    const distances = data.distances ?? [];
    return times.map((row, i) =>
      row.map((seconds, j) => ({
        travelSeconds: Math.round(seconds ?? 0),
        distanceMeters: Math.round(distances[i]?.[j] ?? 0),
      })),
    );
  }

  async computeRoutePath(points: LatLng[]): Promise<RoutePath> {
    const data = await this.route(points);
    const path = data.paths?.[0];
    const coordinates = path?.points ? decodePolyline(path.points, 5) : [];
    if (coordinates.length < 2) return straightLinePath(points, this.name);
    return {
      coordinates,
      road: true,
      provider: this.name,
      distanceMeters: Math.round(path?.distance ?? 0),
      travelSeconds: Math.round((path?.time ?? 0) / 1000),
    };
  }
}

/** Google Directions – Zwischenstopps als `waypoints`. */
class GoogleRoutingProvider implements RoutingProvider {
  readonly name = 'google';
  private readonly key = process.env.GOOGLE_MAPS_API_KEY ?? '';

  private async directions(points: LatLng[]) {
    const asParam = (point: LatLng) => `${point.latitude},${point.longitude}`;
    const origin = points[0]!;
    const destination = points.at(-1)!;
    const waypoints = points.slice(1, -1);
    const waypointParam =
      waypoints.length > 0
        ? `&waypoints=${encodeURIComponent(waypoints.map(asParam).join('|'))}`
        : '';
    return (await fetchJson(
      `https://maps.googleapis.com/maps/api/directions/json` +
        `?origin=${encodeURIComponent(asParam(origin))}` +
        `&destination=${encodeURIComponent(asParam(destination))}` +
        `${waypointParam}&mode=driving&key=${encodeURIComponent(this.key)}`,
    )) as {
      status?: string;
      routes?: {
        overview_polyline?: { points?: string };
        legs?: { distance?: { value?: number }; duration?: { value?: number } }[];
      }[];
    };
  }

  async computeRoute(points: LatLng[]): Promise<RouteLeg[]> {
    const data = await this.directions(points);
    const legs = data.routes?.[0]?.legs ?? [];
    return legs.map((leg) => ({
      travelSeconds: Math.round(leg.duration?.value ?? 0),
      distanceMeters: Math.round(leg.distance?.value ?? 0),
    }));
  }

  async computeRouteMatrix(points: LatLng[]): Promise<RouteLeg[][]> {
    const list = points.map((p) => `${p.latitude},${p.longitude}`).join('|');
    const data = (await fetchJson(
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
        `?origins=${encodeURIComponent(list)}&destinations=${encodeURIComponent(list)}` +
        `&mode=driving&key=${encodeURIComponent(this.key)}`,
    )) as {
      rows?: { elements?: { duration?: { value?: number }; distance?: { value?: number } }[] }[];
    };
    return (data.rows ?? []).map((row) =>
      (row.elements ?? []).map((element) => ({
        travelSeconds: Math.round(element.duration?.value ?? 0),
        distanceMeters: Math.round(element.distance?.value ?? 0),
      })),
    );
  }

  async computeRoutePath(points: LatLng[]): Promise<RoutePath> {
    const data = await this.directions(points);
    const route = data.routes?.[0];
    const coordinates = route?.overview_polyline?.points
      ? decodePolyline(route.overview_polyline.points, 5)
      : [];
    if (coordinates.length < 2) return straightLinePath(points, this.name);
    const legs = route?.legs ?? [];
    return {
      coordinates,
      road: true,
      provider: this.name,
      distanceMeters: legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0),
      travelSeconds: legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0),
    };
  }
}

let providerInstance: RoutingProvider | null = null;

export function getRoutingProvider(): RoutingProvider {
  if (providerInstance) return providerInstance;
  const configured = (process.env.ROUTING_PROVIDER ?? 'mock').toLowerCase();
  switch (configured) {
    case 'osrm':
      providerInstance = new OsrmRoutingProvider();
      break;
    case 'mapbox':
      providerInstance = new MapboxRoutingProvider();
      break;
    case 'graphhopper':
      providerInstance = new GraphhopperRoutingProvider();
      break;
    case 'google':
      providerInstance = new GoogleRoutingProvider();
      break;
    case 'mock':
    default:
      providerInstance = new MockRoutingProvider();
      break;
  }
  return providerInstance;
}

// ------------------------- Streckenverlauf ---------------------------------

/**
 * Reihenfolge für die Kartendarstellung: zuerst der konfigurierte Provider,
 * danach jeder weitere, für den ein Schlüssel hinterlegt ist. So bleibt die
 * Karte auch dann bei echten Straßen, wenn ein Dienst gerade klemmt oder sein
 * Kontingent erschöpft ist (der öffentliche OSRM-Server ist verzichtbar).
 */
function pathProviderChain(): RoutingProvider[] {
  const chain: RoutingProvider[] = [getRoutingProvider()];
  const add = (candidate: RoutingProvider, available: boolean) => {
    if (available && !chain.some((entry) => entry.name === candidate.name)) chain.push(candidate);
  };
  add(new OsrmRoutingProvider(), true);
  add(new MapboxRoutingProvider(), Boolean(process.env.MAPBOX_ACCESS_TOKEN));
  add(new GraphhopperRoutingProvider(), Boolean(process.env.GRAPHHOPPER_API_KEY));
  add(new GoogleRoutingProvider(), Boolean(process.env.GOOGLE_MAPS_API_KEY));
  return chain;
}

const pathCache = new Map<string, { path: RoutePath; cachedAt: number }>();
const PATH_TTL_MS = 30 * 60 * 1000;
const PATH_CACHE_MAX = 120;

function pathKey(points: LatLng[]): string {
  return points.map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`).join(';');
}

/**
 * Gefahrene Strecke für die Karte – gecacht, mit Fallback-Kette und am Ende
 * der Luftlinie. Wirft nie: eine fehlende Geometrie darf die Routenansicht
 * nicht blockieren.
 */
export async function computeRoutePathCached(points: LatLng[]): Promise<RoutePath> {
  if (points.length < 2) return straightLinePath(points, 'none');

  const key = pathKey(points);
  const cached = pathCache.get(key);
  if (cached && Date.now() - cached.cachedAt < PATH_TTL_MS) return cached.path;

  let result: RoutePath | null = null;
  for (const provider of pathProviderChain()) {
    try {
      const path = await provider.computeRoutePath(points);
      if (path.road && path.coordinates.length >= 2) {
        result = path;
        break;
      }
      // Luftlinien-Ergebnis merken, falls kein Dienst echte Straßen liefert.
      result ??= path;
    } catch {
      // Nächsten Anbieter versuchen – Fehler sind hier nicht fatal.
    }
  }

  const path = result ?? straightLinePath(points, 'none');
  if (path.road) {
    if (pathCache.size >= PATH_CACHE_MAX) {
      const oldest = pathCache.keys().next().value;
      if (oldest) pathCache.delete(oldest);
    }
    pathCache.set(key, { path, cachedAt: Date.now() });
  }
  return path;
}

// --------------------------- Matrix-Cache ----------------------------------

const matrixCache = new Map<string, { matrix: RouteLeg[][]; cachedAt: number }>();
const MATRIX_TTL_MS = 10 * 60 * 1000;
const MATRIX_CACHE_MAX = 200;

function matrixKey(provider: string, points: LatLng[]): string {
  return `${provider}|${points.map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`).join(';')}`;
}

export async function computeRouteMatrixCached(points: LatLng[]): Promise<RouteLeg[][]> {
  const provider = getRoutingProvider();
  const key = matrixKey(provider.name, points);
  const cached = matrixCache.get(key);
  if (cached && Date.now() - cached.cachedAt < MATRIX_TTL_MS) return cached.matrix;

  const matrix = await provider.computeRouteMatrix(points);
  if (matrixCache.size >= MATRIX_CACHE_MAX) {
    const oldest = matrixCache.keys().next().value;
    if (oldest) matrixCache.delete(oldest);
  }
  matrixCache.set(key, { matrix, cachedAt: Date.now() });
  return matrix;
}
