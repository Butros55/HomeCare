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
 * Wunschmitarbeiter (Phase 8): In der Eigenplanung eines ANDEREN Mitarbeiters
 * darf der Kunde nicht angeboten werden, solange sein Wunschmitarbeiter aktiv
 * (grundsätzlich zuständig) ist. Ein INAKTIVER/gelöschter Wunschmitarbeiter darf
 * die Planung dagegen NICHT dauerhaft blockieren – dann wird der Kunde regulär
 * anderen Mitarbeitern angeboten.
 */
describe('Wunschmitarbeiter – Selbstplanung eines anderen Mitarbeiters', () => {
  const OFFICE = { label: 'Büro', latitude: 51.96, longitude: 7.62 };
  const futureDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  let organization: Organization;
  let planner: Employee; // plant die eigene Route (nicht der Wunschmitarbeiter)
  let preferred: Employee; // Wunschmitarbeiter des Kunden
  let plannerCtx: OrgContext;
  let customerId: string;

  beforeAll(async () => {
    await resetDatabase();
    const base = await createOrg('PreferredOrg');
    // Stundenbudgets AUS: jeder aktive Kunde mit Adresse gilt als Bedarf.
    organization = { ...base, hourBudgetsEnabled: false, defaultStartLocation: OFFICE };

    const account = await createUserWithMembership(base.id, 'EMPLOYEE', 'Planer');
    planner = await createEmployee(base.id, 'Planer', { userId: account.user.id });
    preferred = await createEmployee(base.id, 'Wunsch');
    plannerCtx = buildContext(account.user, account.membership, organization, planner);

    const customer = await db.customer.create({
      data: {
        organizationId: base.id,
        customerNumber: 'PE-1',
        firstName: 'Wunsch',
        lastName: 'Kunde',
        status: 'ACTIVE',
        preferredEmployeeId: preferred.id,
        defaultAppointmentDurationMinutes: 120,
      },
    });
    customerId = customer.id;
    await db.address.create({
      data: {
        organizationId: base.id,
        customerId: customer.id,
        street: 'Teststr.',
        houseNumber: '1',
        postalCode: '48143',
        city: 'Münster',
        latitude: 51.9607,
        longitude: 7.6261,
      },
    });
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('bietet den Kunden NICHT an, wenn der Wunschmitarbeiter aktiv ist', async () => {
    authState.ctx = plannerCtx;
    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'self',
      bufferMinutes: 10,
      returnToStart: true,
      originType: 'office',
    });
    const panel = result.employees.find((e) => e.employeeId === planner.id);
    expect(panel?.suggestions.some((s) => s.customerId === customerId)).toBe(false);
  });

  it('bietet den Kunden anderen an, wenn der Wunschmitarbeiter INAKTIV ist', async () => {
    await db.employee.update({ where: { id: preferred.id }, data: { status: 'INACTIVE' } });
    authState.ctx = plannerCtx;
    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'self',
      bufferMinutes: 10,
      returnToStart: true,
      originType: 'office',
    });
    const panel = result.employees.find((e) => e.employeeId === planner.id);
    expect(panel?.suggestions.some((s) => s.customerId === customerId)).toBe(true);
    // Und dann korrekt NICHT als „Wunschmitarbeiter" markiert.
    const suggestion = panel?.suggestions.find((s) => s.customerId === customerId);
    expect(suggestion?.isPreferredEmployee).toBe(false);
  });

  it('blockiert auch bei soft-gelöschtem Wunschmitarbeiter nicht', async () => {
    await db.employee.update({
      where: { id: preferred.id },
      data: { status: 'ACTIVE', deletedAt: new Date() },
    });
    authState.ctx = plannerCtx;
    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'self',
      bufferMinutes: 10,
      returnToStart: true,
      originType: 'office',
    });
    const panel = result.employees.find((e) => e.employeeId === planner.id);
    expect(panel?.suggestions.some((s) => s.customerId === customerId)).toBe(true);
  });
});
