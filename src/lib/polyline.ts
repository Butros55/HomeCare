/**
 * Dekodiert „Encoded Polylines" (Google-Algorithmus) in [lat, lng]-Paare.
 * Alle gängigen Routing-Dienste liefern die gefahrene Strecke in diesem
 * Format: OSRM und Google mit Genauigkeit 5, Mapbox wahlweise mit 6.
 *
 * Bewusst tolerant: unvollständige oder beschädigte Eingaben liefern die
 * bis dahin gelesenen Punkte zurück, statt zu werfen – eine fehlerhafte
 * Geometrie darf die Kartenanzeige nie blockieren.
 */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const points: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const latDelta = readSignedValue(encoded, index);
    if (!latDelta) break;
    index = latDelta.index;
    latitude += latDelta.value;

    const lngDelta = readSignedValue(encoded, index);
    if (!lngDelta) break;
    index = lngDelta.index;
    longitude += lngDelta.value;

    const lat = latitude / factor;
    const lng = longitude / factor;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) break;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) break;
    points.push([lat, lng]);
  }

  return points;
}

/** Liest einen zickzack-kodierten Wert ab `start`; null = Eingabe zu kurz. */
function readSignedValue(
  encoded: string,
  start: number,
): { value: number; index: number } | null {
  let index = start;
  let shift = 0;
  let result = 0;
  let byte = 0;

  do {
    if (index >= encoded.length) return null;
    byte = encoded.charCodeAt(index) - 63;
    if (byte < 0) return null;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
    // Mehr als 6 Fortsetzungsbytes gibt es im Format nicht.
    if (shift > 35) return null;
  } while (byte >= 0x20);

  return { value: result & 1 ? ~(result >> 1) : result >> 1, index };
}
