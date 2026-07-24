import 'server-only';

import { calendarDayInZone, dayPeriodInZone, fromDateInputValue, utcDate } from '@/lib/dates';
import {
  computeHourAccount,
  grantOccurrencesBetween,
  projectedGrantMinutes,
  type HourAccountSummary,
  type RecurringGrantLike,
} from '@/lib/hour-account';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { assertSameOrg, requirePermission, requireOrganizationMembership } from '@/server/permissions';

/**
 * Stundenkonto-Service: Gutschriften (einmalig/wiederkehrend/Korrektur) und
 * die Konto-Sicht je Kunde. Abzüge sind abgeleitet (abgeschlossene Termine),
 * siehe src/lib/hour-account.ts.
 *
 * Wiederkehrende Aufladungen werden lazy materialisiert: Vor jeder Konto-
 * Leseoperation werden fällige Gutschriften bis „heute" als Topup-Zeilen
 * gebucht (idempotent über UNIQUE(recurringGrantId, effectiveOn)). Änderungen
 * an einer Regel wirken dadurch nur auf zukünftige Gutschriften.
 */

/** Heutiges Kalenderdatum der Organisation als UTC-Mitternacht (Datumssemantik). */
export function todayUtcDate(timezone: string, now: Date = new Date()): Date {
  const { year, month, day } = calendarDayInZone(now, timezone);
  return utcDate(year, month, day);
}

// ---------------------------------------------------------------------------
// Materialisierung
// ---------------------------------------------------------------------------

interface GrantRecord {
  id: string;
  organizationId: string;
  customerId: string;
  minutes: number;
  intervalUnit: 'WEEK' | 'MONTH';
  intervalCount: number;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
  note: string | null;
  materializedUntil: Date | null;
}

/**
 * Bucht fällige Gutschriften aller aktiven Regeln der Organisation bis `until`
 * (Standard: heute). Nebenläufigkeitssicher: doppelte Gutschriften scheitern
 * am Unique-Index und werden übersprungen.
 */
