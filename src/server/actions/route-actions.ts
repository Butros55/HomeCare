'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { runAction, type ActionResult } from '@/server/errors';
import {
  computeRoutePlan,
  discardRoutePlan,
  getRoutePlanningData,
  saveRoutePlan,
  type ComputedRoute,
} from '@/server/services/route-service';

export async function getRoutePlanningDataAction(employeeId: string, date: string) {
  return runAction(() => getRoutePlanningData(employeeId, date));
}

const computeSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  appointmentIds: z.array(z.string().min(1)).min(1).max(30),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  bufferMinutes: z.number().int().min(0).max(120),
  returnToStart: z.boolean(),
  start: z.object({ latitude: z.number(), longitude: z.number(), label: z.string().optional() }),
  end: z.object({ latitude: z.number(), longitude: z.number(), label: z.string().optional() }),
  manualOrder: z.boolean().optional(),
});
export type ComputeRouteActionInput = z.input<typeof computeSchema>;

export async function computeRouteAction(
  input: ComputeRouteActionInput,
): Promise<ActionResult<ComputedRoute>> {
  return runAction(async () => {
    const data = computeSchema.parse(input);
    return computeRoutePlan(data);
  });
}

export async function saveRouteAction(
  input: ComputeRouteActionInput,
  publish: boolean,
): Promise<ActionResult<{ routePlanId: string }>> {
  return runAction(async () => {
    const data = computeSchema.parse(input);
    const result = await saveRoutePlan({ ...data, publish });
    revalidatePath('/routes');
    revalidatePath('/dashboard');
    return result;
  });
}

export async function discardRouteAction(
  employeeId: string,
  date: string,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await discardRoutePlan(employeeId, date);
    revalidatePath('/routes');
    return { done: true as const };
  });
}
