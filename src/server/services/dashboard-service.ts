import 'server-only';

import { addDays } from 'date-fns';

import { isOutsideAvailabilityWindows } from '@/lib/conflicts';
import {
  calendarDayInZone,
  dayPeriodInZone,
  monthPeriodInZone,
  overlaps,
  toDateInputValue,
  utcDate,
  weekPeriodInZone,
} from '@/lib/dates';
import { computeRouteEarnings } from '@/lib/earnings';
import { estimateTravelSeconds } from '@/lib/geo';
import { formatMinutesAsHours } from '@/lib/duration';
import { getManagerSelfObligationMinutes } from '@/lib/hours';
import { isAppointmentCompletableStatus } from '@/lib/status-maps';
import { db } from '@/server/db';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  hasPermission,
  type OrgContext,
} from '@/server/permissions';
import { getCustomerAccountStatsBulk } from '@/server/services/hours-service';
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
    | 'ROUTE_UNPLANNED'
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
  employeeId: string | null;
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

// ---------------------------------------------------------------------------
// „Mein Tag“ – reduziertes Alltags-Dashboard (Solo-Leitung & Mitarbeiter)
// ---------------------------------------------------------------------------

export interface MyDayEntry {
  appointmentId: string;
  title: string;
  customerId: string;
  customerName: string;
  customerColor: string;
  startAt: Date;
  endAt: Date;
  status: string;
  /** Termin läuft laut Status oder befindet sich gerade im geplanten Zeitfenster. */
  isCurrent: boolean;
  /** Terminale/abgesagte Termine bieten keinen Schnellabschluss mehr an. */
  canComplete: boolean;
  unassigned: boolean;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Fahrzeit vom vorherigen Stopp (bzw. vom Startpunkt zum ersten Termin). */
  travelSeconds: number | null;
  /** Späteste Abfahrt, um pünktlich zu sein. */
  departureAt: Date | null;
  /** Hinweis (Überschneidung, Abwesenheit, außerhalb der Verfügbarkeit) – bitte prüfen. */
  hasConflict: boolean;
}

/**
 * Daten für das reduzierte „Mein Tag“-UI: ausschließlich die eigenen Termine
 * (Solo-Modus: zusätzlich noch nicht zugewiesene – sie gehören faktisch der
 * Leitung), Tagesroute mit Abfahrtszeiten ab dem Startpunkt, Wochenüberblick
 * und offene Stunden.
 */
