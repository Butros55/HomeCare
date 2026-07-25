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
import { getAppointmentConflicts } from '@/server/services/conflict-service';
import { generateDayRoutes } from '@/server/services/day-route-service';
import { isPastPlanningDay } from '@/server/services/route-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

describe('Stundenkonto AUS + vergangene Tage eingefroren', () => {
  let ctxOff: OrgContext;
  let ctxOn: OrgContext;
  let appointmentId: string;
  let ownEmployeeId: string;

  beforeAll(async () => {
    await resetDatabase();
    const organization = await createOrg('BudgetOffOrg');
    const owner = await createUserWithMembership(organization.id, 'ORGANIZATION_OWNER', 'BudgetOwner');
    const ownEmployee = await createEmployee(organization.id, 'BudgetOwner', { userId: owner.user.id });
    ownEmployeeId = ownEmployee.id;
    // Zwei Kontextvarianten auf derselben Organisation – nur der Schalter unterscheidet.
    ctxOff = buildContext(owner.user, owner.membership, { ...organization, hourBudgetsEnabled: false }, ownEmployee);
    ctxOn = buildContext(owner.user, owner.membership, { ...organization, hourBudgetsEnabled: true }, ownEmployee);

    const customer = await db.customer.create({
      data: { organizationId: organization.id, customerNumber: 'BO-1', firstName: 'Ohne', lastName: 'Konto' },
    });
    // Termin in der Zukunft, Kunde OHNE Stundenkonto.
    const appt = await db.appointment.create({
      data: {
        organizationId: organization.id,
        customerId: customer.id,
        assignedEmployeeId: ownEmployee.id,
        title: 'Einsatz',
        startAt: new Date('2099-08-05T08:00:00Z'),
        endAt: new Date('2099-08-05T10:00:00Z'),
        durationMinutes: 120,
        status: 'PLANNED',
        assignmentStatus: 'ASSIGNED',
        routeRelevant: true,
      },
    });
    appointmentId = appt.id;
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('erzeugt bei deaktiviertem Stundenkonto KEINEN Guthaben-Konflikt', async () => {
    authState.ctx = ctxOff;
    const { conflicts } = await getAppointmentConflicts(appointmentId);
    expect(conflicts.some((c) => c.type === 'NO_HOUR_BUDGET')).toBe(false);
    expect(conflicts.some((c) => c.type === 'HOUR_BUDGET_OVERPLANNED')).toBe(false);
  });

  it('warnt bei aktivem Stundenkonto weiterhin (kein Konto → NO_HOUR_BUDGET)', async () => {
    authState.ctx = ctxOn;
    const { conflicts } = await getAppointmentConflicts(appointmentId);
    expect(conflicts.some((c) => c.type === 'NO_HOUR_BUDGET')).toBe(true);
  });

  it('isPastPlanningDay: gestern/2020 ist Vergangenheit, Zukunft nicht', () => {
    expect(isPastPlanningDay(new Date('2020-01-01T12:00:00Z'), 'Europe/Berlin')).toBe(true);
    expect(isPastPlanningDay(new Date('2099-01-01T12:00:00Z'), 'Europe/Berlin')).toBe(false);
  });

  it('verweigert die Routengenerierung für einen vergangenen Tag', async () => {
    authState.ctx = ctxOn;
    await expect(
      generateDayRoutes({
        employeeId: ownEmployeeId,
        date: '2020-01-01',
        bufferMinutes: 10,
        returnToStart: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
