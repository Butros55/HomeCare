/**
 * Einheitliche Fehlercodes für API-/Action-Antworten.
 * Serverseitig geworfen als AppError (src/server/errors.ts), im Client
 * über die deutschsprachigen Meldungen unten angezeigt.
 */
export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'ACCESS_DENIED',
  'ORGANIZATION_SCOPE_VIOLATION',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'CUSTOMER_NOT_FOUND',
  'EMPLOYEE_NOT_FOUND',
  'APPOINTMENT_NOT_FOUND',
  'BUDGET_NOT_FOUND',
  'HOUR_BUDGET_EXCEEDED',
  'ALLOCATION_POOL_EXCEEDED',
  'RECIPIENT_INACTIVE',
  'RECIPIENT_CANNOT_RECEIVE_HOURS',
  'HIERARCHY_CYCLE',
  'HIERARCHY_SELF_REFERENCE',
  'APPOINTMENT_CONFLICT',
  'SERIES_INVALID_RULE',
  'ROUTE_NOT_FEASIBLE',
  'SUGGESTION_STALE',
  'GEOCODING_FAILED',
  'GEOCODING_AMBIGUOUS',
  'ADDRESS_MISSING',
  'SOFT_DELETE_REQUIRED',
  'INVALID_CREDENTIALS',
  'INVITATION_INVALID',
  'TOKEN_INVALID',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: 'Bitte melde dich an, um fortzufahren.',
  ACCESS_DENIED: 'Dafür fehlt dir die Berechtigung.',
  ORGANIZATION_SCOPE_VIOLATION: 'Der Datensatz gehört nicht zu deiner Organisation.',
  VALIDATION_FAILED: 'Die Eingaben sind unvollständig oder ungültig.',
  RATE_LIMITED: 'Zu viele Versuche. Bitte warte einen Moment.',
  NOT_FOUND: 'Der Datensatz wurde nicht gefunden.',
  CUSTOMER_NOT_FOUND: 'Der Kunde wurde nicht gefunden.',
  EMPLOYEE_NOT_FOUND: 'Der Mitarbeiter wurde nicht gefunden.',
  APPOINTMENT_NOT_FOUND: 'Der Termin wurde nicht gefunden.',
  BUDGET_NOT_FOUND: 'Das Stundenbudget wurde nicht gefunden.',
  HOUR_BUDGET_EXCEEDED: 'Das verfügbare Stundenbudget reicht dafür nicht aus.',
  ALLOCATION_POOL_EXCEEDED: 'Dein verfügbarer Stundenpool reicht dafür nicht aus.',
  RECIPIENT_INACTIVE: 'Der Empfänger ist nicht aktiv.',
  RECIPIENT_CANNOT_RECEIVE_HOURS: 'Der Empfänger kann keine Stunden erhalten.',
  HIERARCHY_CYCLE: 'Diese Zuordnung würde einen Kreis in der Hierarchie erzeugen.',
  HIERARCHY_SELF_REFERENCE: 'Ein Mitarbeiter kann nicht sein eigener Vorgesetzter sein.',
  APPOINTMENT_CONFLICT: 'Der Termin kollidiert mit einer bestehenden Planung.',
  SERIES_INVALID_RULE: 'Die Wiederholungsregel ist ungültig.',
  ROUTE_NOT_FEASIBLE: 'Für diese Vorgaben existiert keine zulässige Route.',
  SUGGESTION_STALE:
    'Der Vorschlag ist nicht mehr aktuell (Daten haben sich geändert) – bitte Vorschläge neu generieren.',
  GEOCODING_FAILED: 'Die Adresse konnte nicht geokodiert werden.',
  GEOCODING_AMBIGUOUS: 'Die Adresse ist mehrdeutig – bitte einen Treffer auswählen.',
  ADDRESS_MISSING: 'Für diese Aktion wird eine Adresse mit Koordinaten benötigt.',
  SOFT_DELETE_REQUIRED:
    'Der Datensatz hat verknüpfte Historie und kann nur archiviert werden.',
  INVALID_CREDENTIALS: 'Anmeldung fehlgeschlagen. Bitte Eingaben prüfen.',
  INVITATION_INVALID: 'Die Einladung ist ungültig oder abgelaufen.',
  TOKEN_INVALID: 'Der Link ist ungültig oder abgelaufen.',
  CONFLICT: 'Die Aktion steht im Konflikt mit dem aktuellen Datenstand.',
  INTERNAL_ERROR: 'Unerwarteter Fehler. Bitte erneut versuchen.',
};

export function messageForCode(code: string | undefined | null): string {
  if (code && code in ERROR_MESSAGES) return ERROR_MESSAGES[code as ErrorCode];
  return ERROR_MESSAGES.INTERNAL_ERROR;
}
