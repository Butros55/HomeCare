'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Dialog-Inhalt: mittig auf Desktop, als Bottom-Sheet auf Mobilgeräten
 * (Anforderung 8 – „Dialoge als Bottom-Sheets").
 */
export function DialogContent({
  className,
  children,
  title,
  description,
  wide = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  wide?: boolean;
}) {
  // Läuft eine Hinweis-Tour, darf ein Klick auf deren Popover/Overlay den
  // Dialog nicht schließen (Radix wertet ihn sonst als "outside interaction").
  const tourActive = () =>
    typeof document !== 'undefined' && document.querySelector('[data-tour-overlay]') !== null;

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="animate-overlay-in fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
      <DialogPrimitive.Content
        onPointerDownOutside={(event) => {
          if (tourActive()) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (tourActive()) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (tourActive()) event.preventDefault();
        }}
        className={cn(
          // Mobil: Bottom-Sheet. overflow-x-hidden: Dialoge scrollen nie seitlich –
          // Felder müssen sich der Dialogbreite anpassen (Inputs sind min-w-0).
          'animate-sheet-in fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] w-full overflow-x-hidden overflow-y-auto rounded-t-[var(--radius-xl)]',
          // Desktop: zentriert
          'sm:animate-pop-in sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-xl)]',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
          'border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-5 shadow-[var(--shadow-popover)]',
          className,
        )}
        {...props}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--color-line-strong)] sm:hidden" aria-hidden />
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-[length:var(--text-lg)] font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            className="rounded-[var(--radius-xs)] p-1 text-[var(--color-ink-subtle)] transition-colors hover:bg-[var(--color-panel-raised)] hover:text-[var(--color-ink)]"
            aria-label="Schließen"
          >
            <X className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Fußzeile mit rechtsbündigen Aktionen. */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}
