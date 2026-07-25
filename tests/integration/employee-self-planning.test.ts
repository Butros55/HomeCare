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
import { computeRoutePlan, discardRoutePlan, saveRoutePlan } from '@/server/services/route-service';
import { generateDayRoutes } from '@/server/services/day-route-service';
import {
  acceptRouteSuggestion,
  createSuggestionToken,
} from '@/server/services/route-suggestion-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Selbstplanung (#20): Ein Mitarbeiter (Rolle EMPLOYEE, ohne routes.manage) darf
 * seine EIGENE Route bearbeiten, aber nicht die eines anderen Mitarbeiters.
 */
describe('Mitarbeiter-Selbstplanung: nur eigene Route', () => {
  const routeDate = new Date('2026-08-10T00:00:00.000Z');
  const futureDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  let ownEmployeeId: string;
  let otherEmployeeId: string;
  let organizationId: string;

  beforeAll(async () => {
    await resetDatabase();
    const organization = await createOrg('SelfPlanOrg');
    organizationId = organization.id;
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

  const denied = { code: 'ACCESS_DENIED' };

  it('darf keine fremde Route optimieren (computeRoutePlan)', async () => {
    await expect(
      computeRoutePlan({
        employeeId: otherEmployeeId,
        date: futureDate,
        appointmentIds: [],
        originType: 'office',
        bufferMinutes: 10,
        returnToStart: true,
      }),
    ).rejects.toMatchObject(denied);
  });

  it('darf keine fremde Route speichern (saveRoutePlan)', async () => {
    await expect(
      saveRoutePlan({
        employeeId: otherEmployeeId,
        date: futureDate,
        appointmentIds: [],
        originType: 'office',
        bufferMinutes: 10,
        returnToStart: true,
        publish: false,
      }),
    ).rejects.toMatchObject(denied);
  });

  it('darf keine fremde Tagesroute generieren (generateDayRoutes)', async () => {
    await expect(
      generateDayRoutes({
        employeeId: otherEmployeeId,
        date: futureDate,
        bufferMinutes: 10,
        returnToStart: true,
      }),
    ).rejects.toMatchObject(denied);
  });

  it('darf keinen Vorschlag für einen fremden Mitarbeiter übernehmen (acceptRouteSuggestion)', async () => {
    const token = createSuggestionToken({
      v: 2,
      org: organizationId,
      emp: otherEmployeeId,
      cust: 'irrelevant',
      date: futureDate,
      start: `${futureDate}T09:00:00.000Z`,
      dur: 120,
      originType: 'office',
      oLat: 51.96,
      oLng: 7.62,
      oLabel: 'Büro',
      buffer: 10,
      ret: true,
      exp: Date.now() + 60_000,
    });
    await expect(acceptRouteSuggestion(token)).rejects.toMatchObject(denied);
  });
});
