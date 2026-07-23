import 'server-only';

import { monthPeriodInZone } from '@/lib/dates';
import { collectSubtree, managerChain } from '@/lib/hierarchy';
import { employeeDisplayName } from '@/lib/utils';
import {
  getEmployeeAllocatedMinutes,
  getEmployeeMissingTargetMinutes,
  getManagerSelfObligationMinutes,
} from '@/lib/hours';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  assertSameOrg,
  canAccessCustomer,
  hasPermission,
  requireOrganizationMembership,
} from '@/server/permissions';
import {
  getCustomerAccountStatsBulk,
} from '@/server/services/hours-service';
import { createNotification } from '@/server/services/notification-service';

/**
 * Stundenzuweisung (Anforderung 11): Kundenstunden an Mitarbeiter übertragen.
 *
 * Konto-Modell: Zuweisungen hängen nicht mehr an einem Budget-Zeitraum,
 * sondern am Stundenkonto des Kunden.
 *
 * Modus 'org':  Owner/Admin/Disponent verteilen aus dem Kundenguthaben
 *               (Kontostand minus bereits aktive Org-Zuweisungen).
 * Modus 'pool': Team-Manager reichen aus dem eigenen erhaltenen Pool an ihren
 *               Unterbaum weiter (verbraucht nicht erneut das Kundenguthaben).
 */

export interface AllocationRecipient {
  id: string;
  name: string;
  depth: number;
  targetMonthMinutes: number | null;
  receivedMonthMinutes: number;
  missingMonthMinutes: number;
  canReceiveHours: boolean;
}

export interface AllocationContext {
  mode: 'org' | 'pool';
  customer: { id: string; name: string };
  /** Verfügbare Minuten im gewählten Modus (Konto-Rest bzw. eigener Pool). */
  availableMinutes: number;
  /** Kontostand des Kunden (Anzeige). */
  balanceMinutes: number;
  /** Konto eingerichtet (Gutschrift oder Aufladungsregel vorhanden). */
  hasAccount: boolean;
  recipients: AllocationRecipient[];
  currentAllocations: Array<{
    id: string;
    minutes: number;
    toId: string;
    toName: string;
    byName: string | null;
  }>;
}

/** Effektives Monatsziel: Monatswert, sonst Wochenwert × 4,33 (auf 15 min gerundet). */
export function effectiveMonthTarget(employee: {
  targetMinutesPerMonth: number | null;
  targetMinutesPerWeek: number | null;
}): number | null {
  if (employee.targetMinutesPerMonth) return employee.targetMinutesPerMonth;
  if (employee.targetMinutesPerWeek) {
    return Math.round((employee.targetMinutesPerWeek * 4.33) / 15) * 15;
  }
  return null;
}

async function resolveMode(ctx: Awaited<ReturnType<typeof requireOrganizationMembership>>) {
  if (hasPermission(ctx, 'hours.allocateOrg')) return 'org' as const;
  if (hasPermission(ctx, 'hours.allocateOwnPool') && ctx.employee) return 'pool' as const;
  throw new AppError('ACCESS_DENIED');
}

function toAllocationLike(a: {
  id: string;
  budgetId: string | null;
  allocatedByEmployeeId: string | null;
  allocatedToEmployeeId: string;
  allocatedMinutes: number;
  status: string;
}) {
  return {
    id: a.id,
    budgetId: a.budgetId ?? '',
    allocatedByEmployeeId: a.allocatedByEmployeeId,
    allocatedToEmployeeId: a.allocatedToEmployeeId,
    allocatedMinutes: a.allocatedMinutes,
    status: a.status as 'ACTIVE' | 'REVOKED',
  };
}

/** Verfügbare Minuten im Modus: Org = Konto-Rest, Pool = erhalten − weitergegeben. */
async function availableMinutesFor(
  ctx: Awaited<ReturnType<typeof requireOrganizationMembership>>,
  mode: 'org' | 'pool',
  customerId: string,
): Promise<{ availableMinutes: number; balanceMinutes: number; hasAccount: boolean }> {
  const stats = (
    await getCustomerAccountStatsBulk(ctx.organization.id, ctx.organization.timezone, [customerId])
  ).get(customerId);
  const balanceMinutes = stats?.balanceMinutes ?? 0;
  const hasAccount = stats?.hasAccount ?? false;

  if (mode === 'org') {
    return {
      availableMinutes: Math.max(0, balanceMinutes - (stats?.allocatedMinutes ?? 0)),
      balanceMinutes,
      hasAccount,
    };
  }

  const allocations = await db.hourAllocation.findMany({
    where: { customerId, status: 'ACTIVE' },
  });
  return {
    availableMinutes: Math.max(
      0,
      getManagerSelfObligationMinutes(allocations.map(toAllocationLike), ctx.employee!.id),
    ),
    balanceMinutes,
    hasAccount,
  };
}

