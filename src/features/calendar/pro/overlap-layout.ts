/**
 * Spalten-Layout für überlappende Kalender-Termine (Wochen-/Tagesansicht).
 *
 * Überschneidende Termine werden – wie in Google Kalender – in Spalten
 * nebeneinander gelegt, damit alle lesbar und einzeln anklickbar sind, auch
 * wenn zwei Termine exakt dieselbe Zeit haben. Reine Berechnung, unit-getestet.
 */

export interface TimeSpan {
  startMinutes: number;
  endMinutes: number;
}

export interface OverlapPlacement {
  /** Spaltenindex innerhalb der Überlappungsgruppe (0-basiert). */
  colIndex: number;
  /** Gesamtzahl der Spalten der Gruppe. */
  colCount: number;
}

export function layoutOverlapping<T extends TimeSpan>(entries: T[]): (T & OverlapPlacement)[] {
  const result = [...entries]
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes)
    .map((entry) => ({ ...entry, colIndex: 0, colCount: 1 }));

  let i = 0;
  while (i < result.length) {
    // Cluster transitiv überlappender Termine sammeln.
    let clusterEnd = result[i]!.endMinutes;
    let j = i + 1;
    const cluster = [result[i]!];
    while (j < result.length && result[j]!.startMinutes < clusterEnd) {
      cluster.push(result[j]!);
      clusterEnd = Math.max(clusterEnd, result[j]!.endMinutes);
      j += 1;
    }
    // Greedy: jeden Termin in die erste freie Spalte legen.
    const colEnds: number[] = [];
    for (const entry of cluster) {
      let placed = false;
      for (let c = 0; c < colEnds.length; c += 1) {
        if (entry.startMinutes >= colEnds[c]!) {
          entry.colIndex = c;
          colEnds[c] = entry.endMinutes;
          placed = true;
          break;
        }
      }
      if (!placed) {
        entry.colIndex = colEnds.length;
        colEnds.push(entry.endMinutes);
      }
    }
    for (const entry of cluster) entry.colCount = colEnds.length;
    i = j;
  }
  return result;
}
