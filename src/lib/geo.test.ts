import { describe, expect, it } from 'vitest';

import {
  estimateTravelSeconds,
  formatDistance,
  formatLocationLine,
  formatTravelSeconds,
  googleMapsDirectionsUrl,
  haversineMeters,
  isWithinCoverage,
  parseAddressQuery,
  pointFromLocationJson,
  resolveCoverageArea,
} from './geo';

const prinzipalmarkt = { latitude: 51.9625, longitude: 7.6281 };
const hauptbahnhof = { latitude: 51.9565, longitude: 7.6352 };
const berlin = { latitude: 52.52, longitude: 13.405 };

describe('haversineMeters', () => {
  it('Distanz zu sich selbst ist 0', () => {
    expect(haversineMeters(prinzipalmarkt, prinzipalmarkt)).toBe(0);
  });

  it('kurze Innenstadtdistanz plausibel (~850 m)', () => {
    const d = haversineMeters(prinzipalmarkt, hauptbahnhof);
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(1000);
  });

  it('Münster–Berlin plausibel (~400 km Luftlinie)', () => {
    const d = haversineMeters(prinzipalmarkt, berlin);
    expect(d).toBeGreaterThan(380_000);
    expect(d).toBeLessThan(420_000);
  });

  it('ist symmetrisch', () => {
    expect(haversineMeters(prinzipalmarkt, berlin)).toBe(haversineMeters(berlin, prinzipalmarkt));
  });
});

describe('estimateTravelSeconds', () => {
  it('enthält 60 s Rüstzeit bei Distanz 0', () => {
    expect(estimateTravelSeconds(prinzipalmarkt, prinzipalmarkt)).toBe(60);
  });

  it('ist deterministisch und monoton mit der Distanz', () => {
    const short = estimateTravelSeconds(prinzipalmarkt, hauptbahnhof);
    const long = estimateTravelSeconds(prinzipalmarkt, berlin);
    expect(short).toBe(estimateTravelSeconds(prinzipalmarkt, hauptbahnhof));
    expect(long).toBeGreaterThan(short);
  });
});

describe('Formatierung', () => {
  it('formatDistance', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(1500)).toBe('1,5 km');
  });

  it('formatTravelSeconds', () => {
    expect(formatTravelSeconds(300)).toBe('5 Min.');
    expect(formatTravelSeconds(3600)).toBe('1 Std.');
    expect(formatTravelSeconds(5400)).toBe('1 Std. 30 Min.');
  });

  it('formatLocationLine', () => {
    expect(
      formatLocationLine({ street: 'Prinzipalmarkt', houseNumber: '22', postalCode: '48143', city: 'Münster' }),
    ).toBe('Prinzipalmarkt 22, 48143 Münster');
    expect(formatLocationLine(null)).toBe('');
  });

  it('parseAddressQuery trennt Straße und Hausnummer', () => {
    expect(parseAddressQuery('Warendorfer Straße 85')).toEqual({
      street: 'Warendorfer Straße',
      houseNumber: '85',
    });
    expect(parseAddressQuery('Hammer Str. 12a')).toEqual({
      street: 'Hammer Str.',
      houseNumber: '12a',
    });
    expect(parseAddressQuery('Prinzipalmarkt')).toEqual({
      street: 'Prinzipalmarkt',
      houseNumber: '',
    });
    expect(parseAddressQuery('Hafenweg 14, Münster')).toEqual({
      street: 'Hafenweg',
      houseNumber: '14',
    });
    expect(parseAddressQuery('  Grevener Straße 120 ')).toEqual({
      street: 'Grevener Straße',
      houseNumber: '120',
    });
  });

  it('googleMapsDirectionsUrl mit Koordinaten und Text', () => {
    expect(googleMapsDirectionsUrl(prinzipalmarkt)).toContain('destination=51.9625,7.6281');
    expect(googleMapsDirectionsUrl('Prinzipalmarkt 22, Münster')).toContain(
      'destination=Prinzipalmarkt%2022%2C%20M%C3%BCnster',
    );
  });
});

describe('Zuständigkeitsgebiet (Umkreis)', () => {
  const home = { label: 'Zuhause', street: 'A', latitude: 51.9607, longitude: 7.6261 };
  const manual = { street: 'B', latitude: 52.0, longitude: 7.0 };

  it('pointFromLocationJson liest nur gültige Koordinaten', () => {
    expect(pointFromLocationJson(home)).toEqual({ latitude: 51.9607, longitude: 7.6261 });
    expect(pointFromLocationJson({ street: 'X' })).toBeNull();
    expect(pointFromLocationJson(null)).toBeNull();
  });

  it('ohne Umkreis ist das Gebiet unbeschränkt', () => {
    const area = resolveCoverageArea({
      coverageUseHome: true,
      startLocation: home,
      coverageCenter: null,
      coverageRadiusKm: null,
    });
    expect(area).toEqual({ center: null, radiusMeters: null });
    // Jeder Punkt liegt „innerhalb".
    expect(isWithinCoverage(area, { latitude: 0, longitude: 0 })).toBe(true);
  });

  it('nutzt je nach useHome die Zuhause- oder die manuelle Adresse als Zentrum', () => {
    const withHome = resolveCoverageArea({
      coverageUseHome: true,
      startLocation: home,
      coverageCenter: manual,
      coverageRadiusKm: 10,
    });
    expect(withHome.center).toEqual({ latitude: 51.9607, longitude: 7.6261 });
    expect(withHome.radiusMeters).toBe(10_000);

    const withManual = resolveCoverageArea({
      coverageUseHome: false,
      startLocation: home,
      coverageCenter: manual,
      coverageRadiusKm: 10,
    });
    expect(withManual.center).toEqual({ latitude: 52.0, longitude: 7.0 });
  });

  it('lässt Punkte im Umkreis zu und schließt weiter entfernte aus', () => {
    const area = resolveCoverageArea({
      coverageUseHome: true,
      startLocation: home,
      coverageCenter: null,
      coverageRadiusKm: 5,
    });
    // ~1 km entfernt (innerhalb 5 km).
    expect(isWithinCoverage(area, { latitude: 51.9697, longitude: 7.6261 })).toBe(true);
    // Weit entfernt (Köln, > 100 km).
    expect(isWithinCoverage(area, { latitude: 50.9375, longitude: 6.9603 })).toBe(false);
  });

  it('ohne Koordinaten am Zentrum bleibt das Gebiet wirkungslos (kein Ausschluss)', () => {
    const area = resolveCoverageArea({
      coverageUseHome: false,
      startLocation: home,
      coverageCenter: { street: 'ohne Koordinaten' },
      coverageRadiusKm: 5,
    });
    expect(area.radiusMeters).toBeNull();
    expect(isWithinCoverage(area, { latitude: 0, longitude: 0 })).toBe(true);
  });

  it('schließt den Kunden exakt an der Grenze ein (Umkreis ist inklusiv)', () => {
    const center = { latitude: 51.9607, longitude: 7.6261 };
    const point = { latitude: 51.9697, longitude: 7.6261 };
    const distance = haversineMeters(center, point);
    // Genau am Radius → drin; einen Meter enger → draußen.
    expect(isWithinCoverage({ center, radiusMeters: distance }, point)).toBe(true);
    expect(isWithinCoverage({ center, radiusMeters: distance - 1 }, point)).toBe(false);
  });
});
