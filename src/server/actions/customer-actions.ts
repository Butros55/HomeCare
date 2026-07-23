'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { runAction, type ActionResult } from '@/server/errors';
import {
  archiveCustomer,
  createCustomer,
  importCustomersCsv,
  restoreCustomer,
  updateCustomer,
  type CustomerImportResult,
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

const importCustomersInputSchema = z.object({
  /** CSV-Inhalt als Text (max ~2 MB – deckt 500 großzügige Zeilen ab). */
  csvText: z.string().min(1, 'Die Datei ist leer.').max(2_000_000, 'Die Datei ist zu groß (max. 2 MB).'),
  updateExisting: z.boolean().default(false),
});

export async function importCustomersAction(
  input: z.input<typeof importCustomersInputSchema>,
): Promise<ActionResult<CustomerImportResult>> {
  return runAction(async () => {
    const data = importCustomersInputSchema.parse(input);
    const result = await importCustomersCsv(data);
    if (result.created > 0 || result.updated > 0) revalidateCustomerViews();
    return result;
  });
}
