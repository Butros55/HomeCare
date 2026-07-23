import 'server-only';

import { dayPeriodInZone, fromDateInputValue } from '@/lib/dates';
import type { StructuredLocation } from '@/lib/geo';
import { optimizeRoute, type RouteStopInput } from '@/lib/route-optimizer';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  assertSameOrg,
  canAccessEmployee,
  hasPermission,
  requireOrganizationMembership,
} from '@/server/permissions';
import { computeRouteMatrixCached, getRoutingProvider } from '@/server/providers/routing';
import { createNotification } from '@/server/services/notification-service';

/**
 * Tagesroutenplanung (Anforderung 17).
 *
 * Wichtig: Die Planung weist Termine NIEMALS automatisch zu – nicht zugewiesene
 * Termine erscheinen nur als Vorschläge und werden erst nach ausdrücklicher
 * Auswahl in die Route aufgenommen (ohne dabei die Zuweisung zu ändern).
 */

export interface RouteCandidate {
  appointmentId: string;
  title: string;
  customerName: string;
  customerColor: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  isFlexible: boolean;
  earliestStartAt: Date | null;
  latestEndAt: Date | null;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
  assigned: boolean;
  routeNotes: string | null;
}

function locationFromJson(value: unknown): StructuredLocation | null {
  if (!value || typeof value !== 'object') return null;
  const loc = value as Partial<StructuredLocation>;
  if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return null;
  return loc as StructuredLocation;
}

