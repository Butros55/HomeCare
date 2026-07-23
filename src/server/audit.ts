import 'server-only';

import type { Prisma } from '@prisma/client';

import { db } from '@/server/db';

/**
 * Audit-Log-Service.
 *
 * Grundsatz: Es werden nie Passwörter, Tokens oder vollständige sensible
 * Inhalte protokolliert – nur Aktion, Entität und knappe Metadaten
 * (Feldnamen, Kurzwerte, IDs). Anzeige: Einstellungen → Aktivität sowie
 * Aktivitäts-Tabs der Detailseiten.
 */
export interface AuditEntry {
  organizationId: string;
  actorUserId?: string | null;
  /** z. B. "customer.created", "hours.allocated", "appointment.rescheduled" */
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

type Tx = Prisma.TransactionClient;

/** Schreibt einen Audit-Eintrag; innerhalb einer Transaktion `tx` übergeben. */
export async function writeAuditLog(entry: AuditEntry, tx?: Tx): Promise<void> {
  const client = tx ?? db;
  await client.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

/** Menschlich lesbare Beschriftungen für den Aktivitätsverlauf. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'organization.created': 'Organisation angelegt',
  'organization.updated': 'Organisationseinstellungen geändert',
  'member.invited': 'Mitglied eingeladen',
  'member.joined': 'Mitglied beigetreten',
  'member.roleChanged': 'Rolle geändert',
  'member.suspended': 'Mitglied gesperrt',
  'member.earningsSettingsChanged': 'Verdienst-Einstellungen geändert',
  'customer.created': 'Kunde angelegt',
  'customer.updated': 'Kunde geändert',
  'customer.archived': 'Kunde archiviert',
  'customer.restored': 'Kunde wiederhergestellt',
  'customer.anonymized': 'Kunde anonymisiert',
  'customer.exported': 'Kundendaten exportiert',
  'employee.created': 'Mitarbeiter angelegt',
  'employee.updated': 'Mitarbeiter geändert',
  'employee.deactivated': 'Mitarbeiter deaktiviert',
  'employee.reactivated': 'Mitarbeiter reaktiviert',
  'employee.managerChanged': 'Vorgesetzten geändert',
  'employee.exported': 'Mitarbeiterdaten exportiert',
  'availability.updated': 'Verfügbarkeit geändert',
  'absence.created': 'Abwesenheit eingetragen',
  'absence.updated': 'Abwesenheit geändert',
  'absence.deleted': 'Abwesenheit entfernt',
  'budget.created': 'Stundenbudget angelegt',
  'budget.updated': 'Stundenbudget geändert',
  'budget.adjusted': 'Stundenbudget korrigiert',
  'budget.deleted': 'Stundenbudget entfernt',
  'hours.allocated': 'Stunden übertragen',
  'hours.allocationUpdated': 'Stundenzuweisung geändert',
  'hours.allocationRevoked': 'Stundenzuweisung zurückgezogen',
  'appointment.created': 'Termin angelegt',
  'appointment.updated': 'Termin geändert',
  'appointment.rescheduled': 'Termin verschoben',
  'appointment.assigned': 'Mitarbeiterzuweisung geändert',
  'appointment.statusChanged': 'Terminstatus geändert',
  'appointment.cancelled': 'Termin abgesagt',
  'appointment.deleted': 'Termin gelöscht',
  'series.created': 'Serientermin angelegt',
  'series.updated': 'Serienregel geändert',
  'series.ended': 'Serie beendet',
  'series.deleted': 'Serie gelöscht',
  'timeEntry.recorded': 'Zeit erfasst',
  'timeEntry.approved': 'Zeiterfassung freigegeben',
  'route.generated': 'Route erzeugt',
  'route.published': 'Route freigegeben',
  'route.discarded': 'Route verworfen',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
