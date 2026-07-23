import type { Employee, Organization, OrganizationMembership, User } from '@prisma/client';

import type { OrgContext } from '@/server/permissions';
import { db } from '@/server/db';

/** Alle Tabellen leeren (Reihenfolge egal – Cascade). */
export async function resetDatabase(): Promise<void> {
  await db.auditLog.deleteMany();
  await db.notification.deleteMany();
  await db.routeStop.deleteMany();
  await db.routePlan.deleteMany();
  await db.timeEntry.deleteMany();
  await db.appointmentSeriesException.deleteMany();
  await db.appointment.deleteMany();
  await db.appointmentSeries.deleteMany();
  await db.hourAllocation.deleteMany();
  await db.customerHourAdjustment.deleteMany();
  await db.customerHourBudget.deleteMany();
  await db.address.deleteMany();
  await db.customer.deleteMany();
  await db.employeeAbsence.deleteMany();
  await db.employeeAvailability.deleteMany();
  await db.invitation.deleteMany();
  await db.employee.deleteMany();
  await db.organizationMembership.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.session.deleteMany();
  await db.userPreference.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();
}

let counter = 0;
const next = () => {
  counter += 1;
  return counter;
};

export async function createOrg(name: string): Promise<Organization> {
  return db.organization.create({
    data: { name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${next()}` },
  });
}

export async function createUserWithMembership(
  organizationId: string,
  role: OrganizationMembership['role'],
  name: string,
): Promise<{ user: User; membership: OrganizationMembership }> {
  const user = await db.user.create({
    data: {
      email: `${name.toLowerCase()}${next()}@test.example`,
      passwordHash: 'x',
      firstName: name,
      lastName: 'Test',
    },
  });
  const membership = await db.organizationMembership.create({
    data: { organizationId, userId: user.id, role, status: 'ACTIVE' },
  });
  return { user, membership };
}

export async function createEmployee(
  organizationId: string,
  name: string,
  options?: Partial<Pick<Employee, 'managerEmployeeId' | 'userId' | 'targetMinutesPerWeek' | 'status' | 'canReceiveHours'>>,
): Promise<Employee> {
  return db.employee.create({
    data: {
      organizationId,
      firstName: name,
      lastName: 'Test',
      canReceiveHours: options?.canReceiveHours ?? true,
      status: options?.status ?? 'ACTIVE',
      managerEmployeeId: options?.managerEmployeeId ?? null,
      userId: options?.userId ?? null,
      targetMinutesPerWeek: options?.targetMinutesPerWeek ?? null,
    },
  });
}

/** OrgContext für Scope-Funktionen manuell zusammensetzen (ohne Request/Cookies). */
export function buildContext(
  user: User,
  membership: OrganizationMembership,
  organization: Organization,
  employee: Employee | null,
): OrgContext {
  return { user, membership, organization, employee };
}
