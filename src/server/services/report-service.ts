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
import { getCustomerHourStatsBulk, getEmployeeHourStatsBulk } from '@/server/services/hours-service';

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

  const [employeeStats, appointments, routePlans] = await Promise.all([
    getEmployeeHourStatsBulk(employees, period, 'month'),
    db.appointment.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        startAt: { gte: period.start, lt: period.end },
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(employeeIds.length > 0 && (filters.employeeId || filters.teamId || scope !== 'ALL')
          ? { assignedEmployeeId: { in: employeeIds } }
          : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
      },
      select: {
        assignedEmployeeId: true,
        customerId: true,
        status: true,
        durationMinutes: true,
      },
    }),
    db.routePlan.findMany({
      where: {
        organizationId: orgId,
        routeDate: { gte: period.start, lt: period.end },
        ...(employeeIds.length > 0 ? { employeeId: { in: employeeIds } } : {}),
      },
      select: { totalTravelSeconds: true, totalDistanceMeters: true },
    }),
  ]);

  // Kundenstunden (Budget/zugewiesen/offen) für den Zeitraum.
  const customerWhere = filters.customerId ? [filters.customerId] : undefined;
  const customers = await db.customer.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      ...(customerWhere ? { id: { in: customerWhere } } : {}),
    },
    select: { id: true, firstName: true, lastName: true },
  });
  const customerStats = await getCustomerHourStatsBulk(
    customers.map((c) => c.id),
    period,
  );

  const totals = {
    budgetMinutes: 0,
    allocatedMinutes: 0,
    plannedMinutes: 0,
    completedMinutes: 0,
    openMinutes: 0,
  };
  for (const stats of customerStats.values()) {
    totals.budgetMinutes += stats.budgetMinutes;
    totals.allocatedMinutes += stats.allocatedMinutes;
    totals.plannedMinutes += stats.plannedMinutes;
    totals.completedMinutes += stats.completedMinutes;
    totals.openMinutes += Math.max(0, stats.unallocatedMinutes);
  }

  const cancelled = appointments.filter((a) => a.status === 'CANCELLED' || a.status === 'NO_SHOW');
  const unassigned = appointments.filter((a) => a.assignedEmployeeId === null);
  const travelSeconds = routePlans.reduce((sum, p) => sum + p.totalTravelSeconds, 0);
  const distanceMeters = routePlans.reduce((sum, p) => sum + p.totalDistanceMeters, 0);

  // Auslastung: geplante Minuten vs. Zielminuten (Monatsäquivalent über Zeitraum).
  const days = Math.max(1, Math.round((period.end.getTime() - period.start.getTime()) / 86_400_000));
  const targetTotal = employees.reduce((sum, employee) => {
    const monthly =
      employee.targetMinutesPerMonth ??
      (employee.targetMinutesPerWeek ? Math.round(employee.targetMinutesPerWeek * 4.33) : 0);
    return sum + Math.round((monthly / 30.44) * days);
  }, 0);
  const plannedByEmployees = [...employeeStats.values()].reduce(
    (sum, stats) => sum + stats.plannedMinutes,
    0,
  );

  return {
    period: { from: filters.from, to: filters.to },
    totals: {
      ...totals,
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
          budgetMinutes: stats.budgetMinutes,
          allocatedMinutes: stats.allocatedMinutes,
          plannedMinutes: stats.plannedMinutes,
          completedMinutes: stats.completedMinutes,
          openMinutes: Math.max(0, stats.unallocatedMinutes),
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
