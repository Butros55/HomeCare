'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/server/db';
import { runAction, type ActionResult } from '@/server/errors';
import { requireOrganizationMembership } from '@/server/permissions';

export async function markNotificationReadAction(
  notificationId: string,
  read: boolean,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    // Nur eigene Benachrichtigungen (userId-Filter statt reiner ID-Zugriff → kein IDOR).
    await db.notification.updateMany({
      where: { id: notificationId, userId: ctx.user.id },
      data: { readAt: read ? new Date() : null },
    });
    revalidatePath('/notifications');
    return { done: true as const };
  });
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    await db.notification.updateMany({
      where: { userId: ctx.user.id, organizationId: ctx.organization.id, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath('/notifications');
    return { done: true as const };
  });
}
