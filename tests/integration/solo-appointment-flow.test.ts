import type { OrgContext } from '@/server/permissions';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  ctx: null as OrgContext | null,
}));

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
import {
  completeAppointment,
  createAppointment,
  updateAppointment,
} from '@/server/services/appointment-service';

import {
  buildContext,
  createEmployee,
  createOrg,
  createUserWithMembership,
  resetDatabase,
} from './helpers';

describe('Alleine-Modus: Terminfluss (Integration)', () => {
  let customerId: string;
  let ownEmployeeId: string;
  let foreignEmployeeId: string;
  let organizationId: string;

  beforeAll(async () => {
    await resetDatabase();
    const baseOrganization = await createOrg('SoloFlow');
    const organization = await db.organization.update({
      where: { id: baseOrganization.id },
      data: { soloMode: true },
    });
    organizationId = organization.id;

    const owner = await createUserWithMembership(
      organization.id,
      'ORGANIZATION_OWNER',
      'SoloOwner',
    );
    const ownEmployee = await createEmployee(organization.id, 'SoloOwner', {
      userId: owner.user.id,
    });
    const foreignEmployee = await createEmployee(organization.id, 'AnderePerson');
    ownEmployeeId = ownEmployee.id;
    foreignEmployeeId = foreignEmployee.id;
    authState.ctx = buildContext(
      owner.user,
      owner.membership,
      organization,
      ownEmployee,
    );

    const customer = await db.customer.create({
      data: {
        organizationId: organization.id,
        customerNumber: 'SOLO-1',
        firstName: 'Solo',
        lastName: 'Kunde',
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('erzwingt bei der Neuanlage self + ACCEPTED und überspringt Warnbestätigungen', async () => {
    const result = await createAppointment(
      {
        customerId,
        assignedEmployeeId: foreignEmployeeId,
        title: 'Direkter Solo-Termin',
        date: '2026-08-03',
        startTime: '09:00',
        durationMinutes: 60,
      },
      { confirmed: false },
    );

    expect(result.requiresConfirmation).toBe(false);
    if (result.requiresConfirmation || !result.appointmentId) {
      throw new Error('Termin wurde nicht angelegt');
    }
    const appointment = await db.appointment.findUniqueOrThrow({
      where: { id: result.appointmentId },
    });
    expect(appointment.assignedEmployeeId).toBe(ownEmployeeId);
    expect(appointment.assignmentStatus).toBe('ACCEPTED');
    expect(appointment.status).toBe('PLANNED');
  });

  it('erzwingt self + ACCEPTED auch beim Bearbeiten und bei neuen Serienvorkommen', async () => {
    const existing = await db.appointment.create({
      data: {
        organizationId,
        customerId,
        assignedEmployeeId: foreignEmployeeId,
        assignmentStatus: 'ASSIGNED',
        title: 'Altbestand',
        startAt: new Date('2026-08-04T08:00:00Z'),
        endAt: new Date('2026-08-04T09:00:00Z'),
        durationMinutes: 60,
        status: 'CONFIRMED',
      },
    });
    await updateAppointment(
      existing.id,
      { title: 'Solo bearbeitet', assignedEmployeeId: foreignEmployeeId, status: 'DRAFT' },
      { scope: 'single', confirmed: false },
    );
    const updated = await db.appointment.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.assignedEmployeeId).toBe(ownEmployeeId);
    expect(updated.assignmentStatus).toBe('ACCEPTED');
    // Das reduzierte Formular darf einen bestehenden Status nicht unbemerkt zurücksetzen.
    expect(updated.status).toBe('CONFIRMED');

    const seriesResult = await createAppointment(
      {
        customerId,
        assignedEmployeeId: null,
        title: 'Solo-Serie',
        date: '2026-08-05',
        startTime: '10:00',
        durationMinutes: 45,
        recurrence: {
          enabled: true,
          frequency: 'WEEKLY',
          count: 2,
        },
      },
      { confirmed: false },
    );
    expect(seriesResult.requiresConfirmation).toBe(false);
    if (seriesResult.requiresConfirmation || !seriesResult.seriesId) {
      throw new Error('Serie wurde nicht angelegt');
    }
    const occurrences = await db.appointment.findMany({
      where: { seriesId: seriesResult.seriesId },
    });
    expect(occurrences).toHaveLength(2);
    expect(
      occurrences.every(
        (appointment) =>
          appointment.assignedEmployeeId === ownEmployeeId &&
          appointment.assignmentStatus === 'ACCEPTED',
      ),
    ).toBe(true);
  });

  it('schließt legacy-unzugewiesene Termine idempotent ab und ordnet sie self zu', async () => {
    const legacy = await db.appointment.create({
      data: {
        organizationId,
        customerId,
        assignedEmployeeId: null,
        assignmentStatus: 'UNASSIGNED',
        title: 'Legacy ohne Zuordnung',
        startAt: new Date('2026-08-06T08:00:00Z'),
        endAt: new Date('2026-08-06T10:00:00Z'),
        durationMinutes: 120,
        status: 'IN_PROGRESS',
      },
    });

    const first = await completeAppointment(legacy.id);
    const afterFirst = await db.appointment.findUniqueOrThrow({ where: { id: legacy.id } });
    const second = await completeAppointment(legacy.id);
    const afterSecond = await db.appointment.findUniqueOrThrow({ where: { id: legacy.id } });

    expect(first.alreadyCompleted).toBe(false);
    expect(second.alreadyCompleted).toBe(true);
    expect(afterFirst.status).toBe('COMPLETED');
    expect(afterFirst.assignedEmployeeId).toBe(ownEmployeeId);
    expect(afterFirst.assignmentStatus).toBe('ACCEPTED');
    expect(afterFirst.completedAt).not.toBeNull();
    expect(afterSecond.completedAt?.getTime()).toBe(afterFirst.completedAt?.getTime());
  });

  it('lässt abgesagte Termine nicht nachträglich als geleistet zählen', async () => {
    const cancelled = await db.appointment.create({
      data: {
        organizationId,
        customerId,
        assignedEmployeeId: ownEmployeeId,
        assignmentStatus: 'ACCEPTED',
        title: 'Abgesagt',
        startAt: new Date('2026-08-07T08:00:00Z'),
        endAt: new Date('2026-08-07T09:00:00Z'),
        durationMinutes: 60,
        status: 'CANCELLED',
      },
    });

    await expect(completeAppointment(cancelled.id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
