import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { APP_NAME } from '@/lib/app-config';
import { formatDateTime } from '@/lib/dates';
import { globalSearchAction } from '@/server/actions/search-actions';
import { getCurrentSession } from '@/server/auth/session';
import { db } from '@/server/db';
import {
  canTogglePersonalView,
  getOrgContext,
  hasPermission,
  navPermissionsFor,
  uiModeFor,
} from '@/server/permissions';

/**
 * Geschütztes Layout: verlangt Session + Organisationsmitgliedschaft und
 * versorgt die App-Shell mit Navigation, Rollen-Sichtbarkeit und Zählern.
 * Jede Seite/Action prüft ihre Berechtigungen zusätzlich selbst.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  const ctx = await getOrgContext();
  if (!ctx) redirect('/login');

  const [memberships, unreadNotifications, recentNotifications] = await Promise.all([
    db.organizationMembership.findMany({
      where: { userId: ctx.user.id, status: 'ACTIVE' },
      include: { organization: { select: { id: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    db.notification.count({
      where: { userId: ctx.user.id, organizationId: ctx.organization.id, readAt: null },
    }),
    db.notification.findMany({
      where: { userId: ctx.user.id, organizationId: ctx.organization.id },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        title: true,
        message: true,
        targetUrl: true,
        readAt: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <AppShell
      appName={APP_NAME}
      organizationName={ctx.organization.name}
      organizations={memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
      }))}
      activeOrganizationId={ctx.organization.id}
      user={{
        id: ctx.user.id,
        name: `${ctx.user.firstName} ${ctx.user.lastName}`,
        email: ctx.user.email,
      }}
      permissions={navPermissionsFor(ctx)}
      uiMode={uiModeFor(ctx)}
      canCreate={hasPermission(ctx, 'appointments.manage')}
      canManageEmployees={hasPermission(ctx, 'employees.manage')}
      personalViewToggle={canTogglePersonalView(ctx) ? { personalView: ctx.personalView } : null}
      unreadNotifications={unreadNotifications}
      recentNotifications={recentNotifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        targetUrl: notification.targetUrl,
        readAt: notification.readAt?.toISOString() ?? null,
        createdAtLabel: formatDateTime(notification.createdAt, ctx.organization.timezone),
      }))}
      onSearch={globalSearchAction}
    >
      {children}
    </AppShell>
  );
}
