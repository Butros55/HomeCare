'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, Minus } from 'lucide-react';
import * as React from 'react';

import { cn, colorFromId, initialsOf } from '@/lib/utils';

// ------------------------------- Avatar ------------------------------------

export function EntityAvatar({
  id,
  name,
  color,
  size = 'md',
  className,
}: {
  id: string;
  name: string;
  color?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClasses = {
    xs: 'size-5 text-[9px]',
    sm: 'size-6 text-[10px]',
    md: 'size-8 text-[length:var(--text-xs)]',
    lg: 'size-12 text-[length:var(--text-base)]',
  }[size];
  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none',
        sizeClasses,
        className,
      )}
      style={{ backgroundColor: color || colorFromId(id) }}
    >
      <AvatarPrimitive.Fallback delayMs={0}>{initialsOf(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

// ------------------------------ Separator ----------------------------------

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(
        'shrink-0 bg-[var(--color-line-subtle)]',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

// ------------------------------- Switch ------------------------------------

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
        'pointer-coarse:h-7 pointer-coarse:w-12',
        'data-[state=checked]:bg-[var(--color-brand)] data-[state=unchecked]:bg-[var(--color-line-strong)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-4 rounded-full bg-white shadow transition-transform',
          'data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5',
          'pointer-coarse:size-6 pointer-coarse:data-[state=checked]:translate-x-[22px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
});

// ------------------------------ Checkbox -----------------------------------

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[var(--color-line-strong)] bg-[var(--color-panel)] transition-colors',
        'pointer-coarse:size-5',
        'data-[state=checked]:border-[var(--color-brand)] data-[state=checked]:bg-[var(--color-brand)] data-[state=indeterminate]:border-[var(--color-brand)] data-[state=indeterminate]:bg-[var(--color-brand)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-white">
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3" aria-hidden />
        ) : (
          <Check className="size-3" aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

// ------------------------------- Tooltip -----------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-[var(--radius-md)] bg-[var(--color-ink)] px-2.5 py-1.5 text-[length:var(--text-xs)] text-[var(--color-ink-inverse)] shadow-[var(--shadow-popover)]"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ------------------------------ Skeleton -----------------------------------

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)]', className)}
      aria-hidden
      {...props}
    />
  );
}

// ------------------------------- Spinner -----------------------------------

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Lädt"
      className={cn(
        'size-5 animate-spin rounded-full border-2 border-[var(--color-line-strong)] border-t-[var(--color-brand)]',
        className,
      )}
    />
  );
}
