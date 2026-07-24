/**
 * Zentraler Konfliktservice (Anforderung 14) – reine Logik, unit-getestet.
 *
 * Schweregrade:
 *  - ERROR:   Speichern nicht erlaubt (fachlich unmöglich/inkonsistent).
 *  - WARNING: Speichern nach ausdrücklicher Bestätigung erlaubt.
 *  - INFO:    reine Empfehlung, blockiert nie.
 *
 * Die Services laden die Datensätze (Termine des Mitarbeiters, Abwesenheiten,
 * Verfügbarkeiten, Fahrzeitschätzungen) und delegieren hierher.
 */
import { isoWeekdayInZone, minutesOfDayInZone, overlaps } from '@/lib/dates';

export type ConflictSeverity = 'ERROR' | 'WARNING' | 'INFO';

export type ConflictType =
  | 'INVALID_DURATION'
  | 'OVERLAP'
  | 'ABSENCE'
  | 'OUTSIDE_AVAILABILITY'
  | 'INSUFFICIENT_TRAVEL_TIME'
  | 'DAY_MAX_EXCEEDED'
  | 'OUTSIDE_CUSTOMER_WINDOW'
  | 'ADDRESS_MISSING'
  | 'DUPLICATE_SERIES_OCCURRENCE'
  | 'NO_HOUR_BUDGET'
  | 'HOUR_BUDGET_OVERPLANNED';

export interface Conflict {
  type: ConflictType;
  severity: ConflictSeverity;
  message: string;
  /** Betroffener Bestands-Termin (für Kalender-Markierung). */
  relatedAppointmentId?: string;
}

export interface CandidateAppointment {
  id?: string;
  assignedEmployeeId: string | null;
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  routeRelevant: boolean;
  /** Hat der Einsatzort Koordinaten? (für ADDRESS_MISSING) */
  locationHasCoordinates: boolean;
  isFlexible: boolean;
  earliestStartAt?: Date | null;
  latestEndAt?: Date | null;
}

export interface ExistingAppointment {
  id: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  title?: string;
  /** Koordinate für Fahrzeitprüfung (optional). */
  latitude?: number | null;
  longitude?: number | null;
}

export interface AvailabilitySlot {
  weekday: number; // 1=Mo … 7=So
  startTime: string; // "HH:mm"
  endTime: string;
}

export interface AbsenceSlot {
  startAt: Date;
  endAt: Date;
  type?: string;
}

export interface ConflictCheckInput {
  candidate: CandidateAppointment;
  /** Termine desselben Mitarbeiters am betroffenen Tag ± Puffer (ohne den Kandidaten selbst). */
  existingAppointments: ExistingAppointment[];
  absences: AbsenceSlot[];
  availabilities: AvailabilitySlot[];
  maximumMinutesPerDay?: number | null;
  /** Bereits geplante Minuten des Mitarbeiters am selben Kalendertag (ohne Kandidat). */
  plannedMinutesSameDay?: number;
  /**
   * Fahrzeitschätzung in Sekunden vom Vorgänger- und zum Nachfolgetermin
   * (null = unbekannt/nicht relevant). Vom Aufrufer via Routing-Provider ermittelt.
   */
  travel?: {
    fromPreviousSeconds?: number | null;
    previousEndAt?: Date | null;
    toNextSeconds?: number | null;
    nextStartAt?: Date | null;
  };
  timezone: string;
}

