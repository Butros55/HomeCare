/**
 * Gemeinsames CSV-Schema für Kunden-Export und -Import.
 *
 * Eine Quelle für: Export-Spalten, Import-Header-Erkennung, Vorlagen-Download
 * und die Spalten-Dokumentation im Import-Dialog. Export und Import sind
 * roundtrip-fähig – eine exportierte Datei lässt sich unverändert importieren.
 */

export type CustomerCsvColumn = {
  /** Interner Schlüssel (stabil, unabhängig vom deutschen Header). */
  key:
    | 'customerNumber'
    | 'salutation'
    | 'firstName'
    | 'lastName'
    | 'companyName'
    | 'email'
    | 'phone'
    | 'secondaryPhone'
    | 'status'
    | 'street'
    | 'houseNumber'
    | 'addressAddition'
    | 'postalCode'
    | 'city'
    | 'countryCode'
    | 'preferredEmployeeNumber'
    | 'color'
    | 'monthlyHours'
    | 'routeNotes'
    | 'accessInstructions'
    | 'cleaningInstructions'
    | 'privateNotes'
    | 'latitude'
    | 'longitude';
  /** Deutscher Spaltenkopf (Export-Header, Import-Erkennung). */
  label: string;
  /** Zusätzlich akzeptierte Header beim Import (normalisiert verglichen). */
  aliases?: string[];
  required?: boolean;
  /** Kurzbeschreibung für den Import-Dialog / die Doku. */
  description: string;
  example: string;
};

export const CUSTOMER_CSV_COLUMNS: CustomerCsvColumn[] = [
  {
    key: 'customerNumber',
    label: 'Kundennummer',
    aliases: ['kunden-nr', 'kundennr', 'nummer'],
    description: 'Eindeutig je Organisation. Leer = wird automatisch vergeben (K-1001 …). Vorhandene Nummer = bestehender Kunde (überspringen oder aktualisieren).',
    example: 'K-1001',
  },
  { key: 'salutation', label: 'Anrede', description: 'Frei, z. B. Frau/Herr.', example: 'Frau' },
  { key: 'firstName', label: 'Vorname', required: true, description: 'Pflichtfeld.', example: 'Helga' },
  { key: 'lastName', label: 'Nachname', required: true, description: 'Pflichtfeld.', example: 'Brinkmann' },
  { key: 'companyName', label: 'Firma', description: 'Optional (z. B. Betreuungsdienst).', example: '' },
  { key: 'email', label: 'E-Mail', aliases: ['email', 'mail'], description: 'Optional, muss gültig sein.', example: 'helga@example.de' },
  { key: 'phone', label: 'Telefon', description: 'Optional.', example: '+49 251 481101' },
  { key: 'secondaryPhone', label: 'Telefon 2', aliases: ['telefon2', 'mobil'], description: 'Optional.', example: '' },
  {
    key: 'status',
    label: 'Status',
    description: '„Aktiv“, „Pausiert“ oder „Archiviert“ (auch ACTIVE/PAUSED/ARCHIVED). Leer = Aktiv.',
    example: 'Aktiv',
  },
  { key: 'street', label: 'Straße', aliases: ['strasse'], required: true, description: 'Pflichtfeld.', example: 'Prinzipalmarkt' },
  { key: 'houseNumber', label: 'Hausnummer', aliases: ['nr', 'hausnr'], required: true, description: 'Pflichtfeld.', example: '22' },
  { key: 'addressAddition', label: 'Adresszusatz', description: 'Optional, z. B. „2. OG links“.', example: '' },
  { key: 'postalCode', label: 'PLZ', aliases: ['postleitzahl'], required: true, description: 'Pflichtfeld, 4–5 Ziffern.', example: '48143' },
  { key: 'city', label: 'Ort', aliases: ['stadt'], required: true, description: 'Pflichtfeld.', example: 'Münster' },
  { key: 'countryCode', label: 'Land', aliases: ['landcode', 'länderkennung'], description: '2-Buchstaben-Code. Leer = DE.', example: 'DE' },
  {
    key: 'preferredEmployeeNumber',
    label: 'Zuständig (Personalnummer)',
    aliases: ['zustaendig (personalnummer)', 'personalnummer', 'zuständig'],
    description: 'Personalnummer des zuständigen Mitarbeiters (z. B. MA-001). Unbekannte Nummer → Hinweis, Feld bleibt leer.',
    example: 'MA-001',
  },
  {
    key: 'color',
    label: 'Farbe',
    description: 'Hex-Farbe für Kalender/Karte (#RRGGBB). Leer = Standardfarbe.',
    example: '#6c5ce7',
  },
  {
    key: 'monthlyHours',
    label: 'Stunden pro Monat',
    aliases: ['stunden/monat', 'monatsstunden', 'gebuchte stunden'],
    description: 'Gebuchte Stunden – legt beim NEU-Anlegen ein Budget für den aktuellen Monat an (Komma oder Punkt, z. B. „12,5“). Bei Aktualisierungen ignoriert.',
    example: '12',
  },
  { key: 'routeNotes', label: 'Routen-Hinweise', description: 'Optional, sichtbar in der Routenplanung.', example: '' },
  { key: 'accessInstructions', label: 'Zugangshinweise', description: 'Optional (Schlüssel, Klingel …).', example: '' },
  { key: 'cleaningInstructions', label: 'Arbeitshinweise', aliases: ['reinigungshinweise'], description: 'Optional.', example: '' },
  {
    key: 'privateNotes',
    label: 'Private Notizen',
    description: 'Nur mit Berechtigung „Private Kundennotizen“ exportiert/importiert.',
    example: '',
  },
  {
    key: 'latitude',
    label: 'Breitengrad',
    aliases: ['lat'],
    description: 'Optional. Sind Breiten- UND Längengrad gefüllt, wird die Koordinate direkt übernommen (kein Geocoding nötig – ideal für Re-Import eines Exports).',
    example: '51.9617',
  },
  { key: 'longitude', label: 'Längengrad', aliases: ['lng', 'lon'], description: 'Optional, siehe Breitengrad.', example: '7.6280' },
];

