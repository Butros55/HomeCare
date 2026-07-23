/**
 * Kleiner, abhängigkeitsfreier CSV-Parser/-Serializer (RFC 4180).
 *
 * Ausgelegt auf deutsche Excel-Dateien: Trennzeichen wird automatisch erkannt
 * (Semikolon bevorzugt, Komma als Fallback), UTF-8-BOM wird entfernt,
 * Anführungszeichen mit `""`-Escapes und mehrzeilige Felder werden korrekt
 * gelesen. Beim Schreiben: Semikolon + CRLF (Excel-kompatibel).
 */

export type CsvRecord = {
  /** Physische Zeilennummer des Record-Beginns in der Datei (1-basiert). */
  line: number;
  fields: string[];
};

export type ParsedCsv = {
  delimiter: ';' | ',';
  header: string[];
  headerLine: number;
  records: CsvRecord[];
};

/** Erkennt das Trennzeichen anhand der ersten nicht-leeren Zeile (außerhalb von Quotes). */
export function detectDelimiter(text: string): ';' | ',' {
  let inQuotes = false;
  let semicolons = 0;
  let commas = 0;
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (char === '\n') break;
      if (char === ';') semicolons += 1;
      else if (char === ',') commas += 1;
    }
  }
  return semicolons >= commas ? ';' : ',';
}

/**
 * Parst CSV-Text in Header + Records. Leere Zeilen werden übersprungen.
 * Wirft nie – fehlerhafte Quotes werden tolerant als Literaltext gelesen.
 */
export function parseCsv(input: string): ParsedCsv {
  // BOM entfernen (Excel exportiert UTF-8 mit BOM).
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);

  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let recordHasContent = false;

  const pushField = () => {
    fields.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    // Komplett leere Zeilen (nur Trennzeichen/Whitespace) überspringen.
    if (recordHasContent || fields.some((f) => f.trim() !== '')) {
      records.push({ line: recordStartLine, fields });
    }
    fields = [];
    recordHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      recordHasContent = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === '\r') {
      // CRLF/CR: beim folgenden \n behandeln bzw. als Zeilenende werten.
      if (text[i + 1] !== '\n') {
        pushRecord();
        line += 1;
        recordStartLine = line;
      }
    } else if (char === '\n') {
      pushRecord();
      line += 1;
      recordStartLine = line;
    } else {
      field += char;
    }
  }
  // Letzter Record ohne abschließenden Zeilenumbruch.
  if (field !== '' || fields.length > 0) pushRecord();

  const headerRecord = records.shift();
  return {
    delimiter,
    header: (headerRecord?.fields ?? []).map((h) => h.trim()),
    headerLine: headerRecord?.line ?? 1,
    records,
  };
}

/** Serialisiert Zeilen als Excel-kompatibles CSV (Semikolon, CRLF, alles gequotet). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (value: string | number | null | undefined) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;
  return rows.map((row) => row.map(esc).join(';')).join('\r\n');
}
