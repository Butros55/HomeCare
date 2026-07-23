import 'server-only';

import type { Period } from '@/lib/dates';
import { computeHourAccount } from '@/lib/hour-account';
import {
  computeEmployeeHourStats,
  getCustomerAllocatedMinutes,
  type EmployeeHourStats,
} from '@/lib/hours';
import { db } from '@/server/db';
import {
  ensureRecurringTopupsMaterialized,
  todayUtcDate,
} from '@/server/services/account-service';

/**
 * Stunden-Service: lädt die Datensätze und delegiert die Berechnung an die
 * reinen Funktionen (src/lib/hour-account.ts für das Kunden-Stundenkonto,
 * src/lib/hours.ts für die Mitarbeiter-Sicht).
 *
 * Kunden-Sicht (Konto-Modell): global statt zeitraumbezogen –
 * Kontostand = Gutschriften − Geleistet, Verplanbar = Kontostand − Reserviert.
 * Mitarbeiter-Sicht: weiterhin zeitraumbezogen (Woche/Monat, Zielstunden).
 */

/** Kunden-Kennzahlen im Konto-Modell. */
export interface CustomerAccountStats {
  creditedMinutes: number;
  completedMinutes: number;
  reservedMinutes: number;
  balanceMinutes: number;
  plannableMinutes: number;
  /** Aktive Org-Zuweisungen an Mitarbeiter (Leitungs-Buchhaltung). */
  allocatedMinutes: number;
  /** Konto eingerichtet (mindestens eine Gutschrift oder Aufladungsregel). */
  hasAccount: boolean;
}

function allocationOverlapFilter(period: Period) {
  return {
    validFrom: { lt: period.end },
    validUntil: { gte: period.start },
  };
}

export async function getCustomerAccountStats(
  organizationId: string,
  timezone: string,
  customerId: string,
): Promise<CustomerAccountStats> {
  const map = await getCustomerAccountStatsBulk(organizationId, timezone, [customerId]);
  return (
    map.get(customerId) ?? {
      creditedMinutes: 0,
      completedMinutes: 0,
      reservedMinutes: 0,
      balanceMinutes: 0,
      plannableMinutes: 0,
      allocatedMinutes: 0,
      hasAccount: false,
    }
  );
}

/** Kennzahlen für mehrere Kunden in einem Rutsch (Kundenliste, keine N+1). */
export async function getCustomerAccountStatsBulk(
  organizationId: string,
  timezone: string,
  customerIds: string[],
): Promise<Map<string, CustomerAccountStats>> {
  const result = new Map<string, CustomerAccountStats>();
  if (customerIds.length === 0) return result;

  await ensureRecurringTopupsMaterialized(organizationId, timezone);
  const today = todayUtcDate(timezone);

  const [topups, grants, allocations, appointments] = await Promise.all([
    db.customerHourTopup.findMany({
      where: { customerId: { in: customerIds } },
      select: { customerId: true, minutes: true, effectiveOn: true },
    }),
    db.customerRecurringHourGrant.findMany({
      where: { customerId: { in: customerIds } },
      select: { customerId: true },
    }),
    db.hourAllocation.findMany({
      where: { customerId: { in: customerIds }, status: 'ACTIVE' },
    }),
    db.appointment.findMany({
      where: {
        customerId: { in: customerIds },
        deletedAt: null,
      },
      select: {
        customerId: true,
        durationMinutes: true,
        status: true,
        timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
      },
    }),
  ]);

  const grantCustomers = new Set(grants.map((g) => g.customerId));
  for (const customerId of customerIds) {
    const customerTopups = topups.filter((t) => t.customerId === customerId);
    const summary = computeHourAccount({
      topups: customerTopups,
      appointments: appointments
        .filter((a) => a.customerId === customerId)
        .map((a) => ({
          durationMinutes: a.durationMinutes,
          status: a.status,
          workedMinutes:
            a.timeEntries.length > 0
              ? a.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0)
              : null,
        })),
      until: today,
    });
    result.set(customerId, {
      ...summary,
      allocatedMinutes: getCustomerAllocatedMinutes(
        allocations
          .filter((a) => a.customerId === customerId)
          .map((a) => ({
            budgetId: a.budgetId ?? '',
            allocatedByEmployeeId: a.allocatedByEmployeeId,
            allocatedToEmployeeId: a.allocatedToEmployeeId,
            allocatedMinutes: a.allocatedMinutes,
            status: a.status as 'ACTIVE' | 'REVOKED',
          })),
      ),
      hasAccount: customerTopups.length > 0 || grantCustomers.has(customerId),
    });
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
