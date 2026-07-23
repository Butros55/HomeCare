'use client';

import {
  Bell,
  Building2,
  CalendarPlus,
  Check,
  Clock,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Route,
  Search,
  Sun,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EntityAvatar } from '@/components/ui/misc';
import { CountBadge } from '@/components/ui/status-pill';
import { logoutAction, switchOrganizationAction } from '@/server/auth/actions';
import { cn } from '@/lib/utils';

export interface TopbarOrganization {
  id: string;
  name: string;
}

export function Topbar({
  user,
  organizations,
  activeOrganizationId,
  unreadNotifications,
  canCreate,
  canManageEmployees,
  onOpenSearch,
}: {
  user: { id: string; name: string; email: string };
  organizations: TopbarOrganization[];
  activeOrganizationId: string;
  unreadNotifications: number;
  canCreate: boolean;
  canManageEmployees: boolean;
  onOpenSearch: () => void;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <header className="flex h-[var(--spacing-topbar)] shrink-0 items-center gap-2 border-b border-[var(--color-line-subtle)] bg-[var(--color-surface)] px-3">
      {/* Eine Sucheinstiegsstelle: öffnet die Befehls-/Suchpalette (Strg+K). */}
      <button
        type="button"
        onClick={onOpenSearch}
        className={cn(
          'flex h-9 w-full max-w-md items-center gap-2.5 rounded-full border pointer-coarse:h-11 border-[var(--color-line)] bg-[var(--color-panel-sunken)] px-3.5 text-left text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]',
          'transition-[border-color,box-shadow,background-color] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-panel)] hover:shadow-[var(--shadow-panel)]',
        )}
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Suchen…</span>
        <kbd className="hidden shrink-0 rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-0.5 text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)] sm:inline-block">
          Ctrl K
        </kbd>
      </button>

      <div className="flex-1" />

      {canCreate ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Schnell anlegen"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] pointer-coarse:size-11 text-white shadow-[0_6px_16px_var(--color-brand-ring)] transition-colors hover:bg-[var(--color-brand-hover)]"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Neu anlegen</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href="/customers/new">
                <UserPlus aria-hidden /> Kunde
              </Link>
            </DropdownMenuItem>
            {canManageEmployees ? (
              <DropdownMenuItem asChild>
                <Link href="/employees/new">
                  <UsersRound aria-hidden /> Mitarbeiter
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <Link href="/calendar?neu=1">
                <CalendarPlus aria-hidden /> Termin
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/customers?stunden=1">
                <Clock aria-hidden /> Stunden verteilen
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/routes">
                <Route aria-hidden /> Route planen
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Link
        href="/notifications"
        aria-label={
          unreadNotifications > 0
            ? `Benachrichtigungen, ${unreadNotifications} ungelesen`
            : 'Benachrichtigungen'
        }
        className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] pointer-coarse:size-11 transition-colors hover:bg-[var(--color-panel-raised)] hover:text-[var(--color-ink)]"
      >
        <Bell className="size-4" aria-hidden />
        {unreadNotifications > 0 ? (
          <CountBadge count={unreadNotifications} className="absolute -top-0.5 -right-0.5" />
        ) : null}
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Benutzermenü"
            className="rounded-full transition-opacity hover:opacity-85 pointer-coarse:p-1.5"
          >
            <EntityAvatar id={user.id} name={user.name} size="md" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <div className="px-2.5 py-2">
            <div className="truncate text-[length:var(--text-sm)] font-medium">{user.name}</div>
            <div className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
              {user.email}
            </div>
          </div>

          {organizations.length > 1 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Organisation</DropdownMenuLabel>
              {organizations.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  onSelect={() => {
                    if (org.id !== activeOrganizationId) void switchOrganizationAction(org.id);
                  }}
                >
                  <Building2 aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {org.id === activeOrganizationId ? (
                    <Check className="text-[var(--color-brand)]" aria-hidden />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Darstellung</DropdownMenuLabel>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setTheme('light'); }}>
            <Sun aria-hidden /> Hell
            {theme === 'light' ? <Check className="ml-auto text-[var(--color-brand)]" aria-hidden /> : null}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setTheme('dark'); }}>
            <Moon aria-hidden /> Dunkel
            {theme === 'dark' ? <Check className="ml-auto text-[var(--color-brand)]" aria-hidden /> : null}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setTheme('system'); }}>
            <Monitor aria-hidden /> System
            {theme === 'system' ? <Check className="ml-auto text-[var(--color-brand)]" aria-hidden /> : null}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <KeyRound aria-hidden /> Einstellungen
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={() => void logoutAction()}>
            <LogOut aria-hidden /> Abmelden
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
