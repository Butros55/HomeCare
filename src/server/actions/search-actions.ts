'use server';

import type { SearchResultItem } from '@/components/layout/command-palette';
import { globalSearch } from '@/server/services/search-service';

/** Globale Suche für die Befehls-/Suchpalette (Strg+K). */
export async function globalSearchAction(query: string): Promise<SearchResultItem[]> {
  try {
    return await globalSearch(String(query ?? '').slice(0, 100));
  } catch {
    return [];
  }
}
