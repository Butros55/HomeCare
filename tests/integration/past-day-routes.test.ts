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

import type { Employee, Organization } from '@prisma/client';

import { db } from '@/server/db';
import {
  computeRoutePlan,
  discardRoutePlan,
  isPastPlanningDay,
  saveRoutePlan,
} from '@/server/services/route-service';
import {
  acceptRouteSuggestion,
  createSuggestionToken,
  generateRouteSuggestions,
} from '@/server/services/route-suggestion-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Vergangene Tage sind in der Routenplanung eingefroren (Phase 4): Alle
 * schreibenden Pfade müssen serverseitig für einen vergangenen Kalendertag
 * (Org-Zeitzone) scheitern – auch über direkte Service-/Token-Aufrufe.
 */
describe('Vergangene Tage – zeitzonenkorrekter Guard', () => {
  it('isPastPlanningDay respektiert die Org-Zeitzone am Tageswechsel', () => {
    // 22:30 UTC ist in Europe/Berlin (Sommerzeit, UTC+2) bereits der Folgetag.
    const nowLateUtc = new Date('2026-06-15T22:30:00Z'); // = 16.06. 00:30 Berlin
    // „Heute" (Berlin) ist der 16.06. → der 15.06. gilt als vergangen …
    expect(isPastPlanningDay(new Date('2026-06-15T00:00:00Z'), 'Europe/Berlin', nowLateUtc)).toBe(true);
    // … der 16.06. ist heute (nicht vergangen) …
    expect(isPastPlanningDay(new Date('2026-06-16T00:00:00Z'), 'Europe/Berlin', nowLateUtc)).toBe(false);
    // In UTC hingegen wäre der 15.06. noch „heute" – der Beweis, dass die Zone zählt.
    expect(isPastPlanningDay(new Date('2026-06-15T00:00:00Z'), 'UTC', nowLateUtc)).toBe(false);
  });

  it('deckt eine Sommer-/Winterzeit-Grenze ab (DST-Umstellung Ende März)', () => {
    // 30.03.2026, 00:30 UTC = 02:30 Berlin (nach der Umstellung) → heute 30.03.
    const now = new Date('2026-03-30T00:30:00Z');
    expect(isPastPlanningDay(new Date('2026-03-29T00:00:00Z'), 'Europe/Berlin', now)).toBe(true);
    expect(isPastPlanningDay(new Date('2026-03-30T00:00:00Z'), 'Europe/Berlin', now)).toBe(false);
  });
});

describe('Vergangene Tage – schreibende Routen-Pfade gesperrt', () => {
  const PAST = '2020-01-01';
  let organization: Organization;
  let ownerCtx: OrgContext;
  let employee: Employee;

  beforeAll(async () => {
    await resetDatabase();
    const base = await createOrg('PastDayOrg');
    organization = { ...base, defaultStartLocation: { label: 'Büro', latitude: 51.96, longitude: 7.62 } };
    const owner = await createUserWithMembership(base.id, 'ORGANIZATION_OWNER', 'PastOwner');
    employee = await createEmployee(base.id, 'PastMa');
    ownerCtx = buildContext(owner.user, owner.membership, organization, null);
    authState.ctx = ownerCtx;
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  const past = { code: 'VALIDATION_FAILED' };

  it('saveRoutePlan scheitert für einen vergangenen Tag', async () => {
    await expect(
      saveRoutePlan({
        employeeId: employee.id,
        date: PAST,
        appointmentIds: [],
        originType: 'office',
        bufferMinutes: 10,
        returnToStart: true,
        publish: false,
      }),
    ).rejects.toMatchObject(past);
  });

  it('discardRoutePlan scheitert für einen vergangenen Tag', async () => {
    await expect(discardRoutePlan(employee.id, PAST)).rejects.toMatchObject(past);
  });

  it('computeRoutePlan (Optimieren) scheitert für einen vergangenen Tag', async () => {
    await expect(
      computeRoutePlan({
        employeeId: employee.id,
        date: PAST,
        appointmentIds: [],
        originType: 'office',
        bufferMinutes: 10,
        returnToStart: true,
      }),
    ).rejects.toMatchObject(past);
  });

  it('generateRouteSuggestions (self) scheitert für einen vergangenen Tag', async () => {
    await expect(
      generateRouteSuggestions({ date: PAST, scope: 'self', bufferMinutes: 10, returnToStart: true }),
    ).rejects.toMatchObject(past);
  });

  it('generateRouteSuggestions (team) scheitert für einen vergangenen Tag', async () => {
    await expect(
      generateRouteSuggestions({ date: PAST, scope: 'team', bufferMinutes: 10, returnToStart: true }),
    ).rejects.toMatchObject(past);
  });

  it('acceptRouteSuggestion scheitert für einen vergangenen Tag (auch mit gültigem Token)', async () => {
    const token = createSuggestionToken({
      v: 2,
      org: organization.id,
      emp: employee.id,
      cust: 'irrelevant',
      date: PAST,
      start: `${PAST}T09:00:00.000Z`,
      dur: 120,
      originType: 'office',
      oLat: 51.96,
      oLng: 7.62,
      oLabel: 'Büro',
      buffer: 10,
      ret: true,
      exp: Date.now() + 60_000,
    });
    await expect(acceptRouteSuggestion(token)).rejects.toMatchObject(past);
  });
});
