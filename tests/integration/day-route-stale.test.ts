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

import { isoWeekdayInZone, zonedWallTimeToUtc } from '@/lib/dates';
import { db } from '@/server/db';
import { acceptDayRoute, generateDayRoutes } from '@/server/services/day-route-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Gleiche Ursache wie bei den Einzel-Vorschlägen, aber im Tagesrouten-Generator:
 * ein flexibler Bestandstermin darf die Annahme einer generierten Tagesroute
 * nicht mit einem falschen SUGGESTION_STALE blockieren. Der Bestandstermin wird
 * im Fenster verschoben, der neue Einsatz auf 06:00 angelegt.
 */
describe('Tagesrouten-Generator – flexibler Bestandstermin blockiert Annahme nicht', () => {
  const timezone = 'Europe/Berlin';
  const OFFICE = { label: 'Büro', latitude: 51.96, longitude: 7.62 };
  const futureDate = new Date(Date.now() + 61 * 86_400_000).toISOString().slice(0, 10);
  const [year, month, day] = futureDate.split('-').map(Number);
  const at = (hhmm: string) => zonedWallTimeToUtc(year!, month!, day!, hhmm, timezone);
  const weekday = isoWeekdayInZone(at('06:00'), timezone);

  let organization: Organization;
  let adminCtx: OrgContext;
  let router: Employee;
  let existingCustomerId: string;
  let newCustomerId: string;

  beforeAll(async () => {
    await resetDatabase();
    const base = await createOrg('DayStaleRepro');
    organization = { ...base, timezone, hourBudgetsEnabled: false, defaultStartLocation: OFFICE };

    const account = await createUserWithMembership(base.id, 'ADMIN', 'Leitung');
    adminCtx = buildContext(account.user, account.membership, organization, null);
    router = await createEmployee(base.id, 'Tagesrouter');

    const existing = await db.customer.create({
      data: {
        organizationId: base.id,
        customerNumber: 'DR-EXIST',
        firstName: 'Bestand',
        lastName: 'Tag',
        status: 'ACTIVE',
        defaultAppointmentDurationMinutes: 120,
      },
    });
    existingCustomerId = existing.id;
    const existingAddress = await db.address.create({
      data: {
        organizationId: base.id,
        customerId: existing.id,
        street: 'Bestandweg',
        houseNumber: '1',
        postalCode: '48143',
        city: 'Münster',
        latitude: 51.9603,
        longitude: 7.6203,
      },
    });
    await db.appointment.create({
      data: {
        organizationId: base.id,
        customerId: existing.id,
        assignedEmployeeId: router.id,
        title: 'Bestehender flexibler Einsatz',
        startAt: at('06:00'),
        endAt: at('08:00'),
        durationMinutes: 120,
        status: 'PLANNED',
        assignmentStatus: 'ASSIGNED',
        isFlexible: true,
        earliestStartAt: at('06:00'),
        latestEndAt: at('12:00'),
        locationAddressId: existingAddress.id,
        routeRelevant: true,
      },
    });

    const fresh = await db.customer.create({
      data: {
        organizationId: base.id,
        customerNumber: 'DR-NEW',
        firstName: 'Neu',
        lastName: 'Tag',
        status: 'ACTIVE',
        defaultAppointmentDurationMinutes: 120,
        availabilities: { create: [{ weekday, startTime: '06:00', endTime: '08:00' }] },
      },
    });
    newCustomerId = fresh.id;
    await db.address.create({
      data: {
        organizationId: base.id,
        customerId: fresh.id,
        street: 'Neuweg',
        houseNumber: '2',
        postalCode: '48143',
        city: 'Münster',
        latitude: 51.9605,
        longitude: 7.6205,
      },
    });
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('nimmt eine Variante mit dem neuen Einsatz auf 06:00 ohne SUGGESTION_STALE an', async () => {
    authState.ctx = adminCtx;

    const generated = await generateDayRoutes({
      employeeId: router.id,
      date: futureDate,
      bufferMinutes: 10,
      returnToStart: true,
    });

    // Variante mit dem neuen Einsatz (überlappt die Rohzeit des Bestandstermins).
    const variant = generated.variants.find((v) => v.newVisitCount >= 1);
    expect(variant, 'Es sollte eine Variante mit dem neuen Einsatz geben').toBeTruthy();

    const accepted = await acceptDayRoute({ token: variant!.token, publish: false });
    expect(accepted.appointmentIds.length).toBeGreaterThanOrEqual(1);

    // Keine Doppelbelegung: die reservierenden Termine am Tag überlappen sich nicht.
    const dayAppointments = await db.appointment.findMany({
      where: {
        assignedEmployeeId: router.id,
        deletedAt: null,
        status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
      },
      orderBy: { startAt: 'asc' },
    });
    expect(dayAppointments).toHaveLength(2);
    for (let i = 1; i < dayAppointments.length; i += 1) {
      expect(dayAppointments[i]!.startAt.getTime()).toBeGreaterThanOrEqual(
        dayAppointments[i - 1]!.endAt.getTime(),
      );
    }

    const existingAppointment = dayAppointments.find((a) => a.customerId === existingCustomerId)!;
    expect(existingAppointment.startAt.getTime()).toBeGreaterThanOrEqual(at('06:00').getTime());
    expect(existingAppointment.endAt.getTime()).toBeLessThanOrEqual(at('12:00').getTime());
    const newAppointment = dayAppointments.find((a) => a.customerId === newCustomerId)!;
    expect(newAppointment.startAt.toISOString()).toBe(at('06:00').toISOString());
    expect(newAppointment.customerConfirmationStatus).toBe('PENDING');
  });
});
