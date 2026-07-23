/**
 * Automatische Konfliktauflösung für einen Mitarbeitertag (reine Logik).
 *
 * Regeln (Anforderung Juli 2026):
 *  - **Fixe Termine bleiben fix** (isFlexible = false) – sie sind Anker.
 *  - **Flexible Termine** werden innerhalb ihres Fensters [earliestStart,
 *    latestEnd] so verschoben, dass keine Überschneidung mehr besteht und der
 *    Tag möglichst früh/kompakt liegt (frühestmögliche freie Lücke).
 *  - Was sich nicht überschneidungsfrei einplanen lässt (z. B. zwei fixe
 *    Termine übereinander oder ein zu enges Fenster), bleibt unverändert und
 *    wird als „ungelöst" gemeldet – dann ist manuelles Eingreifen nötig.
 *
 * DB-frei und unit-getestet (src/lib/conflict-resolver.test.ts); der Service
 * lädt die Termine und wendet die Vorschläge an.
 */

export interface ResolverAppointment {
  id: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  isFlexible: boolean;
  earliestStartAt: Date | null;
  latestEndAt: Date | null;
}

export interface ResolverMove {
  id: string;
  newStart: Date;
  newEnd: Date;
}

export interface ResolverResult {
  /** Überschneidung bestand vor der Auflösung (Assistent nur dann sinnvoll). */
  hadOverlap: boolean;
  /** Verschobene flexible Termine (neue Zeiten, gleiche Dauer). */
  moves: ResolverMove[];
  /** Termin-IDs, die nicht überschneidungsfrei platziert werden konnten. */
  unresolved: string[];
}

interface Interval {
  start: number;
  end: number;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Liegt [start, start+dur] frei (kein Overlap mit einem belegten Intervall inkl. Puffer)? */
function fits(start: number, durationMs: number, occupied: Interval[], gapMs: number): boolean {
  const candidate = { start, end: start + durationMs };
  return !occupied.some((interval) =>
    overlaps(
      { start: candidate.start - gapMs, end: candidate.end + gapMs },
      interval,
    ),
  );
}

export function resolveDayOverlaps(
  appointments: ResolverAppointment[],
  options: {
    dayStart: Date;
    dayEnd: Date;
    bufferMinutes?: number;
    /** Genehmigte Abwesenheiten als blockierte Zeitfenster (unverrückbar). */
    blockedIntervals?: { start: Date; end: Date }[];
  },
): ResolverResult {
  const gapMs = Math.max(0, options.bufferMinutes ?? 0) * 60_000;
  const dayStartMs = options.dayStart.getTime();
  const dayEndMs = options.dayEnd.getTime();
  const blocked: Interval[] = (options.blockedIntervals ?? []).map((interval) => ({
    start: interval.start.getTime(),
    end: interval.end.getTime(),
  }));

  // Konflikt vorhanden? Überschneidung ODER Termin in einer Abwesenheit.
  const sortedAll = [...appointments].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  let hadOverlap = false;
  for (let i = 0; i < sortedAll.length && !hadOverlap; i += 1) {
    for (let j = i + 1; j < sortedAll.length; j += 1) {
      if (sortedAll[j]!.startAt.getTime() >= sortedAll[i]!.endAt.getTime()) break;
      hadOverlap = true;
      break;
    }
  }
  if (!hadOverlap) {
    hadOverlap = appointments.some((a) =>
      blocked.some((b) => overlaps({ start: a.startAt.getTime(), end: a.endAt.getTime() }, b)),
    );
  }
  if (!hadOverlap) {
    return { hadOverlap: false, moves: [], unresolved: [] };
  }

  // Fixe Termine + Abwesenheiten sind Anker (bleiben, wo sie sind).
  const occupied: Interval[] = [
    ...appointments
      .filter((a) => !a.isFlexible)
      .map((a) => ({ start: a.startAt.getTime(), end: a.endAt.getTime() })),
    ...blocked,
  ];

  // Fixe Termine, die sich gegenseitig überschneiden, sind nicht auflösbar.
  const unresolved: string[] = [];
  const fixed = appointments.filter((a) => !a.isFlexible);
  for (let i = 0; i < fixed.length; i += 1) {
    for (let j = i + 1; j < fixed.length; j += 1) {
      if (
        overlaps(
          { start: fixed[i]!.startAt.getTime(), end: fixed[i]!.endAt.getTime() },
          { start: fixed[j]!.startAt.getTime(), end: fixed[j]!.endAt.getTime() },
        )
      ) {
        if (!unresolved.includes(fixed[i]!.id)) unresolved.push(fixed[i]!.id);
        if (!unresolved.includes(fixed[j]!.id)) unresolved.push(fixed[j]!.id);
      }
    }
  }

  // Flexible Termine frühestmöglich in freie Lücken legen.
  const flexible = appointments
    .filter((a) => a.isFlexible)
    .sort(
      (a, b) =>
        (a.earliestStartAt ?? a.startAt).getTime() - (b.earliestStartAt ?? b.startAt).getTime(),
    );

  const moves: ResolverMove[] = [];
  for (const appointment of flexible) {
    const durationMs = appointment.durationMinutes * 60_000;
    // Minimale Störung: nicht vor den ursprünglichen Beginn (bzw. das gepflegte
    // früheste Fenster) verschieben – nur bei Bedarf nach hinten schieben.
    const desiredEarliest = appointment.earliestStartAt
      ? appointment.earliestStartAt.getTime()
      : appointment.startAt.getTime();
    const lowerBound = Math.max(dayStartMs, desiredEarliest);
    const upperEnd = Math.min(
      dayEndMs,
      appointment.latestEndAt ? appointment.latestEndAt.getTime() : dayEndMs,
    );

    // Kandidatenstarts: frühester erlaubter Beginn + jeweils direkt nach einem
    // belegten Intervall (aufsteigend), damit die Lösung kompakt bleibt.
    const candidateStarts = [
      lowerBound,
      ...occupied.map((interval) => interval.end + gapMs).filter((start) => start >= lowerBound),
    ].sort((a, b) => a - b);

    let placed = false;
    for (const start of candidateStarts) {
      if (start + durationMs > upperEnd) break;
      if (fits(start, durationMs, occupied, gapMs)) {
        occupied.push({ start, end: start + durationMs });
        if (start !== appointment.startAt.getTime()) {
          moves.push({
            id: appointment.id,
            newStart: new Date(start),
            newEnd: new Date(start + durationMs),
          });
        }
        placed = true;
        break;
      }
    }
    if (!placed) unresolved.push(appointment.id);
  }

  return { hadOverlap, moves, unresolved };
}
