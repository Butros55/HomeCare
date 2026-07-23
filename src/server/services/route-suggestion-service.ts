import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { addDays } from 'date-fns';

import {
  calendarDayInZone,
  dayPeriodInZone,
  fromDateInputValue,
  isoWeekdayInZone,
  minutesOfDayInZone,
  zonedWallTimeToUtc,
  type Period,
} from '@/lib/dates';
import { haversineMeters } from '@/lib/geo';
import { validateManagerPoolAllocation, validateOrgPoolAllocation } from '@/lib/hours';
import type { Matrix, RouteStopInput } from '@/lib/route-optimizer';
import {
  candidateWindows,
  computeOpenBudgetMinutes,
  evaluateCandidate,
  intersectWindows,
  isReservingStatus,
  MIN_SUGGESTION_MINUTES,
  planRouteWithAutoDeparture,
  sliceMatrix,
  slotsToWindows,
  suggestionDurationMinutes,
  type MinuteWindow,
  type PlannedRoute,
  minutesToTime,
} from '@/lib/route-suggestions';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  assertSameOrg,
  employeeScopeFilter,
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
  scopeContains,
  type OrgContext,
} from '@/server/permissions';
import {
  isOllamaConfigured,
  rankSuggestionsWithOllama,
  type OllamaCandidateMetrics,
} from '@/server/providers/ollama';
import { computeRouteMatrixCached } from '@/server/providers/routing';
import { ensureMaterializedUntil } from '@/server/services/appointment-service';
import { createNotification } from '@/server/services/notification-service';
import {
  ORIGIN_LABELS,
  resolveRouteOrigin,
  type GpsCoordinate,
  type RouteOriginType,
} from '@/server/services/route-service';

/**
 * Intelligente Terminvorschläge für die Tages- und Teamroutenplanung.
 *
 * Ablauf je Mitarbeiter:
 *  1. Offener Bedarf: Kunden mit Budgetrest am Planungstag (Serien werden
 *     vorher bis zum Budgetende materialisiert), noch ohne Termin an dem Tag.
 *  2. Harte Filter: Wunschmitarbeiter, Verfügbarkeiten (Kunde ∩ Mitarbeiter),
 *     Abwesenheiten, Tageshöchstarbeitszeit, Mindestdauer 15 Minuten.
 *  3. Geografischer Vorfilter, dann Bewertung mit echten Fahrzeitmatrizen:
 *     Kandidat wird im 15-Minuten-Raster in die Route eingesetzt; nur
 *     vollständig zulässige Zeitpläne werden Vorschläge.
 *  4. Deterministische Rangfolge; optional priorisiert Ollama und liefert
 *     Begründungen (niemals Entscheidungen über Machbarkeit).
 *
 * Annahme (acceptRouteSuggestion) vertraut weder Client- noch KI-Daten:
 * signiertes Token + vollständige Re-Validierung in einer serialisierbaren
 * Transaktion; Stunden-Zuweisung, PLANNED-Termin und Routenentwurf werden
 * gemeinsam gespeichert.
 */

// ---------------------------------------------------------------------------
// Signierte Annahme-Tokens
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 15 * 60 * 1000;

export interface SuggestionTokenPayload {
  v: 1;
  org: string;
  emp: string;
  cust: string;
  budget: string;
  date: string; // YYYY-MM-DD
  start: string; // ISO
  dur: number; // Minuten
  originType: RouteOriginType;
  oLat: number;
  oLng: number;
  oLabel: string;
  buffer: number;
  ret: boolean;
  exp: number; // Epoch ms
}

function tokenSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new AppError('INTERNAL_ERROR', { message: 'AUTH_SECRET fehlt.' });
  return secret;
}

function signPayload(encoded: string): string {
  return createHmac('sha256', tokenSecret()).update(encoded).digest('base64url');
}

