'use client';

import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import {
  bottomNavItems,
  moreNavItems,
  type NavPermissions,
} from '@/components/layout/nav-items';
import { CountBadge } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';

/**
 * Mobile Bottom-Navigation (max. 4 Hauptpunkte + „Mehr“-Sheet).
 * Große Touch-Ziele (min. 48px), sichtbarer aktiver Zustand.
 */
export function BottomNav({
  permissions,
  unreadNotifications = 0,
}: {
  permissions: NavPermissions;
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const main = bottomNavItems(permissions);
  const more = moreNavItems(permissions);
  const moreActive = more.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="animate-overlay-in absolute inset-0 bg-black/40"
            onClick={() => setMoreOpen(false)}
            aria-label="Menü schließen"
          />
          <div className="animate-sheet-in absolute inset-x-0 bottom-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] rounded-t-[var(--radius-xl)] border-t border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-3 pb-4 shadow-[var(--shadow-popover)]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--color-line-strong)]" aria-hidden />
            <ul className="grid grid-cols-3 gap-2">
              {more.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                const showBadge = item.href === '/notifications' && unreadNotifications > 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-2 py-2 text-[length:var(--text-xs)]',
                        active
                          ? 'bg-[var(--color-brand-subtle)] font-medium text-[var(--color-brand)]'
                          : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-panel-raised)]',
                      )}
                    >
                      <span className="relative">
                        <Icon className="size-5" aria-hidden />
                        {showBadge ? (
                          <CountBadge count={unreadNotifications} className="absolute -top-1.5 -right-2.5" />
                        ) : null}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Mobile Navigation"
        // Höhe = Navigationsleiste + Safe-Area (sonst quetscht das iOS-Inset
        // die Buttons nach oben zusammen und die Labels laufen über).
        className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] items-stretch border-t border-[var(--color-line-subtle)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {main.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const showBadge = item.href === '/notifications' && unreadNotifications > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px]',
                active
                  ? 'font-medium text-[var(--color-brand)]'
                  : 'text-[var(--color-ink-muted)]',
              )}
            >
              <span
                className={cn(
                  'relative flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                  active && 'bg-[var(--color-brand-subtle)]',
                )}
              >
                <Icon className="size-4.5" aria-hidden />
                {showBadge ? (
                  <CountBadge count={unreadNotifications} className="absolute -top-0.5 right-0.5" />
                ) : null}
              </span>
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        {more.length > 0 ? (
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px]',
              moreActive ? 'font-medium text-[var(--color-brand)]' : 'text-[var(--color-ink-muted)]',
            )}
          >
            <span
              className={cn(
                'relative flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                moreActive && 'bg-[var(--color-brand-subtle)]',
              )}
            >
              <MoreHorizontal className="size-4.5" aria-hidden />
              {unreadNotifications > 0 &&
              more.some((item) => item.href === '/notifications') ? (
                <CountBadge count={unreadNotifications} className="absolute -top-0.5 right-0.5" />
              ) : null}
            </span>
            <span>Mehr</span>
          </button>
        ) : null}
      </nav>
    </>
  );
}
