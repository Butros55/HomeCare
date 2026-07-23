import 'server-only';

import { addDays } from 'date-fns';

import { dayPeriodInZone, monthPeriodInZone, overlaps, weekPeriodInZone } from '@/lib/dates';
import { estimateTravelSeconds } from '@/lib/geo';
import { formatMinutesAsHours } from '@/lib/duration';
import { getManagerSelfObligationMinutes } from '@/lib/hours';
import { db } from '@/server/db';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  hasPermission,
  type OrgContext,
} from '@/server/permissions';
import { getCustomerHourStatsBulk } from '@/server/services/hours-service';
import { effectiveMonthTarget } from '@/server/services/allocation-service';

/**
 * Dashboard-Aggregationen (Anforderung 15) – gebündelte, indizierte Abfragen,
 * keine Neuberechnung im Client.
 */

export interface ActionItem {
  kind:
    | 'EMPLOYEE_NEEDS_HOURS'
    | 'CUSTOMER_OPEN_HOURS'
    | 'UNASSIGNED_APPOINTMENT'
    | 'ADDRESS_MISSING'
    | 'CONFLICT'
    | 'ASSIGNMENT_DECLINED'
    | 'BUDGET_ENDING';
  title: string;
  detail: string;
  href: string;
}

export interface TodayEntry {
  appointmentId: string;
  title: string;
  customerName: string;
  customerColor: string;
  employeeName: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
  travelSecondsFromPrevious: number | null;
  departureFromPreviousAt: Date | null;
  hasConflict: boolean;
}