export async function getRoutePlanningData(employeeId: string, dateInput: string) {
  const ctx = await requireOrganizationMembership();
  const isOwn = ctx.employee?.id === employeeId;
  if (!hasPermission(ctx, 'routes.manage') && !isOwn) throw new AppError('ACCESS_DENIED');
  if (!(await canAccessEmployee(ctx, employeeId, 'read')) && !isOwn) {
    throw new AppError('EMPLOYEE_NOT_FOUND', { status: 404 });
  }

  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  assertSameOrg(ctx, employee);

  const date = fromDateInputValue(dateInput);
  if (!date) throw new AppError('VALIDATION_FAILED', { message: 'Ungültiges Datum.' });
  const day = dayPeriodInZone(date, ctx.organization.timezone);

  const [assignedAppointments, unassignedAppointments, existingPlan] = await Promise.all([
    db.appointment.findMany({
      where: {
        organizationId: ctx.organization.id,
        deletedAt: null,
        assignedEmployeeId: employeeId,
        routeRelevant: true,
        status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
        startAt: { gte: day.start, lt: day.end },
      },
      include: {
        customer: { select: { firstName: true, lastName: true, color: true, routeNotes: true } },
        locationAddress: true,
      },
      orderBy: { startAt: 'asc' },
    }),
    hasPermission(ctx, 'routes.manage')
      ? db.appointment.findMany({
          where: {
            organizationId: ctx.organization.id,
            deletedAt: null,
            assignedEmployeeId: null,
            routeRelevant: true,
            status: { in: ['PLANNED', 'CONFIRMED', 'DRAFT'] },
            startAt: { gte: day.start, lt: day.end },
          },
          include: {
            customer: { select: { firstName: true, lastName: true, color: true, routeNotes: true } },
            locationAddress: true,
          },
          orderBy: { startAt: 'asc' },
        })
      : Promise.resolve([]),
    db.routePlan.findUnique({
      where: { employeeId_routeDate: { employeeId, routeDate: date } },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    }),
  ]);

  const toCandidate = (
    appointment: (typeof assignedAppointments)[number],
    assigned: boolean,
  ): RouteCandidate => ({
    appointmentId: appointment.id,
    title: appointment.title,
    customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
    customerColor: appointment.customer.color,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    durationMinutes: appointment.durationMinutes,
    isFlexible: appointment.isFlexible,
    earliestStartAt: appointment.earliestStartAt,
    latestEndAt: appointment.latestEndAt,
    addressLine: appointment.locationAddress
      ? `${appointment.locationAddress.street} ${appointment.locationAddress.houseNumber}, ${appointment.locationAddress.postalCode} ${appointment.locationAddress.city}`
      : null,
    latitude: appointment.locationAddress?.latitude ?? null,
    longitude: appointment.locationAddress?.longitude ?? null,
    assigned,
    routeNotes: appointment.customer.routeNotes,
  });

  const defaultStart =
    locationFromJson(employee.startLocation) ??
    locationFromJson(ctx.organization.defaultStartLocation);
  const defaultEnd =
    locationFromJson(employee.endLocation) ??
    locationFromJson(ctx.organization.defaultEndLocation) ??
    defaultStart;

  return {
    employeeName: `${employee.firstName} ${employee.lastName}`,
    assigned: assignedAppointments.map((a) => toCandidate(a, true)),
    suggestions: unassignedAppointments.map((a) => toCandidate(a, false)),
    defaultStart,
    defaultEnd,
    canManage: hasPermission(ctx, 'routes.manage'),
    existingPlan: existingPlan
      ? {
          id: existingPlan.id,
          status: existingPlan.status,
          generatedAt: existingPlan.generatedAt,
          totalTravelSeconds: existingPlan.totalTravelSeconds,
          totalDistanceMeters: existingPlan.totalDistanceMeters,
          stopAppointmentIds: existingPlan.stops.map((s) => s.appointmentId),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------

export interface ComputeRouteInput {
  employeeId: string;
  date: string;
  appointmentIds: string[];
  departureTime: string; // "HH:mm" – Wandzeit? Wir nutzen UTC-Zeit des Tagesbeginns + Offset unten.
  bufferMinutes: number;
  returnToStart: boolean;
  start: { latitude: number; longitude: number; label?: string };
  end: { latitude: number; longitude: number; label?: string };
  /** Manuelle Reihenfolge (keine Optimierung, nur Zeitplan). */
  manualOrder?: boolean;
}

export async function computeRoutePlan(input: ComputeRouteInput) {
  const ctx = await requireOrganizationMembership();
  const isOwn = ctx.employee?.id === input.employeeId;
  if (!hasPermission(ctx, 'routes.manage') && !isOwn) throw new AppError('ACCESS_DENIED');

  const date = fromDateInputValue(input.date);
  if (!date) throw new AppError('VALIDATION_FAILED');

  const appointments = await db.appointment.findMany({
    where: {
      id: { in: input.appointmentIds },
      organizationId: ctx.organization.id,
      deletedAt: null,
    },
    include: { locationAddress: true, customer: { select: { firstName: true, lastName: true, color: true } } },
  });
  if (appointments.length === 0) {
    throw new AppError('ROUTE_NOT_FEASIBLE', { message: 'Keine Termine für die Route ausgewählt.' });
  }

  const missingCoords = appointments.filter(
    (a) => a.locationAddress?.latitude == null || a.locationAddress?.longitude == null,
  );
  if (missingCoords.length > 0) {
    throw new AppError('ADDRESS_MISSING', {
      message: `${missingCoords.length} Termin(e) ohne geokodierte Adresse können nicht eingeplant werden.`,
    });
  }

  // Reihenfolge der Eingabe beibehalten (relevant für manuelle Sortierung).
  const ordered = input.appointmentIds
    .map((id) => appointments.find((a) => a.id === id))
    .filter((a): a is (typeof appointments)[number] => Boolean(a));

  const stops: RouteStopInput[] = ordered.map((appointment) => ({
    id: appointment.id,
    latitude: appointment.locationAddress!.latitude!,
    longitude: appointment.locationAddress!.longitude!,
    serviceMinutes: appointment.durationMinutes,
    fixedStartAt: appointment.isFlexible ? null : appointment.startAt,
    earliestStartAt: appointment.isFlexible
      ? (appointment.earliestStartAt ?? appointment.startAt)
      : null,
    latestEndAt: appointment.isFlexible ? appointment.latestEndAt : null,
  }));

  const points = [
    { latitude: input.start.latitude, longitude: input.start.longitude },
    ...stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    { latitude: input.end.latitude, longitude: input.end.longitude },
  ];
  const legs = await computeRouteMatrixCached(points);
  const matrix = {
    travelSeconds: legs.map((row) => row.map((leg) => leg.travelSeconds)),
    distanceMeters: legs.map((row) => row.map((leg) => leg.distanceMeters)),
  };

  const [h, m] = input.departureTime.split(':').map(Number);
  const { zonedWallTimeToUtc, calendarDayInZone } = await import('@/lib/dates');
  const dayParts = calendarDayInZone(date, ctx.organization.timezone);
  const departureAt = zonedWallTimeToUtc(
    dayParts.year,
    dayParts.month,
    dayParts.day,
    `${(h ?? 8).toString().padStart(2, '0')}:${(m ?? 0).toString().padStart(2, '0')}`,
    ctx.organization.timezone,
  );

  const timeFormatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: ctx.organization.timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  const optimizeInput = {
    stops,
    matrix,
    departureAt,
    bufferMinutes: input.bufferMinutes,
    returnToEnd: input.returnToStart,
    formatTime: (date: Date) => timeFormatter.format(date),
  };

  const result = input.manualOrder
    ? { ...(await import('@/lib/route-optimizer')).computeSchedule(stops.map((_, i) => i), optimizeInput), order: stops.map((_, i) => i) }
    : optimizeRoute(optimizeInput);

  const byId = new Map(ordered.map((a) => [a.id, a] as const));
  return {
    provider: getRoutingProvider().name,
    departureAt: result.departureAt.toISOString(),
    returnArrivalAt: result.returnArrivalAt?.toISOString() ?? null,
    totalTravelSeconds: result.totalTravelSeconds,
    totalDistanceMeters: result.totalDistanceMeters,
    totalServiceMinutes: result.totalServiceMinutes,
    totalWaitSeconds: result.totalWaitSeconds,
    warnings: result.warnings,
    feasible: result.feasible,
    stops: result.stops.map((stop) => {
      const appointment = byId.get(stop.id)!;
      return {
        appointmentId: stop.id,
        sequence: stop.sequence,
        title: appointment.title,
        customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
        customerColor: appointment.customer.color,
        addressLine: `${appointment.locationAddress!.street} ${appointment.locationAddress!.houseNumber}, ${appointment.locationAddress!.postalCode} ${appointment.locationAddress!.city}`,
        latitude: appointment.locationAddress!.latitude!,
        longitude: appointment.locationAddress!.longitude!,
        isFlexible: appointment.isFlexible,
        arrivalAt: stop.arrivalAt.toISOString(),
        serviceStartAt: stop.serviceStartAt.toISOString(),
        serviceEndAt: stop.serviceEndAt.toISOString(),
        travelSecondsFromPrevious: stop.travelSecondsFromPrevious,
        distanceMetersFromPrevious: stop.distanceMetersFromPrevious,
        waitSeconds: stop.waitSeconds,
        warning: stop.warning,
      };
    }),
  };
}

export type ComputedRoute = Awaited<ReturnType<typeof computeRoutePlan>>;

// ---------------------------------------------------------------------------

export async function saveRoutePlan(
  input: ComputeRouteInput & { publish: boolean },
): Promise<{ routePlanId: string }> {
  const ctx = await requireOrganizationMembership();
  if (!hasPermission(ctx, 'routes.manage')) throw new AppError('ACCESS_DENIED');
  const employee = await db.employee.findUnique({ where: { id: input.employeeId } });
  assertSameOrg(ctx, employee);

  const computed = await computeRoutePlan(input);
  const date = fromDateInputValue(input.date)!;

  const plan = await db.$transaction(async (tx) => {
    // Bestehenden Plan des Tages ersetzen (eindeutig je Mitarbeiter+Datum).
    await tx.routePlan.deleteMany({
      where: { employeeId: input.employeeId, routeDate: date },
    });
    const created = await tx.routePlan.create({
      data: {
        organizationId: ctx.organization.id,
        employeeId: input.employeeId,
        routeDate: date,
        startAddress: { ...input.start },
        endAddress: { ...input.end },
        provider: computed.provider,
        totalDistanceMeters: computed.totalDistanceMeters,
        totalTravelSeconds: computed.totalTravelSeconds,
        totalServiceMinutes: computed.totalServiceMinutes,
        plannedDepartureAt: new Date(computed.departureAt),
        plannedReturnAt: computed.returnArrivalAt ? new Date(computed.returnArrivalAt) : null,
        status: input.publish ? 'PUBLISHED' : 'DRAFT',
      },
    });
    for (const stop of computed.stops) {
      await tx.routeStop.create({
        data: {
          routePlanId: created.id,
          appointmentId: stop.appointmentId,
          sequence: stop.sequence,
          arrivalAt: new Date(stop.arrivalAt),
          serviceStartAt: new Date(stop.serviceStartAt),
          serviceEndAt: new Date(stop.serviceEndAt),
          departureAt: new Date(stop.serviceEndAt),
          travelSecondsFromPrevious: stop.travelSecondsFromPrevious,
          distanceMetersFromPrevious: stop.distanceMetersFromPrevious,
          warning: stop.warning,
        },
      });
    }
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: input.publish ? 'route.published' : 'route.generated',
        entityType: 'RoutePlan',
        entityId: created.id,
        metadata: {
          employeeId: input.employeeId,
          date: input.date,
          stops: computed.stops.length,
          warnings: computed.warnings.length,
        },
      },
      tx,
    );
    return created;
  });

  if (input.publish && employee.userId && employee.userId !== ctx.user.id) {
    await createNotification({
      organizationId: ctx.organization.id,
      userId: employee.userId,
      type: 'ROUTE_PROBLEM',
      title: 'Tagesroute freigegeben',
      message: `Deine Route für ${new Intl.DateTimeFormat('de-DE', { timeZone: ctx.organization.timezone }).format(date)} mit ${computed.stops.length} Stopps ist verfügbar.`,
      targetUrl: `/routes?mitarbeiter=${input.employeeId}&datum=${input.date}`,
    });
  }

  return { routePlanId: plan.id };
}

export async function discardRoutePlan(employeeId: string, dateInput: string): Promise<void> {
  const ctx = await requireOrganizationMembership();
  if (!hasPermission(ctx, 'routes.manage')) throw new AppError('ACCESS_DENIED');
  const date = fromDateInputValue(dateInput);
  if (!date) throw new AppError('VALIDATION_FAILED');
  const plan = await db.routePlan.findUnique({
    where: { employeeId_routeDate: { employeeId, routeDate: date } },
  });
  if (!plan) return;
  assertSameOrg(ctx, plan);
  await db.$transaction(async (tx) => {
    await tx.routePlan.delete({ where: { id: plan.id } });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'route.discarded',
        entityType: 'RoutePlan',
        entityId: plan.id,
      },
      tx,
    );
  });
}
