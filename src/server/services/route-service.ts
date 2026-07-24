import 'server-only';

import type { Employee, Prisma } from '@prisma/client';

import { dayPeriodInZone, fromDateInputValue } from '@/lib/dates';
import type { StructuredLocation } from '@/lib/geo';
import type { RouteStopInput } from '@/lib/route-optimizer';
import { planRouteWithAutoDeparture } from '@/lib/route-suggestions';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  assertSameOrg,
  canAccessEmployee,
  hasPermission,
  requireOrganizationMembership,
  type OrgContext,
} from '@/server/permissions';
import { computeRouteMatrixCached, getRoutingProvider } from '@/server/providers/routing';
import { createNotification } from '@/server/services/notification-service';

/**
 * Tagesroutenplanung (Anforderung 17).
 *
 * Wichtig: Die Planung weist Termine NIEMALS automatisch zu – nicht zugewiesene
 * Termine erscheinen nur als Vorschläge und werden erst nach ausdrücklicher
 * Auswahl in die Route aufgenommen (ohne dabei die Zuweisung zu ändern).
 *
 * Abfahrtszeit: Es gibt keine manuelle Eingabe mehr – die Engine berechnet die
 * späteste empfohlene Abfahrt, mit der der erste Termin inklusive Puffer
 * erreichbar ist (siehe src/lib/route-suggestions.ts).
 */

// ------------------------- Startpunkt-Auflösung -----------------------------

export type RouteOriginType = 'office' | 'home' | 'gps';

export interface GpsCoordinate {
  latitude: number;
  longitude: number;
  /** Client-Zeitstempel der Ortung (Aktualitätsprüfung). */
  timestamp?: number;
}

export const ORIGIN_LABELS: Record<RouteOriginType, string> = {
  office: 'Büro',
  home: 'Zuhause',
  gps: 'Aktueller Standort',
};

function locationFromJson(value: unknown): StructuredLocation | null {
  if (!value || typeof value !== 'object') return null;
  const loc = value as Partial<StructuredLocation>;
  if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return null;
  return loc as StructuredLocation;
}

const GPS_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Startpunkt einer Route serverseitig auflösen. GPS-Koordinaten sind nur für
 * die eigene Route erlaubt und werden auf Wertebereich und Aktualität geprüft.
 */
