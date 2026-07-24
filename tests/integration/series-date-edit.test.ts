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
import { createAppointment, updateAppointment } from '@/server/services/appointment-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

describe('REPRO: Serientermin mit Datumswechsel bearbeiten (Team-Modus)', () => {
  let customerId: string;
  let ownEmployeeId: string;
  let organizationId: string;

  beforeAll(async () => {
    await resetDatabase();
    const organization = await createOrg('SeriesRepro'); // Team-Modus (soloMode default false)
    organizationId = organization.id;
    const owner = await createUserWithMembership(organization.id, 'ORGANIZATION_OWNER', 'ReproOwner');
    const ownEmployee = await createEmployee(organization.id, 'ReproOwner', { userId: owner.user.id });
    ownEmployeeId = ownEmployee.id;
    authState.ctx = buildContext(owner.user, owner.membership, organization, ownEmployee);
    const customer = await db.customer.create({
      data: { organizationId: organization.id, customerNumber: 'SR-1', firstName: 'Serie', lastName: 'Kunde' },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  async function makeSeries(): Promise<string> {
    const created = await createAppointment(
      {
        customerId,
        assignedEmployeeId: ownEmployeeId,
        title: 'Wöchentliche Reinigung',
        date: '2026-08-05', // Mittwoch
        startTime: '10:00',
        durationMinutes: 60,
        recurrence: { enabled: true, frequency: 'WEEKLY', count: 5 },
      },
      { confirmed: true },
    );
    if (!created.seriesId) throw new Error('Serie nicht angelegt');
    return created.seriesId;
  }

  async function tryEdit(label: string, input: Parameters<typeof updateAppointment>[1], scope: 'all' | 'following') {
    const seriesId = await makeSeries();
    const occ = await db.appointment.findFirstOrThrow({
      where: { seriesId },
      orderBy: { startAt: 'asc' },
      skip: 1, // zweites Vorkommen (12.08.)
    });
    let caught: unknown = null;
    try {
      await updateAppointment(occ.id, input, { scope, confirmed: true });
    } catch (e) {
      caught = e;
      console.error(`\n=== Serien-Edit fehlgeschlagen [${label}] ===\n`, e, '\n');
    }
    // Serie für den nächsten Fall wegräumen.
    await db.appointment.deleteMany({ where: { seriesId } });
    await db.appointmentSeriesException.deleteMany({ where: { seriesId } });
    await db.appointmentSeries.deleteMany({ where: { id: seriesId } });
    return caught;
  }

  it('scope=all, Datum geändert, MIT recurrence', async () => {
    const e = await tryEdit(
      'all+date+recurrence',
      { date: '2026-08-13', startTime: '10:00', recurrence: { frequency: 'WEEKLY', weekdays: [4], endDate: null, count: null } },
      'all',
    );
    expect(e).toBeNull();
  });

  it('scope=all, Datum geändert, OHNE recurrence', async () => {
    const e = await tryEdit('all+date', { date: '2026-08-20', startTime: '10:00' }, 'all');
    expect(e).toBeNull();
  });

  it('scope=following, Datum geändert, MIT recurrence', async () => {
    const e = await tryEdit(
      'following+date+recurrence',
      { date: '2026-08-13', startTime: '10:00', recurrence: { frequency: 'WEEKLY', weekdays: [4], endDate: null, count: null } },
      'following',
    );
    expect(e).toBeNull();
  });

  it('scope=following, Datum geändert, OHNE recurrence', async () => {
    const e = await tryEdit('following+date', { date: '2026-08-14', startTime: '11:00' }, 'following');
    expect(e).toBeNull();
  });
});
