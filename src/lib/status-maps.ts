import type { StatusTone } from '@/components/ui/status-pill';

/**
 * Zentrale Zuordnung: Domänen-Status → Anzeigename (de) + Farbton-Token.
 * Ein Status sieht damit überall gleich aus (Pille, Kalender, Tabelle).
 */

export const CUSTOMER_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: 'Aktiv', tone: 'done' },
  PAUSED: { label: 'Pausiert', tone: 'hold' },
  ARCHIVED: { label: 'Archiviert', tone: 'neutral' },
};

export const EMPLOYEE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: 'Aktiv', tone: 'done' },
  INACTIVE: { label: 'Inaktiv', tone: 'neutral' },
};

export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: 'Vollzeit',
  PART_TIME: 'Teilzeit',
  MINI_JOB: 'Minijob',
  FREELANCE: 'Freiberuflich',
};

export const APPOINTMENT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: 'Entwurf', tone: 'neutral' },
  PLANNED: { label: 'Geplant', tone: 'todo' },
  CONFIRMED: { label: 'Bestätigt', tone: 'review' },
  IN_PROGRESS: { label: 'Läuft', tone: 'progress' },
  COMPLETED: { label: 'Abgeschlossen', tone: 'done' },
  CANCELLED: { label: 'Abgesagt', tone: 'stuck' },
  NO_SHOW: { label: 'Nicht angetroffen', tone: 'stuck' },
};

export const ASSIGNMENT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  UNASSIGNED: { label: 'Offen', tone: 'progress' },
  ASSIGNED: { label: 'Zugewiesen', tone: 'todo' },
  ACCEPTED: { label: 'Angenommen', tone: 'done' },
  DECLINED: { label: 'Abgelehnt', tone: 'stuck' },
  NEEDS_REASSIGNMENT: { label: 'Neu zu besetzen', tone: 'progress' },
};

export const ABSENCE_TYPE_LABELS: Record<string, string> = {
  VACATION: 'Urlaub',
  SICK: 'Krank',
  TRAINING: 'Fortbildung',
  OTHER: 'Sonstiges',
};

export const ABSENCE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  REQUESTED: { label: 'Angefragt', tone: 'progress' },
  APPROVED: { label: 'Genehmigt', tone: 'done' },
  REJECTED: { label: 'Abgelehnt', tone: 'stuck' },
};

export const BUDGET_SOURCE_LABELS: Record<string, string> = {
  CONTRACT: 'Vertrag',
  INSURANCE: 'Kasse/Versicherung',
  PRIVATE: 'Privat',
  OTHER: 'Sonstiges',
};

export const TIME_ENTRY_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  RUNNING: { label: 'Läuft', tone: 'progress' },
  COMPLETED: { label: 'Erfasst', tone: 'todo' },
  APPROVED: { label: 'Freigegeben', tone: 'done' },
  REJECTED: { label: 'Abgelehnt', tone: 'stuck' },
};

export const ROUTE_PLAN_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: 'Entwurf', tone: 'progress' },
  PUBLISHED: { label: 'Freigegeben', tone: 'done' },
  ARCHIVED: { label: 'Archiviert', tone: 'neutral' },
};

export const MEMBERSHIP_ROLE_LABELS: Record<string, string> = {
  ORGANIZATION_OWNER: 'Admin (Inhaber)',
  ADMIN: 'Leitung',
  DISPATCHER: 'Leitung (Disposition)',
  TEAM_MANAGER: 'Leitung (Team)',
  EMPLOYEE: 'Mitarbeiter',
};

export function statusOf(
  map: Record<string, { label: string; tone: StatusTone }>,
  key: string,
): { label: string; tone: StatusTone } {
  return map[key] ?? { label: key, tone: 'neutral' };
}
