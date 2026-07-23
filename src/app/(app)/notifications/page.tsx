import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/dates';
import { db } from '@/server/db';
import { requireOrganizationMembership } from '@/server/permissions';
import { NotificationList } from '@/features/notifications/notification-list';

export const metadata: Metadata = { title: 'Benachrichtigungen' };

export default async function NotificationsPage() {
  const ctx = await requireOrganizationMembership();
  const notifications = await db.notification.findMany({
    where: { userId: ctx.user.id, organizationId: ctx.organization.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

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
      <div className="mx-auto max-w-3xl p-4 sm:p-5">
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