export async function ensureRecurringTopupsMaterialized(
  organizationId: string,
  timezone: string,
  until?: Date,
): Promise<void> {
  const horizon = until ?? todayUtcDate(timezone);
  const grants = (await db.customerRecurringHourGrant.findMany({
    where: {
      organizationId,
      active: true,
      startDate: { lte: horizon },
      OR: [{ materializedUntil: null }, { materializedUntil: { lt: horizon } }],
    },
  })) as GrantRecord[];
  if (grants.length === 0) return;

  for (const grant of grants) {
    const occurrences = grantOccurrencesBetween(
      { ...grant, active: true },
      grant.materializedUntil,
      horizon,
    );
    await db.$transaction(async (tx) => {
      if (occurrences.length > 0) {
        await tx.customerHourTopup.createMany({
          data: occurrences.map((effectiveOn) => ({
            organizationId: grant.organizationId,
            customerId: grant.customerId,
            kind: 'RECURRING' as const,
            minutes: grant.minutes,
            effectiveOn,
            note: grant.note,
            recurringGrantId: grant.id,
          })),
          skipDuplicates: true,
        });
      }
      await tx.customerRecurringHourGrant.update({
        where: { id: grant.id },
        data: { materializedUntil: horizon },
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Konto-Sicht
// ---------------------------------------------------------------------------

export interface RecurringGrantDto {
  id: string;
  minutes: number;
  intervalUnit: 'WEEK' | 'MONTH';
  intervalCount: number;
  startDateIso: string;
  endDateIso: string | null;
  active: boolean;
  note: string | null;
  /** Nächste fällige Gutschrift (null = Regel beendet/inaktiv). */
  nextOccurrenceIso: string | null;
}

export type AccountEntryKind =
  | 'TOPUP_MANUAL'
  | 'TOPUP_RECURRING'
  | 'CORRECTION'
  | 'COMPLETED'
  | 'RESERVED';

export interface AccountHistoryEntryDto {
  id: string;
  kind: AccountEntryKind;
  dateIso: string;
  /** Vorzeichenbehaftete Minuten (Gutschrift +, Abzug/Reservierung −). */
  minutes: number;
  label: string;
  /** Noch nicht wirksam: zukünftige Gutschrift bzw. geplanter Termin. */
  pending: boolean;
  appointmentId: string | null;
}

export interface CustomerHourAccountDto {
  customerId: string;
  summary: HourAccountSummary;
  /** Konto eingerichtet = mindestens eine Gutschrift oder Regel vorhanden. */
  hasAccount: boolean;
  grants: RecurringGrantDto[];
  history: AccountHistoryEntryDto[];
}

export interface AccountSummaryWithMeta extends HourAccountSummary {
  hasAccount: boolean;
}

const HISTORY_LIMIT = 200;

function grantToDto(grant: GrantRecord, today: Date): RecurringGrantDto {
  const next = grantOccurrencesBetween(
    { ...grant },
    // Auch bereits materialisierte, aber heute fällige Gutschriften nicht
    // erneut anzeigen: nächste = erste Gutschrift nach max(heute, Horizont).
    grant.materializedUntil && grant.materializedUntil > today ? grant.materializedUntil : today,
    utcDate(today.getUTCFullYear() + 5, today.getUTCMonth() + 1, today.getUTCDate()),
  )[0];
  return {
    id: grant.id,
    minutes: grant.minutes,
    intervalUnit: grant.intervalUnit,
    intervalCount: grant.intervalCount,
    startDateIso: grant.startDate.toISOString(),
    endDateIso: grant.endDate?.toISOString() ?? null,
    active: grant.active,
    note: grant.note,
    nextOccurrenceIso: grant.active && next ? next.toISOString() : null,
  };
}

/** Vollständige Konto-Sicht eines Kunden (Zusammenfassung, Regeln, Historie). */
export async function getCustomerHourAccount(
  customerId: string,
): Promise<CustomerHourAccountDto> {
  const ctx = await requireOrganizationMembership();
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, organizationId: true },
  });
  assertSameOrg(ctx, customer);

  const timezone = ctx.organization.timezone;
  await ensureRecurringTopupsMaterialized(ctx.organization.id, timezone);
  const today = todayUtcDate(timezone);

  const [topups, grants, appointments] = await Promise.all([
    db.customerHourTopup.findMany({
      where: { customerId },
      orderBy: { effectiveOn: 'desc' },
    }),
    db.customerRecurringHourGrant.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
    }),
    db.appointment.findMany({
      where: { customerId, deletedAt: null },
      select: {
        id: true,
        title: true,
        startAt: true,
        durationMinutes: true,
        status: true,
        timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
      },
    }),
  ]);

  const accountAppointments = appointments.map((a) => ({
    durationMinutes: a.durationMinutes,
    status: a.status,
    workedMinutes:
      a.timeEntries.length > 0
        ? a.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0)
        : null,
  }));

  const summary = computeHourAccount({
    topups,
    appointments: accountAppointments,
    until: today,
  });

  // ---- Historie: Gutschriften + abgeleitete Abzüge/Reservierungen ---------
  const entries: AccountHistoryEntryDto[] = [];
  for (const topup of topups) {
    const kind: AccountEntryKind =
      topup.kind === 'RECURRING'
        ? 'TOPUP_RECURRING'
        : topup.kind === 'CORRECTION'
          ? 'CORRECTION'
          : 'TOPUP_MANUAL';
    entries.push({
      id: `topup:${topup.id}`,
      kind,
      dateIso: topup.effectiveOn.toISOString(),
      minutes: topup.minutes,
      label:
        topup.kind === 'RECURRING'
          ? 'Automatische Aufladung'
          : topup.kind === 'CORRECTION'
            ? `Korrektur: ${topup.note ?? 'ohne Begründung'}`
            : (topup.note?.trim() || 'Stunden aufgeladen'),
      pending: topup.effectiveOn > today,
      appointmentId: null,
    });
  }
  for (const appointment of appointments) {
    if (appointment.status === 'COMPLETED') {
      const worked =
        appointment.timeEntries.length > 0
          ? appointment.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0)
          : appointment.durationMinutes;
      entries.push({
        id: `done:${appointment.id}`,
        kind: 'COMPLETED',
        dateIso: appointment.startAt.toISOString(),
        minutes: -worked,
        label: `Durchgeführt: ${appointment.title}`,
        pending: false,
        appointmentId: appointment.id,
      });
    } else if (['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS'].includes(appointment.status)) {
      entries.push({
        id: `plan:${appointment.id}`,
        kind: 'RESERVED',
        dateIso: appointment.startAt.toISOString(),
        minutes: -appointment.durationMinutes,
        label: `Geplant: ${appointment.title}`,
        pending: true,
        appointmentId: appointment.id,
      });
    }
  }
  entries.sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));

  return {
    customerId,
    summary,
    hasAccount: topups.length > 0 || grants.length > 0,
    grants: (grants as GrantRecord[]).map((grant) => grantToDto(grant, today)),
    history: entries.slice(0, HISTORY_LIMIT),
  };
}

