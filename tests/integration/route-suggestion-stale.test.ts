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
import {
  acceptRouteSuggestion,
  generateRouteSuggestions,
} from '@/server/services/route-suggestion-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Reproduktion des häufigen FALSCHEN „Der Vorschlag ist nicht mehr aktuell"
 * (SUGGESTION_STALE) in der Teamplanung.
 *
 * Ursache: Beim Generieren gelten flexible Bestandstermine als BEWEGLICH (sie
 * dürfen im Fenster verschoben werden), beim Annehmen prüfte die Transaktion die
 * Kollision aber gegen die ROHEN startAt/endAt – ein beweglicher Bestandstermin
 * wurde damit fälschlich als „fest belegt" gewertet und blockierte den Vorschlag.
 *
 * Szenario: Der Mitarbeiter hat bereits einen FLEXIBLEN Termin 06:00–08:00 mit
 * Fenster 06:00–12:00. Ein neuer Kunde ist nur 06:00–08:00 verfügbar, sodass die
 * Teamplanung den Vorschlag zwangsläufig auf 06:00–08:00 legt (und den flexiblen
 * Bestandstermin nach hinten schiebt). Ohne echte Datenänderung MUSS dieser
 * angezeigte Vorschlag deterministisch annehmbar sein.
 */
describe('Teamplanung – flexibler Bestandstermin blockiert Vorschlag nicht mehr fälschlich', () => {
  const timezone = 'Europe/Berlin';
  const OFFICE = { label: 'Büro', latitude: 51.96, longitude: 7.62 };
  // Fester künftiger Tag (kein „heute" – die Heute-ab-jetzt-Logik ist hier
  // bewusst nicht im Spiel; getestet wird ausschließlich die Kollisionssemantik).
  const futureDate = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
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
    const base = await createOrg('StaleRepro');
    // Stundenbudgets AUS: jeder aktive Kunde mit Adresse gilt als Bedarf.
    organization = {
      ...base,
      timezone,
      hourBudgetsEnabled: false,
      defaultStartLocation: OFFICE,
    };

    const account = await createUserWithMembership(base.id, 'ADMIN', 'Leitung');
    adminCtx = buildContext(account.user, account.membership, organization, null);

    router = await createEmployee(base.id, 'Router');

    // Bestehender Kunde mit FLEXIBLEM Termin 06:00–08:00 (Fenster 06:00–12:00).
    const existing = await db.customer.create({
      data: {
        organizationId: base.id,
        customerNumber: 'SR-EXIST',
        firstName: 'Bestand',
        lastName: 'Kunde',
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

    // Neuer Kunde, NUR 06:00–08:00 verfügbar → Vorschlag landet zwangsläufig auf
    // 06:00–08:00 (überlappt die Rohzeit des Bestandstermins).
    const fresh = await db.customer.create({
      data: {
        organizationId: base.id,
        customerNumber: 'SR-NEW',
        firstName: 'Neu',
        lastName: 'Kunde',
        status: 'ACTIVE',
        defaultAppointmentDurationMinutes: 120,
        availabilities: {
          create: [{ weekday, startTime: '06:00', endTime: '08:00' }],
        },
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

  it('bietet den neuen Kunden auf 06:00 an und nimmt ihn ohne SUGGESTION_STALE an', async () => {
    authState.ctx = adminCtx;

    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'team',
      bufferMinutes: 10,
      returnToStart: true,
    });

    const panel = result.employees.find((e) => e.employeeId === router.id);
    const suggestion = panel?.suggestions.find((s) => s.customerId === newCustomerId);
    expect(suggestion, 'Teamplanung sollte den neuen Kunden vorschlagen').toBeTruthy();
    // Der Vorschlag liegt auf 06:00 – genau auf der Rohzeit des Bestandstermins.
    expect(suggestion!.startAt).toBe(at('06:00').toISOString());

    // Kernforderung: der angezeigte Vorschlag ist deterministisch annehmbar.
    const accepted = await acceptRouteSuggestion(suggestion!.token);
    expect(accepted.appointmentId).toBeTruthy();
    expect(accepted.routePlanId).toBeTruthy();

    // Datenkonsistenz: die reservierenden Termine des Mitarbeiters am Tag dürfen
    // sich NICHT überlappen – der flexible Bestandstermin wurde im Fenster nach
    // hinten verschoben (nicht als Doppelbelegung stehen gelassen).
    const dayAppointments = await db.appointment.findMany({
      where: {
        assignedEmployeeId: router.id,
        deletedAt: null,
        status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
      },
      orderBy: { startAt: 'asc' },
    });
    expect(dayAppointments).toHaveLength(2);
    expect(
      dayAppointments.find((appointment) => appointment.id === accepted.appointmentId)
        ?.customerConfirmationStatus,
    ).toBe('PENDING');
    for (let i = 1; i < dayAppointments.length; i += 1) {
      expect(dayAppointments[i]!.startAt.getTime()).toBeGreaterThanOrEqual(
        dayAppointments[i - 1]!.endAt.getTime(),
      );
    }

    // Der verschobene Bestandstermin bleibt in seinem Fenster (06:00–12:00).
    const existingAppointment = dayAppointments.find((a) => a.customerId === existingCustomerId)!;
    expect(existingAppointment.startAt.getTime()).toBeGreaterThanOrEqual(at('06:00').getTime());
    expect(existingAppointment.endAt.getTime()).toBeLessThanOrEqual(at('12:00').getTime());
    // ... und der neue Einsatz liegt tatsächlich auf 06:00–08:00.
    const newAppointment = dayAppointments.find((a) => a.customerId === newCustomerId)!;
    expect(newAppointment.startAt.toISOString()).toBe(at('06:00').toISOString());

    // Der gespeicherte Routenplan enthält beide Stopps.
    const stopCount = await db.routeStop.count({ where: { routePlanId: accepted.routePlanId } });
    expect(stopCount).toBe(2);
  });
});
