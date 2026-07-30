import type { OrgContext } from '@/server/permissions';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { zonedWallTimeToUtc } from '@/lib/dates';
import { db } from '@/server/db';
import { resolvePlanningHorizon } from '@/server/services/route-service';
import {
  acceptRouteSuggestion,
  createSuggestionToken,
  generateRouteSuggestions,
} from '@/server/services/route-suggestion-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Heutige Routen ausschließlich ab JETZT planen.
 *
 * Bisher startete die Simulation immer um 00:00 Org-Wandzeit – am heutigen Tag
 * konnten dadurch Abfahrten und Einsätze in der Vergangenheit vorgeschlagen
 * werden (und beim Annehmen später als „nicht mehr aktuell" scheitern). Der
 * zentrale `resolvePlanningHorizon` setzt den Planungsbeginn heute auf „jetzt".
 *
 * Die Zeit wird über einen FESTEN injizierten Zeitpunkt gesteuert (nur `Date`
 * wird ersetzt, Timer laufen echt weiter – Prisma bleibt funktionsfähig).
 */
describe('Planungshorizont – heute nur ab jetzt', () => {
  const timezone = 'Europe/Berlin';
  const OFFICE = { label: 'Büro', latitude: 51.96, longitude: 7.62 };
  /** 2026-09-15, 12:00 Ortszeit (Berlin = UTC+2 im September). */
  const NOW = new Date('2026-09-15T10:00:00.000Z');
  const todayIso = '2026-09-15';
  const tomorrowIso = '2026-09-16';
  const at = (hhmm: string, dateIso = todayIso) => {
    const [year, month, day] = dateIso.split('-').map(Number);
    return zonedWallTimeToUtc(year!, month!, day!, hhmm, timezone);
  };

  let organization: Organization;
  let adminCtx: OrgContext;
  let router: Employee;
  let customerId: string;

  beforeAll(async () => {
    await resetDatabase();
    const base = await createOrg('HorizonOrg');
    organization = { ...base, timezone, hourBudgetsEnabled: false, defaultStartLocation: OFFICE };

    const account = await createUserWithMembership(base.id, 'ADMIN', 'Leitung');
    adminCtx = buildContext(account.user, account.membership, organization, null);
    router = await createEmployee(base.id, 'Horizont');

    // Kunde ohne gepflegte Fenster → Standard-Planungsfenster 06:00–22:00.
    const customer = await db.customer.create({
      data: {
        organizationId: base.id,
        customerNumber: 'HZ-1',
        firstName: 'Horizont',
        lastName: 'Kunde',
        status: 'ACTIVE',
        defaultAppointmentDurationMinutes: 120,
      },
    });
    customerId = customer.id;
    await db.address.create({
      data: {
        organizationId: base.id,
        customerId: customer.id,
        street: 'Horizontweg',
        houseNumber: '1',
        postalCode: '48143',
        city: 'Münster',
        latitude: 51.9605,
        longitude: 7.6205,
      },
    });
  });

  beforeEach(() => {
    // Nur `Date` ersetzen: Timer/Promises bleiben echt, damit die Datenbank-
    // Zugriffe normal laufen. Der Zeitpunkt ist fest – keine Testflakiness.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    authState.ctx = adminCtx;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    authState.ctx = null;
    vi.useRealTimers();
    await resetDatabase();
    await db.$disconnect();
  });

  it('setzt den Planungsbeginn heute auf jetzt, für künftige Tage auf 00:00', () => {
    const today = resolvePlanningHorizon({ date: at('00:00'), timezone, now: NOW });
    expect(today.isToday).toBe(true);
    expect(today.earliestDepartureAt.toISOString()).toBe(NOW.toISOString());
    // 12:00 Ortszeit = 720 Minuten seit Mitternacht.
    expect(today.earliestServiceMinute).toBe(720);

    const future = resolvePlanningHorizon({
      date: at('00:00', tomorrowIso),
      timezone,
      now: NOW,
    });
    expect(future.isToday).toBe(false);
    expect(future.earliestDepartureAt.toISOString()).toBe(at('00:00', tomorrowIso).toISOString());
    expect(future.earliestServiceMinute).toBe(0);
  });

  it('schlägt heute keinen Einsatz vor, der vor jetzt beginnt', async () => {
    const result = await generateRouteSuggestions({
      date: todayIso,
      scope: 'team',
      bufferMinutes: 10,
      returnToStart: true,
    });

    const panel = result.employees.find((e) => e.employeeId === router.id);
    const suggestion = panel?.suggestions.find((s) => s.customerId === customerId);
    expect(suggestion, 'Für heute sollte es einen Vorschlag geben').toBeTruthy();

    // Kern: kein Beginn und keine Abfahrt in der Vergangenheit.
    expect(new Date(suggestion!.startAt).getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    expect(new Date(suggestion!.impact.departureAt).getTime()).toBeGreaterThanOrEqual(
      NOW.getTime(),
    );
    // Und der Einsatz muss ab jetzt auch tatsächlich erreichbar sein
    // (Fahrzeit ab jetzt liegt vor dem Beginn).
    expect(new Date(suggestion!.startAt).getTime()).toBeGreaterThan(
      new Date(suggestion!.impact.departureAt).getTime(),
    );
  });

  it('nimmt einen heutigen Vorschlag ohne Fehlalarm an und legt ihn nicht rückwärts an', async () => {
    const result = await generateRouteSuggestions({
      date: todayIso,
      scope: 'team',
      bufferMinutes: 10,
      returnToStart: true,
    });
    const suggestion = result.employees
      .find((e) => e.employeeId === router.id)
      ?.suggestions.find((s) => s.customerId === customerId);
    expect(suggestion).toBeTruthy();

    const accepted = await acceptRouteSuggestion(suggestion!.token);
    const appointment = await db.appointment.findUniqueOrThrow({
      where: { id: accepted.appointmentId },
    });
    expect(appointment.startAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime());

    // Aufräumen für die folgenden Fälle (der Kunde hätte sonst einen Tagestermin).
    await db.routeStop.deleteMany({ where: { routePlanId: accepted.routePlanId } });
    await db.routePlan.deleteMany({ where: { id: accepted.routePlanId } });
    await db.appointment.deleteMany({ where: { id: accepted.appointmentId } });
  });

  it('lehnt einen inzwischen verstrichenen Vorschlag ehrlich ab, statt ihn rückwärts zu buchen', async () => {
    // Ein Token mit bereits verstrichener Startzeit lässt sich über den echten
    // Ablauf nicht mehr erzeugen – genau das ist die zu prüfende Eigenschaft.
    // Deshalb wird hier ein regulär signiertes Token mit vergangener Zeit
    // gestellt (gleicher Signierpfad, nur die Zeit ist veraltet).
    const token = createSuggestionToken({
      v: 2,
      org: organization.id,
      emp: router.id,
      cust: customerId,
      date: todayIso,
      start: at('06:00').toISOString(), // 6 Stunden vor „jetzt"
      dur: 120,
      originType: 'office',
      oLat: OFFICE.latitude,
      oLng: OFFICE.longitude,
      oLabel: OFFICE.label,
      buffer: 10,
      ret: true,
      exp: NOW.getTime() + 60_000,
    });

    await expect(acceptRouteSuggestion(token)).rejects.toMatchObject({
      code: 'SUGGESTION_STALE',
    });
    // Nichts angelegt – die Ablehnung ist folgenlos.
    const created = await db.appointment.count({ where: { customerId } });
    expect(created).toBe(0);
  });
});
