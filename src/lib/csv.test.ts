import { describe, expect, it } from 'vitest';

import { detectDelimiter, parseCsv, toCsv } from './csv';
import {
  matchCsvHeaders,
  parseCustomerStatus,
  parseDecimal,
} from '@/features/customers/csv-schema';

describe('detectDelimiter', () => {
  it('bevorzugt Semikolon (deutsches Excel)', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  it('ignoriert Trennzeichen innerhalb von Quotes', () => {
    expect(detectDelimiter('"a;x",b,c\n')).toBe(',');
  });
});

describe('parseCsv', () => {
  it('parst Header und Records mit Zeilennummern', () => {
    const parsed = parseCsv('Vorname;Nachname\r\nHelga;Brinkmann\r\nWerner;Austermann');
    expect(parsed.delimiter).toBe(';');
    expect(parsed.header).toEqual(['Vorname', 'Nachname']);
    expect(parsed.records).toEqual([
      { line: 2, fields: ['Helga', 'Brinkmann'] },
      { line: 3, fields: ['Werner', 'Austermann'] },
    ]);
  });

  it('entfernt BOM und überspringt leere Zeilen', () => {
    const parsed = parseCsv('﻿A;B\n\n;\nx;y\n');
    expect(parsed.header).toEqual(['A', 'B']);
    expect(parsed.records).toEqual([{ line: 4, fields: ['x', 'y'] }]);
  });

  it('liest Quotes, Escapes und mehrzeilige Felder (Zeilennummer = Record-Beginn)', () => {
    const parsed = parseCsv('A;B\n"Sagt ""Hallo""";"Zeile 1\nZeile 2"\nx;y');
    expect(parsed.records[0]).toEqual({ line: 2, fields: ['Sagt "Hallo"', 'Zeile 1\nZeile 2'] });
    expect(parsed.records[1]).toEqual({ line: 4, fields: ['x', 'y'] });
  });

  it('liest Komma-CSV mit gequoteten Kommas', () => {
    const parsed = parseCsv('A,B\n"Müller, Klaus",1');
    expect(parsed.records[0]!.fields).toEqual(['Müller, Klaus', '1']);
  });

  it('roundtrip mit toCsv', () => {
    const rows = [
      ['Kopf A', 'Kopf B'],
      ['Wert;mit;Semikolon', 'Zeile\numbruch "quote"'],
    ];
    const parsed = parseCsv(toCsv(rows));
    expect(parsed.header).toEqual(rows[0]);
    expect(parsed.records[0]!.fields).toEqual(rows[1]);
  });
});

describe('matchCsvHeaders', () => {
  it('erkennt Labels und Aliasse unabhängig von Groß-/Kleinschreibung', () => {
    const { mapping, unknown, missingRequired } = matchCsvHeaders([
      'kundennummer',
      'VORNAME',
      'Nachname',
      'Strasse',
      'Hausnummer',
      'PLZ',
      'Stadt',
      'Unbekanntes Feld',
    ]);
    expect(mapping).toEqual([
      'customerNumber',
      'firstName',
      'lastName',
      'street',
      'houseNumber',
      'postalCode',
      'city',
      null,
    ]);
    expect(unknown).toEqual(['Unbekanntes Feld']);
    expect(missingRequired).toEqual([]);
  });

  it('meldet fehlende Pflichtspalten', () => {
    const { missingRequired } = matchCsvHeaders(['Vorname', 'Nachname']);
    expect(missingRequired).toEqual(['Straße', 'Hausnummer', 'PLZ', 'Ort']);
  });
});

describe('parseCustomerStatus / parseDecimal', () => {
  it('versteht deutsche und technische Status-Werte', () => {
    expect(parseCustomerStatus('')).toBe('ACTIVE');
    expect(parseCustomerStatus('Aktiv')).toBe('ACTIVE');
    expect(parseCustomerStatus('PAUSED')).toBe('PAUSED');
    expect(parseCustomerStatus('archiviert')).toBe('ARCHIVED');
    expect(parseCustomerStatus('gelöscht')).toBeNull();
  });

  it('versteht Komma- und Punkt-Dezimal', () => {
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parseDecimal('12.5')).toBe(12.5);
    expect(parseDecimal(' 8 ')).toBe(8);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });
});