export async function getAllocationContext(customerId: string): Promise<AllocationContext> {
  const ctx = await requireOrganizationMembership();
  const mode = await resolveMode(ctx);
  if (!(await canAccessCustomer(ctx, customerId, 'read'))) {
    throw new AppError('CUSTOMER_NOT_FOUND', { status: 404 });
  }

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, organizationId: true, firstName: true, lastName: true },
  });
  assertSameOrg(ctx, customer);

  const period = monthPeriodInZone(new Date(), ctx.organization.timezone);

  // Alle (nicht gelöschten) Mitarbeiter für Hierarchie & Empfängerliste.
  const employees = await db.employee.findMany({
    where: { organizationId: ctx.organization.id, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      userId: true,
      status: true,
      canReceiveHours: true,
      managerEmployeeId: true,
      targetMinutesPerWeek: true,
      targetMinutesPerMonth: true,
    },
  });
  const nodes = employees.map((e) => ({ id: e.id, managerEmployeeId: e.managerEmployeeId }));

  let recipientIds: string[];
  if (mode === 'org') {
    recipientIds = employees.filter((e) => e.status === 'ACTIVE').map((e) => e.id);
  } else {
    recipientIds = collectSubtree(nodes, ctx.employee!.id).filter((id) => {
      const employee = employees.find((e) => e.id === id);
      return employee?.status === 'ACTIVE';
    });
  }

  // Erhaltene Minuten des Monats je Empfänger (eine Abfrage).
  const monthAllocations = await db.hourAllocation.findMany({
    where: {
      organizationId: ctx.organization.id,
      status: 'ACTIVE',
      validFrom: { lt: period.end },
      validUntil: { gte: period.start },
    },
  });
  const monthAllocationLikes = monthAllocations.map(toAllocationLike);

  const recipients: AllocationRecipient[] = recipientIds
    .map((id) => {
      const employee = employees.find((e) => e.id === id)!;
      const target = effectiveMonthTarget(employee);
      const received = getEmployeeAllocatedMinutes(monthAllocationLikes, id);
      return {
        id,
        // Eigenes Profil markieren – die Leitung kann sich selbst Stunden zuweisen.
        name: employeeDisplayName(employee, ctx.user.id),
        depth: managerChain(nodes, id).length,
        targetMonthMinutes: target,
        receivedMonthMinutes: received,
        missingMonthMinutes: getEmployeeMissingTargetMinutes(target, received),
        canReceiveHours: employee.canReceiveHours,
      };
    })
    .filter((r) => r.canReceiveHours)
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

  const { availableMinutes, balanceMinutes, hasAccount } = await availableMinutesFor(
    ctx,
    mode,
    customerId,
  );

  const employeeName = (id: string | null) => {
    if (!id) return null;
    const employee = employees.find((e) => e.id === id);
    return employee ? `${employee.firstName} ${employee.lastName}` : null;
  };

  const customerAllocations = await db.hourAllocation.findMany({
    where: { customerId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });

  return {
    mode,
    customer: { id: customer.id, name: `${customer.firstName} ${customer.lastName}` },
    availableMinutes,
    balanceMinutes,
    hasAccount,
    recipients,
    currentAllocations: customerAllocations.map((a) => ({
      id: a.id,
      minutes: a.allocatedMinutes,
      toId: a.allocatedToEmployeeId,
      toName: employeeName(a.allocatedToEmployeeId) ?? 'Unbekannt',
      byName: employeeName(a.allocatedByEmployeeId),
    })),
  };
}

// ---------------------------------------------------------------------------

/** Kunden mit verfügbarem Guthaben (für den Einstieg über die Mitarbeiterseite). */
export async function listAllocatableCustomers(): Promise<
  Array<{ id: string; name: string; availableMinutes: number }>
> {
  const ctx = await requireOrganizationMembership();
  await resolveMode(ctx);

  const customers = await db.customer.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      status: { not: 'ARCHIVED' },
    },
    select: { id: true, firstName: true, lastName: true },
  });
  const stats = await getCustomerAccountStatsBulk(
    ctx.organization.id,
    ctx.organization.timezone,
    customers.map((c) => c.id),
  );

  return customers
    .map((customer) => {
      const stat = stats.get(customer.id);
      return {
        id: customer.id,
        name: `${customer.firstName} ${customer.lastName}`,
        availableMinutes: stat
          ? Math.max(0, stat.balanceMinutes - stat.allocatedMinutes)
          : 0,
        hasAccount: stat?.hasAccount ?? false,
      };
    })
    .filter((entry) => entry.hasAccount && entry.availableMinutes > 0)
    .map(({ id, name, availableMinutes }) => ({ id, name, availableMinutes }))
    .sort((a, b) => b.availableMinutes - a.availableMinutes || a.name.localeCompare(b.name));
}

