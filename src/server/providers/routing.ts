import 'server-only';

import type { LatLng } from '@/lib/geo';
import { estimateDistanceMeters, estimateTravelSeconds } from '@/lib/geo';
import type { RouteLeg, RoutingProvider } from '@/server/providers/types';

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
}

let providerInstance: RoutingProvider | null = null;

export function getRoutingProvider(): RoutingProvider {
  if (providerInstance) return providerInstance;
  const configured = (process.env.ROUTING_PROVIDER ?? 'mock').toLowerCase();
  switch (configured) {
    case 'osrm':
      providerInstance = new OsrmRoutingProvider();
      break;
    case 'mock':
    default:
      providerInstance = new MockRoutingProvider();
      break;
  }
  return providerInstance;
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
