'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ArrowRight, Bell, Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { CountBadge } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { markNotificationReadAction } from '@/server/actions/notification-actions';

export interface NotificationPreviewItem {
  id: string;
  title: string;
  message: string;
  targetUrl: string | null;
  readAt: string | null;
  createdAtLabel: string;
}

export function NotificationPopover({
  items,
  unreadCount,
}: {
  items: NotificationPreviewItem[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [, startTransition] = React.useTransition();

  const markRead = (item: NotificationPreviewItem) => {
    if (item.readAt) return;

    startTransition(async () => {
      const result = await markNotificationReadAction(item.id, true);
      if (result.ok) router.refresh();
      else toast.error(result.message);
    });
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={
            unreadCount > 0
              ? `Benachrichtigungen öffnen, ${unreadCount} ungelesen`
              : 'Benachrichtigungen öffnen'
          }
          className={cn(
            'relative flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] pointer-coarse:size-11',
            'transition-colors hover:bg-[var(--color-panel-raised)] hover:text-[var(--color-ink)]',
            'data-[state=open]:bg-[var(--color-brand-subtle)] data-[state=open]:text-[var(--color-brand)]',
          )}
        >
          <Bell className="size-4" aria-hidden />
          {unreadCount > 0 ? (
            <CountBadge count={unreadCount} className="absolute -top-0.5 -right-0.5" />
          ) : null}
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Neueste Benachrichtigungen"
          className={cn(
            'animate-pop-in z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden',
            'rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] shadow-[var(--shadow-popover)]',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--color-line-subtle)] px-4 py-3.5">
            <div>
              <h2 className="text-[length:var(--text-base)] font-semibold text-[var(--color-ink)]">
                Benachrichtigungen
              </h2>
              <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                {unreadCount > 0 ? `${unreadCount} ungelesen` : 'Alles gelesen'}
              </p>
            </div>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[length:var(--text-xs)] font-medium text-[var(--color-brand)] transition-colors hover:bg-[var(--color-brand-subtle)]"
            >
              Alle anzeigen
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>

          {items.length > 0 ? (
            <ul className="max-h-[min(26rem,calc(100vh-7rem))] overflow-y-auto p-2">
              {items.map((item) => {
                const content = (
                  <>
                    <span
                      className={cn(
                        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                        item.readAt
                          ? 'bg-[var(--color-panel-sunken)] text-[var(--color-ink-subtle)]'
                          : 'bg-[var(--color-brand-subtle)] text-[var(--color-brand)]',
                      )}
                      aria-hidden
                    >
                      <Bell className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-[length:var(--text-sm)]',
                          item.readAt
                            ? 'font-medium text-[var(--color-ink-muted)]'
                            : 'font-semibold text-[var(--color-ink)]',
                        )}
                      >
                        {item.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[length:var(--text-xs)] leading-relaxed text-[var(--color-ink-muted)]">
                        {item.message}
                      </span>
                      <span className="mt-1 block text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                        {item.createdAtLabel}
                      </span>
                    </span>
                    {!item.readAt ? (
                      <span
                        className="mt-2.5 size-2 shrink-0 rounded-full bg-[var(--color-brand)]"
                        aria-label="Ungelesen"
                      />
                    ) : (
                      <Check
                        className="mt-1.5 size-3.5 shrink-0 text-[var(--color-ink-subtle)]"
                        aria-hidden
                      />
                    )}
                  </>
                );

                return (
                  <li key={item.id}>
                    {item.targetUrl ? (
                      <Link
                        href={item.targetUrl}
                        onClick={() => {
                          setOpen(false);
                          markRead(item);
                        }}
                        className="flex items-start gap-3 rounded-[var(--radius-lg)] px-2.5 py-2.5 transition-colors hover:bg-[var(--color-panel-raised)]"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex items-start gap-3 rounded-[var(--radius-lg)] px-2.5 py-2.5">
                        {content}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center px-6 py-9 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-[var(--color-panel-sunken)] text-[var(--color-ink-subtle)]">
                <Bell className="size-5" aria-hidden />
              </span>
              <p className="mt-3 text-[length:var(--text-sm)] font-medium text-[var(--color-ink)]">
                Keine Benachrichtigungen
              </p>
              <p className="mt-1 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                Neue Ereignisse erscheinen hier.
              </p>
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
