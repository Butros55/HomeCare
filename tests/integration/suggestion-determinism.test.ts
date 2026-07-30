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
import {
  acceptRouteSuggestion,
  generateRouteSuggestions,
} from '@/server/services/route-suggestion-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Zentrale Zusicherung der Teamplanung: Ändern sich zwischen Erzeugen und
 * Annehmen KEINE fachlich relevanten Daten, muss jeder angezeigte Vorschlag
 * annehmbar sein – ohne „Der Vorschlag ist nicht mehr aktuell".
 *
 * Der Test nimmt je Mitarbeiter-Panel den ersten Vorschlag an. Die Teamzuordnung
 * gibt jeden Kunden an genau einen Mitarbeiter, die Annahmen sind daher
 * voneinander unabhängig (verschiedene Mitarbeiter, verschiedene Kunden).
 */
describe('Teamplanung – angezeigte Vorschläge sind deterministisch annehmbar', () => {
  const timezone = 'Europe/Berlin';
  const OFFICE = { label: 'Büro', latitude: 51.96, longitude: 7.62 };
  const futureDate = new Date(Date.now() + 62 * 86_400_000).toISOString().slice(0, 10);

  let organization: Organization;
  let adminCtx: OrgContext;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    await resetDatabase();
    const base = await createOrg('DeterminismOrg');
    organization = { ...base, timezone, hourBudgetsEnabled: false, defaultStartLocation: OFFICE };

    const account = await createUserWithMembership(base.id, 'ADMIN', 'Leitung');
    adminCtx = buildContext(account.user, account.membership, organization, null);

    for (const name of ['Anna', 'Ben']) {
      const employee = await createEmployee(base.id, name);
      employeeIds.push(employee.id);
    }

    // Mehrere Kunden ohne gepflegte Fenster (Standard-Planungsfenster),
    // rund um das Büro verteilt.
    const spots = [
      { lat: 51.9605, lng: 7.6205 },
      { lat: 51.9655, lng: 7.6305 },
      { lat: 51.9555, lng: 7.6105 },
      { lat: 51.9705, lng: 7.6405 },
    ];
    for (const [index, spot] of spots.entries()) {
      const customer = await db.customer.create({
        data: {
          organizationId: base.id,
          customerNumber: `DT-${index + 1}`,
          firstName: `Kunde${index + 1}`,
          lastName: 'Determinismus',
          status: 'ACTIVE',
          defaultAppointmentDurationMinutes: 90,
        },
      });
      await db.address.create({
        data: {
          organizationId: base.id,
          customerId: customer.id,
          street: 'Testweg',
          houseNumber: `${index + 1}`,
          postalCode: '48143',
          city: 'Münster',
          latitude: spot.lat,
          longitude: spot.lng,
        },
      });
    }
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('nimmt je Mitarbeiter den angezeigten Vorschlag ohne SUGGESTION_STALE an', async () => {
    authState.ctx = adminCtx;

    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'team',
      bufferMinutes: 10,
      returnToStart: true,
    });

    const panels = result.employees.filter((panel) => panel.suggestions.length > 0);
    expect(panels.length, 'Es sollten Vorschläge für Mitarbeiter entstehen').toBeGreaterThan(0);

    // Ohne Datenänderung dazwischen: jeder erste Panel-Vorschlag ist annehmbar.
    for (const panel of panels) {
      const suggestion = panel.suggestions[0]!;
      const accepted = await acceptRouteSuggestion(suggestion.token);
      expect(accepted.appointmentId).toBeTruthy();

      const appointment = await db.appointment.findUniqueOrThrow({
        where: { id: accepted.appointmentId },
      });
      // Die angenommene Zeit entspricht exakt der angezeigten.
      expect(appointment.startAt.toISOString()).toBe(suggestion.startAt);
      expect(appointment.assignedEmployeeId).toBe(panel.employeeId);
    }
  });

  it('meldet einen echten Konflikt weiterhin als veraltet (keine stille Annahme)', async () => {
    authState.ctx = adminCtx;

    const result = await generateRouteSuggestions({
      date: futureDate,
      scope: 'team',
      bufferMinutes: 10,
      returnToStart: true,
    });
    const panel = result.employees.find((entry) => entry.suggestions.length > 0);
    expect(panel).toBeTruthy();
    const suggestion = panel!.suggestions[0]!;

    // Echte Datenänderung: Der Kunde wird pausiert – die Annahme MUSS
    // scheitern (die Prüfungen bleiben scharf, es wird nichts blind angelegt).
    await db.customer.update({
      where: { id: suggestion.customerId },
      data: { status: 'PAUSED' },
    });

    await expect(acceptRouteSuggestion(suggestion.token)).rejects.toMatchObject({
      code: 'SUGGESTION_STALE',
    });

    await db.customer.update({
      where: { id: suggestion.customerId },
      data: { status: 'ACTIVE' },
    });
  });
});
