'use server';

import { requireOrganizationMembership } from '@/server/permissions';
import { suggestAddressesCached } from '@/server/providers/geocoding';
import type { AddressSuggestion } from '@/server/providers/types';

/**
 * Adress-Autocomplete für Formulare. Sessiongebunden (kein offener
 * Geocoding-Proxy); Fehler werden bewusst zu einer leeren Liste –
 * die Felder bleiben immer manuell ausfüllbar.
 */
export async function suggestAddressesAction(query: string): Promise<AddressSuggestion[]> {
  try {
    await requireOrganizationMembership();
    const trimmed = String(query ?? '').trim();
    if (trimmed.length < 3) return [];
    return await suggestAddressesCached(trimmed.slice(0, 120));
  } catch {
    return [];
  }
}
