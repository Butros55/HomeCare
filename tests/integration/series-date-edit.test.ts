import type { OrgContext } from '@/server/permissions';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
import { listCalendarEvents } from '@/server/services/calendar-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/** Serientermin bearbeiten: Datumsverschiebung (Ganze Serie) und Split (Folgende). */
describe('Serientermin mit Datumswechsel bearbeiten (Team-Modus)', () => {
  let customerId: string;
  let ownEmployeeId: string;

  beforeAll(async () => {
    await resetDatabase();
    const organization = await createOrg('SeriesEdit'); // Team-Modus (soloMode default false)
    const owner = await createUserWithMembership(organization.id, 'ORGANIZATION_OWNER', 'EditOwner');
    const ownEmployee = await createEmployee(organization.id, 'EditOwner', { userId: owner.user.id });
    ownEmployeeId = ownEmployee.id;
    authState.ctx = buildContext(owner.user, owner.membership, organization, ownEmployee);
    const customer = await db.customer.create({
      data: { organizationId: organization.id, customerNumber: 'SE-1', firstName: 'Serie', lastName: 'Kunde' },
    });
    customerId = customer.id;
  });

  afterEach(async () => {
    await db.routeStop.deleteMany({});
    await db.appointment.deleteMany({ where: { customerId } });
    await db.appointmentSeriesException.deleteMany({});
    await db.appointmentSeries.deleteMany({ where: { customerId } });
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  /** Wöchentliche Serie ab dem gegebenen Startdatum (offen, damit weit materialisiert). */
  async function makeWeeklySeries(startDate: string): Promise<string> {
    const created = await createAppointment(
      {
        customerId,
        assignedEmployeeId: ownEmployeeId,
        title: 'Wöchentliche Reinigung',
        date: startDate,
        startTime: '10:00',
        durationMinutes: 60,
        recurrence: { enabled: true, frequency: 'WEEKLY' },
      },
      { confirmed: true },
    );
    if (created.requiresConfirmation || !created.seriesId) throw new Error('Serie nicht angelegt');
    return created.seriesId;
  }

  const dayOf = (d: Date) => d.toISOString().slice(0, 10);
  const toUtc = (day: string) => new Date(`${day}T00:00:00.000Z`);
  const startOfTodayUtc = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  };
  const addDaysUtc = (date: Date, days: number) =>
    new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

  it('Ganze Serie: Datumswechsel verschiebt den Serienstart (Wochentag folgt)', async () => {
    const seriesId = await makeWeeklySeries('2026-08-05'); // Mittwoch
    const second = await db.appointment.findFirstOrThrow({
      where: { seriesId },
      orderBy: { startAt: 'asc' },
      skip: 1,
    });

    await updateAppointment(
      second.id,
      { date: '2026-08-20', startTime: '10:00' }, // Donnerstag
      { scope: 'all', confirmed: true },
    );

    const updatedSeries = await db.appointmentSeries.findUniqueOrThrow({ where: { id: seriesId } });
    expect(dayOf(updatedSeries.startDate)).toBe('2026-08-20');

    const occ = await db.appointment.findMany({ where: { seriesId }, orderBy: { startAt: 'asc' } });
    // Erstes Vorkommen liegt am neuen Startdatum; alle Vorkommen sind Donnerstage.
    expect(dayOf(occ[0]!.occurrenceDate!)).toBe('2026-08-20');
    expect(occ.every((a) => a.occurrenceDate!.getUTCDay() === 4)).toBe(true);
  });

  it('Dieser und folgende: Datumswechsel splittet die Serie am gewählten Tag', async () => {
    const seriesId = await makeWeeklySeries('2026-08-05'); // Mi 5.8., 12.8., 19.8. …
    const second = await db.appointment.findFirstOrThrow({
      where: { seriesId },
      orderBy: { startAt: 'asc' },
      skip: 1, // 12.08.
    });
    expect(dayOf(second.occurrenceDate!)).toBe('2026-08-12');

    await updateAppointment(
      second.id,
      { date: '2026-08-14', startTime: '11:00' }, // Freitag
      { scope: 'following', confirmed: true },
    );

    // Alte Serie endet vor dem gewählten Tag; Vorkommen davor bleiben.
    const oldSeries = await db.appointmentSeries.findUniqueOrThrow({ where: { id: seriesId } });
    expect(oldSeries.endDate && oldSeries.endDate.getTime() < new Date('2026-08-12T00:00:00Z').getTime()).toBe(true);
    const oldOcc = await db.appointment.findMany({ where: { seriesId }, orderBy: { startAt: 'asc' } });
    expect(dayOf(oldOcc[0]!.occurrenceDate!)).toBe('2026-08-05');
    expect(oldOcc.every((a) => a.occurrenceDate!.getTime() < new Date('2026-08-12T00:00:00Z').getTime())).toBe(true);

    // Neue Serie ab dem neuen Datum (Freitag).
    const newSeries = await db.appointmentSeries.findFirstOrThrow({
      where: { customerId, id: { not: seriesId } },
    });
    expect(dayOf(newSeries.startDate)).toBe('2026-08-14');
    const newOcc = await db.appointment.findMany({ where: { seriesId: newSeries.id }, orderBy: { startAt: 'asc' } });
    expect(dayOf(newOcc[0]!.occurrenceDate!)).toBe('2026-08-14');
    expect(newOcc.every((a) => a.occurrenceDate!.getUTCDay() === 5)).toBe(true);
  });

  it('lehnt einen Serienstart in der Vergangenheit ab', async () => {
    const seriesId = await makeWeeklySeries('2026-08-05');
    const second = await db.appointment.findFirstOrThrow({ where: { seriesId }, orderBy: { startAt: 'asc' }, skip: 1 });
    await expect(
      updateAppointment(second.id, { date: '2020-01-01', startTime: '10:00' }, { scope: 'all', confirmed: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('eine kaputte Wiederholungsregel reißt NICHT den ganzen Kalender-Feed', async () => {
    // Gültige Serie (Vorkommen bereits materialisiert).
    const goodId = await makeWeeklySeries('2026-08-05');
    const before = await db.appointment.count({ where: { seriesId: goodId } });
    expect(before).toBeGreaterThan(0);

    // Zweite Serie künstlich kaputt machen (wie ein Alt-Datenstand).
    const brokenId = await makeWeeklySeries('2026-08-06');
    await db.appointmentSeries.update({
      where: { id: brokenId },
      data: { recurrenceRule: 'FREQ=KAPUTT;NONSENSE', materializedUntil: null },
    });

    // Feed muss trotzdem laden (kaputte Serie wird übersprungen) und die gültigen
    // Termine liefern – vorher riss das den ganzen Kalender („Unerwarteter Fehler").
    const events = await listCalendarEvents(
      { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-09-01T00:00:00Z') },
      {},
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.seriesId === goodId)).toBe(true);
  });

  it('Ganze Serie verschieben: offene Vorkommen vor dem neuen Start entfallen', async () => {
    // Serienstart in der Vergangenheit (heute ist im Test der echte Tag) – nach
    // dem Verschieben darf am alten Starttag KEIN verwaister Termin bleiben.
    const past = dayOf(addDaysUtc(startOfTodayUtc(), -2));
    const future = dayOf(addDaysUtc(startOfTodayUtc(), 14));
    const seriesId = await makeWeeklySeries(past);
    expect(await db.appointment.count({ where: { seriesId, occurrenceDate: toUtc(past) } })).toBe(1);

    const first = await db.appointment.findFirstOrThrow({
      where: { seriesId },
      orderBy: { startAt: 'asc' },
    });
    await updateAppointment(first.id, { date: future, startTime: '10:00' }, { scope: 'all', confirmed: true });

    const series = await db.appointmentSeries.findUniqueOrThrow({ where: { id: seriesId } });
    expect(dayOf(series.startDate)).toBe(future);
    const remaining = await db.appointment.findMany({ where: { seriesId }, orderBy: { startAt: 'asc' } });
    expect(remaining.length).toBeGreaterThan(0);
    // Kein Vorkommen mehr vor dem neuen Serienstart, insbesondere nicht am alten.
    expect(remaining.every((a) => dayOf(a.occurrenceDate!) >= future)).toBe(true);
    expect(dayOf(remaining[0]!.occurrenceDate!)).toBe(future);
  });

  it('Ganze Serie verschieben: abgeschlossene Vorkommen bleiben als Historie', async () => {
    const past = dayOf(addDaysUtc(startOfTodayUtc(), -2));
    const future = dayOf(addDaysUtc(startOfTodayUtc(), 14));
    const seriesId = await makeWeeklySeries(past);
    const oldFirst = await db.appointment.findFirstOrThrow({
      where: { seriesId },
      orderBy: { startAt: 'asc' },
    });
    await db.appointment.update({
      where: { id: oldFirst.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    const next = await db.appointment.findFirstOrThrow({
      where: { seriesId, status: 'PLANNED' },
      orderBy: { startAt: 'asc' },
    });
    await updateAppointment(next.id, { date: future, startTime: '10:00' }, { scope: 'all', confirmed: true });

    const kept = await db.appointment.findUnique({ where: { id: oldFirst.id } });
    expect(kept?.status).toBe('COMPLETED');
  });

  it('Dieser und folgende auf dem Serienstart verschiebt die ganze Serie (ohne Rest am alten Tag)', async () => {
    const past = dayOf(addDaysUtc(startOfTodayUtc(), -2));
    const future = dayOf(addDaysUtc(startOfTodayUtc(), 14));
    const seriesId = await makeWeeklySeries(past);
    const first = await db.appointment.findFirstOrThrow({
      where: { seriesId },
      orderBy: { startAt: 'asc' },
    });

    await updateAppointment(first.id, { date: future, startTime: '10:00' }, { scope: 'following', confirmed: true });

    // Kein Split: es bleibt bei genau einer Serie, verschoben auf das neue Datum.
    expect(await db.appointmentSeries.count({ where: { customerId } })).toBe(1);
    const series = await db.appointmentSeries.findUniqueOrThrow({ where: { id: seriesId } });
    expect(dayOf(series.startDate)).toBe(future);
    const remaining = await db.appointment.findMany({ where: { seriesId } });
    expect(remaining.every((a) => dayOf(a.occurrenceDate!) >= future)).toBe(true);
  });

  it('liefert nach einer Serienänderung eine gültige Termin-ID zurück (nicht die gelöschte)', async () => {
    // Der Drawer lädt danach den Termin nach – zeigte die ID ins Leere, meldete
    // die UI „Unerwarteter Fehler" und der Kalender lud komplett neu.
    const future = dayOf(addDaysUtc(startOfTodayUtc(), 7));
    const later = dayOf(addDaysUtc(startOfTodayUtc(), 21));
    const seriesId = await makeWeeklySeries(future);
    const first = await db.appointment.findFirstOrThrow({
      where: { seriesId },
      orderBy: { startAt: 'asc' },
    });

    const result = await updateAppointment(
      first.id,
      { date: later, startTime: '10:00' },
      { scope: 'all', confirmed: true },
    );
    if (result.requiresConfirmation) throw new Error('unerwartete Rückfrage');
    expect(result.appointmentId).toBeTruthy();
    const target = await db.appointment.findUnique({ where: { id: result.appointmentId! } });
    expect(target).not.toBeNull();
    expect(dayOf(target!.occurrenceDate!)).toBe(later);
  });

  it('ohne Datumswechsel bleibt es bei einer Serie (nur Zeit ändern)', async () => {
    const seriesId = await makeWeeklySeries('2026-08-05');
    const second = await db.appointment.findFirstOrThrow({ where: { seriesId }, orderBy: { startAt: 'asc' }, skip: 1 });
    await updateAppointment(second.id, { startTime: '14:00' }, { scope: 'all', confirmed: true });
    const seriesCount = await db.appointmentSeries.count({ where: { customerId } });
    expect(seriesCount).toBe(1);
    const series = await db.appointmentSeries.findUniqueOrThrow({ where: { id: seriesId } });
    expect(series.defaultStartTime).toBe('14:00');
    expect(dayOf(series.startDate)).toBe('2026-08-05'); // Start unverändert
  });
});
