'use server';

import { formatDate, formatDateTime, monthPeriodInZone, weekPeriodInZone } from '@/lib/dates';
import { getCustomerBudgetMinutes } from '@/lib/hours';
import { BUDGET_SOURCE_LABELS } from '@/lib/status-maps';
import { employeeDisplayName } from '@/lib/utils';
import { db } from '@/server/db';
import { runAction, type ActionResult } from '@/server/errors';
import { AppError } from '@/server/errors';
import {
  canAccessCustomer,
  canAccessEmployee,
  requireOrganizationMembership,
} from '@/server/permissions';

/**
 * Detail-Aufschlüsselung der Stunden-Kennzahlen (klickbare Kacheln).
 * Liefert vor-formatierte, organisationsgeprüfte Listen für die Dialoge –
 * dieselbe Zeitraum-Semantik wie src/server/services/hours-service.ts.
 */

export interface CustomerHourDetail {
  monthLabel: string;
  /** Gebucht: Budgets inkl. Korrekturen. */
  budgets: Array<{
    id: string;
    periodLabel: string;
    sourceLabel: string;
    note: string | null;
    budgetMinutes: number;
    adjustedMinutes: number;
    adjustments: Array<{ id: string; reason: string; minutes: number; byName: string }>;
  }>;
  /** Zugewiesen: aktive Zuweisungen an Mitarbeiter. */
  allocations: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    minutes: number;
    fromPool: string | null;
    validLabel: string;
  }>;
  /** Verplant/Geleistet: Termine des Monats. */
  appointments: Array<{
    id: string;
    title: string;
    dateLabel: string;
    durationMinutes: number;
    workedMinutes: number | null;
    status: string;
    employeeId: string | null;
    employeeName: string | null;
  }>;
}

