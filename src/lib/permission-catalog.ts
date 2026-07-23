/**
 * Berechtigungs-Katalog – gemeinsame Quelle für Server (Prüfung) und UI
 * (Editor in den Einstellungen). Die Durchsetzung passiert ausschließlich
 * serverseitig in src/server/permissions.
 */

export type Permission =
  | 'customers.read'
  | 'customers.manage'
  | 'customers.privateNotes'
  | 'employees.read'
  | 'employees.manage'
  | 'employees.invite'
  | 'hours.allocateOrg'
  | 'hours.allocateOwnPool'
  | 'budgets.manage'
  | 'appointments.viewAll'
  | 'appointments.manage'
  | 'timeEntries.approve'
  | 'routes.manage'
  | 'reports.view'
  | 'notifications.broadcast'
  | 'settings.manage'
  | 'members.manage'
  | 'organization.transferOwnership'
  | 'audit.view'
  | 'privacy.export';

export const ALL_PERMISSIONS: readonly Permission[] = [
  'customers.read',
  'customers.manage',
  'customers.privateNotes',
  'employees.read',
  'employees.manage',
  'employees.invite',
  'hours.allocateOrg',
  'hours.allocateOwnPool',
  'budgets.manage',
  'appointments.viewAll',
  'appointments.manage',
  'timeEntries.approve',
  'routes.manage',
  'reports.view',
  'notifications.broadcast',
  'settings.manage',
  'members.manage',
  'organization.transferOwnership',
  'audit.view',
  'privacy.export',
];

/** Im Berechtigungseditor wählbar (Inhaberschafts-Übertragung bleibt Owner-exklusiv). */
export const EDITABLE_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter(
  (permission) => permission !== 'organization.transferOwnership',
);

export const PERMISSION_LABELS: Record<Permission, string> = {
  'customers.read': 'Kunden ansehen',
  'customers.manage': 'Kunden anlegen & bearbeiten',
  'customers.privateNotes': 'Private Kundennotizen',
  'employees.read': 'Mitarbeiter ansehen',
  'employees.manage': 'Mitarbeiter anlegen & bearbeiten',
  'employees.invite': 'Mitarbeiter einladen',
  'hours.allocateOrg': 'Stunden organisationsweit verteilen',
  'hours.allocateOwnPool': 'Stunden aus eigenem Pool verteilen',
  'budgets.manage': 'Stundenbudgets verwalten',
  'appointments.viewAll': 'Alle Termine sehen',
  'appointments.manage': 'Termine planen & ändern',
  'timeEntries.approve': 'Zeiterfassung freigeben',
  'routes.manage': 'Routen planen',
  'reports.view': 'Auswertungen ansehen',
  'notifications.broadcast': 'Mitteilungen an alle senden',
  'settings.manage': 'Einstellungen verwalten',
  'members.manage': 'Konten & Berechtigungen verwalten',
  'organization.transferOwnership': 'Inhaberschaft übertragen',
  'audit.view': 'Aktivitätsprotokoll ansehen',
  'privacy.export': 'Datenexport (DSGVO)',
};

/** Gruppierung für den Editor (Reihenfolge = Anzeige). */
export const PERMISSION_GROUPS: { title: string; permissions: Permission[] }[] = [
  {
    title: 'Kunden & Stunden',
    permissions: [
      'customers.read',
      'customers.manage',
      'customers.privateNotes',
      'budgets.manage',
      'hours.allocateOrg',
      'hours.allocateOwnPool',
    ],
  },
  {
    title: 'Planung',
    permissions: ['appointments.viewAll', 'appointments.manage', 'routes.manage', 'timeEntries.approve'],
  },
  {
    title: 'Mitarbeiter & Konten',
    permissions: ['employees.read', 'employees.manage', 'employees.invite', 'members.manage'],
  },
  {
    title: 'Organisation',
    permissions: ['reports.view', 'notifications.broadcast', 'settings.manage', 'audit.view', 'privacy.export'],
  },
];

/**
 * Standard-Berechtigungen neuer Leitungs-Konten (entspricht der bisherigen
 * Admin-Rolle ohne Inhaberschafts-Übertragung). Pro Organisation über die
 * Einstellungen anpassbar (defaultLeadershipPermissions).
 */
export const LEADERSHIP_DEFAULT_PERMISSIONS: readonly Permission[] = EDITABLE_PERMISSIONS;

/**
 * Standard-Berechtigungen neuer Mitarbeiter-Konten: Mitarbeiter arbeiten
 * standardmäßig nur mit den eigenen Terminen/Routen (Scope-Logik) und
 * erhalten keine zusätzlichen Verwaltungsrechte.
 */
export const EMPLOYEE_DEFAULT_PERMISSIONS: readonly Permission[] = [];

/** Unbekannte Strings (z. B. aus alten Datenständen) herausfiltern. */
export function sanitizePermissions(value: unknown): Permission[] | null {
  if (!Array.isArray(value)) return null;
  const set = new Set(ALL_PERMISSIONS);
  return value.filter((entry): entry is Permission => typeof entry === 'string' && set.has(entry as Permission));
}
