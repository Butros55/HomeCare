import 'server-only';

import type { Employee, Prisma, RoutePlanStatus } from '@prisma/client';

import {
  calendarDayInZone,
  dayPeriodInZone,
  fromDateInputValue,
  minutesOfDayInZone,
} from '@/lib/dates';
import type { StructuredLocation } from '@/lib/geo';
import { computeSchedule, type Matrix, type RouteStopInput } from '@/lib/route-optimizer';
import { planRouteWithAutoDeparture, sliceMatrix } from '@/lib/route-suggestions';
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
  customerPhone: string | null;
  customerConfirmationStatus: 'NOT_REQUIRED' | 'PENDING' | 'CONFIRMED' | 'DECLINED';
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

/**
 * Termin für die Routenplanung bereits vergangen? An vergangene Zeiten führt
 * keine Route: Ein FESTER Termin, dessen Startzeit vorbei ist, und ein FLEXIBLER,
 * dessen Zeitfenster ganz abgelaufen ist, werden nicht mehr eingeplant (sie
 * würden die Route sonst nur unzulässig machen). Für künftige Tage trifft das
 * nie zu, weil dort alle Startzeiten in der Zukunft liegen.
 */
export function isPastForRoutePlanning(
  appointment: { isFlexible: boolean; startAt: Date; endAt: Date; latestEndAt: Date | null },
  now: Date,
): boolean {
  if (appointment.isFlexible) {
    return (appointment.latestEndAt ?? appointment.endAt).getTime() <= now.getTime();
  }
  return appointment.startAt.getTime() <= now.getTime();
}

/**
 * Liegt der (Kalender-)Tag vor dem heutigen Tag (in der Organisations-Zeitzone)?
 * Vergangene Tage sind in der Routenplanung eingefroren: nur ansehen, nicht mehr
 * planen/ändern. Der heutige Tag bleibt planbar (für den restlichen Tag).
 */
export function isPastPlanningDay(date: Date, timezone: string, now: Date = new Date()): boolean {
  const target = calendarDayInZone(date, timezone);
  const today = calendarDayInZone(now, timezone);
  const asNumber = (d: { year: number; month: number; day: number }) =>
    d.year * 10000 + d.month * 100 + d.day;
  return asNumber(target) < asNumber(today);
}

export interface PlanningHorizon {
  /** Ist der Planungstag der heutige Tag (Organisations-Zeitzone)? */
  isToday: boolean;
  /**
   * Frühestmögliche Abfahrt / Simulationsbeginn. HEUTE: „jetzt" (keine Abfahrt in
   * der Vergangenheit); künftige Tage: 00:00 Org-Wandzeit. So plant der Optimierer
   * nie eine Abfahrt oder einen Einsatzbeginn in der Vergangenheit – die
   * Erreichbarkeit (Fahrzeit + Puffer ab jetzt) ergibt sich direkt aus der
   * Ankunftsberechnung des Planers.
   */
  earliestDepartureAt: Date;
  /**
   * Untergrenze für den Einsatzbeginn in Wandzeit-Minuten seit Mitternacht.
   * HEUTE: die aktuelle Uhrzeit (Vorschlagsraster nicht vor „jetzt"); sonst 0.
   */
  earliestServiceMinute: number;
}

/**
 * Planungshorizont eines Tages. Zentral, damit Einzelvorschläge, Tagesrouten und
 * die manuelle Routenberechnung „heute ab jetzt" identisch behandeln. `now` wird
 * vom Aufrufer EINMAL pro Operation bestimmt und übergeben (deterministisch,
 * testbar). Vergangene Tage sind Sache der aufrufenden Vergangenheitsprüfung.
 */
export function resolvePlanningHorizon(input: {
  date: Date;
  timezone: string;
  now: Date;
}): PlanningHorizon {
  const day = dayPeriodInZone(input.date, input.timezone);
  const isToday = input.now >= day.start && input.now < day.end;
  if (!isToday) {
    return { isToday: false, earliestDepartureAt: day.start, earliestServiceMinute: 0 };
  }
  return {
    isToday: true,
    // Innerhalb des heutigen Tages ist `now` stets ≥ Tagesbeginn.
    earliestDepartureAt: input.now,
    earliestServiceMinute: Math.max(0, minutesOfDayInZone(input.now, input.timezone)),
  };
}

