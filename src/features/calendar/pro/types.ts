import type { CalendarEventDto } from '@/server/services/calendar-service';

/**
 * Ereignismodell des portierten StudyMate-Kalenders, gespeist aus HomeCare-
 * Terminen (CalendarEventDto). `kind` bestimmt die Farbwelt der Chips/Blöcke:
 *
 *  - planned    → Himmelblau  (geplant)
 *  - confirmed  → Smaragd     (bestätigt / läuft)
 *  - done       → Violett     (abgeschlossen)
 *  - open       → Bernstein   (keine Zuordnung – Handlungsbedarf)
 *  - cancelled  → schraffiert (abgesagt / nicht erschienen)
 */
export type ProEventKind = 'planned' | 'confirmed' | 'done' | 'open' | 'cancelled';

export const PRO_EVENT_KINDS: ProEventKind[] = ['planned', 'confirmed', 'done', 'open', 'cancelled'];
export const SOLO_EVENT_KINDS: ProEventKind[] = ['open', 'done', 'cancelled'];

export const PRO_KIND_LABELS: Record<ProEventKind, string> = {
  planned: 'Geplant',
  confirmed: 'Bestätigt',
  done: 'Abgeschlossen',
  open: 'Ohne Zuordnung',
  cancelled: 'Abgesagt',
};

export const SOLO_KIND_LABELS: Record<ProEventKind, string> = {
  planned: 'Offen',
  confirmed: 'Offen',
  done: 'Abgeschlossen',
  open: 'Offen',
  cancelled: 'Abgesagt',
};

export interface ProCalendarEvent {
  id: string;
  kind: ProEventKind;
  /** Kompakter Chip-Text (Kunde). */
  summary: string;
  /** Untertitel (Titel des Einsatzes, ggf. Mitarbeiter). */
  detail: string;
  start: string;
  end: string;
  customerName: string;
  customerColor: string;
  employeeName: string | null;
  /** Nur im Team-Modus ein eigener Handlungsbedarf; Solo kennt keine Zuweisung. */
  unassigned: boolean;
  hasConflict: boolean;
  status: string;
}

export function kindForEvent(event: CalendarEventDto, soloMode = false): ProEventKind {
  if (event.status === 'CANCELLED' || event.status === 'NO_SHOW') return 'cancelled';
  if (event.status === 'COMPLETED') return 'done';
  if (soloMode || !event.employeeId) return 'open';
  if (event.status === 'CONFIRMED' || event.status === 'IN_PROGRESS') return 'confirmed';
  return 'planned';
}

export function toProEvent(event: CalendarEventDto, soloMode = false): ProCalendarEvent {
  return {
    id: event.id,
    kind: kindForEvent(event, soloMode),
    summary: event.customerName,
    detail: [event.title, soloMode ? null : event.employeeName].filter(Boolean).join(' · '),
    start: event.start,
    end: event.end,
    customerName: event.customerName,
    customerColor: event.customerColor,
    employeeName: event.employeeName,
    unassigned: !soloMode && !event.employeeId,
    hasConflict: event.hasConflict,
    status: event.status,
  };
}

/** Lokaler Tages-Schlüssel "YYYY-MM-DD" (Organisationszeit = Browserzeit der Nutzer). */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
