import type { OrgContext } from '@/server/permissions';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ ctx: null as OrgContext | null }));

vi.mock('@/server/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/permissions')>();
  return {
    ...actual,
    requireOrganizationMembership: async () => {
      if (!authState.ctx) throw new Error('Test-Kontext fehlt');
      return authState.ctx;
    },
    requirePermission: async () => {
      if (!authState.ctx) throw new Error('Test-Kontext fehlt');
      return authState.ctx;
    },
  };
});

import { hashToken } from '@/server/auth/session';
import { db } from '@/server/db';
import {
  acceptInvitation,
  deleteEmployeeAccount,
  setEmployeeAccountSuspended,
} from '@/server/services/employee-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

describe('Mitarbeiter-Account: Einladung → Registrierung → Sperren → Löschen', () => {
  let organizationId: string;
  let employeeId: string;

  beforeAll(async () => {
    await resetDatabase();
    const organization = await createOrg('AccountOrg');
    organizationId = organization.id;
    const owner = await createUserWithMembership(organization.id, 'ORGANIZATION_OWNER', 'AccountOwner');
    const ownEmployee = await createEmployee(organization.id, 'AccountOwner', { userId: owner.user.id });
    authState.ctx = buildContext(owner.user, owner.membership, organization, ownEmployee);

    const employee = await createEmployee(organization.id, 'Neu');
    employeeId = employee.id;

    // Einladung direkt anlegen (Token im Test bekannt).
    await db.invitation.create({
      data: {
        organizationId: organization.id,
        email: 'neu@test.example',
        role: 'EMPLOYEE',
        employeeId: employee.id,
        tokenHash: hashToken('token-neu-123'),
        invitedByUserId: owner.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('Selbstregistrierung: Konto gebunden, Adresse + Verfügbarkeit übernommen', async () => {
    const { userId } = await acceptInvitation({
      token: 'token-neu-123',
      firstName: 'Nina',
      lastName: 'Neu',
      passwordHash: 'hashed',
      phone: '0251 12345',
      homeLocation: { street: 'Domplatz', houseNumber: '1', postalCode: '48143', city: 'Münster' },
      availabilitySlots: [
        { weekday: 1, startTime: '08:00', endTime: '12:00' },
        { weekday: 3, startTime: '13:00', endTime: '17:00' },
      ],
    });

    // Konto existiert und gehört zur Organisation.
    const user = await db.user.findUnique({ where: { id: userId } });
    expect(user?.email).toBe('neu@test.example');
    const membership = await db.organizationMembership.findFirst({
      where: { organizationId, userId },
    });
    expect(membership?.role).toBe('EMPLOYEE');
    expect(membership?.status).toBe('ACTIVE');

    // Profil ist mit dem Konto verknüpft, Selbstangaben übernommen.
    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    expect(employee?.userId).toBe(userId);
    expect(employee?.phone).toBe('0251 12345');
    expect(employee?.startLocation).toMatchObject({ label: 'Zuhause', city: 'Münster' });

    const slots = await db.employeeAvailability.findMany({ where: { employeeId } });
    expect(slots).toHaveLength(2);

    // Einladung ist verbraucht.
    const invitation = await db.invitation.findFirst({ where: { employeeId } });
    expect(invitation?.acceptedAt).not.toBeNull();
  });

  it('Sperren setzt Mitgliedschaft auf SUSPENDED und beendet Sessions', async () => {
    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    // Aktive Session anlegen, die beim Sperren beendet werden muss.
    await db.session.create({
      data: {
        userId: employee!.userId!,
        tokenHash: hashToken('sess-1'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await setEmployeeAccountSuspended(employeeId, true);

    const membership = await db.organizationMembership.findFirst({
      where: { organizationId, userId: employee!.userId! },
    });
    expect(membership?.status).toBe('SUSPENDED');
    const sessions = await db.session.count({ where: { userId: employee!.userId! } });
    expect(sessions).toBe(0);

    // Entsperren stellt den Zugang wieder her.
    await setEmployeeAccountSuspended(employeeId, false);
    const reactivated = await db.organizationMembership.findFirst({
      where: { organizationId, userId: employee!.userId! },
    });
    expect(reactivated?.status).toBe('ACTIVE');
  });

  it('Löschen archiviert das Profil und entzieht den Login', async () => {
    const before = await db.employee.findUnique({ where: { id: employeeId } });
    const userId = before!.userId!;

    await deleteEmployeeAccount(employeeId);

    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    expect(employee?.deletedAt).not.toBeNull();
    expect(employee?.userId).toBeNull();

    const membership = await db.organizationMembership.findFirst({
      where: { organizationId, userId },
    });
    expect(membership).toBeNull();

    // Ohne weitere Mitgliedschaft ist das Konto deaktiviert (Login gesperrt).
    const user = await db.user.findUnique({ where: { id: userId } });
    expect(user?.status).toBe('INACTIVE');
  });
});
