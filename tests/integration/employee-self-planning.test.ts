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
  };
});

import { db } from '@/server/db';
import { discardRoutePlan } from '@/server/services/route-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Selbstplanung (#20): Ein Mitarbeiter (Rolle EMPLOYEE, ohne routes.manage) darf
 * seine EIGENE Route bearbeiten, aber nicht die eines anderen Mitarbeiters.
 */
describe('Mitarbeiter-Selbstplanung: nur eigene Route', () => {
  const routeDate = new Date('2026-08-10T00:00:00.000Z');
  let ownEmployeeId: string;
  let otherEmployeeId: string;

  beforeAll(async () => {
    await resetDatabase();
    const organization = await createOrg('SelfPlanOrg');
    const account = await createUserWithMembership(organization.id, 'EMPLOYEE', 'Selbst');
    const own = await createEmployee(organization.id, 'Selbst', { userId: account.user.id });
    const other = await createEmployee(organization.id, 'Fremd');
    ownEmployeeId = own.id;
    otherEmployeeId = other.id;
    authState.ctx = buildContext(account.user, account.membership, organization, own);

    for (const employeeId of [own.id, other.id]) {
      await db.routePlan.create({
        data: {
          organizationId: organization.id,
          employeeId,
          routeDate,
          startAddress: {},
          endAddress: {},
          provider: 'mock',
        },
      });
    }
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('darf die eigene Route verwerfen', async () => {
    await expect(discardRoutePlan(ownEmployeeId, '2026-08-10')).resolves.toBeUndefined();
    const plan = await db.routePlan.findUnique({
      where: { employeeId_routeDate: { employeeId: ownEmployeeId, routeDate } },
    });
    expect(plan).toBeNull();
  });

  it('darf die Route eines anderen Mitarbeiters NICHT verwerfen', async () => {
    await expect(discardRoutePlan(otherEmployeeId, '2026-08-10')).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
    });
    const plan = await db.routePlan.findUnique({
      where: { employeeId_routeDate: { employeeId: otherEmployeeId, routeDate } },
    });
    expect(plan).not.toBeNull();
  });
});
