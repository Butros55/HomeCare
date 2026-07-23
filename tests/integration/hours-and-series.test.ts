import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { utcDate } from '@/lib/dates';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { materializeSeries } from '@/server/services/appointment-service';
import { getCustomerHourStatsBulk } from '@/server/services/hours-service';

import { createEmployee, createOrg, resetDatabase } from './helpers';

/**
 * Stundenberechnung, Serien-Materialisierung, Soft Delete und Audit-Log
 * gegen die echte Datenbank.
 */
describe('Stunden & Serien (Integration)', () => {
  let orgId: string;
  let customerId: string;
  let employeeId: string;
  let managerId: string;

  beforeAll(async () => {
    await resetDatabase();
    const org = await createOrg('HoursOrg');
    orgId = org.id;
    const manager = await createEmployee(orgId, 'Manager');
    const worker = await createEmployee(orgId, 'Worker', { managerEmployeeId: manager.id });
    managerId = manager.id;
    employeeId = worker.id;
    const customer = await db.customer.create({
      data: { organizationId: orgId, customerNumber: 'K-100', firstName: 'Stunden', lastName: 'Kunde' },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await resetDatabase();
    await db.$disconnect();
  });

  it('berechnet Kundenstunden korrekt (Budget, Korrektur, Pool-Weitergabe, Soft Delete)', async () => {
    const period = { start: utcDate(2026, 7, 1), end: utcDate(2026, 8, 1) };
    const budget = await db.customerHourBudget.create({
      data: {
        organizationId: orgId,
        customerId,
        periodStart: utcDate(2026, 7, 1),
        periodEnd: utcDate(2026, 7, 31),
        budgetMinutes: 600,
      },
    });
    await db.customerHourAdjustment.create({
      data: {
        customerHourBudgetId: budget.id,
        adjustmentMinutes: 120,
        reason: 'Aufstockung',
        createdByUserId: (
          await db.user.create({
            data: { email: 'adm@test.example', passwordHash: 'x', firstName: 'A', lastName: 'B' },
          })
        ).id,
      },
    });
    // Org-Pool → Manager 480; Manager → Worker 240 (zählt NICHT gegen das Kundenbudget).
    await db.hourAllocation.createMany({
      data: [
        {
          organizationId: orgId,
          customerId,
          budgetId: budget.id,
          allocatedToEmployeeId: managerId,
          allocatedMinutes: 480,
          validFrom: utcDate(2026, 7, 1),
          validUntil: utcDate(2026, 7, 31),
        },
        {
          organizationId: orgId,
          customerId,
          budgetId: budget.id,
          allocatedByEmployeeId: managerId,
          allocatedToEmployeeId: employeeId,
          allocatedMinutes: 240,
          validFrom: utcDate(2026, 7, 1),
          validUntil: utcDate(2026, 7, 31),
        },
      ],
    });
    // Termine: 1 geplant (120), 1 abgeschlossen (60, Ist 55), 1 abgesagt (999 – zählt nicht),
    // 1 soft-deleted (500 – zählt nicht).
    const base = {
      organizationId: orgId,
      customerId,
      assignedEmployeeId: employeeId,
      title: 'T',
    };
    await db.appointment.createMany({
      data: [
        {
          ...base,
          startAt: new Date('2026-07-10T08:00:00Z'),
          endAt: new Date('2026-07-10T10:00:00Z'),
          durationMinutes: 120,
          status: 'PLANNED',
        },
        {
          ...base,
          startAt: new Date('2026-07-11T08:00:00Z'),
          endAt: new Date('2026-07-11T09:00:00Z'),
          durationMinutes: 60,
          status: 'COMPLETED',
        },
        {
          ...base,
          startAt: new Date('2026-07-12T08:00:00Z'),
          endAt: new Date('2026-07-12T08:30:00Z'),
          durationMinutes: 999,
          status: 'CANCELLED',
        },
        {
          ...base,
          startAt: new Date('2026-07-13T08:00:00Z'),
          endAt: new Date('2026-07-13T09:00:00Z'),
          durationMinutes: 500,
          status: 'PLANNED',
          deletedAt: new Date(),
        },
      ],
    });
    const completed = await db.appointment.findFirst({ where: { status: 'COMPLETED' } });
    await db.timeEntry.create({
      data: {
        organizationId: orgId,
        appointmentId: completed!.id,
        employeeId,
        startedAt: completed!.startAt,
        endedAt: completed!.endAt,
        workedMinutes: 55,
        status: 'APPROVED',
      },
    });

    const stats = (await getCustomerHourStatsBulk([customerId], period)).get(customerId)!;
    expect(stats.budgetMinutes).toBe(720); // 600 + 120 Korrektur
    expect(stats.allocatedMinutes).toBe(480); // nur Org-Pool
    expect(stats.unallocatedMinutes).toBe(240);
    expect(stats.plannedMinutes).toBe(180); // 120 + 60 (abgesagt/gelöscht zählen nicht)
    expect(stats.completedMinutes).toBe(55); // Ist-Zeit vor Plan-Dauer
  });

  it('materialisiert Serien idempotent und respektiert Ausnahmen', async () => {
    const series = await db.appointmentSeries.create({
      data: {
        organizationId: orgId,
        customerId,
        title: 'Serie',
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=4',
        recurrenceTimezone: 'Europe/Berlin',
        startDate: utcDate(2026, 7, 6), // Montag
        defaultStartTime: '09:00',
        defaultDurationMinutes: 60,
        status: 'ACTIVE',
      },
    });

    const created = await materializeSeries(series.id, utcDate(2026, 8, 31));
    expect(created).toBe(4);

    // Idempotent: zweiter Lauf erzeugt nichts Neues.
    expect(await materializeSeries(series.id, utcDate(2026, 8, 31))).toBe(0);

    // Ausnahme: zweites Vorkommen absagen und Termin löschen → wird NICHT neu erzeugt.
    const second = await db.appointment.findFirst({
      where: { seriesId: series.id, occurrenceDate: utcDate(2026, 7, 13) },
    });
    expect(second).not.toBeNull();
    await db.appointmentSeriesException.create({
      data: {
        seriesId: series.id,
        occurrenceDate: utcDate(2026, 7, 13),
        exceptionType: 'CANCELLED',
      },
    });
    await db.appointment.delete({ where: { id: second!.id } });
    expect(await materializeSeries(series.id, utcDate(2026, 8, 31))).toBe(0);
    expect(
      await db.appointment.count({ where: { seriesId: series.id } }),
    ).toBe(3);

    // Wandzeit-Korrektheit: 9:00 Berlin im Juli = 7:00 UTC.
    const first = await db.appointment.findFirst({
      where: { seriesId: series.id, occurrenceDate: utcDate(2026, 7, 6) },
    });
    expect(first!.startAt.toISOString()).toBe('2026-07-06T07:00:00.000Z');
  });

  it('schreibt Audit-Einträge über writeAuditLog', async () => {
    await writeAuditLog({
      organizationId: orgId,
      action: 'customer.updated',
      entityType: 'Customer',
      entityId: customerId,
      metadata: { changedFields: ['phone'] },
    });
    const entry = await db.auditLog.findFirst({
      where: { organizationId: orgId, action: 'customer.updated' },
    });
    expect(entry).not.toBeNull();
    expect(entry!.entityId).toBe(customerId);
  });
});
