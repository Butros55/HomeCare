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

import type { Organization } from '@prisma/client';

import { db } from '@/server/db';
import { reportScopeConflicts } from '@/server/services/conflict-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Leitungs-Sammelaktion „Konflikte melden" (Phase 10): meldet offene Konflikte
 * an die betroffenen Mitarbeiter, schreibt ein Audit-Log, vermeidet Duplikate
 * und ist für Konten ohne appointments.manage gesperrt.
 */
describe('Konflikte melden – Sammelaktion', () => {
  let organization: Organization;
  let ownerCtx: OrgContext;
  let employeeCtx: OrgContext;
  let employeeUserId: string;

  beforeAll(async () => {
    await resetDatabase();
    const base = await createOrg('ConflictReportOrg');
    organization = base;

    const owner = await createUserWithMembership(base.id, 'ORGANIZATION_OWNER', 'ReportOwner');
    ownerCtx = buildContext(owner.user, owner.membership, base, null);

    const empAccount = await createUserWithMembership(base.id, 'EMPLOYEE', 'KonfliktMa');
    employeeUserId = empAccount.user.id;
    const employee = await createEmployee(base.id, 'KonfliktMa', { userId: empAccount.user.id });
    employeeCtx = buildContext(empAccount.user, empAccount.membership, base, employee);

    const customer = await db.customer.create({
      data: { organizationId: base.id, customerNumber: 'CR-1', firstName: 'Kon', lastName: 'Flikt' },
    });

    // Zwei überschneidende Termine ~3 Tage in der Zukunft (innerhalb des Horizonts).
    const day = new Date(Date.now() + 3 * 86_400_000);
    const at = (h: number) =>
      new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, 0, 0));
    for (const [start, end] of [
      [10, 12],
      [11, 13],
    ] as const) {
      await db.appointment.create({
        data: {
          organizationId: base.id,
          customerId: customer.id,
          assignedEmployeeId: employee.id,
          title: 'Einsatz',
          startAt: at(start),
          endAt: at(end),
          durationMinutes: 120,
          status: 'PLANNED',
          assignmentStatus: 'ASSIGNED',
          routeRelevant: true,
        },
      });
    }
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('meldet den Konflikt an den betroffenen Mitarbeiter + Audit-Log', async () => {
    authState.ctx = ownerCtx;
    const result = await reportScopeConflicts();
    expect(result.reported).toBeGreaterThanOrEqual(1);

    const notifications = await db.notification.findMany({
      where: { userId: employeeUserId, type: 'APPOINTMENT_CONFLICT' },
    });
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    expect(notifications[0]!.targetUrl).toMatch(/^\/calendar\?termin=/);

    const audit = await db.auditLog.findFirst({
      where: { organizationId: organization.id, action: 'conflict.reported' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorUserId).toBe(ownerCtx.user.id);
  });

  it('erzeugt bei erneutem Ausführen keine Duplikate (Dedup)', async () => {
    authState.ctx = ownerCtx;
    const before = await db.notification.count({
      where: { userId: employeeUserId, type: 'APPOINTMENT_CONFLICT' },
    });
    const result = await reportScopeConflicts();
    const after = await db.notification.count({
      where: { userId: employeeUserId, type: 'APPOINTMENT_CONFLICT' },
    });
    expect(after).toBe(before);
    expect(result.reported).toBe(0);
    expect(result.alreadyReported).toBeGreaterThanOrEqual(1);
  });

  it('verweigert die Aktion für ein Konto ohne appointments.manage', async () => {
    authState.ctx = employeeCtx;
    await expect(reportScopeConflicts()).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
});
