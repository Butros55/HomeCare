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
import { suggestReplacementEmployees } from '@/server/services/conflict-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

describe('Konfliktlösung: Ersatz-Mitarbeiter (frei + nächste)', () => {
  let assignedId: string;
  let freeId: string;
  let busyId: string;
  let appointmentId: string;

  beforeAll(async () => {
    await resetDatabase();
    const organization = await createOrg('ReplaceOrg');
    const owner = await createUserWithMembership(organization.id, 'ORGANIZATION_OWNER', 'ReplaceOwner');
    const ownEmployee = await createEmployee(organization.id, 'ReplaceOwner', { userId: owner.user.id });
    authState.ctx = buildContext(owner.user, owner.membership, organization, ownEmployee);

    const customer = await db.customer.create({
      data: { organizationId: organization.id, customerNumber: 'RP-1', firstName: 'Ersatz', lastName: 'Kunde' },
    });
    await db.address.create({
      data: {
        organizationId: organization.id,
        customerId: customer.id,
        street: 'Hauptstr.',
        houseNumber: '1',
        postalCode: '48143',
        city: 'Münster',
        latitude: 51.96,
        longitude: 7.626,
      },
    });

    const assigned = await createEmployee(organization.id, 'Zugewiesen');
    const free = await createEmployee(organization.id, 'Frei');
    const busy = await createEmployee(organization.id, 'Belegt');
    assignedId = assigned.id;
    freeId = free.id;
    busyId = busy.id;

    // Der zu prüfende Termin (zugewiesen an „Zugewiesen").
    const appt = await db.appointment.create({
      data: {
        organizationId: organization.id,
        customerId: customer.id,
        assignedEmployeeId: assigned.id,
        title: 'Einsatz',
        startAt: new Date('2026-08-05T08:00:00Z'),
        endAt: new Date('2026-08-05T10:00:00Z'),
        durationMinutes: 120,
        status: 'PLANNED',
        assignmentStatus: 'ASSIGNED',
      },
    });
    appointmentId = appt.id;

    // „Belegt" hat zur selben Zeit einen anderen Termin → Überschneidung.
    await db.appointment.create({
      data: {
        organizationId: organization.id,
        customerId: customer.id,
        assignedEmployeeId: busy.id,
        title: 'Kollision',
        startAt: new Date('2026-08-05T08:30:00Z'),
        endAt: new Date('2026-08-05T09:30:00Z'),
        durationMinutes: 60,
        status: 'CONFIRMED',
        assignmentStatus: 'ASSIGNED',
      },
    });
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('schlägt freie Mitarbeiter vor, mit Überschneidung erkannt und hinten gereiht', async () => {
    const result = await suggestReplacementEmployees(appointmentId);

    // Der zugewiesene Mitarbeiter taucht nicht als Vorschlag auf.
    expect(result.candidates.some((c) => c.employeeId === assignedId)).toBe(false);

    const free = result.candidates.find((c) => c.employeeId === freeId);
    const busy = result.candidates.find((c) => c.employeeId === busyId);
    expect(free?.available).toBe(true);
    expect(busy?.available).toBe(false);
    expect(busy?.hasOverlap).toBe(true);

    // Freie Mitarbeiter stehen vor belegten.
    const freeIndex = result.candidates.findIndex((c) => c.employeeId === freeId);
    const busyIndex = result.candidates.findIndex((c) => c.employeeId === busyId);
    expect(freeIndex).toBeLessThan(busyIndex);
  });

  it('schlägt im Alleine-Modus niemanden vor (auch nicht aus einer früheren Team-Phase)', async () => {
    const organization = authState.ctx!.organization;
    await db.organization.update({ where: { id: organization.id }, data: { soloMode: true } });
    authState.ctx = { ...authState.ctx!, organization: { ...organization, soloMode: true } };
    try {
      const result = await suggestReplacementEmployees(appointmentId);
      expect(result.candidates).toEqual([]);
    } finally {
      await db.organization.update({ where: { id: organization.id }, data: { soloMode: false } });
      authState.ctx = { ...authState.ctx!, organization };
    }
  });
});
