'use client';

import { Bell, Check, CheckCheck, Mail, MailOpen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/server/actions/notification-actions';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  targetUrl: string | null;
  readAt: string | null;
  createdAt: string;
  createdAtLabel: string;
}

export function NotificationList({ items }: { items: NotificationItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const unreadCount = items.filter((item) => !item.readAt).length;

  const toggleRead = (item: NotificationItem) => {
    startTransition(async () => {
      const result = await markNotificationReadAction(item.id, !item.readAt);
      if (result.ok) router.refresh();
      else toast.error(result.message);
    });
  };

  const markAll = () => {
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (result.ok) {
        toast.success('Alle Benachrichtigungen als gelesen markiert.');
        router.refresh();
      } else toast.error(result.message);
    });
  };

  const open = (item: NotificationItem) => {
    if (!item.readAt) {
      startTransition(async () => {
        await markNotificationReadAction(item.id, true);
        router.refresh();
      });
    }
  };

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Bell />}
        title="Keine Benachrichtigungen"
        description="Neue Ereignisse – Zuweisungen, Änderungen, Konflikte – erscheinen hier."
      />
    );
  }

  return (
    <div className="space-y-3">
      {unreadCount > 0 ? (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={markAll} loading={pending}>
            <CheckCheck aria-hidden /> Alle als gelesen markieren
          </Button>
        </div>
      ) : null}
      <ul className="space-y-2">
        {items.map((item) => {
          const inner = (
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
                    'block text-[length:var(--text-sm)]',
                    item.readAt ? 'text-[var(--color-ink-muted)]' : 'font-semibold',
                  )}
                >
                  {item.title}
                </span>
                <span className="block text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                  {item.message}
                </span>
                <span className="mt-0.5 block text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                  {item.createdAtLabel}
                </span>
              </span>
            </>
          );
          return (
            <li
              key={item.id}
              className={cn(
                'flex items-start gap-3 rounded-[var(--radius-xl)] border bg-[var(--color-panel)] p-3.5 shadow-[var(--shadow-panel)] transition-colors',
                item.readAt
                  ? 'border-[var(--color-line-subtle)]'
                  : 'border-[var(--color-brand)]/40',
              )}
            >
              {item.targetUrl ? (
                <Link
                  href={item.targetUrl}
                  onClick={() => open(item)}
                  className="flex min-w-0 flex-1 items-start gap-3"
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex min-w-0 flex-1 items-start gap-3">{inner}</div>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={item.readAt ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
                onClick={() => toggleRead(item)}
                disabled={pending}
              >
                {item.readAt ? <Mail aria-hidden /> : <MailOpen aria-hidden />}
              </Button>
              {!item.readAt ? (
                <span className="mt-2 size-2 shrink-0 rounded-full bg-[var(--color-brand)]" aria-label="Ungelesen" />
              ) : (
                <Check className="mt-1.5 size-4 shrink-0 text-[var(--color-ink-subtle)]" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
