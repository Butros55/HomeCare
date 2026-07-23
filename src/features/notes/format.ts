/** Zeitstempel einer Notiz – einheitlich in Kopfzeile und Blätter-Karussell. */
export function formatNoteUpdatedAt(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/**
 * Nächster freier Standardname für eine neue Seite: „Neue Notiz", danach
 * „Neue Notiz 2", „Neue Notiz 3" … (Lücken werden wieder aufgefüllt).
 */
export function nextUntitledNoteName(
  titles: readonly string[],
  base = 'Neue Notiz',
): string {
  const used = new Set(titles.map((title) => title.trim()));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
