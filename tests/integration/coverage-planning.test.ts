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
import { generateRouteSuggestions } from '@/server/services/route-suggestion-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Zuständigkeitsgebiet (Phase 9) – tatsächliche Planungswirkung (nicht nur das
 * Speichern der Felder): Kunden außerhalb des Umkreises werden NICHT vorgeschlagen,
 * Kunden innerhalb schon.
 */
describe('Zuständigkeitsgebiet wirkt auf Vorschläge', () => {
  // Zentrum = Zuhause-Adresse des Mitarbeiters (Raum Münster).
  const HOME = { label: 'Zuhause', latitude: 51.96, longitude: 7.62 };
  const futureDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  let organization: Organization;
  let employee: Employee;
  let ctx: OrgContext;
  let insideCustomerId: string;
  let outsideCustomerId: string;

  const makeCustomer = async (
    orgId: string,
    number: string,
    latitude: number,
    longitude: number,
  ): Promise<string> => {
    const customer = await db.customer.create({
      data: {
        organizationId: orgId,
        customerNumber: number,
        firstName: number,
        lastName: 'Kunde',
        status: 'ACTIVE',
        defaultAppointmentDurationMinutes: 120,
      },
    });
    await db.address.create({
      data: {
        organizationId: orgId,
        customerId: customer.id,
        street: 'Str.',
        houseNumber: '1',
        postalCode: '48143',
        city: 'Münster',
        latitude,
        longitude,
      },
    });
    return customer.id;
  };

  beforeAll(async () => {
    await resetDatabase();
    const base = await createOrg('CoverageOrg');
    organization = { ...base, hourBudgetsEnabled: false, defaultStartLocation: HOME };

    const account = await createUserWithMembership(base.id, 'EMPLOYEE', 'Gebiet');
    const created = await createEmployee(base.id, 'Gebiet', { userId: account.user.id });
    // Umkreis 5 km um die Zuhause-Adresse.
    employee = await db.employee.update({
      where: { id: created.id },
      data: { startLocation: HOME, coverageUseHome: true, coverageRadiusKm: 5 },
    });
    ctx = buildContext(account.user, account.membership, organization, employee);

    // ~1,1 km nördlich → innerhalb; ~60 km nördlich → außerhalb.
    insideCustomerId = await makeCustomer(base.id, 'IN-1', 51.97, 7.62);
    outsideCustomerId = await makeCustomer(base.id, 'OUT-1', 52.5, 7.62);
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('schlägt Kunden innerhalb des Umkreises vor, außerhalb nicht', async () => {
    authState.ctx = ctx;
    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'self',
      bufferMinutes: 10,
      returnToStart: true,
      originType: 'home',
    });
    const panel = result.employees.find((e) => e.employeeId === employee.id);
    const ids = new Set(panel?.suggestions.map((s) => s.customerId));
    expect(ids.has(insideCustomerId)).toBe(true);
    expect(ids.has(outsideCustomerId)).toBe(false);
  });

  it('unbegrenztes Gebiet (radius null) schlägt auch entfernte Kunden vor', async () => {
    await db.employee.update({ where: { id: employee.id }, data: { coverageRadiusKm: null } });
    authState.ctx = buildContext(ctx.user, ctx.membership, organization, {
      ...employee,
      coverageRadiusKm: null,
    });
    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'self',
      bufferMinutes: 10,
      returnToStart: true,
      originType: 'home',
    });
    const panel = result.employees.find((e) => e.employeeId === employee.id);
    const ids = new Set(panel?.suggestions.map((s) => s.customerId));
    expect(ids.has(insideCustomerId)).toBe(true);
    expect(ids.has(outsideCustomerId)).toBe(true);
  });
});