export async function getDashboardData(ctx: OrgContext) {
  const orgId = ctx.organization.id;
  const timezone = ctx.organization.timezone;
  const now = new Date();
  const today = dayPeriodInZone(now, timezone);
  const week = weekPeriodInZone(now, timezone);
  const month = monthPeriodInZone(now, timezone);
  const next7End = addDays(today.start, 7);

  const scope = await getManagedEmployeeIds(ctx);
  const scopeFilter =
    scope === 'ALL' ? {} : { assignedEmployeeId: { in: scope.length > 0 ? scope : ['-'] } };
  const isPlanner = hasPermission(ctx, 'appointments.viewAll');

  // ---- Basiszählungen -----------------------------------------------------
  const [
    todayAppointments,
    upcomingAppointments,
    unassignedCount,
    declinedCount,
    unreadNotifications,
  ] = await Promise.all([
    db.appointment.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        startAt: { gte: today.start, lt: today.end },
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        ...(isPlanner ? {} : scopeFilter),
      },
      include: {
        customer: { select: { firstName: true, lastName: true, color: true } },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
        locationAddress: {
          select: { street: true, houseNumber: true, postalCode: true, city: true, latitude: true, longitude: true },
        },
      },
      orderBy: { startAt: 'asc' },
    }),
    db.appointment.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        startAt: { gte: now },
        status: { in: ['PLANNED', 'CONFIRMED'] },
        ...(isPlanner ? {} : scopeFilter),
      },
      include: {
        customer: { select: { firstName: true, lastName: true, color: true } },
        assignedEmployee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startAt: 'asc' },
      take: 5,
    }),
    isPlanner
      ? db.appointment.count({
          where: {
            organizationId: orgId,
            deletedAt: null,
            assignedEmployeeId: null,
            startAt: { gte: now },
            status: { in: ['PLANNED', 'CONFIRMED', 'DRAFT'] },
          },
        })
      : Promise.resolve(0),
    isPlanner
      ? db.appointment.count({
          where: {
            organizationId: orgId,
            deletedAt: null,
            assignmentStatus: 'DECLINED',
            startAt: { gte: now },
          },
        })
      : Promise.resolve(0),
    db.notification.count({
      where: { userId: ctx.user.id, organizationId: orgId, readAt: null },
    }),
  ]);

  // ---- Kundenstunden (offene) --------------------------------------------
  let openHoursCustomers: { id: string; name: string; openMinutes: number }[] = [];
  if (hasPermission(ctx, 'customers.read')) {
    const customers = await db.customer.findMany({
      where: { organizationId: orgId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true },
    });
    const stats = await getCustomerHourStatsBulk(
      customers.map((c) => c.id),
      month,
    );
    openHoursCustomers = customers
      .map((customer) => ({
        id: customer.id,
        name: `${customer.firstName} ${customer.lastName}`,
        openMinutes: stats.get(customer.id)?.unallocatedMinutes ?? 0,
      }))
      .filter((entry) => entry.openMinutes > 0)
      .sort((a, b) => b.openMinutes - a.openMinutes);
  }

  // ---- Mitarbeiter mit fehlenden Stunden + Konflikte ----------------------
  const employees = await db.employee.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      status: 'ACTIVE',
      ...employeeScopeFilter(scope),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      targetMinutesPerWeek: true,
      targetMinutesPerMonth: true,
      maximumMinutesPerDay: true,
      userId: true,
    },
  });

  const monthAllocations = await db.hourAllocation.findMany({
    where: {
      organizationId: orgId,
      status: 'ACTIVE',
      validFrom: { lt: month.end },
      validUntil: { gte: month.start },
    },
  });
  const receivedByEmployee = new Map<string, number>();
  for (const allocation of monthAllocations) {
    receivedByEmployee.set(
      allocation.allocatedToEmployeeId,
      (receivedByEmployee.get(allocation.allocatedToEmployeeId) ?? 0) + allocation.allocatedMinutes,
    );
  }
  const employeesNeedingHours = employees
    .map((employee) => {
      const target = effectiveMonthTarget(employee);
      const received = receivedByEmployee.get(employee.id) ?? 0;
      return {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        missingMinutes: target ? Math.max(0, target - received) : 0,
      };
    })
    .filter((entry) => entry.missingMinutes > 0)
    .sort((a, b) => b.missingMinutes - a.missingMinutes);

  // Eigene noch zu erledigende Stunden (Eigenverpflichtung des Nutzers).
  const ownObligationMinutes = ctx.employee
    ? getManagerSelfObligationMinutes(
        monthAllocations.map((a) => ({
          budgetId: a.budgetId,
          allocatedByEmployeeId: a.allocatedByEmployeeId,
          allocatedToEmployeeId: a.allocatedToEmployeeId,
          allocatedMinutes: a.allocatedMinutes,
          status: a.status as 'ACTIVE' | 'REVOKED',
        })),
        ctx.employee.id,
      )
    : 0;

  // ---- Konflikte diese Woche ---------------------------------------------
  const weekAppointments = await db.appointment.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      assignedEmployeeId: { not: null },
      status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
      startAt: { lt: week.end },
      endAt: { gt: week.start },
      ...(isPlanner ? {} : scopeFilter),
    },
    select: {
      id: true,
      assignedEmployeeId: true,
      startAt: true,
      endAt: true,
      title: true,
    },
    orderBy: { startAt: 'asc' },
  });
  const weekAbsences = await db.employeeAbsence.findMany({
    where: {
      employee: { organizationId: orgId },
      status: 'APPROVED',
      startAt: { lt: week.end },
      endAt: { gt: week.start },
    },
    select: { employeeId: true, startAt: true, endAt: true },
  });
  const conflictAppointmentIds = new Set<string>();
  const byEmployee = new Map<string, typeof weekAppointments>();
  for (const appointment of weekAppointments) {
    const list = byEmployee.get(appointment.assignedEmployeeId!) ?? [];
    list.push(appointment);
    byEmployee.set(appointment.assignedEmployeeId!, list);
  }
  for (const [employeeId, list] of byEmployee) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[j]!.startAt >= list[i]!.endAt) break;
        conflictAppointmentIds.add(list[i]!.id);
        conflictAppointmentIds.add(list[j]!.id);
      }
      if (
        weekAbsences.some(
          (absence) =>
            absence.employeeId === employeeId &&
            overlaps(list[i]!.startAt, list[i]!.endAt, absence.startAt, absence.endAt),
        )
      ) {
        conflictAppointmentIds.add(list[i]!.id);
      }
    }
  }

  // ---- Kunden ohne nächste Planung ---------------------------------------
  let customersWithoutNextAppointment = 0;
  if (isPlanner) {
    customersWithoutNextAppointment = await db.customer.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: 'ACTIVE',
        appointments: {
          none: {
            deletedAt: null,
            startAt: { gte: now },
            status: { in: ['PLANNED', 'CONFIRMED'] },
          },
        },
      },
    });
  }

  // ---- Heutige Zeitleiste inkl. Fahrzeiten -------------------------------
  const timeline: TodayEntry[] = [];
  {
    // Fahrzeiten je Mitarbeiter zwischen aufeinanderfolgenden Terminen schätzen.
    const byEmp = new Map<string, typeof todayAppointments>();
    for (const appointment of todayAppointments) {
      const key = appointment.assignedEmployee?.id ?? 'unassigned';
      const list = byEmp.get(key) ?? [];
      list.push(appointment);
      byEmp.set(key, list);
    }
    const travelByAppointment = new Map<string, { seconds: number; departure: Date }>();
    for (const [key, list] of byEmp) {
      if (key === 'unassigned') continue;
      for (let i = 1; i < list.length; i += 1) {
        const prev = list[i - 1]!;
        const current = list[i]!;
        if (
          prev.locationAddress?.latitude != null &&
          prev.locationAddress.longitude != null &&
          current.locationAddress?.latitude != null &&
          current.locationAddress.longitude != null &&
          current.routeRelevant
        ) {
          const seconds = estimateTravelSeconds(
            { latitude: prev.locationAddress.latitude, longitude: prev.locationAddress.longitude },
            {
              latitude: current.locationAddress.latitude,
              longitude: current.locationAddress.longitude,
            },
          );
          travelByAppointment.set(current.id, {
            seconds,
            departure: new Date(current.startAt.getTime() - seconds * 1000),
          });
        }
      }
    }
    for (const appointment of todayAppointments) {
      const travel = travelByAppointment.get(appointment.id) ?? null;
      timeline.push({
        appointmentId: appointment.id,
        title: appointment.title,
        customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
        customerColor: appointment.customer.color,
        employeeName: appointment.assignedEmployee
          ? `${appointment.assignedEmployee.firstName} ${appointment.assignedEmployee.lastName}`
          : null,
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        status: appointment.status,
        addressLine: appointment.locationAddress
          ? `${appointment.locationAddress.street} ${appointment.locationAddress.houseNumber}, ${appointment.locationAddress.postalCode} ${appointment.locationAddress.city}`
          : null,
        latitude: appointment.locationAddress?.latitude ?? null,
        longitude: appointment.locationAddress?.longitude ?? null,
        travelSecondsFromPrevious: travel?.seconds ?? null,
        departureFromPreviousAt: travel?.departure ?? null,
        hasConflict: conflictAppointmentIds.has(appointment.id),
      });
    }
  }
  const todayTravelSeconds = timeline.reduce(
    (sum, entry) => sum + (entry.travelSecondsFromPrevious ?? 0),
    0,
  );

  // ---- Nächste 7 Tage -----------------------------------------------------
  const next7 = await db.appointment.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      startAt: { gte: today.start, lt: next7End },
      status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
      ...(isPlanner ? {} : scopeFilter),
    },
    select: { durationMinutes: true, assignedEmployeeId: true },
  });
  const next7Minutes = next7.reduce((sum, a) => sum + a.durationMinutes, 0);
  // Kapazität: Wochenziel aller Mitarbeiter im Scope.
  const capacityMinutes = employees.reduce(
    (sum, e) => sum + (e.targetMinutesPerWeek ?? 0),
    0,
  );
  const next7TravelSeconds = Math.round(todayTravelSeconds * 5.5); // grobe Prognose auf Basis heute

  // ---- Handlungsbedarf ----------------------------------------------------
  const actionItems: ActionItem[] = [];
  for (const employee of employeesNeedingHours.slice(0, 4)) {
    actionItems.push({
      kind: 'EMPLOYEE_NEEDS_HOURS',
      title: `${employee.name} benötigt Stunden`,
      detail: `${formatMinutesAsHours(employee.missingMinutes)} fehlen zum Monatsziel`,
      href: `/employees/${employee.id}?tab=stunden`,
    });
  }
  for (const customer of openHoursCustomers.slice(0, 4)) {
    actionItems.push({
      kind: 'CUSTOMER_OPEN_HOURS',
      title: `${customer.name} hat offene Stunden`,
      detail: `${formatMinutesAsHours(customer.openMinutes)} noch nicht zugewiesen`,
      href: `/customers/${customer.id}?tab=stunden`,
    });
  }
  if (unassignedCount > 0) {
    actionItems.push({
      kind: 'UNASSIGNED_APPOINTMENT',
      title: `${unassignedCount} Termin${unassignedCount === 1 ? '' : 'e'} ohne Mitarbeiter`,
      detail: 'Zuweisung im Kalender vornehmen',
      href: '/calendar?zuweisung=offen',
    });
  }
  if (isPlanner) {
    const missingAddresses = await db.appointment.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        routeRelevant: true,
        startAt: { gte: now, lt: next7End },
        locationAddress: { OR: [{ latitude: null }, { longitude: null }] },
      },
    });
    if (missingAddresses > 0) {
      actionItems.push({
        kind: 'ADDRESS_MISSING',
        title: `${missingAddresses} Termin${missingAddresses === 1 ? '' : 'e'} ohne geokodierte Adresse`,
        detail: 'Adressen prüfen, sonst fehlen sie in Routen',
        href: '/customers',
      });
    }
  }
  if (conflictAppointmentIds.size > 0) {
    actionItems.push({
      kind: 'CONFLICT',
      title: `${conflictAppointmentIds.size} Terminkonflikt${conflictAppointmentIds.size === 1 ? '' : 'e'} diese Woche`,
      detail: 'Überschneidungen oder Abwesenheiten prüfen',
      href: '/calendar?konflikte=1',
    });
  }
  if (declinedCount > 0) {
    actionItems.push({
      kind: 'ASSIGNMENT_DECLINED',
      title: `${declinedCount} abgelehnte Zuweisung${declinedCount === 1 ? '' : 'en'}`,
      detail: 'Termine neu besetzen',
      href: '/calendar?zuweisung=abgelehnt',
    });
  }
  if (isPlanner) {
    const endingBudgets = await db.customerHourBudget.findMany({
      where: {
        organizationId: orgId,
        periodEnd: { gte: now, lt: addDays(now, 7) },
        customer: { deletedAt: null, status: 'ACTIVE' },
      },
      include: { customer: { select: { id: true, firstName: true, lastName: true } } },
      take: 3,
    });
    for (const budget of endingBudgets) {
      actionItems.push({
        kind: 'BUDGET_ENDING',
        title: `Budget von ${budget.customer.firstName} ${budget.customer.lastName} endet bald`,
        detail: `Zeitraum endet am ${new Intl.DateTimeFormat('de-DE', { timeZone: timezone }).format(budget.periodEnd)}`,
        href: `/customers/${budget.customer.id}?tab=stunden`,
      });
    }
  }

  return {
    counts: {
      todayCount: todayAppointments.length,
      unassignedCount,
      openHoursCustomerCount: openHoursCustomers.length,
      openHoursTotalMinutes: openHoursCustomers.reduce((sum, c) => sum + c.openMinutes, 0),
      employeesNeedingHoursCount: employeesNeedingHours.length,
      conflictCount: conflictAppointmentIds.size,
      customersWithoutNextAppointment,
      todayTravelSeconds,
      unreadNotifications,
      ownObligationMinutes,
    },
    timeline,
    upcomingAppointments: upcomingAppointments.map((appointment) => ({
      id: appointment.id,
      title: appointment.title,
      customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      customerColor: appointment.customer.color,
      employeeName: appointment.assignedEmployee
        ? `${appointment.assignedEmployee.firstName} ${appointment.assignedEmployee.lastName}`
        : null,
      startAt: appointment.startAt,
      status: appointment.status,
    })),
    actionItems,
    next7: {
      appointmentCount: next7.length,
      plannedMinutes: next7Minutes,
      capacityMinutes,
      utilizationPercent:
        capacityMinutes > 0 ? Math.round((next7Minutes / capacityMinutes) * 100) : null,
      freeMinutes: Math.max(0, capacityMinutes - next7Minutes),
      expectedTravelSeconds: next7TravelSeconds,
    },
    isPlanner,
  };
}
