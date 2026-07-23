import { describe, expect, it } from 'vitest';

import { decodePolyline } from './polyline';

describe('decodePolyline', () => {
  it('dekodiert das Referenzbeispiel des Google-Algorithmus', () => {
    // Offizielles Beispiel: (38.5,-120.2), (40.7,-120.95), (43.252,-126.453)
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points).toHaveLength(3);
    expect(points[0]![0]).toBeCloseTo(38.5, 5);
    expect(points[0]![1]).toBeCloseTo(-120.2, 5);
    expect(points[1]![0]).toBeCloseTo(40.7, 5);
    expect(points[1]![1]).toBeCloseTo(-120.95, 5);
    expect(points[2]![0]).toBeCloseTo(43.252, 5);
    expect(points[2]![1]).toBeCloseTo(-126.453, 5);
  });

  it('berücksichtigt die Genauigkeit (Mapbox liefert polyline6)', () => {
    const precision5 = decodePolyline('_p~iF~ps|U', 5);
    const precision6 = decodePolyline('_p~iF~ps|U', 6);
    expect(precision5[0]![0]).toBeCloseTo(38.5, 5);
    // Dieselben Rohwerte, nur um eine Zehnerpotenz feiner skaliert.
    expect(precision6[0]![0]).toBeCloseTo(3.85, 5);
  });

  it('liefert für leere Eingaben eine leere Liste', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('bricht bei abgeschnittener Eingabe sauber ab, statt zu werfen', () => {
    // Nur die Breitengrad-Hälfte des ersten Punktes.
    expect(() => decodePolyline('_p~iF')).not.toThrow();
    expect(decodePolyline('_p~iF')).toEqual([]);
  });

  it('verwirft unplausible Koordinaten', () => {
    // Zu große Deltas ergeben Werte außerhalb des gültigen Bereichs.
    const points = decodePolyline('_p~iF~ps|U'.repeat(40));
    expect(points.every(([lat, lng]) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180)).toBe(true);
  });
});
