'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { runAction, type ActionResult } from '@/server/errors';
import {
  createHourCorrection,
  createHourTopup,
  createRecurringGrant,
  setRecurringGrantActive,
  updateRecurringGrant,
} from '@/server/services/account-service';

/** Stundenkonto: Aufladungen, Korrekturen und wiederkehrende Regeln. */

function revalidateCustomer(customerId: string) {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath('/customers');
  revalidatePath('/dashboard');
}

const topupSchema = z.object({
  customerId: z.string().min(1),
  minutes: z.number().int().positive(),
  note: z.string().trim().max(500).optional(),
  effectiveOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function createTopupAction(
  input: z.input<typeof topupSchema>,
): Promise<ActionResult<{ topupId: string }>> {
  return runAction(async () => {
    const data = topupSchema.parse(input);
    const result = await createHourTopup(data);
    revalidateCustomer(data.customerId);
    return result;
  });
}

const correctionSchema = z.object({
  customerId: z.string().min(1),
  minutes: z
    .number()
    .int()
    .refine((value) => value !== 0, 'Die Korrektur darf nicht 0 sein.'),
  reason: z.string().trim().min(1, 'Bitte eine Begründung angeben.').max(500),
});

export async function createCorrectionAction(
  input: z.input<typeof correctionSchema>,
): Promise<ActionResult<{ topupId: string }>> {
  return runAction(async () => {
    const data = correctionSchema.parse(input);
    const result = await createHourCorrection(data);
    revalidateCustomer(data.customerId);
    return result;
  });
}

const grantCreateSchema = z.object({
  customerId: z.string().min(1),
  minutes: z.number().int().positive(),
  intervalUnit: z.enum(['WEEK', 'MONTH']),
  intervalCount: z.number().int().min(1).max(24),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  note: z.string().trim().max(500).optional(),
});

export async function createRecurringGrantAction(
  input: z.input<typeof grantCreateSchema>,
): Promise<ActionResult<{ grantId: string }>> {
  return runAction(async () => {
    const data = grantCreateSchema.parse(input);
    const result = await createRecurringGrant(data);
    revalidateCustomer(data.customerId);
    return result;
  });
}

const grantUpdateSchema = z.object({
  grantId: z.string().min(1),
  customerId: z.string().min(1),
  minutes: z.number().int().positive(),
  intervalUnit: z.enum(['WEEK', 'MONTH']),
  intervalCount: z.number().int().min(1).max(24),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  note: z.string().trim().max(500).optional(),
});

export async function updateRecurringGrantAction(
  input: z.input<typeof grantUpdateSchema>,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const data = grantUpdateSchema.parse(input);
    await updateRecurringGrant({
      grantId: data.grantId,
      minutes: data.minutes,
      intervalUnit: data.intervalUnit,
      intervalCount: data.intervalCount,
      endDate: data.endDate ?? null,
      note: data.note,
    });
    revalidateCustomer(data.customerId);
    return { done: true as const };
  });
}

const grantActiveSchema = z.object({
  grantId: z.string().min(1),
  customerId: z.string().min(1),
  active: z.boolean(),
});

export async function setGrantActiveAction(
  input: z.input<typeof grantActiveSchema>,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const data = grantActiveSchema.parse(input);
    await setRecurringGrantActive(data.grantId, data.active);
    revalidateCustomer(data.customerId);
    return { done: true as const };
  });
}
