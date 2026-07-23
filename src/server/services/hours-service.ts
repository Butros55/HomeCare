import 'server-only';

import type { Period } from '@/lib/dates';
import {
  computeCustomerHourStats,
  computeEmployeeHourStats,
  type CustomerHourStats,
  type EmployeeHourStats,
} from '@/lib/hours';
import { db } from '@/server/db';

/**
 * Stunden-Service: lädt die Datensätze eines Zeitraums und delegiert die
 * Berechnung an die reinen Funktionen in src/lib/hours.ts.
 *
 * Zeitraum-Semantik:
 *  - Budgets/Zuweisungen zählen, wenn ihr Gültigkeitszeitraum den
 *    Abfragezeitraum überlappt (periodEnd/validUntil sind inklusive Daten).
 *  - Termine zählen nach startAt im halboffenen Zeitraum [start, end).
 */

function periodOverlapFilter(period: Period) {
  return {
    periodStart: { lt: period.end },
    periodEnd: { gte: period.start },
  };
}

function allocationOverlapFilter(period: Period) {
  return {
    validFrom: { lt: period.end },
    validUntil: { gte: period.start },
  };
}

async function loadCustomerHourData(customerId: string, period: Period) {
  const [budgets, allocations, appointments] = await Promise.all([
    db.customerHourBudget.findMany({
      where: { customerId, ...periodOverlapFilter(period) },
      include: { adjustments: true },
    }),
    db.hourAllocation.findMany({
      where: { customerId, ...allocationOverlapFilter(period) },
    }),
    db.appointment.findMany({
      where: { customerId, deletedAt: null, startAt: { gte: period.start, lt: period.end } },
      select: {
        assignedEmployeeId: true,
        durationMinutes: true,
        status: true,
        timeEntries: {
          where: { status: 'APPROVED' },
          select: { workedMinutes: true },
        },
      },
    }),
  ]);
  return {
    budgets,
    adjustments: budgets.flatMap((b) => b.adjustments),
    allocations,
    appointments: appointments.map((a) => ({
      assignedEmployeeId: a.assignedEmployeeId,
      durationMinutes: a.durationMinutes,
      status: a.status,
      workedMinutes:
        a.timeEntries.length > 0
          ? a.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0)
          : null,
    })),
  };
}

export async function getCustomerHourStats(
  customerId: string,
  period: Period,
): Promise<CustomerHourStats> {
  const data = await loadCustomerHourData(customerId, period);
  return computeCustomerHourStats(data);
}

/** Kennzahlen für mehrere Kunden in einem Rutsch (Kundenliste, keine N+1). */
export async function getCustomerHourStatsBulk(
  customerIds: string[],
  period: Period,
): Promise<Map<string, CustomerHourStats>> {
  if (customerIds.length === 0) return new Map();

  const [budgets, allocations, appointments] = await Promise.all([
    db.customerHourBudget.findMany({
      where: { customerId: { in: customerIds }, ...periodOverlapFilter(period) },
      include: { adjustments: true },
    }),
    db.hourAllocation.findMany({
      where: { customerId: { in: customerIds }, ...allocationOverlapFilter(period) },
    }),
    db.appointment.findMany({
      where: {
        customerId: { in: customerIds },
        deletedAt: null,
        startAt: { gte: period.start, lt: period.end },
      },
      select: {
        customerId: true,
        assignedEmployeeId: true,
        durationMinutes: true,
        status: true,
        timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
      },
    }),
  ]);

  const result = new Map<string, CustomerHourStats>();
  for (const customerId of customerIds) {
    const customerBudgets = budgets.filter((b) => b.customerId === customerId);
    result.set(
      customerId,
      computeCustomerHourStats({
        budgets: customerBudgets,
        adjustments: customerBudgets.flatMap((b) => b.adjustments),
        allocations: allocations.filter((a) => a.customerId === customerId),
        appointments: appointments
          .filter((a) => a.customerId === customerId)
          .map((a) => ({
            assignedEmployeeId: a.assignedEmployeeId,
            durationMinutes: a.durationMinutes,
            status: a.status,
            workedMinutes:
              a.timeEntries.length > 0
                ? a.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0)
                : null,
          })),
      }),
    );
  }
  return result;
}

export async function getEmployeeHourStats(
  employee: {
    id: string;
    targetMinutesPerWeek: number | null;
    targetMinutesPerMonth: number | null;
  },
  period: Period,
  periodKind: 'week' | 'month',
): Promise<EmployeeHourStats> {
  const [allocations, appointments] = await Promise.all([
    db.hourAllocation.findMany({
      where: {
        OR: [{ allocatedToEmployeeId: employee.id }, { allocatedByEmployeeId: employee.id }],
        ...allocationOverlapFilter(period),
      },
    }),
    db.appointment.findMany({
      where: {
        assignedEmployeeId: employee.id,
        deletedAt: null,
        startAt: { gte: period.start, lt: period.end },
      },
      select: {
        assignedEmployeeId: true,
        durationMinutes: true,
        status: true,
        timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
      },
    }),
  ]);

  const targetMinutes =
    periodKind === 'week' ? employee.targetMinutesPerWeek : employee.targetMinutesPerMonth;

  return computeEmployeeHourStats({
    employeeId: employee.id,
    targetMinutes: targetMinutes ?? null,
    allocations,
    appointments: appointments.map((a) => ({
      assignedEmployeeId: a.assignedEmployeeId,
      durationMinutes: a.durationMinutes,
      status: a.status,
      workedMinutes:
        a.timeEntries.length > 0
          ? a.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0)
          : null,
    })),
  });
}

/** Kennzahlen für mehrere Mitarbeiter (Mitarbeiterliste, Dashboard). */
export async function getEmployeeHourStatsBulk(
  employees: Array<{
    id: string;
    targetMinutesPerWeek: number | null;
    targetMinutesPerMonth: number | null;
  }>,
  period: Period,
  periodKind: 'week' | 'month',
): Promise<Map<string, EmployeeHourStats>> {
  if (employees.length === 0) return new Map();
  const ids = employees.map((e) => e.id);

  const [allocations, appointments] = await Promise.all([
    db.hourAllocation.findMany({
      where: {
        OR: [{ allocatedToEmployeeId: { in: ids } }, { allocatedByEmployeeId: { in: ids } }],
        ...allocationOverlapFilter(period),
      },
    }),
    db.appointment.findMany({
      where: {
        assignedEmployeeId: { in: ids },
        deletedAt: null,
        startAt: { gte: period.start, lt: period.end },
      },
      select: {
        assignedEmployeeId: true,
        durationMinutes: true,
        status: true,
        timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
      },
    }),
  ]);

  const mapped = appointments.map((a) => ({
    assignedEmployeeId: a.assignedEmployeeId,
    durationMinutes: a.durationMinutes,
    status: a.status,
    workedMinutes:
      a.timeEntries.length > 0
        ? a.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0)
        : null,
  }));

  const result = new Map<string, EmployeeHourStats>();
  for (const employee of employees) {
    const targetMinutes =
      periodKind === 'week' ? employee.targetMinutesPerWeek : employee.targetMinutesPerMonth;
    result.set(
      employee.id,
      computeEmployeeHourStats({
        employeeId: employee.id,
        targetMinutes: targetMinutes ?? null,
        allocations,
        appointments: mapped,
      }),
    );
  }
  return result;
}
