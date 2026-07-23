'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { runAction, type ActionResult } from '@/server/errors';
import { adjustBudget, createBudget, deleteBudget } from '@/server/services/budget-service';

const createSchema = z.object({
  customerId: z.string().min(1),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  budgetMinutes: z.number().int().positive(),
  sourceType: z.enum(['CONTRACT', 'INSURANCE', 'PRIVATE', 'OTHER']),
  note: z.string().trim().max(500).optional(),
});

export async function createBudgetAction(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ budgetId: string }>> {
  return runAction(async () => {
    const data = createSchema.parse(input);
    const result = await createBudget(data);
    revalidatePath(`/customers/${data.customerId}`);
    revalidatePath('/customers');
    return result;
  });
}

const adjustSchema = z.object({
  budgetId: z.string().min(1),
  customerId: z.string().min(1),
  adjustmentMinutes: z.number().int(),
  reason: z.string().trim().min(1, 'Bitte eine Begründung angeben.').max(500),
});

export async function adjustBudgetAction(
  input: z.input<typeof adjustSchema>,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const data = adjustSchema.parse(input);
    await adjustBudget(data);
    revalidatePath(`/customers/${data.customerId}`);
    revalidatePath('/customers');
    return { done: true as const };
  });
}

export async function deleteBudgetAction(
  budgetId: string,
  customerId: string,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await deleteBudget(budgetId);
    revalidatePath(`/customers/${customerId}`);
    revalidatePath('/customers');
    return { done: true as const };
  });
}
