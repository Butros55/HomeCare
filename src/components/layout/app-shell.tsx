'use client';

import * as React from 'react';

import { BottomNav } from '@/components/layout/bottom-nav';
import { CommandPalette, type SearchResultItem } from '@/components/layout/command-palette';
import type { NavPermissions, NavUiMode } from '@/components/layout/nav-items';
import { Sidebar } from '@/components/layout/sidebar';
import type { NotificationPreviewItem } from '@/components/layout/notification-popover';
import { Topbar, type TopbarOrganization } from '@/components/layout/topbar';
import { TourProvider } from '@/features/tours/tour-provider';
import type { TourProgressSnapshot } from '@/server/actions/tour-actions';
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
  uiMode = 'team',
  canCreate,
  canManageEmployees,
  personalViewToggle = null,
  unreadNotifications,
  recentNotifications,
  tourProgress = [],
  onSearch,
  children,
}: {
  appName: string;
  organizationName: string;
  organizations: TopbarOrganization[];
  activeOrganizationId: string;
  user: { id: string; name: string; email: string };
  permissions: NavPermissions;
  uiMode?: NavUiMode;
  canCreate: boolean;
  canManageEmployees: boolean;
  personalViewToggle?: { personalView: boolean } | null;
  unreadNotifications: number;
  recentNotifications: NotificationPreviewItem[];
  tourProgress?: TourProgressSnapshot[];
  onSearch?: (query: string) => Promise<SearchResultItem[]>;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = usePersistedBoolean(COLLAPSE_STORAGE_KEY, false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  return (
    <TourProvider permissions={permissions} uiMode={uiMode} initialProgress={tourProgress}>
    {/* Topbar liegt in voller Breite ÜBER Sidebar + Inhalt: die ein-/ausklappbare
        Navigation beeinflusst den Header damit nie (kein Abschneiden rechts). */}
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-canvas)]">
      <Topbar
        appName={appName}
        user={user}
        organizations={organizations}
        activeOrganizationId={activeOrganizationId}
        unreadNotifications={unreadNotifications}
        recentNotifications={recentNotifications}
        canCreate={canCreate}
        canManageEmployees={canManageEmployees}
        personalViewToggle={personalViewToggle}
        onOpenSearch={() => setPaletteOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          organizationName={organizationName}
          permissions={permissions}
          uiMode={uiMode}
          unreadNotifications={unreadNotifications}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          className="hidden md:flex"
        />

        {/* overflow-x-hidden: Seiten scrollen nie horizontal – breite Inhalte
            (Tabellen, Tab-Leisten) scrollen in ihren eigenen Containern. */}
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
      </div>

      <BottomNav permissions={permissions} uiMode={uiMode} unreadNotifications={unreadNotifications} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        permissions={permissions}
        uiMode={uiMode}
        canCreate={canCreate}
        onSearch={onSearch}
      />
    </div>
    </TourProvider>
  );
}