// ---------------------------------------------------------------------------
// Monatsansicht
// ---------------------------------------------------------------------------

export interface MonthAccountView {
  /** Betrachteter Monat als „YYYY-MM". */
  monthIso: string;
  prevMonthIso: string;
  nextMonthIso: string;
  /** Kontostand & Verplanbar zum MONATSENDE (kumuliert, inkl. vorgemerkter Aufladungen). */
  summary: HourAccountSummary;
  /** Bewegungen NUR dieses Monats. */
  month: {
    creditedMinutes: number;
    completedMinutes: number;
    reservedMinutes: number;
  };
  /** Kontostand zu Monatsbeginn (Übertrag aus Vormonaten). */
  carryInMinutes: number;
  hasAccount: boolean;
  grants: RecurringGrantDto[];
  /** Alle Bewegungen des Monats (Client blendet sie portionsweise ein). */
  history: AccountHistoryEntryDto[];
}

function monthIso(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, '0')}`;
}

/** Parst „YYYY-MM"; fällt bei Unsinn auf den aktuellen Monat zurück. */
export function parseMonthIso(value: string | undefined, timezone: string): { year: number; month1: number } {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month1 = Number(match[2]);
    if (month1 >= 1 && month1 <= 12) return { year, month1 };
  }
  const today = todayUtcDate(timezone);
  return { year: today.getUTCFullYear(), month1: today.getUTCMonth() + 1 };
}

/**
 * Stundenkonto-Sicht für EINEN Monat. Die Zahlen gelten für den gewählten Monat:
 *  - `summary` ist der Stand zum MONATSENDE (kumuliert) inkl. der bis dahin
 *    vorgemerkten wiederkehrenden Aufladungen – so sieht man auch für künftige
 *    Monate, ob überbucht wird.
 *  - `month` sind die Bewegungen NUR dieses Monats (aufgeladen/geplant/geleistet).
 *  - Wiederkehrende Aufladungen zukünftiger Monate erscheinen als „vorgemerkt".
 */
export async function getCustomerHourAccountMonth(
  customerId: string,
  monthInput: { year: number; month1: number },
): Promise<MonthAccountView> {
  const ctx = await requireOrganizationMembership();
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, organizationId: true },
  });
  assertSameOrg(ctx, customer);

  const timezone = ctx.organization.timezone;
  await ensureRecurringTopupsMaterialized(ctx.organization.id, timezone);
  const today = todayUtcDate(timezone);

  const { year, month1 } = monthInput;
  const month0 = month1 - 1;
  const viewedIndex = year * 12 + month0;
  const daysInMonth = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  const monthEndInclusive = utcDate(year, month1, daysInMonth);
  const prev = new Date(Date.UTC(year, month0 - 1, 1));
  const next = new Date(Date.UTC(year, month0 + 1, 1));

  const [topups, grants, appointments] = await Promise.all([
    db.customerHourTopup.findMany({ where: { customerId }, orderBy: { effectiveOn: 'desc' } }),
    db.customerRecurringHourGrant.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } }),
    db.appointment.findMany({
      where: { customerId, deletedAt: null },
      select: {
        id: true,
        title: true,
        startAt: true,
        durationMinutes: true,
        status: true,
        timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
      },
    }),
  ]);

  const workedOf = (a: (typeof appointments)[number]) =>
    a.timeEntries.length > 0 ? a.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0) : null;
  const monthIndexOf = (date: Date) => {
    const parts = calendarDayInZone(date, timezone);
    return parts.year * 12 + (parts.month - 1);
  };

  // Stand zum Monatsende: nur Termine bis einschließlich dieses Monats zählen,
  // plus die bis Monatsende vorgemerkten wiederkehrenden Aufladungen.
  const summary = computeHourAccount({
    topups,
    appointments: appointments
      .filter((a) => monthIndexOf(a.startAt) <= viewedIndex)
      .map((a) => ({ durationMinutes: a.durationMinutes, status: a.status, workedMinutes: workedOf(a) })),
    until: monthEndInclusive,
    extraCreditMinutes: projectedGrantMinutes(grants as RecurringGrantLike[], monthEndInclusive),
  });

  // Bewegungen NUR dieses Monats.
  const topupsThisMonth = topups.filter(
    (t) => t.effectiveOn.getUTCFullYear() === year && t.effectiveOn.getUTCMonth() === month0,
  );
  const materializedCredit = topupsThisMonth.reduce((sum, t) => sum + t.minutes, 0);

  // Vorgemerkte wiederkehrende Aufladungen dieses Monats (noch nicht gebucht).
  const projectedOccurrences: { grantId: string; date: Date; minutes: number; note: string | null }[] = [];
  for (const grant of grants as GrantRecord[]) {
    const occurrences = grantOccurrencesBetween(
      { ...grant, active: grant.active },
      grant.materializedUntil,
      monthEndInclusive,
    ).filter((o) => o.getUTCFullYear() === year && o.getUTCMonth() === month0);
    for (const date of occurrences) {
      projectedOccurrences.push({ grantId: grant.id, date, minutes: grant.minutes, note: grant.note });
    }
  }
  const projectedCredit = projectedOccurrences.reduce((sum, o) => sum + o.minutes, 0);

  const inMonth = appointments.filter((a) => monthIndexOf(a.startAt) === viewedIndex);
  const completedThisMonth = inMonth
    .filter((a) => a.status === 'COMPLETED')
    .reduce((sum, a) => sum + (workedOf(a) ?? a.durationMinutes), 0);
  const reservedThisMonth = inMonth
    .filter((a) => ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status))
    .reduce((sum, a) => sum + a.durationMinutes, 0);
  const creditedThisMonth = materializedCredit + projectedCredit;

  // ---- Historie dieses Monats ----------------------------------------------
  const entries: AccountHistoryEntryDto[] = [];
  for (const topup of topupsThisMonth) {
    const kind: AccountEntryKind =
      topup.kind === 'RECURRING' ? 'TOPUP_RECURRING' : topup.kind === 'CORRECTION' ? 'CORRECTION' : 'TOPUP_MANUAL';
    entries.push({
      id: `topup:${topup.id}`,
      kind,
      dateIso: topup.effectiveOn.toISOString(),
      minutes: topup.minutes,
      label:
        topup.kind === 'RECURRING'
          ? 'Automatische Aufladung'
          : topup.kind === 'CORRECTION'
            ? `Korrektur: ${topup.note ?? 'ohne Begründung'}`
            : topup.note?.trim() || 'Stunden aufgeladen',
      pending: topup.effectiveOn > today,
      appointmentId: null,
    });
  }
  for (const occurrence of projectedOccurrences) {
    entries.push({
      id: `grant:${occurrence.grantId}:${occurrence.date.toISOString().slice(0, 10)}`,
      kind: 'TOPUP_RECURRING',
      dateIso: occurrence.date.toISOString(),
      minutes: occurrence.minutes,
      label: 'Automatische Aufladung',
      pending: true,
      appointmentId: null,
    });
  }
  for (const appointment of inMonth) {
    if (appointment.status === 'COMPLETED') {
      entries.push({
        id: `done:${appointment.id}`,
        kind: 'COMPLETED',
        dateIso: appointment.startAt.toISOString(),
        minutes: -(workedOf(appointment) ?? appointment.durationMinutes),
        label: `Durchgeführt: ${appointment.title}`,
        pending: false,
        appointmentId: appointment.id,
      });
    } else if (['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS'].includes(appointment.status)) {
      entries.push({
        id: `plan:${appointment.id}`,
        kind: 'RESERVED',
        dateIso: appointment.startAt.toISOString(),
        minutes: -appointment.durationMinutes,
        label: `Geplant: ${appointment.title}`,
        pending: true,
        appointmentId: appointment.id,
      });
    }
  }
  entries.sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));

  return {
    monthIso: monthIso(year, month1),
    prevMonthIso: monthIso(prev.getUTCFullYear(), prev.getUTCMonth() + 1),
    nextMonthIso: monthIso(next.getUTCFullYear(), next.getUTCMonth() + 1),
    summary,
    month: {
      creditedMinutes: creditedThisMonth,
      completedMinutes: completedThisMonth,
      reservedMinutes: reservedThisMonth,
    },
    carryInMinutes: summary.balanceMinutes - creditedThisMonth + completedThisMonth,
    hasAccount: topups.length > 0 || grants.length > 0,
    grants: (grants as GrantRecord[]).map((grant) => grantToDto(grant, today)),
    history: entries,
  };
}

/** Konto-Zusammenfassungen für Listen (N+1-frei). */
export async function getAccountSummariesBulk(
  organizationId: string,
  timezone: string,
  customerIds: string[],
): Promise<Map<string, AccountSummaryWithMeta>> {
  const result = new Map<string, AccountSummaryWithMeta>();
  if (customerIds.length === 0) return result;

  await ensureRecurringTopupsMaterialized(organizationId, timezone);
  const today = todayUtcDate(timezone);

  const [topups, grantCounts, appointments] = await Promise.all([
    db.customerHourTopup.findMany({
      where: { customerId: { in: customerIds } },
      select: { customerId: true, minutes: true, effectiveOn: true },
    }),
    db.customerRecurringHourGrant.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds } },
      _count: { id: true },
    }),
    db.appointment.findMany({
      where: { customerId: { in: customerIds }, deletedAt: null },
      select: {
        customerId: true,
        durationMinutes: true,
        status: true,
        timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
      },
    }),
  ]);

  const grantByCustomer = new Map(grantCounts.map((g) => [g.customerId, g._count.id]));
  for (const customerId of customerIds) {
    const summary = computeHourAccount({
      topups: topups.filter((t) => t.customerId === customerId),
      appointments: appointments
        .filter((a) => a.customerId === customerId)
        .map((a) => ({
          durationMinutes: a.durationMinutes,
          status: a.status,
          workedMinutes:
            a.timeEntries.length > 0
              ? a.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0)
              : null,
        })),
      until: today,
    });
    result.set(customerId, {
      ...summary,
      hasAccount:
        (grantByCustomer.get(customerId) ?? 0) > 0 ||
        topups.some((t) => t.customerId === customerId),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Mutationen
// ---------------------------------------------------------------------------

export async function createHourTopup(input: {
  customerId: string;
  minutes: number;
  note?: string;
  /** Buchungsdatum (YYYY-MM-DD); Standard: heute. Zukunft = vorgemerkt. */
  effectiveOn?: string;
}): Promise<{ topupId: string }> {
  const ctx = await requirePermission('budgets.manage');
  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  assertSameOrg(ctx, customer);

  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new AppError('VALIDATION_FAILED', { message: 'Die Aufladung muss größer als 0 sein.' });
  }
  const effectiveOn = input.effectiveOn
    ? fromDateInputValue(input.effectiveOn)
    : todayUtcDate(ctx.organization.timezone);
  if (!effectiveOn) {
    throw new AppError('VALIDATION_FAILED', { message: 'Bitte ein gültiges Datum wählen.' });
  }

  const topup = await db.$transaction(async (tx) => {
    const created = await tx.customerHourTopup.create({
      data: {
        organizationId: ctx.organization.id,
        customerId: input.customerId,
        kind: 'MANUAL',
        minutes: input.minutes,
        effectiveOn,
        note: input.note?.trim() || null,
        createdByUserId: ctx.user.id,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'account.topup',
        entityType: 'Customer',
        entityId: input.customerId,
        metadata: { topupId: created.id, minutes: input.minutes },
      },
      tx,
    );
    return created;
  });
  return { topupId: topup.id };
}

/** Korrekturbuchung (±) mit Pflicht-Begründung – auch ins Minus möglich. */
export async function createHourCorrection(input: {
  customerId: string;
  minutes: number;
  reason: string;
}): Promise<{ topupId: string }> {
  const ctx = await requirePermission('budgets.manage');
  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  assertSameOrg(ctx, customer);

  if (!Number.isInteger(input.minutes) || input.minutes === 0) {
    throw new AppError('VALIDATION_FAILED', { message: 'Die Korrektur darf nicht 0 sein.' });
  }
  if (!input.reason.trim()) {
    throw new AppError('VALIDATION_FAILED', { message: 'Bitte eine Begründung angeben.' });
  }

  const topup = await db.$transaction(async (tx) => {
    const created = await tx.customerHourTopup.create({
      data: {
        organizationId: ctx.organization.id,
        customerId: input.customerId,
        kind: 'CORRECTION',
        minutes: input.minutes,
        effectiveOn: todayUtcDate(ctx.organization.timezone),
        note: input.reason.trim(),
        createdByUserId: ctx.user.id,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'account.corrected',
        entityType: 'Customer',
        entityId: input.customerId,
        metadata: { topupId: created.id, minutes: input.minutes },
      },
      tx,
    );
    return created;
  });
  return { topupId: topup.id };
}

export async function createRecurringGrant(input: {
  customerId: string;
  minutes: number;
  intervalUnit: 'WEEK' | 'MONTH';
  intervalCount: number;
  startDate: string;
  endDate?: string;
  note?: string;
}): Promise<{ grantId: string }> {
  const ctx = await requirePermission('budgets.manage');
  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  assertSameOrg(ctx, customer);

  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new AppError('VALIDATION_FAILED', { message: 'Die Aufladung muss größer als 0 sein.' });
  }
  if (!Number.isInteger(input.intervalCount) || input.intervalCount < 1) {
    throw new AppError('VALIDATION_FAILED', { message: 'Das Intervall muss mindestens 1 sein.' });
  }
  const startDate = fromDateInputValue(input.startDate);
  const endDate = input.endDate ? fromDateInputValue(input.endDate) : null;
  if (!startDate || (input.endDate && !endDate) || (endDate && endDate < startDate)) {
    throw new AppError('VALIDATION_FAILED', { message: 'Bitte einen gültigen Zeitraum wählen.' });
  }

  const grant = await db.$transaction(async (tx) => {
    const created = await tx.customerRecurringHourGrant.create({
      data: {
        organizationId: ctx.organization.id,
        customerId: input.customerId,
        minutes: input.minutes,
        intervalUnit: input.intervalUnit,
        intervalCount: input.intervalCount,
        startDate,
        endDate,
        note: input.note?.trim() || null,
        createdByUserId: ctx.user.id,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'account.grantCreated',
        entityType: 'Customer',
        entityId: input.customerId,
        metadata: {
          grantId: created.id,
          minutes: input.minutes,
          interval: `${input.intervalCount} ${input.intervalUnit}`,
        },
      },
      tx,
    );
    return created;
  });
  // Rückwirkender Start: fällige Gutschriften sofort buchen.
  await ensureRecurringTopupsMaterialized(ctx.organization.id, ctx.organization.timezone);
  return { grantId: grant.id };
}

/**
 * Regel ändern: Vergangenheit bleibt eingefroren (vorher materialisiert),
 * neue Werte gelten nur für zukünftige Gutschriften.
 */
export async function updateRecurringGrant(input: {
  grantId: string;
  minutes: number;
  intervalCount: number;
  intervalUnit: 'WEEK' | 'MONTH';
  endDate?: string | null;
  note?: string;
}): Promise<void> {
  const ctx = await requirePermission('budgets.manage');
  const grant = await db.customerRecurringHourGrant.findUnique({ where: { id: input.grantId } });
  if (!grant) throw new AppError('NOT_FOUND', { message: 'Die Aufladungsregel existiert nicht mehr.' });
  assertSameOrg(ctx, grant);

  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new AppError('VALIDATION_FAILED', { message: 'Die Aufladung muss größer als 0 sein.' });
  }
  if (!Number.isInteger(input.intervalCount) || input.intervalCount < 1) {
    throw new AppError('VALIDATION_FAILED', { message: 'Das Intervall muss mindestens 1 sein.' });
  }
  const endDate = input.endDate ? fromDateInputValue(input.endDate) : null;
  if (input.endDate && !endDate) {
    throw new AppError('VALIDATION_FAILED', { message: 'Bitte ein gültiges Enddatum wählen.' });
  }

  await ensureRecurringTopupsMaterialized(ctx.organization.id, ctx.organization.timezone);
  await db.$transaction(async (tx) => {
    await tx.customerRecurringHourGrant.update({
      where: { id: input.grantId },
      data: {
        minutes: input.minutes,
        intervalCount: input.intervalCount,
        intervalUnit: input.intervalUnit,
        endDate,
        note: input.note?.trim() || null,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'account.grantUpdated',
        entityType: 'Customer',
        entityId: grant.customerId,
        metadata: { grantId: input.grantId, minutes: input.minutes },
      },
      tx,
    );
  });
}

/**
 * Regel pausieren/fortsetzen. Beim Fortsetzen gibt es keine Nachbuchung der
 * Pausenzeit: der Materialisierungs-Horizont springt auf heute.
 */
export async function setRecurringGrantActive(grantId: string, active: boolean): Promise<void> {
  const ctx = await requirePermission('budgets.manage');
  const grant = await db.customerRecurringHourGrant.findUnique({ where: { id: grantId } });
  if (!grant) throw new AppError('NOT_FOUND', { message: 'Die Aufladungsregel existiert nicht mehr.' });
  assertSameOrg(ctx, grant);

  if (!active) {
    // Vergangenheit einfrieren, dann pausieren.
    await ensureRecurringTopupsMaterialized(ctx.organization.id, ctx.organization.timezone);
  }
  await db.$transaction(async (tx) => {
    await tx.customerRecurringHourGrant.update({
      where: { id: grantId },
      data: {
        active,
        ...(active ? { materializedUntil: todayUtcDate(ctx.organization.timezone) } : {}),
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: active ? 'account.grantResumed' : 'account.grantPaused',
        entityType: 'Customer',
        entityId: grant.customerId,
        metadata: { grantId },
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Planungs-Helfer (Vorschläge, Konflikt-Warnungen)
// ---------------------------------------------------------------------------

export interface PlannablePerCustomer {
  customerId: string;
  plannableMinutes: number;
  hasAccount: boolean;
}

/**
 * Verplanbare Minuten je Kunde zum Planungsdatum `dateUtcDay` (UTC-Mitternacht):
 * Gutschriften bis zum Datum (inkl. projizierter wiederkehrender Aufladungen)
 * minus Geleistetes minus Reservierungen bis zum Tagesende. Termine NACH dem
 * Planungstag werden von späteren Gutschriften gedeckt und dort geprüft.
 */
export async function getPlannableMinutesForDate(
  organizationId: string,
  timezone: string,
  dateUtcDay: Date,
  options: { customerIds?: string[]; excludeAppointmentId?: string } = {},
): Promise<Map<string, PlannablePerCustomer>> {
  await ensureRecurringTopupsMaterialized(organizationId, timezone);
  const reservedBefore = dayPeriodInZone(dateUtcDay, timezone).end;

  const customerFilter = options.customerIds ? { customerId: { in: options.customerIds } } : {};
  const [topups, grants, appointments] = await Promise.all([
    db.customerHourTopup.findMany({
      where: { organizationId, ...customerFilter },
      select: { customerId: true, minutes: true, effectiveOn: true },
    }),
    db.customerRecurringHourGrant.findMany({
      where: { organizationId, active: true, ...customerFilter },
    }),
    db.appointment.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...customerFilter,
        ...(options.excludeAppointmentId ? { id: { not: options.excludeAppointmentId } } : {}),
      },
      select: {
        customerId: true,
        startAt: true,
        durationMinutes: true,
        status: true,
        timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
      },
    }),
  ]);

  const ids = new Set<string>([
    ...topups.map((t) => t.customerId),
    ...grants.map((g) => g.customerId),
    ...(options.customerIds ?? []),
  ]);

  const result = new Map<string, PlannablePerCustomer>();
  for (const customerId of ids) {
    const customerTopups = topups.filter((t) => t.customerId === customerId);
    const customerGrants = grants.filter(
      (g) => g.customerId === customerId,
    ) as RecurringGrantLike[];
    const summary = computeHourAccount({
      topups: customerTopups,
      appointments: appointments
        .filter((a) => a.customerId === customerId)
        .map((a) => ({
          durationMinutes: a.durationMinutes,
          status: a.status,
          startAt: a.startAt,
          workedMinutes:
            a.timeEntries.length > 0
              ? a.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0)
              : null,
        })),
      until: dateUtcDay,
      extraCreditMinutes: projectedGrantMinutes(customerGrants, dateUtcDay),
      reservedBefore,
    });
    result.set(customerId, {
      customerId,
      plannableMinutes: Math.max(0, summary.plannableMinutes),
      hasAccount: customerTopups.length > 0 || customerGrants.length > 0,
    });
  }
  return result;
}
