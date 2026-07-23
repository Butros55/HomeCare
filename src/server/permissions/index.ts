import 'server-only';

import type {
  Employee,
  MembershipRole,
  Organization,
  OrganizationMembership,
  User,
} from '@prisma/client';
import { cookies } from 'next/headers';
import { cache } from 'react';

import type { NavPermissions } from '@/components/layout/nav-items';
import { collectSubtree } from '@/lib/hierarchy';
import { sanitizePermissions, type Permission } from '@/lib/permission-catalog';
import { getCurrentSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';

/**
 * Serverseitige Berechtigungslogik. Jede geschützte Operation läuft über:
 *   1. requireAuthenticatedUser / requireOrgContext (Session + Mitgliedschaft)
 *   2. requirePermission (Rolle bzw. individuelle Berechtigungen → Fähigkeit)
 *   3. canAccessEmployee / canAccessCustomer (Datensatz-Scope)
 *   4. assertSameOrg für alle referenzierten Datensätze
 * Matrix und Begründungen: docs/permissions.md
 */

export type { Permission };

const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
  ORGANIZATION_OWNER: [
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
  ],
  ADMIN: [
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
    'audit.view',
    'privacy.export',
  ],
  DISPATCHER: [
    'customers.read',
    'customers.manage',
    'employees.read',
    'hours.allocateOrg',
    'budgets.manage',
    'appointments.viewAll',
    'appointments.manage',
    'timeEntries.approve',
    'routes.manage',
    'reports.view',
  ],
  TEAM_MANAGER: [
    'customers.read',
    'employees.read',
    'employees.manage',
    'hours.allocateOwnPool',
    'appointments.manage',
    'timeEntries.approve',
    'routes.manage',
    'reports.view',
  ],
  EMPLOYEE: [],
};

export function rolePermissions(role: MembershipRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

// ---------------------------------------------------------------------------
// Kontext
// ---------------------------------------------------------------------------

export interface OrgContext {
  user: User;
  membership: OrganizationMembership;
  organization: Organization;
  /** Eigenes Mitarbeiterprofil in dieser Organisation (falls vorhanden). */
  employee: Employee | null;
  /** Leitung: persönliche Kompakt-Ansicht aktiv (reiner Ansichtswechsel, keine Datenänderung). */
  personalView: boolean;
}

export const ACTIVE_ORG_COOKIE = 'hcp_active_org';

/** Authentifizierten Benutzer verlangen (Actions werfen, Pages leiten um). */
export async function requireAuthenticatedUser(): Promise<User> {
  const session = await getCurrentSession();
  if (!session) throw new AppError('AUTH_REQUIRED');
  return session.user;
}

/**
 * Aktive Organisation des Benutzers auflösen: Cookie → Mitgliedschaft prüfen,
 * sonst erste aktive Mitgliedschaft. Pro Request gecacht.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const session = await getCurrentSession();
  if (!session) return null;

  const memberships = await db.organizationMembership.findMany({
    where: { userId: session.user.id, status: 'ACTIVE' },
    include: { organization: true },
    orderBy: { joinedAt: 'asc' },
  });
  if (memberships.length === 0) return null;

  const store = await cookies();
  const preference = await db.userPreference.findUnique({
    where: { userId: session.user.id },
    select: { lastActiveOrganizationId: true, personalViewActive: true },
  });
  const preferredOrgId =
    store.get(ACTIVE_ORG_COOKIE)?.value ?? preference?.lastActiveOrganizationId ?? null;

  const membership =
    memberships.find((m) => m.organizationId === preferredOrgId) ?? memberships[0]!;

  const employee = await db.employee.findFirst({
    where: {
      organizationId: membership.organizationId,
      userId: session.user.id,
      deletedAt: null,
    },
  });

  const { organization, ...membershipRest } = membership;
  return {
    user: session.user,
    membership: membershipRest as OrganizationMembership,
    organization,
    employee,
    personalView: preference?.personalViewActive ?? false,
  };
});

/** Organisationsmitgliedschaft verlangen. */
export async function requireOrganizationMembership(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) throw new AppError('AUTH_REQUIRED');
  return ctx;
}

/** Leitungs-Rollen dürfen verwalten; EMPLOYEE ist das reine Mitarbeiter-Konto. */
export function isLeadershipRole(role: MembershipRole): boolean {
  return role !== 'EMPLOYEE';
}

