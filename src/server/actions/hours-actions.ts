'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { runAction, type ActionResult } from '@/server/errors';
import {
  allocateHours,
  getAllocationContext,
  listAllocatableCustomers,
  revokeAllocation,
  type AllocationContext,
} from '@/server/services/allocation-service';

export async function listAllocatableCustomersAction(): Promise<
  ActionResult<Array<{ id: string; name: string; availableMinutes: number }>>
> {
  return runAction(() => listAllocatableCustomers());
}

export async function getAllocationContextAction(
  customerId: string,
): Promise<ActionResult<AllocationContext>> {
  return runAction(() => getAllocationContext(customerId));
}

const allocateSchema = z.object({
  customerId: z.string().min(1),
  toEmployeeId: z.string().min(1),
  minutes: z.number().int().positive('Die Minutenanzahl muss größer als 0 sein.'),
  note: z.string().trim().max(500).optional(),
});

export async function allocateHoursAction(
  input: z.input<typeof allocateSchema>,
): Promise<ActionResult<{ allocationId: string }>> {
  return runAction(async () => {
    const data = allocateSchema.parse(input);
    const result = await allocateHours(data);
    revalidatePath(`/customers/${data.customerId}`);
    revalidatePath('/customers');
    revalidatePath(`/employees/${data.toEmployeeId}`);
    revalidatePath('/employees');
    return result;
  });
}

export async function revokeAllocationAction(
  allocationId: string,
  customerId: string,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await revokeAllocation(allocationId);
    revalidatePath(`/customers/${customerId}`);
    revalidatePath('/customers');
    revalidatePath('/employees');
    return { done: true as const };
  });
}