export async function allocateHours(input: {
  customerId: string;
  toEmployeeId: string;
  minutes: number;
  note?: string;
}): Promise<{ allocationId: string }> {
  const ctx = await requireOrganizationMembership();
  const mode = await resolveMode(ctx);

  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new AppError('VALIDATION_FAILED', { message: 'Die Minutenanzahl muss größer als 0 sein.' });
  }

  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  assertSameOrg(ctx, customer);

  const recipientRecord = await db.employee.findUnique({
    where: { id: input.toEmployeeId },
    include: { user: { select: { id: true } } },
  });
  assertSameOrg(ctx, recipientRecord);
  if (!recipientRecord || recipientRecord.deletedAt) throw new AppError('EMPLOYEE_NOT_FOUND');
  if (recipientRecord.status !== 'ACTIVE') throw new AppError('RECIPIENT_INACTIVE');
  if (!recipientRecord.canReceiveHours) throw new AppError('RECIPIENT_CANNOT_RECEIVE_HOURS');

  if (mode === 'pool') {
    // Scope: Empfänger muss im eigenen Unterbaum liegen (nicht man selbst).
    const nodes = await db.employee.findMany({
      where: { organizationId: ctx.organization.id, deletedAt: null },
      select: { id: true, managerEmployeeId: true },
    });
    const subtree = collectSubtree(nodes, ctx.employee!.id);
    if (!subtree.includes(input.toEmployeeId)) {
      throw new AppError('ACCESS_DENIED', {
        message: 'Stunden können nur an eigene (untergeordnete) Mitarbeiter weitergegeben werden.',
      });
    }
  }

  const { availableMinutes, hasAccount } = await availableMinutesFor(ctx, mode, input.customerId);
  if (mode === 'org' && !hasAccount) {
    throw new AppError('HOUR_BUDGET_EXCEEDED', {
      message: 'Für den Kunden ist noch kein Stundenkonto eingerichtet.',
      details: { availableMinutes: 0 },
    });
  }
  if (input.minutes > availableMinutes) {
    throw new AppError(mode === 'org' ? 'HOUR_BUDGET_EXCEEDED' : 'ALLOCATION_POOL_EXCEEDED', {
      details: { availableMinutes },
    });
  }

  // Gültigkeit: aktueller Monat (Kennzahlen der Mitarbeiter sind monatsbezogen).
  const period = monthPeriodInZone(new Date(), ctx.organization.timezone);

  const allocation = await db.$transaction(async (tx) => {
    const created = await tx.hourAllocation.create({
      data: {
        organizationId: ctx.organization.id,
        customerId: input.customerId,
        budgetId: null,
        allocatedByEmployeeId: mode === 'pool' ? ctx.employee!.id : null,
        allocatedToEmployeeId: input.toEmployeeId,
        allocatedMinutes: input.minutes,
        validFrom: period.start,
        validUntil: new Date(period.end.getTime() - 1),
        note: input.note || null,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'hours.allocated',
        entityType: 'Customer',
        entityId: input.customerId,
        metadata: {
          allocationId: created.id,
          minutes: input.minutes,
          toEmployeeId: input.toEmployeeId,
          mode,
        },
      },
      tx,
    );
    return created;
  });

  // Benachrichtigung an den Empfänger (falls er ein Benutzerkonto hat).
  if (recipientRecord.user) {
    await createNotification({
      organizationId: ctx.organization.id,
      userId: recipientRecord.user.id,
      type: 'HOURS_ALLOCATED',
      title: 'Stunden erhalten',
      message: `Dir wurden ${Math.round(input.minutes / 60 * 100) / 100} Std. für ${customer.firstName} ${customer.lastName} übertragen.`,
      targetUrl: `/customers/${input.customerId}?tab=stunden`,
    });
  }

  return { allocationId: allocation.id };
}

/** Zuweisung zurückziehen (Owner/Admin/Disponent oder der Weitergebende selbst). */
export async function revokeAllocation(allocationId: string): Promise<void> {
  const ctx = await requireOrganizationMembership();
  const allocation = await db.hourAllocation.findUnique({ where: { id: allocationId } });
  assertSameOrg(ctx, allocation);

  const isOrgLevel = hasPermission(ctx, 'hours.allocateOrg');
  const isOwnForwarding =
    ctx.employee && allocation.allocatedByEmployeeId === ctx.employee.id;
  if (!isOrgLevel && !isOwnForwarding) throw new AppError('ACCESS_DENIED');

  await db.$transaction(async (tx) => {
    await tx.hourAllocation.update({
      where: { id: allocationId },
      data: { status: 'REVOKED' },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'hours.allocationRevoked',
        entityType: 'Customer',
        entityId: allocation.customerId,
        metadata: { allocationId, minutes: allocation.allocatedMinutes },
      },
      tx,
    );
  });
}
