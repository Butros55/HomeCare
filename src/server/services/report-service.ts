import 'server-only';

import { fromDateInputValue, type Period } from '@/lib/dates';
import { collectSubtree } from '@/lib/hierarchy';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  requirePermission,
  scopeContains,
} from '@/server/permissions';
import {
  getCustomerAccountStatsBulk,
  getEmployeeHourStatsBulk,
  type CustomerAccountStats,
} from '@/server/services/hours-service';

/**
 * Auswertungen (Anforderung 20): belastbare Kennzahlen über gebündelte
 * Abfragen. Keine Lohnabrechnung – die Datenbasis (TimeEntry) lässt eine
 * spätere Abrechnung zu (docs/architecture.md).
 */

export interface ReportFilters {
  from: string;
  to: string;
  employeeId?: string;
  teamId?: string;
  customerId?: string;
  status?: string;
}

export async function getReportData(filters: ReportFilters) {
  const ctx = await requirePermission('reports.view');
  const orgId = ctx.organization.id;

  const fromDate = fromDateInputValue(filters.from);
  const toDate = fromDateInputValue(filters.to);
  if (!fromDate || !toDate || toDate < fromDate) {
    throw new AppError('VALIDATION_FAILED', { message: 'Bitte einen gültigen Zeitraum wählen.' });
  }
  const period: Period = {
    start: fromDate,
    end: new Date(toDate.getTime() + 24 * 60 * 60 * 1000),
  };

  const scope = await getManagedEmployeeIds(ctx);

  // Mitarbeiterauswahl (Scope + Filter).
  let employeeWhere = employeeScopeFilter(scope);
  if (filters.teamId) {
    if (!scopeContains(scope, filters.teamId)) throw new AppError('ACCESS_DENIED');
    const nodes = await db.employee.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, managerEmployeeId: true },
    });
    employeeWhere = { id: { in: [filters.teamId, ...collectSubtree(nodes, filters.teamId)] } };
  }
  if (filters.employeeId) {
    if (!scopeContains(scope, filters.employeeId)) throw new AppError('ACCESS_DENIED');
    employeeWhere = { id: { in: [filters.employeeId] } };
  }

  const employees = await db.employee.findMany({
    where: { organizationId: orgId, deletedAt: null, ...employeeWhere },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      targetMinutesPerWeek: true,
      targetMinutesPerMonth: true,
    },
    orderBy: [{ lastName: 'asc' }],
  });
  const employeeIds = employees.map((e) => e.id);

  // Termine/Zeiterfassung werden nach Mitarbeiter/Team/Kunde/Status gefiltert –
  // so ändern sich die Kennzahlen mit jedem Filter, nicht nur mit dem Zeitraum.
  const scopeEmployees =
    employeeIds.length > 0 && (filters.employeeId || filters.teamId || scope !== 'ALL');
  const appointmentFilter = {
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.status ? { status: filters.status as never } : {}),
  };
  const [employeeStats, appointments, timeEntries] = await Promise.all([
    getEmployeeHourStatsBulk(employees, period, 'month'),
    db.appointment.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        startAt: { gte: period.start, lt: period.end },
        ...(scopeEmployees ? { assignedEmployeeId: { in: employeeIds } } : {}),
        ...appointmentFilter,
      },
      select: {
        assignedEmployeeId: true,
        customerId: true,
        status: true,
        durationMinutes: true,
      },
    }),
    // Tatsächliche Fahrzeit aus der Zeiterfassung (belastbarer als geplante
    // Routen, die es nur für einzelne Tage gibt) – gleiche Filter wie Termine.
    db.timeEntry.findMany({
      where: {
        organizationId: orgId,
        startedAt: { gte: period.start, lt: period.end },
        ...(scopeEmployees ? { employeeId: { in: employeeIds } } : {}),
        ...(filters.customerId || filters.status
          ? { appointment: { is: { deletedAt: null, ...appointmentFilter } } }
          : {}),
      },
      select: { travelMinutes: true, workedMinutes: true },
    }),
  ]);

  // Kundenstunden (Budget/zugewiesen/offen) für den Zeitraum – nur bei aktiven
  // Stundenbudgets; sonst weder Konto-Abfrage noch -Materialisierung.
  const hourBudgetsEnabled = ctx.organization.hourBudgetsEnabled;
  const customerWhere = filters.customerId ? [filters.customerId] : undefined;
  const customers = hourBudgetsEnabled
    ? await db.customer.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          ...(customerWhere ? { id: { in: customerWhere } } : {}),
        },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const customerStats = hourBudgetsEnabled
    ? await getCustomerAccountStatsBulk(
        orgId,
        ctx.organization.timezone,
        customers.map((c) => c.id),
      )
    : new Map<string, CustomerAccountStats>();

  // Kundenkonto-Kennzahlen (kundenbezogen – folgen dem Kundenfilter).
  let budgetMinutes = 0;
  let openMinutes = 0;
  for (const stats of customerStats.values()) {
    budgetMinutes += stats.creditedMinutes;
    openMinutes += Math.max(0, stats.balanceMinutes - stats.allocatedMinutes);
  }

  // Mitarbeiterbezogene Kennzahlen (folgen dem Mitarbeiter-/Team-Filter und
  // stimmen mit der Mitarbeitertabelle überein) – zuvor org-weit aus dem
  // Kundenkonto, daher unabhängig vom Mitarbeiterfilter.
  const employeeStatList = [...employeeStats.values()];
  const allocatedMinutes = employeeStatList.reduce((sum, s) => sum + s.allocatedMinutes, 0);
  const plannedByEmployees = employeeStatList.reduce((sum, s) => sum + s.plannedMinutes, 0);
  const completedByEmployees = employeeStatList.reduce((sum, s) => sum + s.completedMinutes, 0);

  const cancelled = appointments.filter((a) => a.status === 'CANCELLED' || a.status === 'NO_SHOW');
  const unassigned = appointments.filter((a) => a.assignedEmployeeId === null);
  // Fahrzeit = tatsächlich erfasste Fahrminuten. Entfernung daraus geschätzt
  // (~25 km/h Stadtschnitt) – belastbarer als die nur tageweise geplanten Routen.
  const travelMinutes = timeEntries.reduce((sum, e) => sum + (e.travelMinutes ?? 0), 0);
  const travelSeconds = travelMinutes * 60;
  const distanceMeters = Math.round((travelMinutes / 60) * 25_000);

  // Auslastung: geplante Minuten vs. Zielminuten (Monatsäquivalent über Zeitraum).
  const days = Math.max(1, Math.round((period.end.getTime() - period.start.getTime()) / 86_400_000));
  const targetTotal = employees.reduce((sum, employee) => {
    const monthly =
      employee.targetMinutesPerMonth ??
      (employee.targetMinutesPerWeek ? Math.round(employee.targetMinutesPerWeek * 4.33) : 0);
    return sum + Math.round((monthly / 30.44) * days);
  }, 0);

  return {
    period: { from: filters.from, to: filters.to },
    hourBudgetsEnabled,
    totals: {
      budgetMinutes,
      allocatedMinutes,
      plannedMinutes: plannedByEmployees,
      completedMinutes: completedByEmployees,
      openMinutes,
      travelSeconds,
      distanceMeters,
      utilizationPercent: targetTotal > 0 ? Math.round((plannedByEmployees / targetTotal) * 100) : null,
      cancelledCount: cancelled.length,
      unassignedCount: unassigned.length,
      appointmentCount: appointments.length,
    },
    employeeRows: employees.map((employee) => {
      const stats = employeeStats.get(employee.id)!;
      return {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        allocatedMinutes: stats.allocatedMinutes,
        plannedMinutes: stats.plannedMinutes,
        completedMinutes: stats.completedMinutes,
        selfObligationMinutes: stats.selfObligationMinutes,
      };
    }),
    customerRows: customers
      .map((customer) => {
        const stats = customerStats.get(customer.id)!;
        return {
          id: customer.id,
          name: `${customer.firstName} ${customer.lastName}`,
          budgetMinutes: stats.creditedMinutes,
          allocatedMinutes: stats.allocatedMinutes,
          plannedMinutes: stats.reservedMinutes,
          completedMinutes: stats.completedMinutes,
          openMinutes: Math.max(0, stats.balanceMinutes - stats.allocatedMinutes),
        };
      })
      .filter((row) => row.budgetMinutes > 0 || row.plannedMinutes > 0)
      .sort((a, b) => b.budgetMinutes - a.budgetMinutes),
    statusCounts: countBy(appointments.map((a) => a.status)),
  };
}

function countBy(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

export type ReportData = Awaited<ReturnType<typeof getReportData>>;