const fmtTime = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat('de-DE', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(date);

export function checkAppointmentConflicts(input: ConflictCheckInput): Conflict[] {
  const conflicts: Conflict[] = [];
  const { candidate, timezone } = input;

  // 1) Ungültige Dauer – hart.
  if (
    candidate.endAt.getTime() <= candidate.startAt.getTime() ||
    candidate.durationMinutes <= 0 ||
    candidate.durationMinutes > 24 * 60
  ) {
    conflicts.push({
      type: 'INVALID_DURATION',
      severity: 'ERROR',
      message: 'Die Termindauer ist ungültig (Ende muss nach dem Beginn liegen, max. 24 Stunden).',
    });
    return conflicts; // Weitere Prüfungen sind ohne gültige Zeiten sinnlos.
  }

  // 2) Terminüberschneidung desselben Mitarbeiters.
  if (candidate.assignedEmployeeId) {
    for (const existing of input.existingAppointments) {
      if (existing.id === candidate.id) continue;
      if (overlaps(candidate.startAt, candidate.endAt, existing.startAt, existing.endAt)) {
        conflicts.push({
          type: 'OVERLAP',
          severity: 'WARNING',
          message: `Überschneidung mit ${existing.title ?? 'einem Termin'} (${fmtTime(existing.startAt, timezone)}–${fmtTime(existing.endAt, timezone)}).`,
          relatedAppointmentId: existing.id,
        });
      }
    }
  }

  // 3) Termin während einer Abwesenheit.
  if (candidate.assignedEmployeeId) {
    for (const absence of input.absences) {
      if (overlaps(candidate.startAt, candidate.endAt, absence.startAt, absence.endAt)) {
        conflicts.push({
          type: 'ABSENCE',
          severity: 'WARNING',
          message: 'Der Mitarbeiter ist im Terminzeitraum abwesend.',
        });
        break;
      }
    }
  }

  // 4) Außerhalb der Verfügbarkeit (nur wenn überhaupt Verfügbarkeiten gepflegt sind).
  if (candidate.assignedEmployeeId && input.availabilities.length > 0) {
    const weekday = isoWeekdayInZone(candidate.startAt, timezone);
    const startMinutes = minutesOfDayInZone(candidate.startAt, timezone);
    const endMinutes = startMinutes + candidate.durationMinutes;
    const covered = input.availabilities.some((slot) => {
      if (slot.weekday !== weekday) return false;
      const [sh, sm] = slot.startTime.split(':').map(Number);
      const [eh, em] = slot.endTime.split(':').map(Number);
      const slotStart = (sh ?? 0) * 60 + (sm ?? 0);
      const slotEnd = (eh ?? 0) * 60 + (em ?? 0);
      return startMinutes >= slotStart && endMinutes <= slotEnd;
    });
    if (!covered) {
      conflicts.push({
        type: 'OUTSIDE_AVAILABILITY',
        severity: 'WARNING',
        message: 'Der Termin liegt außerhalb der hinterlegten Verfügbarkeit.',
      });
    }
  }

  // 5) Unzureichende Fahrzeit zwischen Terminen.
  if (input.travel) {
    const { fromPreviousSeconds, previousEndAt, toNextSeconds, nextStartAt } = input.travel;
    if (fromPreviousSeconds != null && previousEndAt) {
      const gapSeconds = (candidate.startAt.getTime() - previousEndAt.getTime()) / 1000;
      if (gapSeconds < fromPreviousSeconds) {
        conflicts.push({
          type: 'INSUFFICIENT_TRAVEL_TIME',
          severity: 'WARNING',
          message: `Fahrzeit vom vorherigen Termin reicht nicht (benötigt ~${Math.ceil(fromPreviousSeconds / 60)} Min., verfügbar ${Math.max(0, Math.floor(gapSeconds / 60))} Min.).`,
        });
      }
    }
    if (toNextSeconds != null && nextStartAt) {
      const gapSeconds = (nextStartAt.getTime() - candidate.endAt.getTime()) / 1000;
      if (gapSeconds < toNextSeconds) {
        conflicts.push({
          type: 'INSUFFICIENT_TRAVEL_TIME',
          severity: 'WARNING',
          message: `Fahrzeit zum nächsten Termin reicht nicht (benötigt ~${Math.ceil(toNextSeconds / 60)} Min., verfügbar ${Math.max(0, Math.floor(gapSeconds / 60))} Min.).`,
        });
      }
    }
  }

  // 6) Maximale Tagesarbeitszeit.
  if (
    candidate.assignedEmployeeId &&
    input.maximumMinutesPerDay &&
    input.plannedMinutesSameDay != null
  ) {
    const total = input.plannedMinutesSameDay + candidate.durationMinutes;
    if (total > input.maximumMinutesPerDay) {
      conflicts.push({
        type: 'DAY_MAX_EXCEEDED',
        severity: 'WARNING',
        message: `Tageshöchstarbeitszeit überschritten (${Math.round(total / 60 * 10) / 10} h von max. ${Math.round(input.maximumMinutesPerDay / 60 * 10) / 10} h).`,
      });
    }
  }

  // 7) Außerhalb des Kundenzeitfensters (flexible Termine).
  if (candidate.isFlexible) {
    if (candidate.earliestStartAt && candidate.startAt < candidate.earliestStartAt) {
      conflicts.push({
        type: 'OUTSIDE_CUSTOMER_WINDOW',
        severity: 'WARNING',
        message: `Beginn liegt vor dem frühesten Start (${fmtTime(candidate.earliestStartAt, timezone)}).`,
      });
    }
    if (candidate.latestEndAt && candidate.endAt > candidate.latestEndAt) {
      conflicts.push({
        type: 'OUTSIDE_CUSTOMER_WINDOW',
        severity: 'WARNING',
        message: `Ende liegt nach dem spätesten Ende (${fmtTime(candidate.latestEndAt, timezone)}).`,
      });
    }
  }

  // 8) Fehlende Adresse bei routenrelevanten Terminen.
  if (candidate.routeRelevant && !candidate.locationHasCoordinates) {
    conflicts.push({
      type: 'ADDRESS_MISSING',
      severity: 'INFO',
      message:
        'Für die Routenplanung fehlt eine geokodierte Adresse – der Termin wird in Routen ignoriert.',
    });
  }

  return conflicts;
}

/**
 * Kopplung Termin ↔ Stundenkonto (Konto-Modell, Umbau Juli 2026): Termine
 * sollen nicht unbemerkt ohne bzw. über das Guthaben des Kunden geplant werden.
 * Warnungen blockieren nicht – Planung bleibt möglich, aber sichtbar begründet.
 */
export function checkAccountConflicts(input: {
  /**
   * Verplanbares Guthaben zum Termindatum (ohne den Kandidaten);
   * null = für den Kunden ist gar kein Stundenkonto eingerichtet.
   */
  plannableMinutes: number | null;
  candidateMinutes: number;
}): Conflict[] {
  const fmtHours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;
  if (input.plannableMinutes === null) {
    return [
      {
        type: 'NO_HOUR_BUDGET',
        severity: 'WARNING',
        message:
          'Für den Kunden ist kein Stundenkonto eingerichtet – der Termin wäre nicht durch Guthaben gedeckt.',
      },
    ];
  }
  if (input.candidateMinutes > input.plannableMinutes) {
    return [
      {
        type: 'HOUR_BUDGET_OVERPLANNED',
        severity: 'WARNING',
        message: `Der Termin (${fmtHours(input.candidateMinutes)}) überzieht das verplanbare Guthaben von ${fmtHours(input.plannableMinutes)} um ${fmtHours(input.candidateMinutes - input.plannableMinutes)}.`,
      },
    ];
  }
  return [];
}

/** Doppelte Serienerzeugung: identisches Vorkommen existiert bereits. */
export function duplicateSeriesConflict(occurrenceDateIso: string): Conflict {
  return {
    type: 'DUPLICATE_SERIES_OCCURRENCE',
    severity: 'ERROR',
    message: `Für ${occurrenceDateIso} existiert bereits ein Termin dieser Serie.`,
  };
}

export function hasErrors(conflicts: Conflict[]): boolean {
  return conflicts.some((conflict) => conflict.severity === 'ERROR');
}

export function hasWarnings(conflicts: Conflict[]): boolean {
  return conflicts.some((conflict) => conflict.severity === 'WARNING');
}

/**
 * Liegt der Einsatz [startAt, startAt+durationMinutes) außerhalb ALLER
 * übergebenen Verfügbarkeitsfenster? Leere Fensterliste = „immer verfügbar"
 * (kein Konflikt). Die Fenster müssen bereits auf ihre Gültigkeit (validFrom/
 * validUntil) vorgefiltert sein. Für Kalender-/Dashboard-Markierungen genutzt.
 */
export function isOutsideAvailabilityWindows(
  startAt: Date,
  durationMinutes: number,
  slots: { weekday: number; startTime: string; endTime: string }[],
  timezone: string,
): boolean {
  if (slots.length === 0) return false;
  const weekday = isoWeekdayInZone(startAt, timezone);
  const startMinutes = minutesOfDayInZone(startAt, timezone);
  const endMinutes = startMinutes + durationMinutes;
  return !slots.some((slot) => {
    if (slot.weekday !== weekday) return false;
    const [sh, sm] = slot.startTime.split(':').map(Number);
    const [eh, em] = slot.endTime.split(':').map(Number);
    return startMinutes >= (sh ?? 0) * 60 + (sm ?? 0) && endMinutes <= (eh ?? 0) * 60 + (em ?? 0);
  });
}
