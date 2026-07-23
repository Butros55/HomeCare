'use client';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Bestätigungsdialog für destruktive oder folgenreiche Aktionen.
 * Nutzt Radix AlertDialog (Fokusfalle, ESC, ARIA) – niemals window.confirm.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  destructive = false,
  loading = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  children?: React.ReactNode;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="animate-overlay-in fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
        <AlertDialogPrimitive.Content
          className={cn(
            'animate-sheet-in fixed inset-x-0 bottom-0 z-50 w-full rounded-t-[var(--radius-xl)]',
            'sm:animate-pop-in sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-xl)]',
            'border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-5 shadow-[var(--shadow-popover)]',
          )}
        >
          <AlertDialogPrimitive.Title className="text-[length:var(--text-lg)] font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          {description ? (
            <AlertDialogPrimitive.Description className="mt-1.5 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              {description}
            </AlertDialogPrimitive.Description>
          ) : null}
          {children}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="ghost" disabled={loading}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              loading={loading}
              onClick={async (event) => {
                event.preventDefault();
                await onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
