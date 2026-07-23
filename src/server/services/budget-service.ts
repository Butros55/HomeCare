import 'server-only';

import { fromDateInputValue } from '@/lib/dates';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { assertSameOrg, requirePermission } from '@/server/permissions';

/**
 * Kundenbudgets (gebuchte Stunden) und bewusste Korrekturbuchungen.
 * Nur Rollen mit budgets.manage; Überziehungen des Budgets sind ausschließlich
 * über eine Korrekturbuchung mit Begründung möglich (Anforderung 6).
 */

export async function createBudget(input: {
  customerId: string;
  periodStart: string;
  periodEnd: string;
  budgetMinutes: number;
  sourceType: 'CONTRACT' | 'INSURANCE' | 'PRIVATE' | 'OTHER';
  note?: string;
}): Promise<{ budgetId: string }> {
  const ctx = await requirePermission('budgets.manage');
  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  assertSameOrg(ctx, customer);

  const periodStart = fromDateInputValue(input.periodStart);
  const periodEnd = fromDateInputValue(input.periodEnd);
  if (!periodStart || !periodEnd || periodEnd < periodStart) {
    throw new AppError('VALIDATION_FAILED', { message: 'Bitte einen gültigen Zeitraum wählen.' });
  }
  if (!Number.isInteger(input.budgetMinutes) || input.budgetMinutes <= 0) {
    throw new AppError('VALIDATION_FAILED', { message: 'Das Budget muss größer als 0 sein.' });
  }

  const budget = await db.$transaction(async (tx) => {
    const created = await tx.customerHourBudget.create({
      data: {
        organizationId: ctx.organization.id,
        customerId: input.customerId,
        periodStart,
        periodEnd,
        budgetMinutes: input.budgetMinutes,
        sourceType: input.sourceType,
        note: input.note || null,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'budget.created',
        entityType: 'Customer',
        entityId: input.customerId,
        metadata: {
          budgetId: created.id,
          budgetMinutes: input.budgetMinutes,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      },
      tx,
    );
    return created;
  });
  return { budgetId: budget.id };
}

/** Korrekturbuchung: bewusste Auf-/Abwertung eines Budgets mit Begründung. */
export async function adjustBudget(input: {
  budgetId: string;
  adjustmentMinutes: number;
  reason: string;
}): Promise<void> {
  const ctx = await requirePermission('budgets.manage');
  const budget = await db.customerHourBudget.findUnique({
    where: { id: input.budgetId },
    include: { adjustments: true, allocations: { where: { status: 'ACTIVE' } } },
  });
  if (!budget) throw new AppError('BUDGET_NOT_FOUND');
  assertSameOrg(ctx, budget);

  if (!Number.isInteger(input.adjustmentMinutes) || input.adjustmentMinutes === 0) {
    throw new AppError('VALIDATION_FAILED', { message: 'Die Korrektur darf nicht 0 sein.' });
  }
  if (!input.reason.trim()) {
    throw new AppError('VALIDATION_FAILED', { message: 'Bitte eine Begründung angeben.' });
  }

  // Kürzungen dürfen das Budget nicht unter die bereits zugewiesenen Minuten drücken.
  if (input.adjustmentMinutes < 0) {
    const total =
      budget.budgetMinutes + budget.adjustments.reduce((sum, a) => sum + a.adjustmentMinutes, 0);
    const orgAllocated = budget.allocations
      .filter((a) => a.allocatedByEmployeeId === null)
      .reduce((sum, a) => sum + a.allocatedMinutes, 0);
    if (total + input.adjustmentMinutes < orgAllocated) {
      throw new AppError('HOUR_BUDGET_EXCEEDED', {
        message: `Es sind bereits ${orgAllocated} Minuten zugewiesen – zuerst Zuweisungen zurückziehen.`,
      });
    }
  }

  await db.$transaction(async (tx) => {
    await tx.customerHourAdjustment.create({
      data: {
        customerHourBudgetId: input.budgetId,
        adjustmentMinutes: input.adjustmentMinutes,
        reason: input.reason.trim(),
        createdByUserId: ctx.user.id,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'budget.adjusted',
        entityType: 'Customer',
        entityId: budget.customerId,
        metadata: { budgetId: input.budgetId, adjustmentMinutes: input.adjustmentMinutes },
      },
      tx,
    );
  });
}

/** Budget löschen – nur ohne aktive Zuweisungen. */
export async function deleteBudget(budgetId: string): Promise<void> {
  const ctx = await requirePermission('budgets.manage');
  const budget = await db.customerHourBudget.findUnique({
    where: { id: budgetId },
    include: { allocations: { where: { status: 'ACTIVE' }, select: { id: true } } },
  });
  if (!budget) throw new AppError('BUDGET_NOT_FOUND');
  assertSameOrg(ctx, budget);
  if (budget.allocations.length > 0) {
    throw new AppError('CONFLICT', {
      message: 'Das Budget hat aktive Zuweisungen und kann nicht gelöscht werden.',
    });
  }

  await db.$transaction(async (tx) => {
    await tx.customerHourBudget.delete({ where: { id: budgetId } });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'budget.deleted',
        entityType: 'Customer',
        entityId: budget.customerId,
        metadata: { budgetId },
      },
      tx,
    );
  });
}
