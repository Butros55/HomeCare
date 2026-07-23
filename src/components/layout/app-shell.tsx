'use client';

import * as React from 'react';

import { BottomNav } from '@/components/layout/bottom-nav';
import { CommandPalette, type SearchResultItem } from '@/components/layout/command-palette';
import type { NavPermissions } from '@/components/layout/nav-items';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar, type TopbarOrganization } from '@/components/layout/topbar';
import { usePersistedBoolean } from '@/lib/persisted-state';

const COLLAPSE_STORAGE_KEY = 'hcp.sidebar.collapsed';

/**
 * Authentifiziertes Layout: links die Sidebar (Desktop), oben die Topbar,
 * unten die Bottom-Navigation (Mobil), dazwischen der scrollende Inhalt.
 */
export function AppShell({
  appName,
  organizationName,
  organizations,
  activeOrganizationId,
  user,
  permissions,
  canCreate,
  canManageEmployees,
  unreadNotifications,
  onSearch,
  children,
}: {
  appName: string;
  organizationName: string;
  organizations: TopbarOrganization[];
  activeOrganizationId: string;
  user: { id: string; name: string; email: string };
  permissions: NavPermissions;
  canCreate: boolean;
  canManageEmployees: boolean;
  unreadNotifications: number;
  onSearch?: (query: string) => Promise<SearchResultItem[]>;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = usePersistedBoolean(COLLAPSE_STORAGE_KEY, false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--color-canvas)]">
      <Sidebar
        appName={appName}
        organizationName={organizationName}
        permissions={permissions}
        unreadNotifications={unreadNotifications}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        className="hidden md:flex"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
          unreadNotifications={unreadNotifications}
          canCreate={canCreate}
          canManageEmployees={canManageEmployees}
          onOpenSearch={() => setPaletteOpen(true)}
        />
        <main className="flex-1 overflow-y-auto pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
      </div>

      <BottomNav permissions={permissions} unreadNotifications={unreadNotifications} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        permissions={permissions}
        canCreate={canCreate}
        onSearch={onSearch}
      />
    </div>
  );
}