export function resolveRouteOrigin(
  ctx: OrgContext,
  employee: Pick<Employee, 'id' | 'startLocation'>,
  originType: RouteOriginType,
  gps?: GpsCoordinate,
): { latitude: number; longitude: number; label: string } {
  if (originType === 'gps') {
    if (ctx.employee?.id !== employee.id) {
      throw new AppError('ACCESS_DENIED', {
        message: 'Der aktuelle Standort kann nur für die eigene Route verwendet werden.',
      });
    }
    if (!gps) {
      throw new AppError('VALIDATION_FAILED', { message: 'Keine GPS-Koordinate übermittelt.' });
    }
    if (
      !Number.isFinite(gps.latitude) ||
      !Number.isFinite(gps.longitude) ||
      Math.abs(gps.latitude) > 90 ||
      Math.abs(gps.longitude) > 180
    ) {
      throw new AppError('VALIDATION_FAILED', { message: 'Ungültige GPS-Koordinate.' });
    }
    if (gps.timestamp && Math.abs(Date.now() - gps.timestamp) > GPS_MAX_AGE_MS) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'Die Standortbestimmung ist veraltet – bitte erneut berechnen.',
      });
    }
    return { latitude: gps.latitude, longitude: gps.longitude, label: ORIGIN_LABELS.gps };
  }

  if (originType === 'home') {
    const home = locationFromJson(employee.startLocation);
    if (!home) {
      throw new AppError('ADDRESS_MISSING', {
        message:
          'Keine Zuhause-Adresse mit Koordinaten hinterlegt (Einstellungen → Profil bzw. Mitarbeiterprofil).',
      });
    }
    return { latitude: home.latitude, longitude: home.longitude, label: home.label ?? ORIGIN_LABELS.home };
  }

  const office = locationFromJson(ctx.organization.defaultStartLocation);
  if (!office) {
    throw new AppError('ADDRESS_MISSING', {
      message: 'Kein Büro-Standort konfiguriert (Einstellungen → Leitung → Organisation).',
    });
  }
  return { latitude: office.latitude, longitude: office.longitude, label: office.label ?? ORIGIN_LABELS.office };
}

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
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            appointment: {
              include: {
                customer: { select: { firstName: true, lastName: true, color: true } },
                locationAddress: true,
              },
            },
          },
        },
      },
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

  const home = locationFromJson(employee.startLocation);
  const office = locationFromJson(ctx.organization.defaultStartLocation);

  const assigned = assignedAppointments.map((a) => toCandidate(a, true));
  const suggestions = unassignedAppointments.map((a) => toCandidate(a, false));

  /**
   * Gespeicherte Stopps können auf inzwischen gelöschte oder abgesagte Termine
   * zeigen. Sie werden hier konsequent ausgeblendet – sonst zählt der Planer
   * Geisterstopps mit („3/2 gewählt") und man bekommt sie nicht mehr abgewählt.
   */
  const livingAppointmentIds = new Set([
    ...assigned.map((candidate) => candidate.appointmentId),
    ...suggestions.map((candidate) => candidate.appointmentId),
  ]);
  const livingStops = (existingPlan?.stops ?? []).filter((stop) =>
    livingAppointmentIds.has(stop.appointmentId),
  );
  const droppedStopCount = (existingPlan?.stops.length ?? 0) - livingStops.length;

  // Verdienst-Kennzahl: nur für die eigene Route und nur, wenn ein Stundenlohn
  // hinterlegt ist (Kilometergeld zählt ausschließlich für eigene Fahrten).
  const earningsRates =
    isOwn && ctx.membership.hourlyWageCents > 0
      ? {
          hourlyWageCents: ctx.membership.hourlyWageCents,
          // Steuerfreier Zuschlag fließt in den Stundenverdienst ein – gleiche
          // Basis wie im Dashboard („Verdienst heute").
          taxFreeBonusCentsPerHour: ctx.membership.taxFreeBonusCentsPerHour ?? 0,
          // `?? 0`: robust, falls der (Dev-)Prisma-Client das Feld noch nicht kennt.
          mileageRatePerKmCents: ctx.membership.mileageRatePerKmCents ?? 0,
        }
      : null;

  return {
    employeeName: `${employee.firstName} ${employee.lastName}`,
    isOwn,
    assigned,
    suggestions,
    /** Verfügbare Startpunkte (GPS entscheidet der Client bei eigener Route). */
    origins: {
      office: office ? { label: office.label ?? 'Büro' } : null,
      home: home ? { label: home.label ?? 'Zuhause' } : null,
    },
    canManage: hasPermission(ctx, 'routes.manage'),
    /** Stundenlohn/Kilometergeld des Betrachters – null, wenn nicht anwendbar. */
    earningsRates,
    existingPlan: existingPlan
      ? {
          id: existingPlan.id,
          status: existingPlan.status,
          generatedAt: existingPlan.generatedAt,
          totalTravelSeconds: existingPlan.totalTravelSeconds,
          totalDistanceMeters: existingPlan.totalDistanceMeters,
          originType: existingPlan.originType as RouteOriginType,
          bufferMinutes: existingPlan.bufferMinutes,
          returnToStart: existingPlan.returnToStart,
          stopAppointmentIds: livingStops.map((s) => s.appointmentId),
          /** Wie viele Stopps auf gelöschte/abgesagte Termine zeigten. */
          droppedStopCount,
        }
      : null,
    /**
     * Die gespeicherte Route als fertiges Ergebnis – damit sie nach einem
     * Seitenwechsel unverändert wieder dasteht und nicht neu berechnet werden
     * muss. `null`, sobald Stopps weggefallen sind: dann ist die gespeicherte
     * Reihenfolge überholt und muss neu berechnet werden.
     */
    savedRoute:
      existingPlan && livingStops.length > 0 && droppedStopCount === 0
        ? savedRouteToDto(existingPlan, livingStops)
        : null,
  };
}

type PersistedPlan = Prisma.RoutePlanGetPayload<{
  include: {
    stops: {
      include: {
        appointment: {
          include: {
            customer: { select: { firstName: true; lastName: true; color: true } };
            locationAddress: true;
          };
        };
      };
    };
  };
}>;

/**
 * Übersetzt einen gespeicherten Plan in dieselbe Form, die `computeRoutePlan`
 * liefert – so zeigt die Oberfläche gespeicherte und frisch berechnete Routen
 * über denselben Weg an.
 */
