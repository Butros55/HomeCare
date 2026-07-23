import 'server-only';

import { monthPeriodInZone } from '@/lib/dates';
import { collectSubtree, managerChain } from '@/lib/hierarchy';
import { employeeDisplayName } from '@/lib/utils';
import {
  getEmployeeAllocatedMinutes,
  getEmployeeMissingTargetMinutes,
  validateManagerPoolAllocation,
  validateOrgPoolAllocation,
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
import { createNotification } from '@/server/services/notification-service';

/**
 * Stundenzuweisung (Anforderung 11): Kundenstunden an Mitarbeiter übertragen.
 *
 * Modus 'org':  Owner/Admin/Disponent verteilen aus dem Kundenbudget.
 * Modus 'pool': Team-Manager reichen aus dem eigenen erhaltenen Pool an ihren
 *               Unterbaum weiter (verbraucht nicht erneut das Kundenbudget).
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

export interface AllocationBudgetOption {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  totalMinutes: number;
  /** Verfügbare Minuten im gewählten Modus (Org-Rest bzw. eigener Pool). */
  availableMinutes: number;
  sourceType: string;
  note: string | null;
}

export interface AllocationContext {
  mode: 'org' | 'pool';
  customer: { id: string; name: string };
  budgets: AllocationBudgetOption[];
  recipients: AllocationRecipient[];
  currentAllocations: Array<{
    id: string;
    budgetId: string;
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
  const budgets = await db.customerHourBudget.findMany({
    where: {
      customerId,
      periodStart: { lt: period.end },
      periodEnd: { gte: new Date(period.start.getTime() - 45 * 24 * 3600 * 1000) },
    },
    orderBy: { periodStart: 'desc' },
    include: { adjustments: true, allocations: true },
  });

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

  const recipients: AllocationRecipient[] = recipientIds
    .map((id) => {
      const employee = employees.find((e) => e.id === id)!;
      const target = effectiveMonthTarget(employee);
      const received = getEmployeeAllocatedMinutes(monthAllocations, id);
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

  const budgetOptions: AllocationBudgetOption[] = budgets.map((budget) => {
    const total =
      budget.budgetMinutes + budget.adjustments.reduce((sum, a) => sum + a.adjustmentMinutes, 0);
    const orgAllocated = budget.allocations
      .filter((a) => a.status === 'ACTIVE' && a.allocatedByEmployeeId === null)
      .reduce((sum, a) => sum + a.allocatedMinutes, 0);
    let available = total - orgAllocated;
    if (mode === 'pool') {
      const received = budget.allocations
        .filter((a) => a.status === 'ACTIVE' && a.allocatedToEmployeeId === ctx.employee!.id)
        .reduce((sum, a) => sum + a.allocatedMinutes, 0);
      const forwarded = budget.allocations
        .filter((a) => a.status === 'ACTIVE' && a.allocatedByEmployeeId === ctx.employee!.id)
        .reduce((sum, a) => sum + a.allocatedMinutes, 0);
      available = received - forwarded;
    }
    return {
      id: budget.id,
      periodStart: budget.periodStart,
      periodEnd: budget.periodEnd,
      totalMinutes: total,
      availableMinutes: Math.max(0, available),
      sourceType: budget.sourceType,
      note: budget.note,
    };
  });

  const employeeName = (id: string | null) => {
    if (!id) return null;
    const employee = employees.find((e) => e.id === id);
    return employee ? `${employee.firstName} ${employee.lastName}` : null;
  };

  return {
    mode,
    customer: { id: customer.id, name: `${customer.firstName} ${customer.lastName}` },
    budgets: budgetOptions,
    recipients,
    currentAllocations: budgets.flatMap((budget) =>
      budget.allocations
        .filter((a) => a.status === 'ACTIVE')
        .map((a) => ({
          id: a.id,
          budgetId: budget.id,
          minutes: a.allocatedMinutes,
          toId: a.allocatedToEmployeeId,
          toName: employeeName(a.allocatedToEmployeeId) ?? 'Unbekannt',
          byName: employeeName(a.allocatedByEmployeeId),
        })),
    ),
  };
}

// ---------------------------------------------------------------------------

/** Kunden mit Budget im aktuellen Monat (für den Einstieg über die Mitarbeiterseite). */
export async function listAllocatableCustomers(): Promise<
  Array<{ id: string; name: string; availableMinutes: number }>
> {
  const ctx = await requireOrganizationMembership();
  await resolveMode(ctx);
  const period = monthPeriodInZone(new Date(), ctx.organization.timezone);

  const budgets = await db.customerHourBudget.findMany({
    where: {
      organizationId: ctx.organization.id,
      periodStart: { lt: period.end },
      periodEnd: { gte: period.start },
      customer: { deletedAt: null, status: { not: 'ARCHIVED' } },
    },
    include: {
      adjustments: true,
      allocations: { where: { status: 'ACTIVE' } },
      customer: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const byCustomer = new Map<string, { name: string; availableMinutes: number }>();
  for (const budget of budgets) {
    const total =
      budget.budgetMinutes + budget.adjustments.reduce((sum, a) => sum + a.adjustmentMinutes, 0);
    const orgAllocated = budget.allocations
      .filter((a) => a.allocatedByEmployeeId === null)
      .reduce((sum, a) => sum + a.allocatedMinutes, 0);
    const entry = byCustomer.get(budget.customer.id) ?? {
      name: `${budget.customer.firstName} ${budget.customer.lastName}`,
      availableMinutes: 0,
    };
    entry.availableMinutes += Math.max(0, total - orgAllocated);
    byCustomer.set(budget.customer.id, entry);
  }
  return [...byCustomer.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.availableMinutes - a.availableMinutes || a.name.localeCompare(b.name));
}

export async function allocateHours(input: {
  customerId: string;
  budgetId: string;
  toEmployeeId: string;
  minutes: number;
  note?: string;
}): Promise<{ allocationId: string }> {
  const ctx = await requireOrganizationMembership();
  const mode = await resolveMode(ctx);

  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new AppError('VALIDATION_FAILED', { message: 'Die Minutenanzahl muss größer als 0 sein.' });
  }

  const budget = await db.customerHourBudget.findUnique({
    where: { id: input.budgetId },
    include: { adjustments: true, allocations: { where: { status: 'ACTIVE' } } },
  });
  if (!budget) throw new AppError('BUDGET_NOT_FOUND');
  assertSameOrg(ctx, budget);
  if (budget.customerId !== input.customerId) {
    throw new AppError('ORGANIZATION_SCOPE_VIOLATION', {
      message: 'Das Budget gehört nicht zu diesem Kunden.',
    });
  }

  const recipient = await db.employee.findUnique({ where: { id: input.toEmployeeId } });
  assertSameOrg(ctx, recipient);
  const recipientRecord = await db.employee.findUnique({
    where: { id: input.toEmployeeId },
    include: { user: { select: { id: true } } },
  });
  if (!recipientRecord || recipientRecord.deletedAt) throw new AppError('EMPLOYEE_NOT_FOUND');
  if (recipientRecord.status !== 'ACTIVE') throw new AppError('RECIPIENT_INACTIVE');
  if (!recipientRecord.canReceiveHours) throw new AppError('RECIPIENT_CANNOT_RECEIVE_HOURS');

  const allocationsWithId = budget.allocations.map((a) => ({
    id: a.id,
    budgetId: a.budgetId,
    allocatedByEmployeeId: a.allocatedByEmployeeId,
    allocatedToEmployeeId: a.allocatedToEmployeeId,
    allocatedMinutes: a.allocatedMinutes,
    status: a.status as 'ACTIVE' | 'REVOKED',
  }));

  let allocatedByEmployeeId: string | null = null;
  if (mode === 'org') {
    const validation = validateOrgPoolAllocation({
      budgets: [{ id: budget.id, budgetMinutes: budget.budgetMinutes }],
      adjustments: budget.adjustments.map((a) => ({
        customerHourBudgetId: a.customerHourBudgetId,
        adjustmentMinutes: a.adjustmentMinutes,
      })),
      allocations: allocationsWithId,
      requestedMinutes: input.minutes,
    });
    if (!validation.ok) {
      throw new AppError(validation.code, { details: { availableMinutes: validation.availableMinutes } });
    }
  } else {
    const manager = ctx.employee!;
    // Scope: Empfänger muss im eigenen Unterbaum liegen (nicht man selbst).
    const nodes = await db.employee.findMany({
      where: { organizationId: ctx.organization.id, deletedAt: null },
      select: { id: true, managerEmployeeId: true },
    });
    const subtree = collectSubtree(nodes, manager.id);
    if (!subtree.includes(input.toEmployeeId)) {
      throw new AppError('ACCESS_DENIED', {
        message: 'Stunden können nur an eigene (untergeordnete) Mitarbeiter weitergegeben werden.',
      });
    }
    const validation = validateManagerPoolAllocation({
      allocations: allocationsWithId,
      managerEmployeeId: manager.id,
      requestedMinutes: input.minutes,
    });
    if (!validation.ok) {
      throw new AppError(validation.code, { details: { availableMinutes: validation.availableMinutes } });
    }
    allocatedByEmployeeId = manager.id;
  }

  const allocation = await db.$transaction(async (tx) => {
    const created = await tx.hourAllocation.create({
      data: {
        organizationId: ctx.organization.id,
        customerId: input.customerId,
        budgetId: input.budgetId,
        allocatedByEmployeeId,
        allocatedToEmployeeId: input.toEmployeeId,
        allocatedMinutes: input.minutes,
        validFrom: budget.periodStart,
        validUntil: budget.periodEnd,
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
    const customer = await db.customer.findUnique({
      where: { id: input.customerId },
      select: { firstName: true, lastName: true },
    });
    await createNotification({
      organizationId: ctx.organization.id,
      userId: recipientRecord.user.id,
      type: 'HOURS_ALLOCATED',
      title: 'Stunden erhalten',
      message: `Dir wurden ${Math.round(input.minutes / 60 * 100) / 100} Std. für ${customer?.firstName ?? ''} ${customer?.lastName ?? ''} übertragen.`,
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
