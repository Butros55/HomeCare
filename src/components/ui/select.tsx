'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({
  className,
  children,
  invalid,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { invalid?: boolean }) {
  return (
    <SelectPrimitive.Trigger
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-md)] border bg-[var(--color-panel-sunken)] px-3 text-left text-[length:var(--text-sm)] text-[var(--color-ink)]',
        'pointer-coarse:h-11 pointer-coarse:text-[16px]',
        'transition-[border-color,box-shadow,background-color] focus:border-[var(--color-brand)] focus:bg-[var(--color-panel)] focus:shadow-[0_0_0_3px_var(--color-brand-ring)] focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-[var(--color-ink-subtle)]',
        invalid
          ? 'border-[var(--color-danger)]'
          : 'border-[var(--color-line)] hover:border-[var(--color-line-strong)]',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-[var(--color-ink-subtle)]" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={4}
        className={cn(
          'animate-pop-in z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-popover)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] py-1.5 pr-2.5 pl-7 text-[length:var(--text-sm)] outline-none select-none',
        'pointer-coarse:py-3 pointer-coarse:text-[length:var(--text-base)]',
        'data-[highlighted]:bg-[var(--color-panel-raised)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 text-[var(--color-brand)]" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn(
        'px-2.5 py-1.5 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={cn('my-1 h-px bg-[var(--color-line-subtle)]', className)}
      {...props}
    />
  );
}
