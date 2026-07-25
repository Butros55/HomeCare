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
  acceptRouteSuggestion,
  generateRouteSuggestions,
} from '@/server/services/route-suggestion-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Stundenbudgets AUS (Phase 3): Kunden OHNE Stundenkonto müssen trotzdem
 * vorgeschlagen und geplant werden können; die Vorschlagsdauer kommt aus der
 * Kunden-Standarddauer (nicht aus einem Guthaben). Bei AN bleibt ein Kunde ohne
 * Konto ohne Bedarf. Vorhandene Kontodaten bleiben beim Umschalten erhalten.
 */
describe('Stundenbudgets AUS – Vorschläge ohne Konto', () => {
  const OFFICE = { label: 'Büro', latitude: 51.96, longitude: 7.62 };
  const futureDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  let base: Organization;
  let orgOff: Organization;
  let orgOn: Organization;
  let employee: Employee;
  let noAccountCustomerId: string;
  let accountCustomerId: string;
  let userAndMembership: Awaited<ReturnType<typeof createUserWithMembership>>;

  const ctxWith = (org: Organization): OrgContext =>
    buildContext(userAndMembership.user, userAndMembership.membership, org, employee);

  beforeAll(async () => {
    await resetDatabase();
    base = await createOrg('BudgetOffSug');
    orgOff = { ...base, hourBudgetsEnabled: false, defaultStartLocation: OFFICE };
    orgOn = { ...base, hourBudgetsEnabled: true, defaultStartLocation: OFFICE };

    userAndMembership = await createUserWithMembership(base.id, 'EMPLOYEE', 'SugMa');
    employee = await createEmployee(base.id, 'SugMa', { userId: userAndMembership.user.id });

    // Kunde OHNE Konto, Standarddauer 90 Minuten.
    const noAccount = await db.customer.create({
      data: {
        organizationId: base.id,
        customerNumber: 'NA-1',
        firstName: 'Ohne',
        lastName: 'Konto',
        status: 'ACTIVE',
        defaultAppointmentDurationMinutes: 90,
      },
    });
    noAccountCustomerId = noAccount.id;
    await db.address.create({
      data: {
        organizationId: base.id,
        customerId: noAccount.id,
        street: 'Str.',
        houseNumber: '1',
        postalCode: '48143',
        city: 'Münster',
        latitude: 51.965,
        longitude: 7.63,
      },
    });

    // Kunde MIT Konto (Topup) – Kontodaten müssen beim Umschalten erhalten bleiben.
    const withAccount = await db.customer.create({
      data: { organizationId: base.id, customerNumber: 'AC-1', firstName: 'Mit', lastName: 'Konto' },
    });
    accountCustomerId = withAccount.id;
    await db.customerHourTopup.create({
      data: {
        organizationId: base.id,
        customerId: withAccount.id,
        kind: 'MANUAL',
        minutes: 600,
        effectiveOn: new Date('2026-01-01T00:00:00Z'),
      },
    });
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('schlägt den kontolosen Kunden bei AUS vor – Dauer = Standarddauer', async () => {
    authState.ctx = ctxWith(orgOff);
    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'self',
      bufferMinutes: 10,
      returnToStart: true,
      originType: 'office',
    });
    const panel = result.employees.find((e) => e.employeeId === employee.id);
    const suggestion = panel?.suggestions.find((s) => s.customerId === noAccountCustomerId);
    expect(suggestion).toBeTruthy();
    expect(suggestion!.durationMinutes).toBe(90);
  });

  it('bietet denselben kontolosen Kunden bei AN NICHT an (kein Guthaben)', async () => {
    authState.ctx = ctxWith(orgOn);
    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'self',
      bufferMinutes: 10,
      returnToStart: true,
      originType: 'office',
    });
    const panel = result.employees.find((e) => e.employeeId === employee.id);
    expect(panel?.suggestions.some((s) => s.customerId === noAccountCustomerId)).toBe(false);
  });

  it('nimmt einen Vorschlag bei AUS an, ohne Guthabenprüfung', async () => {
    authState.ctx = ctxWith(orgOff);
    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'self',
      bufferMinutes: 10,
      returnToStart: true,
      originType: 'office',
    });
    const panel = result.employees.find((e) => e.employeeId === employee.id);
    const suggestion = panel!.suggestions.find((s) => s.customerId === noAccountCustomerId)!;
    const accepted = await acceptRouteSuggestion(suggestion.token);
    expect(accepted.appointmentId).toBeTruthy();
    const appt = await db.appointment.findUnique({ where: { id: accepted.appointmentId } });
    expect(appt?.customerId).toBe(noAccountCustomerId);
    expect(appt?.durationMinutes).toBe(90);
    // Aufräumen für spätere Läufe dieses Suites.
    await db.routeStop.deleteMany({});
    await db.routePlan.deleteMany({});
    await db.appointment.delete({ where: { id: accepted.appointmentId } });
  });

  it('erhält vorhandene Kontodaten beim Umschalten AUS→AN', async () => {
    const before = await db.customerHourTopup.count({ where: { customerId: accountCustomerId } });
    // Umschalten (nur der Schalter ändert sich – hier direkt am Datensatz).
    await db.organization.update({ where: { id: base.id }, data: { hourBudgetsEnabled: false } });
    await db.organization.update({ where: { id: base.id }, data: { hourBudgetsEnabled: true } });
    const after = await db.customerHourTopup.count({ where: { customerId: accountCustomerId } });
    expect(after).toBe(before);
    expect(after).toBeGreaterThanOrEqual(1);
  });
});