/** Wirft, wenn für einen vergangenen Tag geplant/geändert werden soll. */
function assertNotPastPlanningDay(date: Date, timezone: string): void {
  if (isPastPlanningDay(date, timezone)) {
    throw new AppError('VALIDATION_FAILED', {
      message:
        'Vergangene Tage können nicht mehr geplant oder geändert werden – die Route lässt sich nur ansehen.',
    });
  }
}

/**
 * Tage mit gespeicherter Route eines Mitarbeiters im Bereich [from, to] – für die
 * Datumsleiste der Routenplanung (Farbmarker „geplant"). Datumssemantik: routeDate
 * ist die Kalender-Mitternacht in UTC, YYYY-MM-DD wird direkt daraus abgeleitet.
 */
export async function listRoutePlanDates(
  employeeId: string,
  fromInput: string,
  toInput: string,
): Promise<{ date: string; status: RoutePlanStatus }[]> {
  const ctx = await requireOrganizationMembership();
  const isOwn = ctx.employee?.id === employeeId;
  if (!hasPermission(ctx, 'routes.manage') && !isOwn) throw new AppError('ACCESS_DENIED');
  const from = fromDateInputValue(fromInput);
  const to = fromDateInputValue(toInput);
  if (!from || !to) throw new AppError('VALIDATION_FAILED', { message: 'Ungültiger Zeitraum.' });
  const plans = await db.routePlan.findMany({
    where: {
      organizationId: ctx.organization.id,
      employeeId,
      routeDate: { gte: from, lte: to },
    },
    select: { routeDate: true, status: true },
  });
  return plans.map((plan) => ({
    date: plan.routeDate.toISOString().slice(0, 10),
    status: plan.status,
  }));
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
        // Abgeschlossene bewusst mitladen: sie bleiben in einer gespeicherten
        // Route sichtbar (erledigt), werden aber nicht neu eingeplant.
        status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
        startAt: { gte: day.start, lt: day.end },
      },
      include: {
        customer: {
          select: {
            firstName: true,
            lastName: true,
            color: true,
            phone: true,
            routeNotes: true,
          },
        },
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
            customer: {
              select: {
                firstName: true,
                lastName: true,
                color: true,
                phone: true,
                routeNotes: true,
              },
            },
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
                customer: {
                  select: { firstName: true, lastName: true, color: true, phone: true },
                },
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
    customerPhone: appointment.customer.phone,
    customerConfirmationStatus: appointment.customerConfirmationStatus,
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

  // Nur noch planbare (nicht abgeschlossene, nicht vergangene) Termine sind
  // Kandidaten und Standardauswahl – an vergangene Zeiten führt keine Route.
  const now = new Date();
  const routableAppointments = assignedAppointments.filter(
    (a) => a.status !== 'COMPLETED' && !isPastForRoutePlanning(a, now),
  );
  const assigned = routableAppointments.map((a) => toCandidate(a, true));
  const suggestions = unassignedAppointments.map((a) => toCandidate(a, false));

  /**
   * Gespeicherte Stopps können auf inzwischen gelöschte oder abgesagte Termine
   * zeigen. Sie werden hier konsequent ausgeblendet – sonst zählt der Planer
   * Geisterstopps mit („3/2 gewählt") und man bekommt sie nicht mehr abgewählt.
   * Abgeschlossene/vergangene Termine gelten dagegen als „lebend": eine
   * gespeicherte Route mit inzwischen erledigten Stopps bleibt dadurch sichtbar,
   * statt komplett zu verschwinden.
   */
  const livingAppointmentIds = new Set([
    ...assignedAppointments.map((a) => a.id),
    ...suggestions.map((candidate) => candidate.appointmentId),
  ]);
  const livingStops = (existingPlan?.stops ?? []).filter((stop) =>
    livingAppointmentIds.has(stop.appointmentId),
  );
  const droppedStopCount = (existingPlan?.stops.length ?? 0) - livingStops.length;

  // Wer hat die gespeicherte Route zuletzt geplant? (aus dem Audit-Log, best effort –
  // relevant vor allem für die reine Ansicht vergangener Tage).
  const planAudit = existingPlan
    ? await db.auditLog.findFirst({
        where: { entityType: 'RoutePlan', entityId: existingPlan.id, actorUserId: { not: null } },
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { firstName: true, lastName: true } } },
      })
    : null;
  const plannedByName = planAudit?.actor
    ? `${planAudit.actor.firstName} ${planAudit.actor.lastName}`
    : null;

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
          plannedByName,
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
            customer: {
              select: { firstName: true; lastName: true; color: true; phone: true };
            };
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
      customerPhone: stop.appointment.customer.phone,
      customerConfirmationStatus: stop.appointment.customerConfirmationStatus,
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
  // Optimieren/Neuberechnen ist eine Planungsaktion – für vergangene Tage
  // gesperrt (nur Ansicht). Reine Anzeige läuft über getRoutePlanningData.
  assertNotPastPlanningDay(date, ctx.organization.timezone);

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
    include: {
      locationAddress: true,
      customer: {
        select: { firstName: true, lastName: true, color: true, phone: true },
      },
    },
  });
  if (appointments.length === 0) {
    throw new AppError('ROUTE_NOT_FEASIBLE', { message: 'Keine Termine für die Route ausgewählt.' });
  }

  // Vergangene (fixe) und abgeschlossene Termine nie einplanen – an vergangene
  // Zeiten führt keine Route; sie würden sie sonst nur unzulässig machen. Sie
  // werden still übersprungen (Hinweis unten), statt alles zu blockieren.
  const now = new Date();
  const planable = appointments.filter(
    (a) => a.status !== 'COMPLETED' && !isPastForRoutePlanning(a, now),
  );
  const skippedPastCount = appointments.length - planable.length;

  const missingCoords = planable.filter(
    (a) => a.locationAddress?.latitude == null || a.locationAddress?.longitude == null,
  );
  if (missingCoords.length > 0) {
    throw new AppError('ADDRESS_MISSING', {
      message: `${missingCoords.length} Termin(e) ohne geokodierte Adresse können nicht eingeplant werden.`,
    });
  }

  // Reihenfolge der Eingabe beibehalten (relevant für manuelle Sortierung).
  const ordered = input.appointmentIds
    .map((id) => planable.find((a) => a.id === id))
    .filter((a): a is (typeof planable)[number] => Boolean(a));
  if (ordered.length === 0) {
    throw new AppError('ROUTE_NOT_FEASIBLE', {
      message: 'Alle gewählten Termine liegen in der Vergangenheit oder sind bereits abgeschlossen.',
    });
  }

  const stopInputFor = (appointment: (typeof ordered)[number]): RouteStopInput => ({
    id: appointment.id,
    latitude: appointment.locationAddress!.latitude!,
    longitude: appointment.locationAddress!.longitude!,
    serviceMinutes: appointment.durationMinutes,
    fixedStartAt: appointment.isFlexible ? null : appointment.startAt,
    earliestStartAt: appointment.isFlexible
      ? (appointment.earliestStartAt ?? appointment.startAt)
      : null,
    latestEndAt: appointment.isFlexible ? appointment.latestEndAt : null,
  });
  const fullStops = ordered.map(stopInputFor);

  // Volle Fahrzeitmatrix über [Start, ...alle Stopps, Ziel] – EINE Anfrage; eine
  // ggf. reduzierte Rest-Route wird nur neu zugeschnitten (kein zweiter Aufruf).
  const points = [
    { latitude: origin.latitude, longitude: origin.longitude },
    ...fullStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    { latitude: end.latitude, longitude: end.longitude },
  ];
  const legs = await computeRouteMatrixCached(points);
  const fullMatrix: Matrix = {
    travelSeconds: legs.map((row) => row.map((leg) => leg.travelSeconds)),
    distanceMeters: legs.map((row) => row.map((leg) => leg.distanceMeters)),
  };

  // Simulationsbeginn: 00:00 des Planungstags (Org-Wandzeit) – die Engine
  // verschiebt die Abfahrt anschließend so spät wie möglich. HEUTE beginnt die
  // Simulation dagegen bei „jetzt": An vergangene Zeiten führt keine Route, also
  // wird weder eine Abfahrt noch ein Einsatz in der Vergangenheit geplant.
  const horizon = resolvePlanningHorizon({ date, timezone: ctx.organization.timezone, now });
  const timeFormatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: ctx.organization.timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  const formatTime = (value: Date) => timeFormatter.format(value);

  // Eine Teilmenge der Stopps (Indizes in `ordered`) planen – nutzt die
  // zugeschnittene Matrix statt einer neuen Routendienst-Anfrage.
  const planForIndices = (keepIdx: number[]) => {
    const subStops = keepIdx.map((i) => fullStops[i]!);
    const matrix = sliceMatrix(fullMatrix, [0, ...keepIdx.map((i) => i + 1), points.length - 1]);
    const planInput = {
      stops: subStops,
      matrix,
      bufferMinutes: input.bufferMinutes,
      returnToEnd: input.returnToStart,
      earliestDepartureAt: horizon.earliestDepartureAt,
      formatTime,
    };
    if (input.manualOrder) {
      const order = subStops.map((_, i) => i);
      const probe = computeSchedule(order, {
        ...planInput,
        departureAt: horizon.earliestDepartureAt,
      });
      const first = probe.stops[0];
      const shiftSeconds = first ? Math.max(0, first.waitSeconds - input.bufferMinutes * 60) : 0;
      const latestDepartureAt = new Date(
        horizon.earliestDepartureAt.getTime() + shiftSeconds * 1000,
      );
      const schedule =
        shiftSeconds > 0
          ? computeSchedule(order, { ...planInput, departureAt: latestDepartureAt })
          : probe;
      const lastEnd =
        schedule.returnArrivalAt ??
        schedule.stops[schedule.stops.length - 1]?.serviceEndAt ??
        latestDepartureAt;
      return {
        ...schedule,
        order,
        latestDepartureAt,
        workdaySeconds: Math.max(
          0,
          Math.round((lastEnd.getTime() - latestDepartureAt.getTime()) / 1000),
        ),
      };
    }
    return planRouteWithAutoDeparture(planInput);
  };

  const byId = new Map(ordered.map((a) => [a.id, a] as const));

  // Best-effort: nicht mehr passende Termine (verletzte feste Zeiten / Fenster)
  // fallen der Reihe nach raus, bis die Route zulässig ist – statt die ganze
  // Planung zu blockieren. Flexible Termine ohne Fensterverletzung passen immer.
  let keepIdx = ordered.map((_, i) => i);
  let result = planForIndices(keepIdx);
  const droppedNames: string[] = [];
  let guard = 0;
  while (!result.feasible && guard < ordered.length) {
    guard += 1;
    const violatedIds = new Set(result.stops.filter((s) => s.warning).map((s) => s.id));
    if (violatedIds.size === 0) break;
    const before = keepIdx.length;
    keepIdx = keepIdx.filter((i) => !violatedIds.has(fullStops[i]!.id));
    for (const id of violatedIds) {
      const appointment = byId.get(id);
      if (appointment) droppedNames.push(`${appointment.customer.firstName} ${appointment.customer.lastName}`);
    }
    if (keepIdx.length === before) break;
    result = planForIndices(keepIdx);
  }

  const extraWarnings: string[] = [];
  if (skippedPastCount > 0) {
    extraWarnings.push(
      `${skippedPastCount} vergangene oder abgeschlossene Termin(e) wurden nicht eingeplant.`,
    );
  }
  if (droppedNames.length > 0) {
    extraWarnings.push(
      `Nicht mehr passende Termine wurden aus der Route entfernt: ${[...new Set(droppedNames)].join(', ')}.`,
    );
  }

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
    warnings: [...extraWarnings, ...result.warnings],
    feasible: result.feasible,
    stops: result.stops.map((stop) => {
      const appointment = byId.get(stop.id)!;
      return {
        appointmentId: stop.id,
        sequence: stop.sequence,
        title: appointment.title,
        customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
        customerColor: appointment.customer.color,
        customerPhone: appointment.customer.phone,
        customerConfirmationStatus: appointment.customerConfirmationStatus,
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

/**
 * Markiert einen automatisch vorgeschlagenen Termin nach dem Telefonat als
 * vom Kunden bestätigt. Manuell im Kalender angelegte Termine haben
 * `NOT_REQUIRED` und laufen nicht durch diesen Schritt.
 */
export async function confirmSuggestedRouteAppointment(
  appointmentId: string,
): Promise<{ appointmentId: string; customerConfirmationStatus: 'CONFIRMED' }> {
  const ctx = await requireOrganizationMembership();
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      organizationId: true,
      assignedEmployeeId: true,
      status: true,
      customerConfirmationStatus: true,
    },
  });
  assertSameOrg(ctx, appointment);

  const isOwn = appointment.assignedEmployeeId === ctx.employee?.id;
  if (
    !isOwn &&
    !hasPermission(ctx, 'appointments.manage') &&
    !hasPermission(ctx, 'routes.manage')
  ) {
    throw new AppError('ACCESS_DENIED');
  }
  if (appointment.customerConfirmationStatus !== 'PENDING') {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Dieser Termin wartet nicht mehr auf eine Kundenbestätigung.',
    });
  }
  if (appointment.status !== 'PLANNED') {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Nur vorgemerkte, geplante Termine können bestätigt werden.',
    });
  }

  await db.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        customerConfirmationStatus: 'CONFIRMED',
        status: 'CONFIRMED',
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'appointment.customerConfirmed',
        entityType: 'Appointment',
        entityId: appointment.id,
      },
      tx,
    );
  });

  return { appointmentId: appointment.id, customerConfirmationStatus: 'CONFIRMED' };
}