export async function getCustomerHourDetailAction(
  customerId: string,
  monthIso: string,
): Promise<ActionResult<CustomerHourDetail>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    if (!(await canAccessCustomer(ctx, customerId, 'read'))) {
      throw new AppError('CUSTOMER_NOT_FOUND', { status: 404 });
    }
    const timezone = ctx.organization.timezone;
    const match = /^(\d{4})-(\d{2})$/.exec(monthIso.trim());
    if (!match) throw new AppError('VALIDATION_FAILED', { message: 'Ungültiger Monat.' });
    const anchor = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15));
    const period = monthPeriodInZone(anchor, timezone);

    const [budgets, allocations, appointments] = await Promise.all([
      db.customerHourBudget.findMany({
        where: { customerId, periodStart: { lt: period.end }, periodEnd: { gte: period.start } },
        include: {
          adjustments: { include: { createdBy: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { periodStart: 'desc' },
      }),
      db.hourAllocation.findMany({
        where: {
          customerId,
          status: 'ACTIVE',
          validFrom: { lt: period.end },
          validUntil: { gte: period.start },
        },
        include: {
          allocatedTo: { select: { id: true, firstName: true, lastName: true, userId: true } },
          allocatedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { allocatedMinutes: 'desc' },
      }),
      db.appointment.findMany({
        where: {
          customerId,
          deletedAt: null,
          startAt: { gte: period.start, lt: period.end },
        },
        include: {
          assignedEmployee: { select: { id: true, firstName: true, lastName: true, userId: true } },
          timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
        },
        orderBy: { startAt: 'asc' },
      }),
    ]);

    const monthLabel = new Intl.DateTimeFormat('de-DE', {
      timeZone: timezone,
      month: 'long',
      year: 'numeric',
    }).format(period.start);

    return {
      monthLabel,
      budgets: budgets.map((budget) => ({
        id: budget.id,
        periodLabel: `${formatDate(budget.periodStart, timezone)} – ${formatDate(budget.periodEnd, timezone)}`,
        sourceLabel: BUDGET_SOURCE_LABELS[budget.sourceType] ?? budget.sourceType,
        note: budget.note,
        budgetMinutes: budget.budgetMinutes,
        adjustedMinutes: getCustomerBudgetMinutes([budget], budget.adjustments),
        adjustments: budget.adjustments.map((adjustment) => ({
          id: adjustment.id,
          reason: adjustment.reason,
          minutes: adjustment.adjustmentMinutes,
          byName: `${adjustment.createdBy.firstName} ${adjustment.createdBy.lastName}`,
        })),
      })),
      allocations: allocations.map((allocation) => ({
        id: allocation.id,
        employeeId: allocation.allocatedTo.id,
        employeeName: employeeDisplayName(allocation.allocatedTo, ctx.user.id),
        minutes: allocation.allocatedMinutes,
        fromPool: allocation.allocatedBy
          ? `${allocation.allocatedBy.firstName} ${allocation.allocatedBy.lastName}`
          : null,
        validLabel: `${formatDate(allocation.validFrom, timezone)} – ${formatDate(allocation.validUntil, timezone)}`,
      })),
      appointments: appointments.map((appointment) => ({
        id: appointment.id,
        title: appointment.title,
        dateLabel: formatDateTime(appointment.startAt, timezone),
        durationMinutes: appointment.durationMinutes,
        workedMinutes:
          appointment.timeEntries.length > 0
            ? appointment.timeEntries.reduce((sum, entry) => sum + entry.workedMinutes, 0)
            : null,
        status: appointment.status,
        employeeId: appointment.assignedEmployee?.id ?? null,
        employeeName: appointment.assignedEmployee
          ? employeeDisplayName(appointment.assignedEmployee, ctx.user.id)
          : null,
      })),
    };
  });
}

export interface EmployeeHourDetail {
  periodLabel: string;
  /** Erhaltene Zuweisungen (aus Kundenbudgets bzw. weitergegeben). */
  received: Array<{
    id: string;
    customerId: string;
    customerName: string;
    minutes: number;
    fromPool: string | null;
    validLabel: string;
  }>;
  /** Selbst weitergegebene Stunden. */
  forwarded: Array<{
    id: string;
    customerName: string;
    toName: string;
    minutes: number;
  }>;
  /** Termine des Zeitraums (geplant + geleistet). */
  appointments: Array<{
    id: string;
    customerId: string;
    customerName: string;
    title: string;
    dateLabel: string;
    durationMinutes: number;
    workedMinutes: number | null;
    status: string;
  }>;
}

export async function getEmployeeHourDetailAction(
  employeeId: string,
  periodKind: 'week' | 'month',
): Promise<ActionResult<EmployeeHourDetail>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    if (!(await canAccessEmployee(ctx, employeeId, 'read'))) {
      throw new AppError('NOT_FOUND');
    }
    const timezone = ctx.organization.timezone;
    const now = new Date();
    const period =
      periodKind === 'week' ? weekPeriodInZone(now, timezone) : monthPeriodInZone(now, timezone);

    const [received, forwarded, appointments] = await Promise.all([
      db.hourAllocation.findMany({
        where: {
          allocatedToEmployeeId: employeeId,
          status: 'ACTIVE',
          validFrom: { lt: period.end },
          validUntil: { gte: period.start },
        },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true } },
          allocatedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { allocatedMinutes: 'desc' },
      }),
      db.hourAllocation.findMany({
        where: {
          allocatedByEmployeeId: employeeId,
          status: 'ACTIVE',
          validFrom: { lt: period.end },
          validUntil: { gte: period.start },
        },
        include: {
          customer: { select: { firstName: true, lastName: true } },
          allocatedTo: { select: { firstName: true, lastName: true, userId: true } },
        },
      }),
      db.appointment.findMany({
        where: {
          assignedEmployeeId: employeeId,
          deletedAt: null,
          startAt: { gte: period.start, lt: period.end },
        },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true } },
          timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
        },
        orderBy: { startAt: 'asc' },
      }),
    ]);

    const fmt = new Intl.DateTimeFormat('de-DE', { timeZone: timezone, day: '2-digit', month: '2-digit' });
    const periodLabel =
      periodKind === 'week'
        ? `Woche ${fmt.format(period.start)} – ${fmt.format(new Date(period.end.getTime() - 1))}`
        : new Intl.DateTimeFormat('de-DE', { timeZone: timezone, month: 'long', year: 'numeric' }).format(period.start);

    return {
      periodLabel,
      received: received.map((allocation) => ({
        id: allocation.id,
        customerId: allocation.customer.id,
        customerName: `${allocation.customer.firstName} ${allocation.customer.lastName}`,
        minutes: allocation.allocatedMinutes,
        fromPool: allocation.allocatedBy
          ? `${allocation.allocatedBy.firstName} ${allocation.allocatedBy.lastName}`
          : null,
        validLabel: `${formatDate(allocation.validFrom, timezone)} – ${formatDate(allocation.validUntil, timezone)}`,
      })),
      forwarded: forwarded.map((allocation) => ({
        id: allocation.id,
        customerName: `${allocation.customer.firstName} ${allocation.customer.lastName}`,
        toName: employeeDisplayName(allocation.allocatedTo, ctx.user.id),
        minutes: allocation.allocatedMinutes,
      })),
      appointments: appointments.map((appointment) => ({
        id: appointment.id,
        customerId: appointment.customer.id,
        customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
        title: appointment.title,
        dateLabel: formatDateTime(appointment.startAt, timezone),
        durationMinutes: appointment.durationMinutes,
        workedMinutes:
          appointment.timeEntries.length > 0
            ? appointment.timeEntries.reduce((sum, entry) => sum + entry.workedMinutes, 0)
            : null,
        status: appointment.status,
      })),
    };
  });
}
