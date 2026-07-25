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

import { db } from '@/server/db';
import { deleteEmployeeAccount } from '@/server/services/employee-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Konto entfernen (Phase 5): Ein globales Benutzerkonto darf NICHT deaktiviert
 * werden, solange eine andere aktive Organisationsmitgliedschaft besteht. Der
 * Zugang zur betroffenen Organisation wird entzogen, das Konto bleibt aktiv.
 */
describe('Mitarbeiter-Account löschen – Multi-Org-Schutz', () => {
  let orgAId: string;
  let orgBId: string;
  let sharedUserId: string;
  let employeeAId: string;

  beforeAll(async () => {
    await resetDatabase();
    const orgA = await createOrg('MultiOrgA');
    const orgB = await createOrg('MultiOrgB');
    orgAId = orgA.id;
    orgBId = orgB.id;

    const ownerA = await createUserWithMembership(orgA.id, 'ORGANIZATION_OWNER', 'MultiOwnerA');
    authState.ctx = buildContext(ownerA.user, ownerA.membership, orgA, null);

    // Ein Nutzer mit Mitgliedschaft + Profil in BEIDEN Organisationen.
    const shared = await db.user.create({
      data: {
        email: 'shared@test.example',
        passwordHash: 'x',
        firstName: 'Shared',
        lastName: 'User',
        status: 'ACTIVE',
      },
    });
    sharedUserId = shared.id;
    await db.organizationMembership.create({
      data: { organizationId: orgA.id, userId: shared.id, role: 'EMPLOYEE', status: 'ACTIVE' },
    });
    await db.organizationMembership.create({
      data: { organizationId: orgB.id, userId: shared.id, role: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const empA = await createEmployee(orgA.id, 'SharedA', { userId: shared.id });
    employeeAId = empA.id;
    await createEmployee(orgB.id, 'SharedB', { userId: shared.id });
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('entzieht nur den Zugang zur Organisation, lässt das Konto aber AKTIV', async () => {
    await deleteEmployeeAccount(employeeAId);

    // Zugang zur Organisation A entzogen …
    const aMembership = await db.organizationMembership.findFirst({
      where: { organizationId: orgAId, userId: sharedUserId },
    });
    expect(aMembership).toBeNull();

    // … Organisation B bleibt bestehen …
    const bMembership = await db.organizationMembership.findFirst({
      where: { organizationId: orgBId, userId: sharedUserId },
    });
    expect(bMembership).not.toBeNull();

    // … deshalb bleibt das globale Konto aktiv (kein globaler Lockout).
    const user = await db.user.findUnique({ where: { id: sharedUserId } });
    expect(user?.status).toBe('ACTIVE');
  });
});
