'use client';

import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { navSectionsFor, type NavPermissions, type NavUiMode } from '@/components/layout/nav-items';
import { CountBadge } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';

export function Sidebar({
  organizationName,
  permissions,
  uiMode = 'team',
  unreadNotifications = 0,
  collapsed,
  onToggle,
  onNavigate,
  className,
}: {
  organizationName: string;
  permissions: NavPermissions;
  uiMode?: NavUiMode;
  unreadNotifications?: number;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();

  const isActive = React.useCallback(
    (href: string) => pathname === href || pathname.startsWith(`${href}/`),
    [pathname],
  );

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-[var(--color-line-subtle)] bg-[var(--color-surface)] transition-[width] duration-150',
        collapsed ? 'w-[var(--spacing-sidebar-collapsed)]' : 'w-[var(--spacing-sidebar)]',
        className,
      )}
      aria-label="Hauptnavigation"
    >
      {/* Die Marke sitzt in der Topbar – hier nur der Organisations-Chip. */}
      {!collapsed ? (
        <div className="px-3 pt-3 pb-2">
          <div className="truncate rounded-[var(--radius-md)] bg-[var(--color-panel-raised)] px-2.5 py-1.5 text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">
            {organizationName}
          </div>
        </div>
      ) : null}

      <nav className="flex-1 scrollbar-none overflow-y-auto px-2 py-3">
        {navSectionsFor(uiMode).map((section, sectionIndex) => {
          const visible = section.items.filter(
            (item) => !item.requires || permissions[item.requires],
          );
          if (visible.length === 0) return null;

          return (
            <div key={section.title ?? `section-${sectionIndex}`} className="mb-4 last:mb-0">
              {section.title && !collapsed ? (
                <div className="mb-1 px-2 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
                  {section.title}
                </div>
              ) : null}
              <ul className="space-y-0.5">
                {visible.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  const showBadge = item.href === '/notifications' && unreadNotifications > 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          'flex h-8.5 items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 text-[length:var(--text-sm)] transition-colors',
                          'pointer-coarse:h-12 pointer-coarse:text-[length:var(--text-base)]',
                          collapsed && 'justify-center px-0',
                          active
                            ? 'bg-[var(--color-brand-subtle)] font-medium text-[var(--color-brand)]'
                            : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-panel-raised)] hover:text-[var(--color-ink)]',
                        )}
                      >
                        <span className="relative shrink-0">
                          <Icon className="size-4" aria-hidden />
                          {collapsed && showBadge ? (
                            <span className="absolute -top-1 -right-1 size-2 rounded-full bg-[var(--color-danger)]" />
                          ) : null}
                        </span>
                        {!collapsed ? (
                          <>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {showBadge ? <CountBadge count={unreadNotifications} /> : null}
                          </>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-[var(--color-line-subtle)] p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Navigation ausklappen' : 'Navigation einklappen'}
          className="flex h-7 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] text-[var(--color-ink-subtle)] transition-colors hover:bg-[var(--color-panel-raised)] hover:text-[var(--color-ink)] pointer-coarse:h-11"
        >
          {collapsed ? (
            <ChevronsRight className="size-4" aria-hidden />
          ) : (
            <>
              <ChevronsLeft className="size-4" aria-hidden />
              <span className="text-[length:var(--text-xs)]">Einklappen</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
