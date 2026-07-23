import 'server-only';

import type { NotificationType } from '@prisma/client';

import { db } from '@/server/db';

/**
 * In-App-Benachrichtigungen (Anforderung 18). Weitere Kanäle (E-Mail, Push,
 * SMS) docken später als Adapter an dieselbe Stelle an – createNotification
 * bleibt die einzige Aufrufstelle.
 */
export interface NotificationInput {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  targetUrl?: string;
}

/** Standard-Präferenzen: alle Ereignistypen aktiv. */
export type NotificationPrefs = Partial<Record<NotificationType, boolean>>;

export async function createNotification(input: NotificationInput): Promise<void> {
  // Präferenzen des Empfängers respektieren (Opt-out je Ereignistyp).
  const preference = await db.userPreference.findUnique({
    where: { userId: input.userId },
    select: { notificationPrefs: true },
  });
  const prefs = (preference?.notificationPrefs ?? {}) as NotificationPrefs;
  if (prefs[input.type] === false) return;

  await db.notification.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      targetUrl: input.targetUrl,
    },
  });
}

export async function createNotificationsForUsers(
  userIds: string[],
  base: Omit<NotificationInput, 'userId'>,
): Promise<void> {
  await Promise.all(userIds.map((userId) => createNotification({ ...base, userId })));
}

/** Benutzer mit einer Rolle, die organisationsweit disponiert (für Ereignis-Broadcasts). */
export async function getPlannerUserIds(organizationId: string): Promise<string[]> {
  const memberships = await db.organizationMembership.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      role: { in: ['ORGANIZATION_OWNER', 'ADMIN', 'DISPATCHER'] },
    },
    select: { userId: true },
  });
  return memberships.map((m) => m.userId);
}
