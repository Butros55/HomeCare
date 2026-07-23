'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError, runAction, type ActionResult } from '@/server/errors';
import { hasPermission, requirePermission } from '@/server/permissions';

const roleSchema = z.enum(['ADMIN', 'DISPATCHER', 'TEAM_MANAGER', 'EMPLOYEE']);

/**
 * Rollen ändern (Anforderung 4): Owner/Admin. Die Eigentümerrolle selbst wird
 * hier nie vergeben oder entzogen – Übertragung wäre eine gesonderte,
 * bewusste Owner-Aktion; Admins können sie grundsätzlich nicht ausführen.
 */
export async function updateMemberRoleAction(
  membershipId: string,
  role: z.infer<typeof roleSchema>,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const ctx = await requirePermission('members.manage');
    const parsedRole = roleSchema.parse(role);

    const membership = await db.organizationMembership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || membership.organizationId !== ctx.organization.id) {
      throw new AppError('NOT_FOUND');
    }
    if (membership.userId === ctx.user.id) {
      throw new AppError('CONFLICT', { message: 'Die eigene Rolle kann nicht geändert werden.' });
    }
    if (membership.role === 'ORGANIZATION_OWNER') {
      throw new AppError('ACCESS_DENIED', {
        message: 'Die Eigentümerrolle kann hier nicht geändert werden.',
      });
    }

    await db.$transaction(async (tx) => {
      await tx.organizationMembership.update({
        where: { id: membershipId },
        data: { role: parsedRole },
      });
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: 'member.roleChanged',
          entityType: 'OrganizationMembership',
          entityId: membershipId,
          metadata: { role: parsedRole },
        },
        tx,
      );
    });
    revalidatePath('/settings');
    return { done: true as const };
  });
}

export async function setMemberStatusAction(
  membershipId: string,
  status: 'ACTIVE' | 'SUSPENDED',
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const ctx = await requirePermission('members.manage');
    const membership = await db.organizationMembership.findUnique({ where: { id: membershipId } });
    if (!membership || membership.organizationId !== ctx.organization.id) {
      throw new AppError('NOT_FOUND');
    }
    if (membership.userId === ctx.user.id) {
      throw new AppError('CONFLICT', { message: 'Die eigene Mitgliedschaft kann nicht gesperrt werden.' });
    }
    if (membership.role === 'ORGANIZATION_OWNER' && !hasPermission(ctx, 'organization.transferOwnership')) {
      throw new AppError('ACCESS_DENIED');
    }

    await db.$transaction(async (tx) => {
      await tx.organizationMembership.update({ where: { id: membershipId }, data: { status } });
      // Beim Sperren alle Sessions des Benutzers beenden.
      if (status === 'SUSPENDED') {
        await tx.session.deleteMany({ where: { userId: membership.userId } });
      }
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: 'member.suspended',
          entityType: 'OrganizationMembership',
          entityId: membershipId,
          metadata: { status },
        },
        tx,
      );
    });
    revalidatePath('/settings');
    return { done: true as const };
  });
}