export async function getMyDayData(ctx: OrgContext, options: { includeUnassigned: boolean }) {
  const orgId = ctx.organization.id;
  const timezone = ctx.organization.timezone;
  const now = new Date();
  const today = dayPeriodInZone(now, timezone);
  const week = weekPeriodInZone(now, timezone);
  const month = monthPeriodInZone(now, timezone);

  const ownEmployeeId = ctx.employee?.id ?? null;
  // RoutePlan.routeDate ist die Kalenderdatums-Mitternacht in UTC.
  const todayParts = calendarDayInZone(now, timezone);
  const todayRouteDate = utcDate(todayParts.year, todayParts.month, todayParts.day);
  const mineFilter = options.includeUnassigned
    ? {
        OR: [
          ...(ownEmployeeId ? [{ assignedEmployeeId: ownEmployeeId }] : []),
          { assignedEmployeeId: null },
        ],
      }
    : { assignedEmployeeId: ownEmployeeId ?? '-' };

  const [todayAppointments, upcoming, weekAppointments, todayRoutePlan] = await Promise.all([
    db.appointment.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        startAt: { gte: today.start, lt: today.end },
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        ...mineFilter,
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, color: true } },
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
        startAt: { gte: today.end },
        status: { in: ['PLANNED', 'CONFIRMED'] },
        ...mineFilter,
      },
      include: { customer: { select: { id: true, firstName: true, lastName: true, color: true } } },
      orderBy: { startAt: 'asc' },
      take: 6,
    }),
    db.appointment.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        startAt: { gte: week.start, lt: week.end },
        status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
        ...mineFilter,
      },
      select: { durationMinutes: true, startAt: true, status: true },
    }),
    // Die im Routenplaner gespeicherte Tagesroute. Sie ist bewusst etwas
    // Eigenes: Termine sind der Inhalt des Tages, die Route ist die dafür
    // geplante Fahrt – mit den echten Fahrzeiten von Kunde zu Kunde.
    ownEmployeeId
      ? db.routePlan.findUnique({
          where: {
            employeeId_routeDate: {
              employeeId: ownEmployeeId,
              routeDate: todayRouteDate,
            },
          },
          include: { stops: { orderBy: { sequence: 'asc' } } },
        })
      : Promise.resolve(null),
  ]);

  // Stopps auf gelöschte/abgesagte Termine zählen nicht mehr mit.
  const todayAppointmentIds = new Set(todayAppointments.map((appointment) => appointment.id));
  const routeStops = (todayRoutePlan?.stops ?? []).filter((stop) =>
    todayAppointmentIds.has(stop.appointmentId),
  );
  const routeStopByAppointment = new Map(routeStops.map((stop) => [stop.appointmentId, stop]));

  // Abfahrtszeiten: Startpunkt der Organisation → erster Termin → Folgetermine.
  const startLocation = ctx.organization.defaultStartLocation as
    | { latitude?: number | null; longitude?: number | null }
    | null;

  // Hinweise der EIGENEN heutigen Termine (Überschneidung, Abwesenheit,
  // außerhalb der Verfügbarkeit) – auch im „Mein Tag"/Alleine-Modus sichtbar.
  const conflictEntryIds = new Set<string>();
  if (ownEmployeeId) {
    const [ownAvailability, ownAbsences] = await Promise.all([
      db.employeeAvailability.findMany({
        where: { employeeId: ownEmployeeId },
        select: { weekday: true, startTime: true, endTime: true, validFrom: true, validUntil: true },
      }),
      db.employeeAbsence.findMany({
        where: {
          employeeId: ownEmployeeId,
          status: 'APPROVED',
          startAt: { lt: today.end },
          endAt: { gt: today.start },
        },
        select: { startAt: true, endAt: true },
      }),
    ]);
    const own = todayAppointments.filter(
      (a) =>
        a.assignedEmployeeId === ownEmployeeId &&
        !['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(a.status),
    );
    for (let i = 0; i < own.length; i += 1) {
      for (let j = i + 1; j < own.length; j += 1) {
        if (overlaps(own[i]!.startAt, own[i]!.endAt, own[j]!.startAt, own[j]!.endAt)) {
          conflictEntryIds.add(own[i]!.id);
          conflictEntryIds.add(own[j]!.id);
        }
      }
      if (ownAbsences.some((ab) => overlaps(own[i]!.startAt, own[i]!.endAt, ab.startAt, ab.endAt))) {
        conflictEntryIds.add(own[i]!.id);
      }
      const active = ownAvailability.filter(
        (s) =>
          s.validFrom <= own[i]!.startAt &&
          (s.validUntil === null || s.validUntil >= own[i]!.startAt),
      );
      if (isOutsideAvailabilityWindows(own[i]!.startAt, own[i]!.durationMinutes, active, timezone)) {
        conflictEntryIds.add(own[i]!.id);
      }
    }
  }

  const entries: MyDayEntry[] = [];
  const explicitCurrent = todayAppointments.find(
    (appointment) =>
      appointment.status === 'IN_PROGRESS' &&
      isAppointmentCompletableStatus(appointment.status),
  );
  const currentAppointment =
    explicitCurrent ??
    todayAppointments.find(
      (appointment) =>
        isAppointmentCompletableStatus(appointment.status) &&
        appointment.startAt.getTime() <= now.getTime() &&
        appointment.endAt.getTime() > now.getTime(),
    ) ??
    null;
  let previousCoordinate =
    startLocation?.latitude != null && startLocation?.longitude != null
      ? { latitude: startLocation.latitude, longitude: startLocation.longitude }
      : null;
  for (const appointment of todayAppointments) {
    const coordinate =
      appointment.locationAddress?.latitude != null && appointment.locationAddress.longitude != null
        ? {
            latitude: appointment.locationAddress.latitude,
            longitude: appointment.locationAddress.longitude,
          }
        : null;
    // Liegt eine geplante Route vor, gilt deren echte Fahrzeit für genau
    // diesen Abschnitt (Kunde → Kunde). Nur ohne Plan wird geschätzt.
    const plannedStop = routeStopByAppointment.get(appointment.id);
    const travelSeconds = plannedStop
      ? plannedStop.travelSecondsFromPrevious
      : previousCoordinate && coordinate && appointment.routeRelevant
        ? estimateTravelSeconds(previousCoordinate, coordinate)
        : null;
    entries.push({
      appointmentId: appointment.id,
      title: appointment.title,
      customerId: appointment.customer.id,
      customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      customerColor: appointment.customer.color,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      status: appointment.status,
      isCurrent: currentAppointment?.id === appointment.id,
      canComplete: isAppointmentCompletableStatus(appointment.status),
      unassigned: appointment.assignedEmployeeId === null,
      addressLine: appointment.locationAddress
        ? `${appointment.locationAddress.street} ${appointment.locationAddress.houseNumber}, ${appointment.locationAddress.postalCode} ${appointment.locationAddress.city}`
        : null,
      latitude: coordinate?.latitude ?? null,
      longitude: coordinate?.longitude ?? null,
      travelSeconds,
      departureAt: plannedStop
        ? new Date(plannedStop.arrivalAt.getTime() - plannedStop.travelSecondsFromPrevious * 1000)
        : travelSeconds != null
          ? new Date(appointment.startAt.getTime() - travelSeconds * 1000)
          : null,
      hasConflict: conflictEntryIds.has(appointment.id),
    });
    if (coordinate) previousCoordinate = coordinate;
  }

  // Offene Stunden: Solo = verplanbares Kundenguthaben; Mitarbeiter = zugewiesen minus verplant.
  // Ohne Stundenbudgets gibt es kein Kundenguthaben → die Kachel entfällt im Solo-Fall.
  const hourBudgetsEnabled = ctx.organization.hourBudgetsEnabled;
  let openMinutes = 0;
  let openHint = '';
  let showOpenHours = true;
  if (options.includeUnassigned) {
    if (hourBudgetsEnabled) {
      const customers = await db.customer.findMany({
        where: { organizationId: orgId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      });
      const stats = await getCustomerAccountStatsBulk(
        orgId,
        timezone,
        customers.map((c) => c.id),
      );
      openMinutes = [...stats.values()].reduce(
        (sum, stat) => sum + Math.max(0, stat.plannableMinutes),
        0,
      );
      openHint = 'verplanbares Kundenguthaben (Konto)';
    } else {
      showOpenHours = false;
    }
  } else {
    const allocations = ownEmployeeId
      ? await db.hourAllocation.findMany({
          where: {
            organizationId: orgId,
            allocatedToEmployeeId: ownEmployeeId,
            status: 'ACTIVE',
            validFrom: { lt: month.end },
            validUntil: { gte: month.start },
          },
          select: { allocatedMinutes: true },
        })
      : [];
    const received = allocations.reduce((sum, allocation) => sum + allocation.allocatedMinutes, 0);
    const monthPlanned = await db.appointment.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        assignedEmployeeId: ownEmployeeId ?? '-',
        startAt: { gte: month.start, lt: month.end },
        status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
      },
      select: { durationMinutes: true },
    });
    const planned = monthPlanned.reduce((sum, appointment) => sum + appointment.durationMinutes, 0);
    openMinutes = Math.max(0, received - planned);
    openHint = 'zugewiesen, aber noch nicht verplant (Monat)';
  }

  const weekPlannedMinutes = weekAppointments.reduce((sum, a) => sum + a.durationMinutes, 0);
  const nextAppointment =
    todayAppointments.find((appointment) => appointment.endAt.getTime() > now.getTime()) ?? null;
  const todayTravelSeconds = entries.reduce((sum, entry) => sum + (entry.travelSeconds ?? 0), 0);

  // Für heute Termine, aber noch keine geplante Route? Dann direkt zum Planen anregen.
  const routeRelevantTodayCount = ownEmployeeId
    ? todayAppointments.filter(
        (a) =>
          a.assignedEmployeeId === ownEmployeeId &&
          a.routeRelevant &&
          !['CANCELLED', 'NO_SHOW'].includes(a.status),
      ).length
    : 0;
  const needsRoutePlanning = routeStops.length === 0 && routeRelevantTodayCount >= 2;

  // Voraussichtlicher Tagesverdienst – exakt dieselbe Berechnung wie im
  // Routenplaner („Verdienst (Tag)"): Stundenlohn inkl. steuerfreiem Zuschlag
  // auf die Kundenzeit plus Kilometergeld. Als Verdienstbasis zählt – wenn eine
  // Route geplant ist – genau deren Kundenzeit und Strecke (identisch zum
  // Planer). Ohne geplante Route ersatzweise alle eigenen Termine des Tages,
  // damit der Verdienst nicht auf 0 fällt (Kilometergeld gibt es dann nicht).
  const routeDistanceMeters = routeStops.reduce(
    (sum, stop) => sum + stop.distanceMetersFromPrevious,
    0,
  );
  const durationByAppointmentId = new Map(
    todayAppointments.map((appointment) => [appointment.id, appointment.durationMinutes]),
  );
  const routeServiceMinutes = routeStops.reduce(
    (sum, stop) => sum + (durationByAppointmentId.get(stop.appointmentId) ?? 0),
    0,
  );
  const ownTodayMinutes = ownEmployeeId
    ? todayAppointments
        .filter((appointment) => appointment.assignedEmployeeId === ownEmployeeId)
        .reduce((sum, appointment) => sum + appointment.durationMinutes, 0)
    : 0;
  const earningsServiceMinutes = routeStops.length > 0 ? routeServiceMinutes : ownTodayMinutes;
  // `?? 0`: robust, falls der (Dev-)Prisma-Client das Feld noch nicht kennt.
  const mileageRatePerKmCents = ctx.membership.mileageRatePerKmCents ?? 0;
  const projectedEarnings =
    ownEmployeeId && ctx.membership.hourlyWageCents > 0
      ? computeRouteEarnings({
          serviceMinutes: earningsServiceMinutes,
          distanceMeters: routeDistanceMeters,
          hourlyWageCents: ctx.membership.hourlyWageCents,
          taxFreeBonusCentsPerHour: ctx.membership.taxFreeBonusCentsPerHour,
          mileageRatePerKmCents,
        })
      : null;
  const projectedEarningsCents = projectedEarnings?.totalCents ?? null;
  const projectedMileageCents = projectedEarnings?.mileageCents ?? 0;

  return {
    entries,
    upcoming: upcoming.map((appointment) => ({
      id: appointment.id,
      customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      customerColor: appointment.customer.color,
      startAt: appointment.startAt,
      title: appointment.title,
    })),
    counts: {
      todayCount: todayAppointments.length,
      todayMinutes: todayAppointments.reduce((sum, a) => sum + a.durationMinutes, 0),
      todayTravelSeconds,
      weekPlannedMinutes,
      openMinutes,
      openHint,
      /** Kachel „Offene Stunden" anzeigen (aus, wenn Budget-Guthaben nicht geführt wird). */
      showOpenHours,
      /** Anzahl eigener heutiger Termine mit Hinweis (Konflikt/Verfügbarkeit). */
      conflictCount: conflictEntryIds.size,
      /** Voraussichtlicher Tagesverdienst (null ohne hinterlegten Stundenlohn). */
      projectedEarningsCents,
      /** Kilometergeld-Anteil davon (0 ohne Satz oder Route). */
      projectedMileageCents,
    },
    nextAppointmentAt: nextAppointment?.startAt ?? null,
    firstDeparture: entries[0]?.departureAt ?? null,
    /** Heute Termine, aber noch keine Route geplant → „Tag automatisch planen" anbieten. */
    needsRoutePlanning,
    /**
     * Die im Routenplaner gespeicherte Tagesroute – bewusst getrennt von den
     * Terminen. `null`, solange für heute nichts geplant wurde.
     */
    route:
      todayRoutePlan && routeStops.length > 0
        ? {
            status: todayRoutePlan.status,
            originLabel:
              (todayRoutePlan.startAddress as { label?: string } | null)?.label ?? 'Startpunkt',
            departureAt: todayRoutePlan.plannedDepartureAt,
            returnAt: todayRoutePlan.plannedReturnAt,
            totalTravelSeconds: routeStops.reduce(
              (sum, stop) => sum + stop.travelSecondsFromPrevious,
              0,
            ),
            totalDistanceMeters: routeStops.reduce(
              (sum, stop) => sum + stop.distanceMetersFromPrevious,
              0,
            ),
            stops: routeStops.map((stop, index) => {
              const appointment = todayAppointments.find((a) => a.id === stop.appointmentId)!;
              return {
                appointmentId: stop.appointmentId,
                sequence: index + 1,
                customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
                customerColor: appointment.customer.color,
                arrivalAt: stop.arrivalAt,
                serviceStartAt: stop.serviceStartAt,
                serviceEndAt: stop.serviceEndAt,
                travelSecondsFromPrevious: stop.travelSecondsFromPrevious,
                distanceMetersFromPrevious: stop.distanceMetersFromPrevious,
              };
            }),
          }
        : null,
  };
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
  const hourBudgetsEnabled = ctx.organization.hourBudgetsEnabled;

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
  // Nur bei aktiven Stundenbudgets: sonst gibt es kein Kundenguthaben und die
  // Konto-Materialisierung soll gar nicht laufen.
  let openHoursCustomers: { id: string; name: string; openMinutes: number }[] = [];
  if (hourBudgetsEnabled && hasPermission(ctx, 'customers.read')) {
    const customers = await db.customer.findMany({
      where: { organizationId: orgId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true },
    });
    const stats = await getCustomerAccountStatsBulk(
      orgId,
      timezone,
      customers.map((c) => c.id),
    );
    openHoursCustomers = customers
      .map((customer) => {
        const stat = stats.get(customer.id);
        return {
          id: customer.id,
          name: `${customer.firstName} ${customer.lastName}`,
          // „Offen" = auf dem Konto, aber noch keinem Mitarbeiter zugewiesen.
          openMinutes: stat ? Math.max(0, stat.balanceMinutes - stat.allocatedMinutes) : 0,
        };
      })
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
          budgetId: a.budgetId ?? '',
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
      durationMinutes: true,
      title: true,
    },
    orderBy: { startAt: 'asc' },
  });
  const [weekAbsences, weekAvailabilities] = await Promise.all([
    db.employeeAbsence.findMany({
      where: {
        employee: { organizationId: orgId },
        status: 'APPROVED',
        startAt: { lt: week.end },
        endAt: { gt: week.start },
      },
      select: { employeeId: true, startAt: true, endAt: true },
    }),
    db.employeeAvailability.findMany({
      where: { employee: { organizationId: orgId } },
      select: { employeeId: true, weekday: true, startTime: true, endTime: true, validFrom: true, validUntil: true },
    }),
  ]);
  const availByEmployee = new Map<string, typeof weekAvailabilities>();
  for (const slot of weekAvailabilities) {
    const list = availByEmployee.get(slot.employeeId) ?? [];
    list.push(slot);
    availByEmployee.set(slot.employeeId, list);
  }
  const conflictAppointmentIds = new Set<string>();
  const byEmployee = new Map<string, typeof weekAppointments>();
  for (const appointment of weekAppointments) {
    const list = byEmployee.get(appointment.assignedEmployeeId!) ?? [];
    list.push(appointment);
    byEmployee.set(appointment.assignedEmployeeId!, list);
  }
  for (const [employeeId, list] of byEmployee) {
    const empSlots = availByEmployee.get(employeeId) ?? [];
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
      const active = empSlots.filter(
        (slot) =>
          slot.validFrom <= list[i]!.startAt &&
          (slot.validUntil === null || slot.validUntil >= list[i]!.startAt),
      );
      if (isOutsideAvailabilityWindows(list[i]!.startAt, list[i]!.durationMinutes, active, timezone)) {
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
        employeeId: appointment.assignedEmployee?.id ?? null,
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
  // Kommende Tage: Mitarbeiter mit ≥2 routenrelevanten Terminen an einem Tag, für
  // den noch keine Route geplant ist → zum automatischen Planen anregen.
  {
    const horizonEnd = addDays(today.start, 7);
    const [routeAppts, routePlansAhead] = await Promise.all([
      db.appointment.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          routeRelevant: true,
          assignedEmployeeId: { not: null },
          status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
          startAt: { gte: today.start, lt: horizonEnd },
          ...(isPlanner ? {} : scopeFilter),
        },
        select: { assignedEmployeeId: true, startAt: true },
      }),
      db.routePlan.findMany({
        where: { organizationId: orgId, routeDate: { gte: today.start, lt: horizonEnd } },
        select: { employeeId: true, routeDate: true },
      }),
    ]);
    const plannedDays = new Set(
      routePlansAhead.map((plan) => `${plan.employeeId}:${plan.routeDate.getTime()}`),
    );
    const dayCounts = new Map<string, number>();
    for (const appointment of routeAppts) {
      const parts = calendarDayInZone(appointment.startAt, timezone);
      const routeDate = utcDate(parts.year, parts.month, parts.day);
      const key = `${appointment.assignedEmployeeId}:${routeDate.getTime()}`;
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }
    const employeeName = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
    const unplannedByEmployee = new Map<string, { days: number; firstDate: Date }>();
    for (const [key, count] of dayCounts) {
      if (count < 2 || plannedDays.has(key)) continue;
      const [empId, dateMs] = key.split(':');
      const date = new Date(Number(dateMs));
      const current = unplannedByEmployee.get(empId!);
      if (!current) unplannedByEmployee.set(empId!, { days: 1, firstDate: date });
      else {
        current.days += 1;
        if (date < current.firstDate) current.firstDate = date;
      }
    }
    const needers = [...unplannedByEmployee.entries()]
      .map(([empId, value]) => ({ empId, name: employeeName.get(empId) ?? 'Mitarbeiter', ...value }))
      .filter((entry) => employeeName.has(entry.empId)) // nur im eigenen Verwaltungsbereich
      .sort((a, b) => b.days - a.days)
      .slice(0, 4);
    for (const needer of needers) {
      const dateIso = toDateInputValue(needer.firstDate, timezone);
      actionItems.push({
        kind: 'ROUTE_UNPLANNED',
        title: `${needer.name}: ${needer.days} ${needer.days === 1 ? 'Tag' : 'Tage'} ohne geplante Route`,
        detail: 'Termine vorhanden, aber keine Tagesroute – jetzt automatisch planen',
        href: `/routes?mitarbeiter=${needer.empId}&datum=${dateIso}&plan=1`,
      });
    }
  }
  if (isPlanner && hourBudgetsEnabled) {
    // Konto-Modell: wiederkehrende Aufladungen, die bald auslaufen.
    const endingGrants = await db.customerRecurringHourGrant.findMany({
      where: {
        organizationId: orgId,
        active: true,
        endDate: { gte: now, lt: addDays(now, 7) },
        customer: { deletedAt: null, status: 'ACTIVE' },
      },
      include: { customer: { select: { id: true, firstName: true, lastName: true } } },
      take: 3,
    });
    for (const grant of endingGrants) {
      actionItems.push({
        kind: 'BUDGET_ENDING',
        title: `Aufladung von ${grant.customer.firstName} ${grant.customer.lastName} läuft aus`,
        detail: `Letzte automatische Aufladung bis ${new Intl.DateTimeFormat('de-DE', { timeZone: timezone }).format(grant.endDate!)}`,
        href: `/customers/${grant.customer.id}?tab=stunden`,
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
    /** Kunden-Stundenkonten org-weit aktiv (steuert Konto-Kacheln/Schnellaktionen). */
    hourBudgetsEnabled,
  };
}