export function createSuggestionToken(payload: SuggestionTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signPayload(encoded)}`;
}

export function verifySuggestionToken(token: string): SuggestionTokenPayload {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) throw new AppError('SUGGESTION_STALE');
  const expected = signPayload(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('SUGGESTION_STALE');
  }
  let payload: SuggestionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('SUGGESTION_STALE');
  }
  if (payload.v !== 1 || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    throw new AppError('SUGGESTION_STALE');
  }
  return payload;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface RouteSuggestionDto {
  token: string;
  customerId: string;
  customerName: string;
  customerColor: string;
  addressLine: string | null;
  latitude: number;
  longitude: number;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  openMinutes: number;
  needsAllocation: boolean;
  isPreferredEmployee: boolean;
  position: number;
  insertAfterLabel: string | null;
  reason: string;
  aiRanked: boolean;
  impact: {
    extraTravelSeconds: number;
    extraDistanceMeters: number;
    extraWaitSeconds: number;
    workdayDeltaSeconds: number;
    departureAt: string;
    returnAt: string | null;
    previousDepartureAt: string | null;
    previousReturnAt: string | null;
  };
}

export interface EmployeeSuggestionPanel {
  employeeId: string;
  employeeName: string;
  status: 'ok' | 'absent' | 'no-origin' | 'error';
  statusMessage: string | null;
  originType: RouteOriginType;
  originLabel: string | null;
  /** Arbeitsfenster des Tages (Anzeige, z. B. "08:00–12:00"). */
  workWindows: string[];
  absenceNote: string | null;
  baseRoute: {
    departureAt: string;
    returnAt: string | null;
    totalTravelSeconds: number;
    totalWaitSeconds: number;
    totalServiceMinutes: number;
    stopCount: number;
  } | null;
  suggestions: RouteSuggestionDto[];
}

export interface GenerateSuggestionsResult {
  aiUsed: boolean;
  employees: EmployeeSuggestionPanel[];
  canAccept: boolean;
}

// ---------------------------------------------------------------------------
// Offener Bedarf (organisationsweit je Planungstag)
// ---------------------------------------------------------------------------

interface DemandCandidate {
  customerId: string;
  customerName: string;
  customerColor: string;
  preferredEmployeeId: string | null;
  defaultDurationMinutes: number;
  availabilitySlots: { weekday: number; startTime: string; endTime: string }[];
  addressId: string;
  addressLine: string;
  latitude: number;
  longitude: number;
  budgetId: string;
  budgetPeriod: Period;
  openMinutes: number;
}

async function loadOpenDemand(ctx: OrgContext, date: Date): Promise<DemandCandidate[]> {
  const timezone = ctx.organization.timezone;
  const day = dayPeriodInZone(date, timezone);
  const weekday = isoWeekdayInZone(day.start, timezone);

  const budgets = await db.customerHourBudget.findMany({
    where: {
      organizationId: ctx.organization.id,
      periodStart: { lt: day.end },
      periodEnd: { gte: day.start },
      customer: { status: 'ACTIVE', deletedAt: null },
    },
    include: {
      adjustments: true,
      customer: {
        include: {
          addresses: { take: 1, orderBy: { label: 'asc' } },
          availabilities: true,
        },
      },
    },
    orderBy: { periodEnd: 'asc' },
  });
  if (budgets.length === 0) return [];

  // Serien bis zum spätesten relevanten Budgetende materialisieren, damit
  // bereits geplante Serieneinsätze nicht als „fehlend" vorgeschlagen werden.
  const maxPeriodEnd = budgets.reduce(
    (max, b) => (b.periodEnd > max ? b.periodEnd : max),
    budgets[0]!.periodEnd,
  );
  await ensureMaterializedUntil(ctx.organization.id, addDays(maxPeriodEnd, 1));

  const customerIds = [...new Set(budgets.map((b) => b.customerId))];
  const minStart = budgets.reduce(
    (min, b) => (b.periodStart < min ? b.periodStart : min),
    budgets[0]!.periodStart,
  );

  const appointments = await db.appointment.findMany({
    where: {
      customerId: { in: customerIds },
      deletedAt: null,
      OR: [
        { startAt: { gte: minStart, lt: addDays(maxPeriodEnd, 1) } },
        { customerHourBudgetId: { not: null } },
      ],
    },
    select: {
      customerId: true,
      customerHourBudgetId: true,
      durationMinutes: true,
      startAt: true,
      status: true,
    },
  });

  // Reservierte Minuten je Budget: explizite Budget-Verknüpfung gewinnt,
  // sonst zählt der Termin über sein Datum in den (frühesten) passenden Zeitraum.
  const reservedByBudget = new Map<string, number>();
  const budgetsByCustomer = new Map<string, typeof budgets>();
  for (const budget of budgets) {
    const list = budgetsByCustomer.get(budget.customerId) ?? [];
    list.push(budget);
    budgetsByCustomer.set(budget.customerId, list);
  }
  const customersWithDayAppointment = new Set<string>();
  for (const appointment of appointments) {
    if (!isReservingStatus(appointment.status)) continue;
    if (appointment.startAt >= day.start && appointment.startAt < day.end) {
      customersWithDayAppointment.add(appointment.customerId);
    }
    if (appointment.customerHourBudgetId) {
      reservedByBudget.set(
        appointment.customerHourBudgetId,
        (reservedByBudget.get(appointment.customerHourBudgetId) ?? 0) + appointment.durationMinutes,
      );
      continue;
    }
    const target = (budgetsByCustomer.get(appointment.customerId) ?? []).find(
      (budget) =>
        appointment.startAt >= budget.periodStart &&
        appointment.startAt < addDays(budget.periodEnd, 1),
    );
    if (target) {
      reservedByBudget.set(
        target.id,
        (reservedByBudget.get(target.id) ?? 0) + appointment.durationMinutes,
      );
    }
  }

  const result: DemandCandidate[] = [];
  const seenCustomer = new Set<string>();
  for (const budget of budgets) {
    if (seenCustomer.has(budget.customerId)) continue;
    // Höchstens ein neuer Vorschlag pro Kunde und Tag – Kunden mit
    // bestehendem Termin am Planungstag werden nicht erneut vorgeschlagen.
    if (customersWithDayAppointment.has(budget.customerId)) {
      seenCustomer.add(budget.customerId);
      continue;
    }
    const corrected =
      budget.budgetMinutes + budget.adjustments.reduce((sum, a) => sum + a.adjustmentMinutes, 0);
    const open = computeOpenBudgetMinutes(corrected, reservedByBudget.get(budget.id) ?? 0);
    if (open < MIN_SUGGESTION_MINUTES) continue;

    const address = budget.customer.addresses[0];
    if (!address || address.latitude == null || address.longitude == null) {
      seenCustomer.add(budget.customerId);
      continue;
    }

    seenCustomer.add(budget.customerId);
    result.push({
      customerId: budget.customerId,
      customerName: `${budget.customer.firstName} ${budget.customer.lastName}`,
      customerColor: budget.customer.color,
      preferredEmployeeId: budget.customer.preferredEmployeeId,
      defaultDurationMinutes: budget.customer.defaultAppointmentDurationMinutes,
      availabilitySlots: budget.customer.availabilities
        .filter((slot) => slot.weekday === weekday)
        .map((slot) => ({ weekday: slot.weekday, startTime: slot.startTime, endTime: slot.endTime })),
      // Kunden MIT Verfügbarkeiten, aber ohne Fenster am Wochentag → nicht verfügbar.
      addressId: address.id,
      addressLine: `${address.street} ${address.houseNumber}, ${address.postalCode} ${address.city}`,
      latitude: address.latitude,
      longitude: address.longitude,
      budgetId: budget.id,
      budgetPeriod: { start: budget.periodStart, end: addDays(budget.periodEnd, 1) },
      openMinutes: open,
    });
  }
  return result;
}

/** Hat der Kunde überhaupt Verfügbarkeiten gepflegt (irgendein Wochentag)? */
async function loadCustomersWithAnyAvailability(customerIds: string[]): Promise<Set<string>> {
  if (customerIds.length === 0) return new Set();
  const rows = await db.customerAvailability.findMany({
    where: { customerId: { in: customerIds } },
    select: { customerId: true },
    distinct: ['customerId'],
  });
  return new Set(rows.map((r) => r.customerId));
}

// ---------------------------------------------------------------------------
// Vorschlagsgenerierung
// ---------------------------------------------------------------------------

const MAX_CANDIDATES_PER_EMPLOYEE = 12;
const MAX_SUGGESTIONS_PER_EMPLOYEE = 5;

/**
 * Suchbereich für Vorschläge, wenn WEDER Kunde noch Mitarbeiter Zeitfenster
 * gepflegt haben: „alle Zeiten möglich" bleibt fachlich wahr, aber neue
 * Einsätze werden nur zu üblichen Arbeitszeiten vorgeschlagen. Explizit
 * gepflegte Fenster (z. B. Abendstunden) werden nicht beschnitten.
 */
const DEFAULT_PLANNING_WINDOW: MinuteWindow = { startMinute: 6 * 60, endMinute: 22 * 60 };

export interface GenerateSuggestionsInput {
  date: string;
  scope: 'self' | 'team';
  bufferMinutes: number;
  returnToStart: boolean;
  /** Nur scope 'self': gewählter Startpunkt (+ GPS-Koordinate). */
  originType?: RouteOriginType;
  gps?: GpsCoordinate;
  /** Nur scope 'self': Basisroute = aktuell ausgewählte Termine (Standard: alle zugewiesenen). */
  appointmentIds?: string[];
}

interface EmployeeContext {
  id: string;
  name: string;
  userId: string | null;
  maximumMinutesPerDay: number | null;
  startLocation: unknown;
}

export async function generateRouteSuggestions(
  input: GenerateSuggestionsInput,
): Promise<GenerateSuggestionsResult> {
  const ctx = await requireOrganizationMembership();
  const date = fromDateInputValue(input.date);
  if (!date) throw new AppError('VALIDATION_FAILED', { message: 'Ungültiges Datum.' });

  const isLeadership = ctx.membership.role !== 'EMPLOYEE';

  let employees: EmployeeContext[];
  if (input.scope === 'team') {
    if (!hasPermission(ctx, 'routes.manage') || !isLeadership) {
      throw new AppError('ACCESS_DENIED');
    }
    const scope = await getManagedEmployeeIds(ctx);
    const rows = await db.employee.findMany({
      where: {
        organizationId: ctx.organization.id,
        deletedAt: null,
        status: 'ACTIVE',
        ...employeeScopeFilter(scope),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        userId: true,
        maximumMinutesPerDay: true,
        startLocation: true,
      },
      orderBy: [{ lastName: 'asc' }],
    });
    employees = rows.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      userId: e.userId,
      maximumMinutesPerDay: e.maximumMinutesPerDay,
      startLocation: e.startLocation,
    }));
  } else {
    if (!ctx.employee) {
      throw new AppError('EMPLOYEE_NOT_FOUND', {
        message: 'Für dieses Konto existiert kein Mitarbeiterprofil.',
      });
    }
    employees = [
      {
        id: ctx.employee.id,
        name: `${ctx.employee.firstName} ${ctx.employee.lastName}`,
        userId: ctx.employee.userId,
        maximumMinutesPerDay: ctx.employee.maximumMinutesPerDay,
        startLocation: ctx.employee.startLocation,
      },
    ];
  }

  const demand = await loadOpenDemand(ctx, date);
  const customersWithAvailability = await loadCustomersWithAnyAvailability(
    demand.map((d) => d.customerId),
  );

  const panels = await Promise.all(
    employees.map((employee) =>
      buildEmployeePanel({
        ctx,
        employee,
        date,
        input,
        demand,
        customersWithAvailability,
      }).catch((error): EmployeePanelInternal => {
        console.error(`[route-suggestions] Mitarbeiter ${employee.id} fehlgeschlagen:`, error);
        return {
          panel: {
            employeeId: employee.id,
            employeeName: employee.name,
            status: 'error',
            statusMessage:
              error instanceof AppError ? error.message : 'Unerwarteter Fehler bei der Berechnung.',
            originType: 'office',
            originLabel: null,
            workWindows: [],
            absenceNote: null,
            baseRoute: null,
            suggestions: [],
          },
          evaluations: [],
        };
      }),
    ),
  );

  // Teamlauf: derselbe Kundenbedarf darf nur bei einem Mitarbeiter erscheinen –
  // der Kunde geht an den Mitarbeiter mit dem besten Vergleichswert.
  if (input.scope === 'team') {
    const bestByCustomer = new Map<string, { employeeId: string; score: number }>();
    for (const entry of panels) {
      for (const evaluation of entry.evaluations) {
        const current = bestByCustomer.get(evaluation.customerId);
        if (!current || evaluation.rankScore < current.score) {
          bestByCustomer.set(evaluation.customerId, {
            employeeId: entry.panel.employeeId,
            score: evaluation.rankScore,
          });
        }
      }
    }
    for (const entry of panels) {
      entry.evaluations = entry.evaluations.filter(
        (evaluation) =>
          bestByCustomer.get(evaluation.customerId)?.employeeId === entry.panel.employeeId,
      );
    }
  }

  // Endauswahl je Mitarbeiter + optionale KI-Priorisierung.
  let aiUsed = false;
  await Promise.all(
    panels.map(async (entry) => {
      const top = entry.evaluations
        .sort((a, b) => a.rankScore - b.rankScore)
        .slice(0, MAX_SUGGESTIONS_PER_EMPLOYEE);
      if (top.length === 0) return;

      let ordered = top;
      let reasons = new Map<string, string>();
      if (isOllamaConfigured()) {
        const metrics: OllamaCandidateMetrics[] = top.map((evaluation, index) => ({
          key: `K${index + 1}`,
          extraTravelMinutes: Math.round(evaluation.dto.impact.extraTravelSeconds / 60),
          extraDistanceKm:
            Math.round((evaluation.dto.impact.extraDistanceMeters / 1000) * 10) / 10,
          extraWaitMinutes: Math.round(evaluation.dto.impact.extraWaitSeconds / 60),
          workdayDeltaMinutes: Math.round(evaluation.dto.impact.workdayDeltaSeconds / 60),
          durationMinutes: evaluation.dto.durationMinutes,
          openHours: Math.round((evaluation.dto.openMinutes / 60) * 10) / 10,
          startTime: minutesToTime(evaluation.startMinute),
          hasExistingAllocation: !evaluation.dto.needsAllocation,
          isPreferredEmployee: evaluation.dto.isPreferredEmployee,
        }));
        const ranking = await rankSuggestionsWithOllama(metrics);
        if (ranking) {
          aiUsed = true;
          const byKey = new Map(top.map((evaluation, index) => [`K${index + 1}`, evaluation]));
          const rankedEntries = [...ranking].sort((a, b) => a.priority - b.priority);
          const ranked = rankedEntries
            .map((r) => byKey.get(r.key))
            .filter((v): v is (typeof top)[number] => Boolean(v));
          const missing = top.filter((evaluation) => !ranked.includes(evaluation));
          ordered = [...ranked, ...missing];
          reasons = new Map(
            rankedEntries.map((r) => [byKey.get(r.key)?.customerId ?? '', r.reason]),
          );
        }
      }

      entry.panel.suggestions = ordered.map((evaluation) => ({
        ...evaluation.dto,
        reason: reasons.get(evaluation.customerId) ?? evaluation.dto.reason,
        aiRanked: reasons.has(evaluation.customerId),
      }));
    }),
  );

  return {
    aiUsed,
    canAccept: isLeadership,
    employees: panels.map((entry) => entry.panel),
  };
}

interface CandidateEvaluationInternal {
  customerId: string;
  startMinute: number;
  /** Sortierwert: Zuweisung/Wunschmitarbeiter vor geringer Mehrfahrt. */
  rankScore: number;
  dto: RouteSuggestionDto;
}

interface EmployeePanelInternal {
  panel: EmployeeSuggestionPanel;
  evaluations: CandidateEvaluationInternal[];
}

async function buildEmployeePanel(args: {
  ctx: OrgContext;
  employee: EmployeeContext;
  date: Date;
  input: GenerateSuggestionsInput;
  demand: DemandCandidate[];
  customersWithAvailability: Set<string>;
}): Promise<EmployeePanelInternal> {
  const { ctx, employee, date, input, demand } = args;
  const timezone = ctx.organization.timezone;
  const day = dayPeriodInZone(date, timezone);
  const weekday = isoWeekdayInZone(day.start, timezone);
  const dayParts = calendarDayInZone(day.start, timezone);

  // ---- Startpunkt --------------------------------------------------------
  let originType: RouteOriginType;
  let origin: { latitude: number; longitude: number; label: string };
  const employeeRecord = { id: employee.id, startLocation: employee.startLocation } as Parameters<
    typeof resolveRouteOrigin
  >[1];
  if (input.scope === 'self') {
    originType = input.originType ?? 'office';
    origin = resolveRouteOrigin(ctx, employeeRecord, originType, input.gps);
  } else {
    // Teamplanung: Zuhause, ersatzweise (sichtbar) das Büro. GPS gibt es hier nicht.
    try {
      origin = resolveRouteOrigin(ctx, employeeRecord, 'home');
      originType = 'home';
    } catch {
      origin = resolveRouteOrigin(ctx, employeeRecord, 'office');
      originType = 'office';
    }
  }

  // ---- Tagesdaten des Mitarbeiters ---------------------------------------
  const [dayAppointments, absences, availabilityRows] = await Promise.all([
    db.appointment.findMany({
      where: {
        organizationId: ctx.organization.id,
        deletedAt: null,
        assignedEmployeeId: employee.id,
        startAt: { gte: day.start, lt: day.end },
        status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
      },
      include: {
        locationAddress: true,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startAt: 'asc' },
    }),
    db.employeeAbsence.findMany({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        startAt: { lt: day.end },
        endAt: { gt: day.start },
      },
      select: { startAt: true, endAt: true, type: true },
    }),
    db.employeeAvailability.findMany({
      where: {
        employeeId: employee.id,
        weekday,
        validFrom: { lt: day.end },
        OR: [{ validUntil: null }, { validUntil: { gte: day.start } }],
      },
      select: { weekday: true, startTime: true, endTime: true },
    }),
  ]);

  const employeeWindows =
    availabilityRows.length > 0
      ? slotsToWindows(availabilityRows)
      : [];
  const workWindows =
    employeeWindows.length > 0
      ? employeeWindows.map(
          (w) => `${minutesToTime(w.startMinute)}–${minutesToTime(w.endMinute)}`,
        )
      : ['ganztägig'];

  // Abwesenheiten als blockierte Minutenfenster des Tages.
  const blockedWindows: MinuteWindow[] = absences.map((absence) => ({
    startMinute:
      absence.startAt <= day.start ? 0 : minutesOfDayInZone(absence.startAt, timezone),
    endMinute: absence.endAt >= day.end ? 24 * 60 : minutesOfDayInZone(absence.endAt, timezone),
  }));
  const fullDayAbsent = blockedWindows.some((w) => w.startMinute <= 0 && w.endMinute >= 24 * 60);
  const absenceNote =
    absences.length > 0
      ? fullDayAbsent
        ? 'Ganztägig abwesend (genehmigt)'
        : 'Teilweise abwesend (genehmigt)'
      : null;

  // ---- Basisroute --------------------------------------------------------
  const routableAppointments = dayAppointments.filter(
    (a) =>
      a.routeRelevant &&
      a.status !== 'DRAFT' &&
      a.locationAddress?.latitude != null &&
      a.locationAddress?.longitude != null,
  );
  const selectedIds =
    input.scope === 'self' && input.appointmentIds
      ? new Set(input.appointmentIds)
      : null;
  const baseAppointments = selectedIds
    ? routableAppointments.filter((a) => selectedIds.has(a.id))
    : routableAppointments;

  const baseStops: RouteStopInput[] = baseAppointments.map((appointment) => ({
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

  const timeFormatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  const formatTime = (value: Date) => timeFormatter.format(value);

  // ---- Kandidaten vorfiltern ---------------------------------------------
  const baseServiceMinutes = dayAppointments.reduce((sum, a) => sum + a.durationMinutes, 0);

  const candidates = fullDayAbsent
    ? []
    : demand
        .filter((candidate) => {
          // Wunschmitarbeiter ist verbindlich.
          if (candidate.preferredEmployeeId && candidate.preferredEmployeeId !== employee.id) {
            return false;
          }
          // Kunde hat Verfügbarkeiten gepflegt, aber keine am Wochentag → raus.
          if (
            args.customersWithAvailability.has(candidate.customerId) &&
            candidate.availabilitySlots.length === 0
          ) {
            return false;
          }
          return true;
        })
        .map((candidate) => {
          const rawWindows = candidateWindows({
            customerSlots: candidate.availabilitySlots,
            employeeSlots: availabilityRows,
            blockedWindows,
          });
          const unconstrained =
            candidate.availabilitySlots.length === 0 && availabilityRows.length === 0;
          const windows = unconstrained
            ? intersectWindows(rawWindows, [DEFAULT_PLANNING_WINDOW])
            : rawWindows;
          const duration = suggestionDurationMinutes({
            defaultDurationMinutes: candidate.defaultDurationMinutes,
            openMinutes: candidate.openMinutes,
            windows,
          });
          return { candidate, windows, duration };
        })
        .filter((entry): entry is typeof entry & { duration: number } => {
          if (entry.duration === null) return false;
          // Tageshöchstarbeitszeit (harte Regel).
          if (
            employee.maximumMinutesPerDay &&
            baseServiceMinutes + entry.duration > employee.maximumMinutesPerDay
          ) {
            return false;
          }
          return true;
        });

  // Geografischer Vorfilter: nächste Kandidaten zu Route/Startpunkt zuerst.
  const referencePoints = [
    { latitude: origin.latitude, longitude: origin.longitude },
    ...baseStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
  ];
  const prefiltered = candidates
    .map((entry) => ({
      ...entry,
      distance: Math.min(
        ...referencePoints.map((point) =>
          haversineMeters(point, {
            latitude: entry.candidate.latitude,
            longitude: entry.candidate.longitude,
          }),
        ),
      ),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_CANDIDATES_PER_EMPLOYEE);

  // ---- Matrix (ein Aufruf je Mitarbeiter) --------------------------------
  const allPoints = [
    { latitude: origin.latitude, longitude: origin.longitude },
    ...baseStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    ...prefiltered.map((entry) => ({
      latitude: entry.candidate.latitude,
      longitude: entry.candidate.longitude,
    })),
    { latitude: origin.latitude, longitude: origin.longitude },
  ];
  const legs = await computeRouteMatrixCached(allPoints);
  const fullMatrix: Matrix = {
    travelSeconds: legs.map((row) => row.map((leg) => leg.travelSeconds)),
    distanceMeters: legs.map((row) => row.map((leg) => leg.distanceMeters)),
  };
  const startIndex = 0;
  const baseIndices = baseStops.map((_, i) => 1 + i);
  const endIndex = allPoints.length - 1;

  const baseMatrix = sliceMatrix(fullMatrix, [startIndex, ...baseIndices, endIndex]);
  const baseRoute: PlannedRoute = planRouteWithAutoDeparture({
    stops: baseStops,
    matrix: baseMatrix,
    bufferMinutes: input.bufferMinutes,
    returnToEnd: input.returnToStart,
    earliestDepartureAt: day.start,
    formatTime,
  });

  // ---- Zuweisungen des Mitarbeiters (für Priorisierung) ------------------
  const allocations = await db.hourAllocation.findMany({
    where: {
      organizationId: ctx.organization.id,
      allocatedToEmployeeId: employee.id,
      status: 'ACTIVE',
      customerId: { in: prefiltered.map((entry) => entry.candidate.customerId) },
      validFrom: { lt: day.end },
      validUntil: { gte: day.start },
    },
    select: { customerId: true },
  });
  const allocatedCustomerIds = new Set(allocations.map((a) => a.customerId));

  // ---- Kandidaten bewerten ------------------------------------------------
  const stopNames = new Map(
    baseAppointments.map((a) => [
      a.id,
      `${a.customer.firstName} ${a.customer.lastName}`,
    ]),
  );
  const evaluations: CandidateEvaluationInternal[] = [];
  for (let i = 0; i < prefiltered.length; i += 1) {
    const entry = prefiltered[i]!;
    const candidateMatrix = sliceMatrix(fullMatrix, [
      startIndex,
      ...baseIndices,
      1 + baseStops.length + i,
      endIndex,
    ]);
    const evaluation = evaluateCandidate({
      baseStops,
      baseRoute,
      candidate: {
        id: `candidate:${entry.candidate.customerId}`,
        serviceMinutes: entry.duration,
        windows: entry.windows,
      },
      matrix: candidateMatrix,
      bufferMinutes: input.bufferMinutes,
      returnToEnd: input.returnToStart,
      earliestDepartureAt: day.start,
      minuteToUtc: (minute) =>
        zonedWallTimeToUtc(dayParts.year, dayParts.month, dayParts.day, minutesToTime(minute), timezone),
      formatTime,
    });
    if (!evaluation.feasible || !evaluation.impact || !evaluation.startAt || !evaluation.endAt) {
      continue;
    }

    const hasAllocation = allocatedCustomerIds.has(entry.candidate.customerId);
    const isPreferred = entry.candidate.preferredEmployeeId === employee.id;
    // Priorität: Machbarkeit (gegeben) → Zuweisung/Wunschmitarbeiter → geringe Mehrkosten.
    const rankScore = evaluation.score - (hasAllocation ? 100_000 : 0) - (isPreferred ? 50_000 : 0);

    const startMinute = minutesOfDayInZone(evaluation.startAt, timezone);
    const insertAfterLabel = evaluation.insertAfterStopId
      ? (stopNames.get(evaluation.insertAfterStopId) ?? null)
      : null;

    const token = createSuggestionToken({
      v: 1,
      org: ctx.organization.id,
      emp: employee.id,
      cust: entry.candidate.customerId,
      budget: entry.candidate.budgetId,
      date: input.date,
      start: evaluation.startAt.toISOString(),
      dur: entry.duration,
      originType,
      oLat: origin.latitude,
      oLng: origin.longitude,
      oLabel: origin.label,
      buffer: input.bufferMinutes,
      ret: input.returnToStart,
      exp: Date.now() + TOKEN_TTL_MS,
    });

    const extraTravelMinutes = Math.round(evaluation.impact.extraTravelSeconds / 60);
    const reasonParts: string[] = [];
    if (isPreferred) reasonParts.push('Wunschmitarbeiter des Kunden');
    if (hasAllocation) reasonParts.push('Stunden bereits zugewiesen');
    reasonParts.push(
      extraTravelMinutes <= 5
        ? 'kaum Mehrfahrt'
        : `+${extraTravelMinutes} Min. Fahrzeit`,
    );
    if (evaluation.position) {
      reasonParts.push(
        insertAfterLabel ? `passt nach ${insertAfterLabel}` : 'passt als erster Stopp',
      );
    }

    evaluations.push({
      customerId: entry.candidate.customerId,
      startMinute,
      rankScore,
      dto: {
        token,
        customerId: entry.candidate.customerId,
        customerName: entry.candidate.customerName,
        customerColor: entry.candidate.customerColor,
        addressLine: entry.candidate.addressLine,
        latitude: entry.candidate.latitude,
        longitude: entry.candidate.longitude,
        startAt: evaluation.startAt.toISOString(),
        endAt: evaluation.endAt.toISOString(),
        durationMinutes: entry.duration,
        openMinutes: entry.candidate.openMinutes,
        needsAllocation: !hasAllocation,
        isPreferredEmployee: isPreferred,
        position: evaluation.position ?? 0,
        insertAfterLabel,
        reason: reasonParts.join(' · '),
        aiRanked: false,
        impact: {
          extraTravelSeconds: evaluation.impact.extraTravelSeconds,
          extraDistanceMeters: evaluation.impact.extraDistanceMeters,
          extraWaitSeconds: evaluation.impact.extraWaitSeconds,
          workdayDeltaSeconds: evaluation.impact.workdayDeltaSeconds,
          departureAt: evaluation.impact.departureAt.toISOString(),
          returnAt: evaluation.impact.returnAt?.toISOString() ?? null,
          previousDepartureAt: evaluation.impact.previousDepartureAt?.toISOString() ?? null,
          previousReturnAt: evaluation.impact.previousReturnAt?.toISOString() ?? null,
        },
      },
    });
  }

  return {
    panel: {
      employeeId: employee.id,
      employeeName: employee.name,
      status: fullDayAbsent ? 'absent' : 'ok',
      statusMessage: fullDayAbsent
        ? 'Für diesen Tag ist eine ganztägige Abwesenheit eingetragen – keine Vorschläge.'
        : null,
      originType,
      originLabel: origin.label ?? ORIGIN_LABELS[originType],
      workWindows,
      absenceNote,
      baseRoute:
        baseStops.length > 0
          ? {
              departureAt: baseRoute.latestDepartureAt.toISOString(),
              returnAt: baseRoute.returnArrivalAt?.toISOString() ?? null,
              totalTravelSeconds: baseRoute.totalTravelSeconds,
              totalWaitSeconds: baseRoute.totalWaitSeconds,
              totalServiceMinutes: baseRoute.totalServiceMinutes,
              stopCount: baseRoute.stops.length,
            }
          : null,
      suggestions: [],
    },
    evaluations,
  };
}

// ---------------------------------------------------------------------------
// Vorschlag annehmen
// ---------------------------------------------------------------------------

export interface AcceptSuggestionResult {
  appointmentId: string;
  routePlanId: string;
  allocationCreated: boolean;
}

export async function acceptRouteSuggestion(token: string): Promise<AcceptSuggestionResult> {
  const ctx = await requireOrganizationMembership();
  const payload = verifySuggestionToken(token);

  if (payload.org !== ctx.organization.id) throw new AppError('SUGGESTION_STALE');
  // Normale Mitarbeiter dürfen Vorschläge ansehen, aber nicht übernehmen.
  if (ctx.membership.role === 'EMPLOYEE') {
    throw new AppError('ACCESS_DENIED', {
      message: 'Terminvorschläge kann nur die Leitung übernehmen.',
    });
  }
  const scope = await getManagedEmployeeIds(ctx);
  if (!scopeContains(scope, payload.emp)) {
    throw new AppError('ACCESS_DENIED', {
      message: 'Der Mitarbeiter liegt außerhalb deines Verwaltungsbereichs.',
    });
  }

  const date = fromDateInputValue(payload.date);
  if (!date) throw new AppError('SUGGESTION_STALE');
  const timezone = ctx.organization.timezone;
  const day = dayPeriodInZone(date, timezone);
  const weekday = isoWeekdayInZone(day.start, timezone);
  const startAt = new Date(payload.start);
  const endAt = new Date(startAt.getTime() + payload.dur * 60_000);
  if (Number.isNaN(startAt.getTime()) || startAt < day.start || endAt > day.end) {
    throw new AppError('SUGGESTION_STALE');
  }

  // ---- Stammdaten (Scope-Prüfung vor der Transaktion) ---------------------
  const [employee, customer, budget] = await Promise.all([
    db.employee.findUnique({ where: { id: payload.emp } }),
    db.customer.findUnique({
      where: { id: payload.cust },
      include: { addresses: { take: 1, orderBy: { label: 'asc' } }, availabilities: true },
    }),
    db.customerHourBudget.findUnique({ where: { id: payload.budget }, include: { adjustments: true } }),
  ]);
  assertSameOrg(ctx, employee);
  assertSameOrg(ctx, customer);
  assertSameOrg(ctx, budget);
  if (employee.status !== 'ACTIVE' || employee.deletedAt) throw new AppError('SUGGESTION_STALE');
  if (customer.status !== 'ACTIVE' || customer.deletedAt) throw new AppError('SUGGESTION_STALE');
  if (budget.customerId !== customer.id) throw new AppError('SUGGESTION_STALE');

  const address = customer.addresses[0];
  if (!address || address.latitude == null || address.longitude == null) {
    throw new AppError('SUGGESTION_STALE');
  }

  // ---- Routenentwurf vorbereiten (Matrix-Aufrufe vor der Transaktion) -----
  const baseAppointments = await db.appointment.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      assignedEmployeeId: payload.emp,
      routeRelevant: true,
      status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
      startAt: { gte: day.start, lt: day.end },
    },
    include: { locationAddress: true },
    orderBy: { startAt: 'asc' },
  });
  const routable = baseAppointments.filter(
    (a) => a.locationAddress?.latitude != null && a.locationAddress?.longitude != null,
  );
  const baseStops: RouteStopInput[] = routable.map((appointment) => ({
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

  const NEW_STOP_ID = 'candidate:new';
  const points = [
    { latitude: payload.oLat, longitude: payload.oLng },
    ...baseStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    { latitude: address.latitude, longitude: address.longitude },
    { latitude: payload.oLat, longitude: payload.oLng },
  ];
  const legs = await computeRouteMatrixCached(points);
  const matrix: Matrix = {
    travelSeconds: legs.map((row) => row.map((leg) => leg.travelSeconds)),
    distanceMeters: legs.map((row) => row.map((leg) => leg.distanceMeters)),
  };
  const timeFormatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  const planned = planRouteWithAutoDeparture({
    stops: [
      ...baseStops,
      {
        id: NEW_STOP_ID,
        latitude: address.latitude,
        longitude: address.longitude,
        serviceMinutes: payload.dur,
        fixedStartAt: startAt,
      },
    ],
    matrix,
    bufferMinutes: payload.buffer,
    returnToEnd: payload.ret,
    earliestDepartureAt: day.start,
    formatTime: (value) => timeFormatter.format(value),
  });
  if (!planned.feasible) {
    throw new AppError('SUGGESTION_STALE', {
      message: 'Die Route ist mit dem Vorschlag nicht mehr zulässig – bitte neu generieren.',
    });
  }

  // ---- Serialisierbare Transaktion: prüfen + schreiben --------------------
  const result = await db.$transaction(
    async (tx) => {
      // 1) Terminkollision (alle reservierenden Termine des Mitarbeiters).
      const overlapping = await tx.appointment.findFirst({
        where: {
          organizationId: ctx.organization.id,
          deletedAt: null,
          assignedEmployeeId: payload.emp,
          status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { id: true },
      });
      if (overlapping) throw new AppError('SUGGESTION_STALE');

      // 2) Kunde hat inzwischen einen Termin am Planungstag.
      const customerDayAppointment = await tx.appointment.findFirst({
        where: {
          customerId: customer.id,
          deletedAt: null,
          status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
          startAt: { gte: day.start, lt: day.end },
        },
        select: { id: true },
      });
      if (customerDayAppointment) throw new AppError('SUGGESTION_STALE');

      // 3) Abwesenheit.
      const absence = await tx.employeeAbsence.findFirst({
        where: {
          employeeId: payload.emp,
          status: 'APPROVED',
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { id: true },
      });
      if (absence) throw new AppError('SUGGESTION_STALE');

      // 4) Verfügbarkeiten (Mitarbeiter + Kunde) am Termin.
      const availability = await tx.employeeAvailability.findMany({
        where: {
          employeeId: payload.emp,
          weekday,
          validFrom: { lt: day.end },
          OR: [{ validUntil: null }, { validUntil: { gte: day.start } }],
        },
        select: { startTime: true, endTime: true },
      });
      const startMinute = minutesOfDayInZone(startAt, timezone);
      const endMinute = startMinute + payload.dur;
      const withinWindows = (slots: { startTime: string; endTime: string }[]): boolean => {
        if (slots.length === 0) return true;
        return slotsToWindows(slots).some(
          (w) => startMinute >= w.startMinute && endMinute <= w.endMinute,
        );
      };
      if (!withinWindows(availability)) throw new AppError('SUGGESTION_STALE');
      const customerSlots = customer.availabilities.filter((slot) => slot.weekday === weekday);
      if (customer.availabilities.length > 0 && !withinWindows(customerSlots)) {
        throw new AppError('SUGGESTION_STALE');
      }

      // 5) Tageshöchstarbeitszeit.
      if (employee.maximumMinutesPerDay) {
        const dayLoad = await tx.appointment.aggregate({
          where: {
            organizationId: ctx.organization.id,
            deletedAt: null,
            assignedEmployeeId: payload.emp,
            status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
            startAt: { gte: day.start, lt: day.end },
          },
          _sum: { durationMinutes: true },
        });
        const total = (dayLoad._sum.durationMinutes ?? 0) + payload.dur;
        if (total > employee.maximumMinutesPerDay) throw new AppError('SUGGESTION_STALE');
      }

      // 6) Budgetrest erneut prüfen (korrigiertes Budget minus Reservierungen).
      const corrected =
        budget.budgetMinutes +
        budget.adjustments.reduce((sum, a) => sum + a.adjustmentMinutes, 0);
      const reservedRows = await tx.appointment.findMany({
        where: {
          customerId: customer.id,
          deletedAt: null,
          status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
          OR: [
            { customerHourBudgetId: budget.id },
            {
              customerHourBudgetId: null,
              startAt: { gte: budget.periodStart, lt: addDays(budget.periodEnd, 1) },
            },
          ],
        },
        select: { durationMinutes: true },
      });
      const reserved = reservedRows.reduce((sum, a) => sum + a.durationMinutes, 0);
      if (computeOpenBudgetMinutes(corrected, reserved) < payload.dur) {
        throw new AppError('SUGGESTION_STALE', {
          message: 'Das Stundenbudget reicht für diesen Vorschlag nicht mehr aus.',
        });
      }

      // 7) Stunden-Zuweisung: vorhandene nutzen, sonst automatisch anlegen.
      const existingAllocation = await tx.hourAllocation.findFirst({
        where: {
          organizationId: ctx.organization.id,
          customerId: customer.id,
          allocatedToEmployeeId: payload.emp,
          status: 'ACTIVE',
          validFrom: { lt: day.end },
          validUntil: { gte: day.start },
        },
        select: { id: true },
      });
      let allocationCreated = false;
      if (!existingAllocation) {
        if (!employee.canReceiveHours) {
          throw new AppError('RECIPIENT_CANNOT_RECEIVE_HOURS');
        }
        const budgetAllocations = await tx.hourAllocation.findMany({
          where: { budgetId: budget.id, status: 'ACTIVE' },
          select: {
            id: true,
            budgetId: true,
            allocatedByEmployeeId: true,
            allocatedToEmployeeId: true,
            allocatedMinutes: true,
            status: true,
          },
        });
        const allocationsWithId = budgetAllocations.map((a) => ({
          ...a,
          status: a.status as 'ACTIVE' | 'REVOKED',
        }));

        let allocatedByEmployeeId: string | null = null;
        if (hasPermission(ctx, 'hours.allocateOrg')) {
          const validation = validateOrgPoolAllocation({
            budgets: [{ id: budget.id, budgetMinutes: budget.budgetMinutes }],
            adjustments: budget.adjustments.map((a) => ({
              customerHourBudgetId: a.customerHourBudgetId,
              adjustmentMinutes: a.adjustmentMinutes,
            })),
            allocations: allocationsWithId,
            requestedMinutes: payload.dur,
          });
          if (!validation.ok) {
            throw new AppError('SUGGESTION_STALE', {
              message: 'Das Budget ist inzwischen vollständig zugewiesen – bitte neu generieren.',
            });
          }
        } else if (hasPermission(ctx, 'hours.allocateOwnPool') && ctx.employee) {
          // Team-Manager geben ausschließlich aus dem eigenen Pool weiter.
          const validation = validateManagerPoolAllocation({
            allocations: allocationsWithId,
            managerEmployeeId: ctx.employee.id,
            requestedMinutes: payload.dur,
          });
          if (!validation.ok) {
            throw new AppError('ALLOCATION_POOL_EXCEEDED', {
              details: { availableMinutes: validation.availableMinutes },
            });
          }
          allocatedByEmployeeId = ctx.employee.id;
        } else {
          throw new AppError('ACCESS_DENIED', {
            message: 'Für die automatische Stundenzuweisung fehlt die Berechtigung.',
          });
        }

        await tx.hourAllocation.create({
          data: {
            organizationId: ctx.organization.id,
            customerId: customer.id,
            budgetId: budget.id,
            allocatedByEmployeeId,
            allocatedToEmployeeId: payload.emp,
            allocatedMinutes: payload.dur,
            validFrom: budget.periodStart,
            validUntil: budget.periodEnd,
            note: 'Automatisch beim Übernehmen eines Routenvorschlags',
          },
        });
        allocationCreated = true;
      }

      // 8) PLANNED-Termin mit Budget-Zuordnung anlegen.
      const appointment = await tx.appointment.create({
        data: {
          organizationId: ctx.organization.id,
          customerId: customer.id,
          assignedEmployeeId: payload.emp,
          customerHourBudgetId: budget.id,
          title: 'Einsatz (Routenvorschlag)',
          startAt,
          endAt,
          durationMinutes: payload.dur,
          status: 'PLANNED',
          assignmentStatus: 'ASSIGNED',
          locationAddressId: address.id,
          routeRelevant: true,
          internalNotes: 'Automatisch aus der Routenplanung übernommen.',
        },
      });

      // 9) Routenentwurf gemeinsam speichern (veröffentlichte Pläne werden
      //    wieder zum Entwurf und müssen bewusst erneut freigegeben werden).
      await tx.routePlan.deleteMany({ where: { employeeId: payload.emp, routeDate: date } });
      const routePlan = await tx.routePlan.create({
        data: {
          organizationId: ctx.organization.id,
          employeeId: payload.emp,
          routeDate: date,
          startAddress: { latitude: payload.oLat, longitude: payload.oLng, label: payload.oLabel },
          endAddress: { latitude: payload.oLat, longitude: payload.oLng, label: payload.oLabel },
          originType: payload.originType,
          bufferMinutes: payload.buffer,
          returnToStart: payload.ret,
          provider: 'suggestion',
          totalDistanceMeters: planned.totalDistanceMeters,
          totalTravelSeconds: planned.totalTravelSeconds,
          totalServiceMinutes: planned.totalServiceMinutes,
          totalWaitSeconds: planned.totalWaitSeconds,
          plannedDepartureAt: planned.latestDepartureAt,
          plannedReturnAt: planned.returnArrivalAt,
          status: 'DRAFT',
        },
      });
      for (const stop of planned.stops) {
        await tx.routeStop.create({
          data: {
            routePlanId: routePlan.id,
            appointmentId: stop.id === NEW_STOP_ID ? appointment.id : stop.id,
            sequence: stop.sequence,
            arrivalAt: stop.arrivalAt,
            serviceStartAt: stop.serviceStartAt,
            serviceEndAt: stop.serviceEndAt,
            departureAt: stop.serviceEndAt,
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
          action: 'route.suggestionAccepted',
          entityType: 'Appointment',
          entityId: appointment.id,
          metadata: {
            employeeId: payload.emp,
            customerId: customer.id,
            budgetId: budget.id,
            date: payload.date,
            durationMinutes: payload.dur,
            allocationCreated,
          },
        },
        tx,
      );

      return { appointmentId: appointment.id, routePlanId: routePlan.id, allocationCreated };
    },
    { isolationLevel: 'Serializable' },
  );

  // Benachrichtigung an den Mitarbeiter (außerhalb der Transaktion).
  if (employee.userId && employee.userId !== ctx.user.id) {
    const when = new Intl.DateTimeFormat('de-DE', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(startAt);
    await createNotification({
      organizationId: ctx.organization.id,
      userId: employee.userId,
      type: 'APPOINTMENT_ASSIGNED',
      title: 'Neuer Termin aus der Routenplanung',
      message: `${customer.firstName} ${customer.lastName}, ${when} (${payload.dur} Min.)`,
      targetUrl: `/routes?mitarbeiter=${payload.emp}&datum=${payload.date}`,
    });
  }

  return result;
}
