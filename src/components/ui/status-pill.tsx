'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Getönte Status-Pille: pastellige Tönung der Statusfarbe, der gesättigte
 * Farbton bleibt Text und Punkt vorbehalten. Der Farbton ist immer ein
 * Token-Lookup – nie ein Inline-Hex.
 */
export type StatusTone = 'todo' | 'progress' | 'review' | 'done' | 'stuck' | 'hold' | 'neutral';

function toneColors(tone: StatusTone): { bg: string; fg: string } {
  if (tone === 'neutral') {
    return { bg: 'var(--color-panel-raised)', fg: 'var(--color-ink-muted)' };
  }
  return { bg: `var(--color-status-${tone}-soft)`, fg: `var(--color-status-${tone})` };
}

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  block?: boolean;
  size?: 'sm' | 'md';
  withDot?: boolean;
}

export function StatusPill({
  tone = 'neutral',
  block = false,
  size = 'md',
  withDot = true,
  className,
  children,
  ...props
}: StatusPillProps) {
  const colors = toneColors(tone);
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full leading-none font-medium',
        size === 'sm'
          ? 'h-5 px-2 text-[length:var(--text-2xs)]'
          : 'h-6 px-2.5 text-[length:var(--text-xs)]',
        block ? 'w-full' : '',
        className,
      )}
      style={{ backgroundColor: colors.bg, color: colors.fg }}
      {...props}
    >
      {withDot ? (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: 'currentColor' }}
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}

/** Konflikt-/Schwere-Pille (INFO/WARNING/ERROR → low/high/urgent). */
export type SeverityTone = 'low' | 'medium' | 'high' | 'urgent';

export function SeverityPill({
  tone,
  className,
  children,
  ...props
}: { tone: SeverityTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center justify-center rounded-full px-2 text-[length:var(--text-2xs)] font-semibold',
        className,
      )}
      style={{
        backgroundColor: `var(--color-priority-${tone}-soft)`,
        color: `var(--color-priority-${tone})`,
      }}
      {...props}
    >
      {children}
    </span>
  );
}

/** Neutraler Zähler-Badge (z. B. ungelesene Benachrichtigungen). */
export function CountBadge({
  count,
  className,
  max = 99,
}: {
  count: number;
  className?: string;
  max?: number;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] leading-none font-semibold text-white',
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
