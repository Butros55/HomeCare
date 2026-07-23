import 'server-only';

import type { AppointmentStatus, Prisma } from '@prisma/client';

import { overlaps } from '@/lib/dates';
import { db } from '@/server/db';
import {
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
  type OrgContext,
} from '@/server/permissions';
import { ensureMaterializedUntil } from '@/server/services/appointment-service';

/**
 * Kalender-Feed: Termine eines Zeitraums, organisationsgebunden und nach
 * Rolle gescoped. Lädt ausschließlich den sichtbaren Bereich (Anforderung 13)
 * und stellt vorher die Serien-Materialisierung bis zum Bereichsende sicher.
 */

export interface CalendarEventDto {
  id: string;
  title: string;
  start: string;
  end: string;
  customerId: string;
  customerName: string;
  customerColor: string;
  employeeId: string | null;
  employeeName: string | null;
  status: string;
  assignmentStatus: string;
  seriesId: string | null;
  isFlexible: boolean;
  routeRelevant: boolean;
  hasConflict: boolean;
  city: string | null;
}

export interface CalendarFilters {
  employeeId?: string;
  customerId?: string;
  /** Team = Unterbaum dieses Team-Managers. */
  teamId?: string;
  status?: string[];
  assignment?: 'assigned' | 'unassigned' | 'declined';
  conflictsOnly?: boolean;
  onlyMine?: boolean;
  routeRelevantOnly?: boolean;
}

export async function listCalendarEvents(
  range: { start: Date; end: Date },
  filters: CalendarFilters,
): Promise<CalendarEventDto[]> {
  const ctx = await requireOrganizationMembership();
  await ensureMaterializedUntil(ctx.organization.id, range.end);

  const where = await buildScopeWhere(ctx, filters);
  where.startAt = { lt: range.end };
  where.endAt = { gt: range.start };
  where.deletedAt = null;

  const appointments = await db.appointment.findMany({
    where,
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, color: true } },
      assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      locationAddress: { select: { city: true } },
    },
    orderBy: { startAt: 'asc' },
    take: 2000,
  });

  // Konfliktmarkierung: Überschneidungen je Mitarbeiter + Abwesenheits-Overlaps.
  const conflictIds = new Set<string>();
  const byEmployee = new Map<string, typeof appointments>();
  for (const appointment of appointments) {
    if (!appointment.assignedEmployeeId) continue;
    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(appointment.status)) continue;
    const list = byEmployee.get(appointment.assignedEmployeeId) ?? [];
    list.push(appointment);
    byEmployee.set(appointment.assignedEmployeeId, list);
  }
  const absences = await db.employeeAbsence.findMany({
    where: {
      employeeId: { in: [...byEmployee.keys()] },
      status: 'APPROVED',
      startAt: { lt: range.end },
      endAt: { gt: range.start },
    },
    select: { employeeId: true, startAt: true, endAt: true },
  });
  for (const [employeeId, list] of byEmployee) {
    const sorted = [...list].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (sorted[j]!.startAt >= sorted[i]!.endAt) break;
        conflictIds.add(sorted[i]!.id);
        conflictIds.add(sorted[j]!.id);
      }
      if (
        absences.some(
          (absence) =>
            absence.employeeId === employeeId &&
            overlaps(sorted[i]!.startAt, sorted[i]!.endAt, absence.startAt, absence.endAt),
        )
      ) {
        conflictIds.add(sorted[i]!.id);
      }
    }
  }

  let events = appointments.map((appointment) => ({
    id: appointment.id,
    title: appointment.title,
    start: appointment.startAt.toISOString(),
    end: appointment.endAt.toISOString(),
    customerId: appointment.customer.id,
    customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
    customerColor: appointment.customer.color,
    employeeId: appointment.assignedEmployee?.id ?? null,
    employeeName: appointment.assignedEmployee
      ? `${appointment.assignedEmployee.firstName} ${appointment.assignedEmployee.lastName}`
      : null,
    status: appointment.status,
    assignmentStatus: appointment.assignmentStatus,
    seriesId: appointment.seriesId,
    isFlexible: appointment.isFlexible,
    routeRelevant: appointment.routeRelevant,
    hasConflict: conflictIds.has(appointment.id),
    city: appointment.locationAddress?.city ?? null,
  }));

  if (filters.conflictsOnly) events = events.filter((event) => event.hasConflict);
  return events;
}

async function buildScopeWhere(
  ctx: OrgContext,
  filters: CalendarFilters,
): Promise<Prisma.AppointmentWhereInput> {
  const where: Prisma.AppointmentWhereInput = { organizationId: ctx.organization.id };

  // Rollen-Scope.
  if (!hasPermission(ctx, 'appointments.viewAll')) {
    const scope = await getManagedEmployeeIds(ctx);
    const ids = scope === 'ALL' ? null : scope;
    if (ids) {
      if (ctx.membership.role === 'TEAM_MANAGER') {
        // Team-Manager sehen zusätzlich unbesetzte Termine (zum Planen).
        where.OR = [
          { assignedEmployeeId: { in: ids } },
          { assignedEmployeeId: null },
        ];
      } else {
        where.assignedEmployeeId = { in: ids };
      }
    }
  }

  if (filters.onlyMine && ctx.employee) {
    where.assignedEmployeeId = ctx.employee.id;
  }
  if (filters.employeeId) where.assignedEmployeeId = filters.employeeId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.teamId) {
    const nodes = await db.employee.findMany({
      where: { organizationId: ctx.organization.id, deletedAt: null },
      select: { id: true, managerEmployeeId: true },
    });
    const { collectSubtree } = await import('@/lib/hierarchy');
    where.assignedEmployeeId = { in: [filters.teamId, ...collectSubtree(nodes, filters.teamId)] };
  }
  if (filters.status && filters.status.length > 0) {
    const validStatuses = [
      'DRAFT',
      'PLANNED',
      'CONFIRMED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ] as const;
    const statuses = filters.status.filter((s): s is AppointmentStatus =>
      (validStatuses as readonly string[]).includes(s),
    );
    if (statuses.length > 0) where.status = { in: statuses };
  }
  if (filters.assignment === 'assigned') where.assignedEmployeeId = { not: null };
  if (filters.assignment === 'unassigned') where.assignedEmployeeId = null;
  if (filters.assignment === 'declined') where.assignmentStatus = 'DECLINED';
  if (filters.routeRelevantOnly) where.routeRelevant = true;

  return where;
}