/**
 * UI-Modus (Anfrage Juli 2026 – zwei getrennte Ansichten):
 *  - 'solo':     Organisation im Alleine-Modus → stark reduziertes Alltags-UI
 *                ohne Mitarbeiter-/Zuweisungslogik (kein Umschalten möglich).
 *  - 'employee': Mitarbeiter-Konto → dasselbe reduzierte UI, aber nur mit den
 *                eigenen (zugewiesenen) Terminen/Routen.
 *  - 'personal': Leitung im Team-Modus hat die persönliche Kompakt-Ansicht
 *                eingeschaltet (reiner Ansichtswechsel – Daten unverändert).
 *  - 'team':     volles Leitungs-UI (wie bisher).
 */
export type UiMode = 'solo' | 'employee' | 'team' | 'personal';

export function uiModeFor(ctx: OrgContext): UiMode {
  if (ctx.membership.role === 'EMPLOYEE') return 'employee';
  if (ctx.organization.soloMode) return 'solo';
  return ctx.personalView ? 'personal' : 'team';
}

/** Darf zwischen Verwaltungs- und persönlicher Ansicht umschalten? */
export function canTogglePersonalView(ctx: OrgContext): boolean {
  return isLeadershipRole(ctx.membership.role) && !ctx.organization.soloMode;
}

/** Individuelle Berechtigungen einer Mitgliedschaft (null = Rollen-Standard). */
export function membershipPermissions(
  membership: Pick<OrganizationMembership, 'permissions'>,
): Permission[] | null {
  return sanitizePermissions(membership.permissions);
}

/**
 * Effektive Berechtigung: Der Inhaber hat immer Vollzugriff; sonst gelten die
 * individuellen Berechtigungen der Mitgliedschaft, andernfalls der Rollen-Standard.
 */
export function hasPermission(ctx: OrgContext, permission: Permission): boolean {
  if (ctx.membership.role === 'ORGANIZATION_OWNER') return true;
  const custom = membershipPermissions(ctx.membership);
  if (custom) return custom.includes(permission);
  return ROLE_PERMISSIONS[ctx.membership.role].includes(permission);
}

export async function requirePermission(permission: Permission): Promise<OrgContext> {
  const ctx = await requireOrganizationMembership();
  if (!hasPermission(ctx, permission)) throw new AppError('ACCESS_DENIED');
  return ctx;
}

/** Wirft, wenn ein referenzierter Datensatz nicht zur aktiven Organisation gehört. */
export function assertSameOrg(
  ctx: OrgContext,
  record: { organizationId: string } | null | undefined,
): asserts record is { organizationId: string } {
  if (!record) throw new AppError('NOT_FOUND');
  if (record.organizationId !== ctx.organization.id) {
    throw new AppError('ORGANIZATION_SCOPE_VIOLATION');
  }
}

// ---------------------------------------------------------------------------
// Scope: Mitarbeiter
// ---------------------------------------------------------------------------

/** Sentinel für organisationsweiten Zugriff (vermeidet riesige IN-Listen). */
export type ManagedScope = 'ALL' | string[];

/**
 * IDs der Mitarbeiter im Verwaltungsbereich des Benutzers.
 *  - OWNER/ADMIN/DISPATCHER: alle ('ALL')
 *  - TEAM_MANAGER: eigenes Profil + kompletter Unterbaum
 *  - EMPLOYEE: nur eigenes Profil
 */
export async function getManagedEmployeeIds(ctx: OrgContext): Promise<ManagedScope> {
  const role = ctx.membership.role;
  if (role === 'ORGANIZATION_OWNER' || role === 'ADMIN' || role === 'DISPATCHER') {
    return 'ALL';
  }
  if (!ctx.employee) return [];
  if (role === 'EMPLOYEE') return [ctx.employee.id];

  // TEAM_MANAGER: Unterbaum aus der (kleinen) Org-Hierarchie berechnen.
  const nodes = await db.employee.findMany({
    where: { organizationId: ctx.organization.id, deletedAt: null },
    select: { id: true, managerEmployeeId: true },
  });
  return [ctx.employee.id, ...collectSubtree(nodes, ctx.employee.id)];
}

export function scopeContains(scope: ManagedScope, employeeId: string): boolean {
  return scope === 'ALL' || scope.includes(employeeId);
}

