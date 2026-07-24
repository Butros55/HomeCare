import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/dates';
import { db } from '@/server/db';
import { hasPermission, requireOrganizationMembership } from '@/server/permissions';
import { listScopeConflicts } from '@/server/services/conflict-service';
import { ConflictNoticeList } from '@/features/notifications/conflict-notice-list';
import { NotificationList } from '@/features/notifications/notification-list';

export const metadata: Metadata = { title: 'Benachrichtigungen' };

export default async function NotificationsPage() {
  const ctx = await requireOrganizationMembership();
  const [notifications, conflicts] = await Promise.all([
    db.notification.findMany({
      where: { userId: ctx.user.id, organizationId: ctx.organization.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    hasPermission(ctx, 'appointments.viewAll') || hasPermission(ctx, 'appointments.manage')
      ? listScopeConflicts()
      : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="Benachrichtigungen"
        description={`${notifications.filter((n) => !n.readAt).length} ungelesen`}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/settings?tab=benachrichtigungen">Präferenzen</Link>
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-[var(--page-max)] p-4 sm:p-5">
        <ConflictNoticeList conflicts={conflicts} />
        <NotificationList
          items={notifications.map((notification) => ({
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            targetUrl: notification.targetUrl,
            readAt: notification.readAt?.toISOString() ?? null,
            createdAt: notification.createdAt.toISOString(),
            createdAtLabel: formatDateTime(notification.createdAt, ctx.organization.timezone),
          }))}
        />
      </div>
    </>
  );
}