function savedRouteToDto(plan: PersistedPlan, stops: PersistedPlan['stops']) {
  const origin = locationFromJson(plan.startAddress);
  const lastEnd =
    plan.plannedReturnAt ?? stops.at(-1)?.serviceEndAt ?? plan.plannedDepartureAt ?? plan.routeDate;
  const departure = plan.plannedDepartureAt ?? stops[0]?.arrivalAt ?? plan.routeDate;

  return {
    provider: plan.provider,
    originType: plan.originType as RouteOriginType,
    originLabel: origin?.label ?? 'Startpunkt',
    origin: {
      latitude: origin?.latitude ?? 0,
      longitude: origin?.longitude ?? 0,
      label: origin?.label ?? 'Startpunkt',
    },
    departureAt: departure.toISOString(),
    returnArrivalAt: plan.plannedReturnAt?.toISOString() ?? null,
    totalTravelSeconds: plan.totalTravelSeconds,
    totalDistanceMeters: plan.totalDistanceMeters,
    totalServiceMinutes: plan.totalServiceMinutes,
    totalWaitSeconds: plan.totalWaitSeconds,
    workdaySeconds: Math.max(0, Math.round((lastEnd.getTime() - departure.getTime()) / 1000)),
    warnings: stops.map((stop) => stop.warning).filter((value): value is string => Boolean(value)),
    feasible: true,
    stops: stops.map((stop, index) => ({
      appointmentId: stop.appointmentId,
      sequence: index + 1,
      title: stop.appointment.title,
      customerName: `${stop.appointment.customer.firstName} ${stop.appointment.customer.lastName}`,
      customerColor: stop.appointment.customer.color,
      addressLine: stop.appointment.locationAddress
        ? `${stop.appointment.locationAddress.street} ${stop.appointment.locationAddress.houseNumber}, ${stop.appointment.locationAddress.postalCode} ${stop.appointment.locationAddress.city}`
        : '',
      latitude: stop.appointment.locationAddress?.latitude ?? 0,
      longitude: stop.appointment.locationAddress?.longitude ?? 0,
      isFlexible: stop.appointment.isFlexible,
      arrivalAt: stop.arrivalAt.toISOString(),
      serviceStartAt: stop.serviceStartAt.toISOString(),
      serviceEndAt: stop.serviceEndAt.toISOString(),
      travelSecondsFromPrevious: stop.travelSecondsFromPrevious,
      distanceMetersFromPrevious: stop.distanceMetersFromPrevious,
      waitSeconds: Math.max(
        0,
        Math.round((stop.serviceStartAt.getTime() - stop.arrivalAt.getTime()) / 1000),
      ),
      warning: stop.warning,
    })),
  };
}

// ---------------------------------------------------------------------------

export interface ComputeRouteInput {
  employeeId: string;
  date: string;
  appointmentIds: string[];
  /** Startpunkt: Büro, Zuhause oder (nur eigene Route) aktueller Standort. */
  originType: RouteOriginType;
  gps?: GpsCoordinate;
  bufferMinutes: number;
  returnToStart: boolean;
  /** Manuelle Reihenfolge (keine Optimierung, nur Zeitplan). */
  manualOrder?: boolean;
}

