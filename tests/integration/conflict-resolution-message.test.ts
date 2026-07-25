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
import { suggestResolutionForAppointment } from '@/server/services/conflict-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Konflikt-Auflösung: Wenn zwei FESTE Termine desselben Mitarbeiters kollidieren,
 * muss die Begründung konkret benennen, WELCHER Kunde/Termin womit kollidiert –
 * statt der generischen „Fixer Termin überschneidet sich mit einem anderen".
 */
describe('Konflikt-Auflösung – erklärt konkret, wer betroffen ist', () => {
  let firstAppointmentId: string;

  beforeAll(async () => {
    await resetDatabase();
    const organization = await createOrg('ConflictMsgOrg');
    const owner = await createUserWithMembership(organization.id, 'ORGANIZATION_OWNER', 'MsgOwner');
    authState.ctx = buildContext(owner.user, owner.membership, organization, null);

    const employee = await createEmployee(organization.id, 'MsgMa');
    const customerA = await db.customer.create({
      data: { organizationId: organization.id, customerNumber: 'CA-1', firstName: 'Tim', lastName: 'Bojer' },
    });
    const customerB = await db.customer.create({
      data: { organizationId: organization.id, customerNumber: 'CB-1', firstName: 'Anna', lastName: 'Müller' },
    });

    // Zwei FESTE Termine desselben Mitarbeiters, exakt gleiche Zeit → Doppelbelegung.
    const start = new Date('2026-09-15T12:00:00.000Z');
    const end = new Date('2026-09-15T14:00:00.000Z');
    const makeAppt = (customerId: string, title: string) =>
      db.appointment.create({
        data: {
          organizationId: organization.id,
          customerId,
          assignedEmployeeId: employee.id,
          title,
          startAt: start,
          endAt: end,
          durationMinutes: 120,
          status: 'PLANNED',
          assignmentStatus: 'ASSIGNED',
          isFlexible: false,
          routeRelevant: true,
        },
      });
    const a = await makeAppt(customerA.id, 'Hauswirtschaftlicher Einsatz');
    await makeAppt(customerB.id, 'Hauswirtschaftlicher Einsatz');
    firstAppointmentId = a.id;
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('benennt den kollidierenden Kunden + Handlungsempfehlung', async () => {
    const proposal = await suggestResolutionForAppointment(firstAppointmentId);
    expect(proposal.hadOverlap).toBe(true);
    // Beide festen Termine sind nicht automatisch verschiebbar.
    expect(proposal.moves).toHaveLength(0);
    expect(proposal.unresolved.length).toBeGreaterThanOrEqual(1);

    const reasons = proposal.unresolved.map((u) => u.reason).join(' | ');
    // Der andere Kunde wird konkret genannt …
    expect(reasons).toContain('Anna Müller');
    // … und es gibt eine handlungsleitende Empfehlung (verschieben/neu zuweisen).
    expect(reasons).toMatch(/verschieben|neu zuweisen/);
  });
});