// ---------------------------------------------------------------------------

export async function saveRoutePlan(
  input: ComputeRouteInput & { publish: boolean },
): Promise<{ routePlanId: string }> {
  const ctx = await requireOrganizationMembership();
  // Mitarbeiter dürfen ihre eigene Route speichern (Selbstplanung); für fremde
  // Routen ist routes.manage erforderlich.
  const isOwn = ctx.employee?.id === input.employeeId;
  if (!hasPermission(ctx, 'routes.manage') && !isOwn) throw new AppError('ACCESS_DENIED');
  const saveDate = fromDateInputValue(input.date);
  if (!saveDate) throw new AppError('VALIDATION_FAILED', { message: 'Ungültiges Datum.' });
  assertNotPastPlanningDay(saveDate, ctx.organization.timezone);
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
  const rescheduledFlexibleStops = computed.stops.filter((stop) => stop.isFlexible);

  const plan = await db.$transaction(async (tx) => {
    // Die optimierte Zeit eines flexiblen Termins ist Teil des Ergebnisses,
    // nicht nur eine Darstellung im Routenplan. So bleiben Kalender, Termin-
    // Detail und Route nach dem Speichern synchron.
    for (const stop of rescheduledFlexibleStops) {
      await tx.appointment.updateMany({
        where: {
          id: stop.appointmentId,
          organizationId: ctx.organization.id,
          assignedEmployeeId: input.employeeId,
          isFlexible: true,
          deletedAt: null,
        },
        data: {
          startAt: new Date(stop.serviceStartAt),
          endAt: new Date(stop.serviceEndAt),
        },
      });
    }

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
          rescheduledFlexibleAppointmentIds: rescheduledFlexibleStops.map(
            (stop) => stop.appointmentId,
          ),
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
  const isOwn = ctx.employee?.id === employeeId;
  if (!hasPermission(ctx, 'routes.manage') && !isOwn) throw new AppError('ACCESS_DENIED');
  const date = fromDateInputValue(dateInput);
  if (!date) throw new AppError('VALIDATION_FAILED');
  assertNotPastPlanningDay(date, ctx.organization.timezone);
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
