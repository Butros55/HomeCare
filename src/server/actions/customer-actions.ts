'use server';

import { revalidatePath } from 'next/cache';

import { runAction, type ActionResult } from '@/server/errors';
import {
  archiveCustomer,
  createCustomer,
  restoreCustomer,
  updateCustomer,
} from '@/server/services/customer-service';
import { customerFormSchema, type CustomerFormInput } from '@/server/validation/customer';

/**
 * Kundenadressen fließen in Karte, Routenplanung, Kalender und Dashboard ein –
 * nach jeder Änderung alle betroffenen Ansichten sofort revalidieren.
 */
function revalidateCustomerViews(customerId?: string) {
  revalidatePath('/customers');
  if (customerId) revalidatePath(`/customers/${customerId}`);
  revalidatePath('/routes');
  revalidatePath('/calendar');
  revalidatePath('/dashboard');
}

export async function createCustomerAction(
  input: CustomerFormInput,
): Promise<ActionResult<{ customerId: string }>> {
  return runAction(async () => {
    const data = customerFormSchema.parse(input);
    const result = await createCustomer(data);
    revalidateCustomerViews(result.customerId);
    return result;
  });
}

export async function updateCustomerAction(
  customerId: string,
  input: CustomerFormInput,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const data = customerFormSchema.parse(input);
    await updateCustomer(customerId, data);
    revalidateCustomerViews(customerId);
    return { done: true as const };
  });
}

export async function archiveCustomerAction(
  customerId: string,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await archiveCustomer(customerId);
    revalidateCustomerViews(customerId);
    return { done: true as const };
  });
}

export async function restoreCustomerAction(
  customerId: string,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await restoreCustomer(customerId);
    revalidateCustomerViews(customerId);
    return { done: true as const };
  });
}