/** Header normalisieren: Klein, getrimmt, ohne doppelte Leerzeichen. */
export function normalizeCsvHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Ordnet Datei-Header den Schema-Spalten zu. Unbekannte Header bleiben erhalten. */
export function matchCsvHeaders(fileHeaders: string[]): {
  /** Index in der Datei → Spalten-Key (oder null = unbekannt). */
  mapping: (CustomerCsvColumn['key'] | null)[];
  unknown: string[];
  missingRequired: string[];
} {
  const byNormalized = new Map<string, CustomerCsvColumn['key']>();
  for (const column of CUSTOMER_CSV_COLUMNS) {
    byNormalized.set(normalizeCsvHeader(column.label), column.key);
    for (const alias of column.aliases ?? []) byNormalized.set(normalizeCsvHeader(alias), column.key);
  }

  const mapping = fileHeaders.map((h) => byNormalized.get(normalizeCsvHeader(h)) ?? null);
  const unknown = fileHeaders.filter((h, i) => h.trim() !== '' && mapping[i] === null);
  const present = new Set(mapping.filter(Boolean));
  const missingRequired = CUSTOMER_CSV_COLUMNS.filter((c) => c.required && !present.has(c.key)).map(
    (c) => c.label,
  );
  return { mapping, unknown, missingRequired };
}

/** Status-Werte (deutsch + technisch) → Prisma-Enum. */
export function parseCustomerStatus(value: string): 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === '' ) return 'ACTIVE';
  if (['aktiv', 'active'].includes(normalized)) return 'ACTIVE';
  if (['pausiert', 'paused', 'pause'].includes(normalized)) return 'PAUSED';
  if (['archiviert', 'archived', 'archiv'].includes(normalized)) return 'ARCHIVED';
  return null;
}

/** Dezimalzahl mit deutschem Komma oder Punkt („12,5“ / „12.5“). */
export function parseDecimal(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (normalized === '') return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export const CUSTOMER_CSV_FILENAME_PREFIX = 'kunden';

/** Vorlagen-Zeilen (Header + ein Beispiel) für den Download im Import-Dialog. */
export function customerCsvTemplateRows(): string[][] {
  return [
    CUSTOMER_CSV_COLUMNS.map((c) => c.label),
    CUSTOMER_CSV_COLUMNS.map((c) => c.example),
  ];
}