export async function computeRoutePlan(input: ComputeRouteInput) {
  const ctx = await requireOrganizationMembership();
  const isOwn = ctx.employee?.id === input.employeeId;
  if (!hasPermission(ctx, 'routes.manage') && !isOwn) throw new AppError('ACCESS_DENIED');

  const date = fromDateInputValue(input.date);
  if (!date) throw new AppError('VALIDATION_FAILED');

  const employee = await db.employee.findUnique({ where: { id: input.employeeId } });
  assertSameOrg(ctx, employee);

  const origin = resolveRouteOrigin(ctx, employee, input.originType, input.gps);
  // Bei aktivierter Rückkehr ist das Ziel derselbe Startpunkt.
  const end = origin;

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
    { latitude: origin.latitude, longitude: origin.longitude },
    ...stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    { latitude: end.latitude, longitude: end.longitude },
  ];
  const legs = await computeRouteMatrixCached(points);
  const matrix = {
    travelSeconds: legs.map((row) => row.map((leg) => leg.travelSeconds)),
    distanceMeters: legs.map((row) => row.map((leg) => leg.distanceMeters)),
  };

  // Simulationsbeginn: 00:00 des Planungstags (Org-Wandzeit) – die Engine
  // verschiebt die Abfahrt anschließend so spät wie möglich.
  const day = dayPeriodInZone(date, ctx.organization.timezone);

  const timeFormatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: ctx.organization.timezone,
    hour: '2-digit',
    minute: '2-digit',
  });

  const planInput = {
    stops,
    matrix,
    bufferMinutes: input.bufferMinutes,
    returnToEnd: input.returnToStart,
    earliestDepartureAt: day.start,
    formatTime: (value: Date) => timeFormatter.format(value),
  };

  let result;
  if (input.manualOrder) {
    const { computeSchedule } = await import('@/lib/route-optimizer');
    const order = stops.map((_, i) => i);
    const probe = computeSchedule(order, { ...planInput, departureAt: day.start });
    const first = probe.stops[0];
    const shiftSeconds = first ? Math.max(0, first.waitSeconds - input.bufferMinutes * 60) : 0;
    const latestDepartureAt = new Date(day.start.getTime() + shiftSeconds * 1000);
    const schedule =
      shiftSeconds > 0
        ? computeSchedule(order, { ...planInput, departureAt: latestDepartureAt })
        : probe;
    const lastEnd =
      schedule.returnArrivalAt ??
      schedule.stops[schedule.stops.length - 1]?.serviceEndAt ??
      latestDepartureAt;
    result = {
      ...schedule,
      order,
      latestDepartureAt,
      workdaySeconds: Math.max(
        0,
        Math.round((lastEnd.getTime() - latestDepartureAt.getTime()) / 1000),
      ),
    };
  } else {
    result = planRouteWithAutoDeparture(planInput);
  }

  const byId = new Map(ordered.map((a) => [a.id, a] as const));
  return {
    provider: getRoutingProvider().name,
    originType: input.originType,
    originLabel: origin.label,
    origin: { latitude: origin.latitude, longitude: origin.longitude, label: origin.label },
    /** Späteste empfohlene Abfahrt. */
    departureAt: result.latestDepartureAt.toISOString(),
    returnArrivalAt: result.returnArrivalAt?.toISOString() ?? null,
    totalTravelSeconds: result.totalTravelSeconds,
    totalDistanceMeters: result.totalDistanceMeters,
    totalServiceMinutes: result.totalServiceMinutes,
    totalWaitSeconds: result.totalWaitSeconds,
    workdaySeconds: result.workdaySeconds,
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
  // Unzulässige Routen (verletzte feste Zeiten/Fenster) können nicht
  // gespeichert oder veröffentlicht werden.
  if (!computed.feasible) {
    throw new AppError('ROUTE_NOT_FEASIBLE', {
      message:
        'Die Route verletzt feste Zeiten oder Zeitfenster und kann nicht gespeichert werden.',
      details: { warnings: computed.warnings },
    });
  }
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
        startAddress: { ...computed.origin },
        endAddress: { ...computed.origin },
        originType: computed.originType,
        bufferMinutes: input.bufferMinutes,
        returnToStart: input.returnToStart,
        provider: computed.provider,
        totalDistanceMeters: computed.totalDistanceMeters,
        totalTravelSeconds: computed.totalTravelSeconds,
        totalServiceMinutes: computed.totalServiceMinutes,
        totalWaitSeconds: computed.totalWaitSeconds,
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

/**
 * Entfernt Termine aus allen gespeicherten Routen. Termine werden nur weich
 * gelöscht (`deletedAt`), deshalb greift kein Datenbank-Cascade – ohne diesen
 * Schritt blieben Stopps auf gelöschte/abgesagte Termine bestehen und tauchten
 * im Planer als nicht abwählbare Geisterstopps auf.
 *
 * Reihenfolge wird lückenlos nachgezogen, Summen neu gebildet; bleibt kein
 * Stopp übrig, verschwindet der Plan ganz.
 */
export async function detachAppointmentsFromRoutePlans(
  tx: Prisma.TransactionClient,
  appointmentIds: string[],
): Promise<void> {
  if (appointmentIds.length === 0) return;
  const affected = await tx.routeStop.findMany({
    where: { appointmentId: { in: appointmentIds } },
    select: { id: true, routePlanId: true },
  });
  if (affected.length === 0) return;

  await tx.routeStop.deleteMany({ where: { id: { in: affected.map((stop) => stop.id) } } });

  for (const routePlanId of [...new Set(affected.map((stop) => stop.routePlanId))]) {
    const remaining = await tx.routeStop.findMany({
      where: { routePlanId },
      orderBy: { sequence: 'asc' },
    });
    if (remaining.length === 0) {
      await tx.routePlan.delete({ where: { id: routePlanId } });
      continue;
    }
    // Aufsteigend umnummerieren: Ziel ist immer ≤ aktueller Wert, dadurch
    // kollidiert nichts mit der Eindeutigkeit (routePlanId, sequence).
    for (const [index, stop] of remaining.entries()) {
      if (stop.sequence !== index + 1) {
        await tx.routeStop.update({ where: { id: stop.id }, data: { sequence: index + 1 } });
      }
    }
    await tx.routePlan.update({
      where: { id: routePlanId },
      data: {
        totalTravelSeconds: remaining.reduce(
          (sum, stop) => sum + stop.travelSecondsFromPrevious,
          0,
        ),
        totalDistanceMeters: remaining.reduce(
          (sum, stop) => sum + stop.distanceMetersFromPrevious,
          0,
        ),
        totalServiceMinutes: remaining.reduce(
          (sum, stop) =>
            sum + Math.round((stop.serviceEndAt.getTime() - stop.serviceStartAt.getTime()) / 60000),
          0,
        ),
      },
    });
  }
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
