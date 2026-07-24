import { NextResponse, type NextRequest } from 'next/server';

/**
 * Kartenkacheln (GET) – eine einzige Client-URL, der Server wählt den Anbieter.
 *
 *  - Mit `MAPBOX_ACCESS_TOKEN`: Die Kacheln werden serverseitig geholt und
 *    durchgereicht. Der Schlüssel bleibt dadurch auf dem Server und landet
 *    nicht im Client-Bundle.
 *  - Ohne Token: Weiterleitung auf die frei nutzbaren CARTO-Basiskarten. So
 *    lädt der Browser direkt dort und der Server bleibt aus dem Weg.
 *
 * Die Pfadsegmente werden streng geprüft (nur Zahlen, feste Stilnamen) – der
 * Proxy darf niemals zu einer beliebigen Ziel-URL werden.
 */

const STYLES = {
  light: { mapbox: 'mapbox/light-v11', carto: 'light_all' },
  dark: { mapbox: 'mapbox/dark-v11', carto: 'dark_all' },
  streets: { mapbox: 'mapbox/streets-v12', carto: 'rastertiles/voyager' },
  satellite: { mapbox: 'mapbox/satellite-streets-v12', carto: null },
  /** Eigener Mapbox-Stil – die Referenz kommt streng geprüft aus `?ref=`. */
  custom: { mapbox: null, carto: 'rastertiles/voyager' },
} as const;

type StyleKey = keyof typeof STYLES;

const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;
/** Kacheln ändern sich selten – ein Tag Browser-Cache spart sehr viele Abrufe. */
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

function isStyle(value: string): value is StyleKey {
  return Object.hasOwn(STYLES, value);
}

/** Eigene Mapbox-Stile: exakt „username/style-id“, sonst nichts. */
const CUSTOM_REF_PATTERN = /^[\w.-]{1,64}\/[\w.-]{1,64}$/;

/** `y` trägt bei Retina-Displays das Suffix `@2x`. */
function parseTileY(raw: string): { y: number; retina: boolean } | null {
  const retina = raw.endsWith('@2x');
  const digits = retina ? raw.slice(0, -3) : raw;
  if (!/^\d{1,7}$/.test(digits)) return null;
  return { y: Number(digits), retina };
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
  const token = process.env.MAPBOX_ACCESS_TOKEN;

  // Eigener Mapbox-Stil: nur mit Token sinnvoll; Referenz streng validieren.
  const customRef =
    style === 'custom' ? (request.nextUrl.searchParams.get('ref') ?? '') : null;
  if (style === 'custom' && customRef && !CUSTOM_REF_PATTERN.test(customRef)) {
    return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
  }

  const mapboxStyle =
    style === 'custom' ? (token && customRef ? customRef : null) : STYLES[style].mapbox;

  if (!token || !mapboxStyle) {
    // Kein Token (oder kein nutzbarer Stil): frei verfügbare Kacheln.
    //  - Satellit: Esri World Imagery (kein CARTO-Pendant).
    //  - Sonst: CARTO-Basiskarte des Stils bzw. Voyager als Ersatz.
    if (style === 'satellite') {
      const target =
        `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer` +
        `/tile/${zoom}/${parsedY.y}/${column}`;
      return NextResponse.redirect(target, {
        status: 307,
        headers: { 'Cache-Control': CACHE_CONTROL },
      });
    }
    const carto = STYLES[style].carto ?? 'rastertiles/voyager';
    const subdomain = CARTO_SUBDOMAINS[(column + parsedY.y) % CARTO_SUBDOMAINS.length]!;
    const target =
      `https://${subdomain}.basemaps.cartocdn.com/${carto}` +
      `/${zoom}/${column}/${parsedY.y}${suffix}.png`;
    return NextResponse.redirect(target, {
      status: 307,
      headers: { 'Cache-Control': CACHE_CONTROL },
    });
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
      return NextResponse.json({ error: 'TILE_UNAVAILABLE' }, { status: 502 });
    }
    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'image/png',
        'Cache-Control': CACHE_CONTROL,
      },
    });
  } catch {
    return NextResponse.json({ error: 'TILE_UNAVAILABLE' }, { status: 502 });
  }
}