/** Prisma-Filter für "Mitarbeiter im Scope". */
export function employeeScopeFilter(scope: ManagedScope): { id?: { in: string[] } } {
  return scope === 'ALL' ? {} : { id: { in: scope } };
}

export async function canAccessEmployee(
  ctx: OrgContext,
  employeeId: string,
  level: 'read' | 'manage' = 'read',
): Promise<boolean> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { organizationId: true, id: true },
  });
  if (!employee || employee.organizationId !== ctx.organization.id) return false;

  const role = ctx.membership.role;
  if (role === 'ORGANIZATION_OWNER' || role === 'ADMIN') return true;
  if (role === 'DISPATCHER') return level === 'read';

  const scope = await getManagedEmployeeIds(ctx);
  if (!scopeContains(scope, employeeId)) return false;
  if (level === 'read') return true;
  // manage: Team-Manager dürfen ihren Bereich verwalten, aber nicht sich selbst höherstufen.
  return role === 'TEAM_MANAGER';
}

// ---------------------------------------------------------------------------
// Scope: Kunden
// ---------------------------------------------------------------------------

/**
 * Kunden-Scope:
 *  - OWNER/ADMIN/DISPATCHER: alle Kunden der Organisation
 *  - TEAM_MANAGER/EMPLOYEE: Kunden, für die der eigene Bereich Zuweisungen,
 *    Termine oder eine bevorzugte Zuordnung hat (Datenminimierung, DSGVO).
 */
export async function canAccessCustomer(
  ctx: OrgContext,
  customerId: string,
  level: 'read' | 'manage' = 'read',
): Promise<boolean> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { organizationId: true, preferredEmployeeId: true },
  });
  if (!customer || customer.organizationId !== ctx.organization.id) return false;

  const role = ctx.membership.role;
  if (role === 'ORGANIZATION_OWNER' || role === 'ADMIN' || role === 'DISPATCHER') return true;
  if (level === 'manage') return false;

  const scope = await getManagedEmployeeIds(ctx);
  if (scope === 'ALL') return true;
  if (scope.length === 0) return false;

  if (customer.preferredEmployeeId && scope.includes(customer.preferredEmployeeId)) return true;

  const [allocation, appointment] = await Promise.all([
    db.hourAllocation.findFirst({
      where: { customerId, status: 'ACTIVE', allocatedToEmployeeId: { in: scope } },
      select: { id: true },
    }),
    db.appointment.findFirst({
      where: { customerId, deletedAt: null, assignedEmployeeId: { in: scope } },
      select: { id: true },
    }),
  ]);
  return Boolean(allocation || appointment);
}

/** Prisma-WHERE für die Kundenliste des aktuellen Scopes. */
export async function customerScopeWhere(ctx: OrgContext) {
  const role = ctx.membership.role;
  if (role === 'ORGANIZATION_OWNER' || role === 'ADMIN' || role === 'DISPATCHER') {
    return {};
  }
  const scope = await getManagedEmployeeIds(ctx);
  const ids = scope === 'ALL' ? undefined : scope;
  if (!ids) return {};
  if (ids.length === 0) return { id: { in: [] as string[] } };
  return {
    OR: [
      { preferredEmployeeId: { in: ids } },
      { allocations: { some: { status: 'ACTIVE' as const, allocatedToEmployeeId: { in: ids } } } },
      { appointments: { some: { deletedAt: null, assignedEmployeeId: { in: ids } } } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Navigation (nur UX – Routen prüfen selbst)
// ---------------------------------------------------------------------------

export function navPermissionsFor(ctx: OrgContext): NavPermissions {
  const role = ctx.membership.role;
  return {
    customers: hasPermission(ctx, 'customers.read'),
    employees: hasPermission(ctx, 'employees.read'),
    routes: hasPermission(ctx, 'routes.manage') || role === 'EMPLOYEE',
    reports: hasPermission(ctx, 'reports.view'),
    settings: true, // Profil/Darstellung für alle; sensible Tabs prüfen einzeln.
  };
}

export const ROLE_LABELS: Record<MembershipRole, string> = {
  ORGANIZATION_OWNER: 'Inhaber',
  ADMIN: 'Administrator',
  DISPATCHER: 'Disponent',
  TEAM_MANAGER: 'Team-Manager',
  EMPLOYEE: 'Mitarbeiter',
};
