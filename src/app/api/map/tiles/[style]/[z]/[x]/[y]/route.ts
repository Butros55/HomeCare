import { NextResponse, type NextRequest } from 'next/server';

/**
 * Kartenkacheln (GET) – eine einzige Client-URL, der Server wählt den Anbieter.
 *
 *  - Mit `MAPBOX_ACCESS_TOKEN`: Die Kacheln werden serverseitig geholt und
 *    durchgereicht. Der Schlüssel bleibt dadurch auf dem Server und landet
 *    nicht im Client-Bundle.
 *  - Ohne Token (oder wenn Mapbox nicht liefert): Weiterleitung auf frei
 *    nutzbare Quellen (CARTO-Basiskarten, Esri-Luftbild für Satellit). Die
 *    Karte bleibt dadurch IMMER sichtbar – ein Kachel-Fehler zeigt nie Grau.
 *  - `?labels=0` blendet Beschriftungen aus, wo der Anbieter eine Variante
 *    ohne Labels hat (CARTO `*_nolabels`, Mapbox Satellit ohne Straßen).
 *
 * Die Pfadsegmente werden streng geprüft (nur Zahlen, feste Stilnamen) – der
 * Proxy darf niemals zu einer beliebigen Ziel-URL werden.
 */

const STYLES = {
  light: {
    mapbox: 'mapbox/light-v11',
    carto: 'light_all',
    cartoNoLabels: 'light_nolabels',
  },
  dark: {
    mapbox: 'mapbox/dark-v11',
    carto: 'dark_all',
    cartoNoLabels: 'dark_nolabels',
  },
  streets: {
    mapbox: 'mapbox/streets-v12',
    carto: 'rastertiles/voyager',
    cartoNoLabels: 'rastertiles/voyager_nolabels',
  },
  outdoors: {
    mapbox: 'mapbox/outdoors-v12',
    carto: 'rastertiles/voyager',
    cartoNoLabels: 'rastertiles/voyager_nolabels',
  },
  satellite: {
    // Mit Beschriftung Straßen-Overlay, ohne reines Luftbild.
    mapbox: 'mapbox/satellite-streets-v12',
    mapboxNoLabels: 'mapbox/satellite-v9',
    carto: null,
    cartoNoLabels: null,
  },
} as const;

type StyleKey = keyof typeof STYLES;

const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;
/** Kacheln ändern sich selten – ein Tag Browser-Cache spart sehr viele Abrufe. */
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

function isStyle(value: string): value is StyleKey {
  return Object.hasOwn(STYLES, value);
}

/** `y` trägt bei Retina-Displays das Suffix `@2x`. */
function parseTileY(raw: string): { y: number; retina: boolean } | null {
  const retina = raw.endsWith('@2x');
  const digits = retina ? raw.slice(0, -3) : raw;
  if (!/^\d{1,7}$/.test(digits)) return null;
  return { y: Number(digits), retina };
}

/** Freie Ersatzquelle: CARTO-Basiskarte bzw. Esri-Luftbild für Satellit. */
function fallbackRedirect(
  style: StyleKey,
  labels: boolean,
  zoom: number,
  column: number,
  y: number,
  suffix: string,
): NextResponse {
  if (style === 'satellite') {
    const target =
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer` +
      `/tile/${zoom}/${y}/${column}`;
    return NextResponse.redirect(target, {
      status: 307,
      headers: { 'Cache-Control': CACHE_CONTROL },
    });
  }
  // Nach dem Satellit-Frühausstieg haben alle übrigen Stile CARTO-Varianten.
  const entry = STYLES[style as Exclude<StyleKey, 'satellite'>];
  const carto = labels ? entry.carto : entry.cartoNoLabels;
  const subdomain = CARTO_SUBDOMAINS[(column + y) % CARTO_SUBDOMAINS.length]!;
  const target =
    `https://${subdomain}.basemaps.cartocdn.com/${carto}` + `/${zoom}/${column}/${y}${suffix}.png`;
  return NextResponse.redirect(target, {
    status: 307,
    headers: { 'Cache-Control': CACHE_CONTROL },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ style: string; z: string; x: string; y: string }> },
) {
  const { style, z, x, y } = await context.params;

  if (!isStyle(style) || !/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x)) {
    return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
  }
  const parsedY = parseTileY(y);
  if (!parsedY) return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });

  const zoom = Number(z);
  const column = Number(x);
  if (zoom > 22) return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
  // Außerhalb des Rasters gibt es keine Kachel.
  const limit = 2 ** zoom;
  if (column >= limit || parsedY.y >= limit) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const suffix = parsedY.retina ? '@2x' : '';
  const labels = request.nextUrl.searchParams.get('labels') !== '0';
  const token = process.env.MAPBOX_ACCESS_TOKEN;

  // Beschriftungen aus: Mapbox-Rasterstile haben (außer Satellit) keine
  // Variante ohne Labels – dann liefert CARTO die saubere „nolabels“-Karte.
  const mapboxStyle =
    style === 'satellite'
      ? labels
        ? STYLES.satellite.mapbox
        : STYLES.satellite.mapboxNoLabels
      : labels
        ? STYLES[style].mapbox
        : null;

  if (!token || !mapboxStyle) {
    return fallbackRedirect(style, labels, zoom, column, parsedY.y, suffix);
  }

  const upstream =
    `https://api.mapbox.com/styles/v1/${mapboxStyle}/tiles/512` +
    `/${zoom}/${column}/${parsedY.y}${suffix}` +
    `?access_token=${encodeURIComponent(token)}`;

  try {
    const response = await fetch(upstream, {
      headers: { Accept: 'image/png,image/webp,*/*' },
      // Kacheln sind unveränderlich – Next darf sie zwischenspeichern.
      next: { revalidate: 86_400 },
      signal: request.signal,
    });
    if (!response.ok) {
      // Mapbox liefert nicht (Kontingent, Token-Rechte …) → freie Quelle
      // statt grauer Karte.
      return fallbackRedirect(style, labels, zoom, column, parsedY.y, suffix);
    }
    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'image/png',
        'Cache-Control': CACHE_CONTROL,
      },
    });
  } catch {
    return fallbackRedirect(style, labels, zoom, column, parsedY.y, suffix);
  }
}
