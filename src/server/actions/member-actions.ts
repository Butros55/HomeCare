'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { EDITABLE_PERMISSIONS, sanitizePermissions } from '@/lib/permission-catalog';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError, runAction, type ActionResult } from '@/server/errors';
import { hasPermission, requirePermission } from '@/server/permissions';
import { inviteLeadershipAccount } from '@/server/services/employee-service';

const roleSchema = z.enum(['ADMIN', 'DISPATCHER', 'TEAM_MANAGER', 'EMPLOYEE']);
const permissionListSchema = z
  .array(z.enum(EDITABLE_PERMISSIONS as [string, ...string[]]))
  .max(EDITABLE_PERMISSIONS.length);

/** Ziel-Mitgliedschaft laden und Grundregeln prüfen (nicht selbst, nicht Owner). */
async function requireEditableMembership(membershipId: string) {
  const ctx = await requirePermission('members.manage');
  const membership = await db.organizationMembership.findUnique({
    where: { id: membershipId },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
  });
  if (!membership || membership.organizationId !== ctx.organization.id) {
    throw new AppError('NOT_FOUND');
  }
  if (membership.userId === ctx.user.id) {
    throw new AppError('CONFLICT', { message: 'Das eigene Konto kann hier nicht geändert werden.' });
  }
  if (membership.role === 'ORGANIZATION_OWNER') {
    throw new AppError('ACCESS_DENIED', {
      message: 'Der Admin (Inhaber) hat immer Vollzugriff.',
    });
  }
  return { ctx, membership };
}

/**
 * Rollen ändern (Anforderung 4): Owner/Admin. Die Eigentümerrolle selbst wird
 * hier nie vergeben oder entzogen – Übertragung wäre eine gesonderte,
 * bewusste Owner-Aktion; Admins können sie grundsätzlich nicht ausführen.
 * Beim Wechsel der Konto-Art greifen die Standard-Berechtigungen der Organisation.
 */
export async function updateMemberRoleAction(
  membershipId: string,
  role: z.infer<typeof roleSchema>,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const { ctx, membership } = await requireEditableMembership(membershipId);
    const parsedRole = roleSchema.parse(role);

    // Standard-Berechtigungen der Ziel-Kontoart anwenden (null = Rollen-Standard).
    const defaults =
      parsedRole === 'EMPLOYEE'
        ? sanitizePermissions(ctx.organization.defaultEmployeePermissions)
        : sanitizePermissions(ctx.organization.defaultLeadershipPermissions);

    await db.$transaction(async (tx) => {
      await tx.organizationMembership.update({
        where: { id: membershipId },
        data: { role: parsedRole, permissions: defaults ?? Prisma.DbNull },
      });
      // Leitungs-Konten sind selbst zuweisbar → fehlendes Mitarbeiterprofil ergänzen.
      if (parsedRole !== 'EMPLOYEE') {
        const profile = await tx.employee.findFirst({
          where: { organizationId: ctx.organization.id, userId: membership.userId, deletedAt: null },
          select: { id: true },
        });
        if (!profile) {
          await tx.employee.create({
            data: {
              organizationId: ctx.organization.id,
              userId: membership.userId,
              firstName: membership.user.firstName,
              lastName: membership.user.lastName,
              email: membership.user.email,
              employmentType: 'FULL_TIME',
              canReceiveHours: true,
              canRecruitEmployees: parsedRole === 'ADMIN',
            },
          });
        }
      }
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
    revalidatePath('/employees');
    return { done: true as const };
  });
}

/**
 * Individuelle Berechtigungen eines Kontos setzen (null = Standard der Rolle).
 * Owner bleibt unantastbar (Vollzugriff), das eigene Konto ist gesperrt –
 * so kann sich niemand versehentlich selbst aussperren.
 */
export async function updateMemberPermissionsAction(
  membershipId: string,
  permissions: string[] | null,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const { ctx } = await requireEditableMembership(membershipId);
    const parsed = permissions === null ? null : permissionListSchema.parse(permissions);

    await db.$transaction(async (tx) => {
      await tx.organizationMembership.update({
        where: { id: membershipId },
        data: { permissions: parsed === null ? Prisma.DbNull : [...new Set(parsed)] },
      });
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: 'member.permissionsChanged',
          entityType: 'OrganizationMembership',
          entityId: membershipId,
          metadata: { permissions: parsed },
        },
        tx,
      );
    });
    revalidatePath('/settings');
    return { done: true as const };
  });
}

/** Leitungs-Konto per E-Mail einladen (Einstellungen → Leitung). */
export async function inviteLeadershipAction(input: {
  email: string;
}): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const email = z.string().trim().toLowerCase().pipe(z.email()).parse(input.email);
    await inviteLeadershipAccount({ email });
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
