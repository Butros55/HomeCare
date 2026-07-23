import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Klassen zusammenführen; spätere Tailwind-Utilities gewinnen. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Anzeigename für Mitarbeiter-Auswahlfelder: Das eigene Profil (Leitung, die
 * sich selbst zuweist) wird als „Name (Ich)“ markiert.
 */
export function employeeDisplayName(
  employee: { firstName: string; lastName: string; userId?: string | null },
  currentUserId?: string | null,
): string {
  const base = `${employee.firstName} ${employee.lastName}`;
  return currentUserId && employee.userId === currentUserId ? `${base} (Ich)` : base;
}

/** Initialen aus einem Namen ("Anna Berg" → "AB"). */
export function initialsOf(name: string | null | undefined, fallback = '··'): string {
  if (!name?.trim()) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

/**
 * Deterministische Farbe für eine Entität – derselbe Datensatz erhält überall
 * (Kalender, Karte, Avatar) denselben Farbton.
 */
export function colorFromId(id: string, palette: readonly string[] = GROUP_COLORS): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % palette.length;
  return palette[index] ?? palette[0] ?? '#6c5ce7';
}

export const GROUP_COLORS = [
  'var(--color-group-1)',
  'var(--color-group-2)',
  'var(--color-group-3)',
  'var(--color-group-4)',
  'var(--color-group-5)',
  'var(--color-group-6)',
  'var(--color-group-7)',
  'var(--color-group-8)',
] as const;

/** Konkrete Hex-Palette für Datensätze, die eine gespeicherte Farbe brauchen (Kundenfarbe). */
export const ENTITY_COLOR_CHOICES = [
  '#6c5ce7',
  '#10b981',
  '#f59e0b',
  '#a855f7',
  '#f43f5e',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#3e6de0',
  '#d98324',
] as const;
