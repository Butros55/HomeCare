import 'server-only';

import { randomBytes } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { APP_NAME, APP_URL } from '@/lib/app-config';
import { utcDate } from '@/lib/dates';
import { wouldCreateCycle } from '@/lib/hierarchy';
import { sanitizePermissions } from '@/lib/permission-catalog';
import { writeAuditLog } from '@/server/audit';
import { hashToken } from '@/server/auth/session';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  assertSameOrg,
  canAccessEmployee,
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
  requirePermission,
  scopeContains,
  type OrgContext,
} from '@/server/permissions';
import { sendMail } from '@/server/mail';
import type {
  AvailabilityFormInput,
  EmployeeFormData,
  InviteEmployeeInput,
} from '@/server/validation/employee';

/**
 * Mitarbeiterverwaltung inkl. Hierarchie (Zyklenschutz), Einladung,
 * Verfügbarkeiten und Abwesenheiten. Scope-Regeln: docs/permissions.md.
 */

async function loadHierarchyNodes(organizationId: string) {
  return db.employee.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, managerEmployeeId: true },
  });
}

async function assertManageScope(ctx: OrgContext, employeeId: string) {
  if (!(await canAccessEmployee(ctx, employeeId, 'manage'))) {
    throw new AppError('ACCESS_DENIED');
  }
}

/** Vorgesetzten-Wechsel validieren: gleiche Org, kein Zyklus, keine Selbstreferenz. */
async function validateManagerChange(
  ctx: OrgContext,
  employeeId: string | null,
  managerEmployeeId: string | undefined,
): Promise<string | null> {
  if (!managerEmployeeId) return null;
  const manager = await db.employee.findUnique({ where: { id: managerEmployeeId } });
  assertSameOrg(ctx, manager);
  if (employeeId) {
    if (managerEmployeeId === employeeId) throw new AppError('HIERARCHY_SELF_REFERENCE');
    const nodes = await loadHierarchyNodes(ctx.organization.id);
    if (wouldCreateCycle(nodes, employeeId, managerEmployeeId)) {
      throw new AppError('HIERARCHY_CYCLE');
    }
  }
  return managerEmployeeId;
}

export async function createEmployee(data: EmployeeFormData): Promise<{ employeeId: string }> {
  const ctx = await requirePermission('employees.manage');
  const orgId = ctx.organization.id;

  // Team-Manager dürfen nur unterhalb des eigenen Bereichs anlegen.
  if (ctx.membership.role === 'TEAM_MANAGER') {
    if (!ctx.employee) throw new AppError('ACCESS_DENIED');
    const managerId = data.managerEmployeeId ?? ctx.employee.id;
    const scope = await getManagedEmployeeIds(ctx);
    if (!scopeContains(scope, managerId)) {
      throw new AppError('ACCESS_DENIED', {
        message: 'Neue Mitarbeiter müssen deinem Bereich zugeordnet sein.',
      });
    }
    data = { ...data, managerEmployeeId: managerId };
  }

  const managerEmployeeId = await validateManagerChange(ctx, null, data.managerEmployeeId);

  if (data.personnelNumber) {
    const duplicate = await db.employee.findFirst({
      where: { organizationId: orgId, personnelNumber: data.personnelNumber, deletedAt: null },
    });
    if (duplicate) {
      throw new AppError('CONFLICT', {
        message: `Personalnummer ${data.personnelNumber} ist bereits vergeben.`,
      });
    }
  }

  const employee = await db.$transaction(async (tx) => {
    const created = await tx.employee.create({
      data: {
        organizationId: orgId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        personnelNumber: data.personnelNumber,
        status: data.status,
        employmentType: data.employmentType,
        managerEmployeeId,
        targetMinutesPerWeek: data.targetMinutesPerWeek,
        targetMinutesPerMonth: data.targetMinutesPerMonth,
        maximumMinutesPerDay: data.maximumMinutesPerDay,
        canRecruitEmployees: data.canRecruitEmployees,
        canReceiveHours: data.canReceiveHours,
        notes: data.notes,
      },
    });
    await writeAuditLog(
      {
        organizationId: orgId,
        actorUserId: ctx.user.id,
        action: 'employee.created',
        entityType: 'Employee',
        entityId: created.id,
        metadata: { name: `${data.firstName} ${data.lastName}` },
      },
      tx,
    );
    return created;
  });
  return { employeeId: employee.id };
}

export async function updateEmployee(employeeId: string, data: EmployeeFormData): Promise<void> {
  const ctx = await requirePermission('employees.manage');
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  assertSameOrg(ctx, employee);
  await assertManageScope(ctx, employeeId);

  const managerEmployeeId = await validateManagerChange(ctx, employeeId, data.managerEmployeeId);
  const managerChanged = (employee.managerEmployeeId ?? null) !== (managerEmployeeId ?? null);

  await db.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id: employeeId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: data.phone ?? null,
        personnelNumber: data.personnelNumber ?? null,
        status: data.status,
        employmentType: data.employmentType,
        managerEmployeeId,
        targetMinutesPerWeek: data.targetMinutesPerWeek,
        targetMinutesPerMonth: data.targetMinutesPerMonth,
        maximumMinutesPerDay: data.maximumMinutesPerDay,
        canRecruitEmployees: data.canRecruitEmployees,
        canReceiveHours: data.canReceiveHours,
        notes: data.notes ?? null,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: managerChanged ? 'employee.managerChanged' : 'employee.updated',
        entityType: 'Employee',
        entityId: employeeId,
        metadata: managerChanged ? { managerEmployeeId } : undefined,
      },
      tx,
    );
  });
}

export async function setEmployeeStatus(
  employeeId: string,
  status: 'ACTIVE' | 'INACTIVE',
): Promise<void> {
  const ctx = await requirePermission('employees.manage');
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  assertSameOrg(ctx, employee);
  await assertManageScope(ctx, employeeId);

  await db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data: { status } });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: status === 'ACTIVE' ? 'employee.reactivated' : 'employee.deactivated',
        entityType: 'Employee',
        entityId: employeeId,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Verfügbarkeit & Abwesenheiten
// ---------------------------------------------------------------------------

export async function replaceAvailability(input: AvailabilityFormInput): Promise<void> {
  const ctx = await requireOrganizationMembership();
  const employee = await db.employee.findUnique({ where: { id: input.employeeId } });
  assertSameOrg(ctx, employee);
  const canManage =
    (await canAccessEmployee(ctx, input.employeeId, 'manage')) ||
    ctx.employee?.id === input.employeeId; // eigene Verfügbarkeit pflegen
  if (!canManage) throw new AppError('ACCESS_DENIED');

  const validFrom = utcDate(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth() + 1,
    new Date().getUTCDate(),
  );

  await db.$transaction(async (tx) => {
    await tx.employeeAvailability.deleteMany({ where: { employeeId: input.employeeId } });
    if (input.slots.length > 0) {
      await tx.employeeAvailability.createMany({
        data: input.slots.map((slot) => ({
          employeeId: input.employeeId,
          weekday: slot.weekday,
          startTime: slot.startTime,
          endTime: slot.endTime,
          validFrom,
        })),
      });
    }
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'availability.updated',
        entityType: 'Employee',
        entityId: input.employeeId,
        metadata: { slotCount: input.slots.length },
      },
      tx,
    );
  });
}

export async function createAbsence(input: {
  employeeId: string;
  startDate: string;
  endDate: string;
  type: 'VACATION' | 'SICK' | 'TRAINING' | 'OTHER';
  note?: string;
}): Promise<void> {
  const ctx = await requireOrganizationMembership();
  const employee = await db.employee.findUnique({ where: { id: input.employeeId } });
  assertSameOrg(ctx, employee);
  const canManage =
    (await canAccessEmployee(ctx, input.employeeId, 'manage')) ||
    ctx.employee?.id === input.employeeId;
  if (!canManage) throw new AppError('ACCESS_DENIED');

  const [sy, sm, sd] = input.startDate.split('-').map(Number);
  const [ey, em, ed] = input.endDate.split('-').map(Number);
  const startAt = utcDate(sy!, sm!, sd!);
  // Ende inklusive: bis zum Folgetag 00:00.
  const endAt = new Date(utcDate(ey!, em!, ed!).getTime() + 24 * 60 * 60 * 1000);

  await db.$transaction(async (tx) => {
    await tx.employeeAbsence.create({
      data: {
        employeeId: input.employeeId,
        startAt,
        endAt,
        type: input.type,
        note: input.note,
        status: 'APPROVED',
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'absence.created',
        entityType: 'Employee',
        entityId: input.employeeId,
        metadata: { type: input.type, startDate: input.startDate, endDate: input.endDate },
      },
      tx,
    );
  });
}

export async function deleteAbsence(absenceId: string): Promise<void> {
  const ctx = await requireOrganizationMembership();
  const absence = await db.employeeAbsence.findUnique({
    where: { id: absenceId },
    include: { employee: { select: { id: true, organizationId: true } } },
  });
  if (!absence) throw new AppError('NOT_FOUND');
  assertSameOrg(ctx, absence.employee);
  const canManage =
    (await canAccessEmployee(ctx, absence.employee.id, 'manage')) ||
    ctx.employee?.id === absence.employee.id;
  if (!canManage) throw new AppError('ACCESS_DENIED');

  await db.$transaction(async (tx) => {
    await tx.employeeAbsence.delete({ where: { id: absenceId } });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'absence.deleted',
        entityType: 'Employee',
        entityId: absence.employee.id,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Leitung: eigene Zuweisbarkeit
// ---------------------------------------------------------------------------

/**
 * Leitungs-Konten sollen selbst Termine/Routen übernehmen können ("Ich" in den
 * Mitarbeiter-Dropdowns). Dafür braucht jedes aktive Leitungs-Mitglied ein
 * Mitarbeiterprofil. Idempotent – ergänzt nur fehlende Profile (heilt auch
 * Organisationen, die vor dieser Funktion angelegt wurden).
 */
export async function ensureLeadershipEmployeeProfiles(ctx: OrgContext): Promise<void> {
  const leaders = await db.organizationMembership.findMany({
    where: {
      organizationId: ctx.organization.id,
      status: 'ACTIVE',
      role: { not: 'EMPLOYEE' },
    },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
  });
  if (leaders.length === 0) return;

  const existing = await db.employee.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      userId: { in: leaders.map((leader) => leader.userId) },
    },
    select: { userId: true },
  });
  const linked = new Set(existing.map((employee) => employee.userId));

  for (const leader of leaders) {
    if (linked.has(leader.userId)) continue;
    await db.employee.create({
      data: {
        organizationId: ctx.organization.id,
        userId: leader.userId,
        firstName: leader.user.firstName,
        lastName: leader.user.lastName,
        email: leader.user.email,
        employmentType: 'FULL_TIME',
        canReceiveHours: true,
        canRecruitEmployees: leader.role === 'ORGANIZATION_OWNER' || leader.role === 'ADMIN',
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Einladungen
// ---------------------------------------------------------------------------

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export async function inviteEmployee(input: InviteEmployeeInput & { email: string }): Promise<void> {
  const ctx = await requireOrganizationMembership();
  const employee = await db.employee.findUnique({ where: { id: input.employeeId } });
  assertSameOrg(ctx, employee);

  const allowed =
    hasPermission(ctx, 'employees.invite') ||
    (ctx.membership.role === 'TEAM_MANAGER' &&
      Boolean(ctx.employee?.canRecruitEmployees) &&
      (await canAccessEmployee(ctx, input.employeeId, 'manage')));
  if (!allowed) throw new AppError('ACCESS_DENIED');

  // Rollenvergabe: nur Owner/Admin dürfen höhere Rollen als EMPLOYEE einladen.
  const role = hasPermission(ctx, 'members.manage') ? (input.role ?? 'EMPLOYEE') : 'EMPLOYEE';

  if (employee.userId) {
    throw new AppError('CONFLICT', { message: 'Dieser Mitarbeiter hat bereits ein Benutzerkonto.' });
  }
  const existingUser = await db.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    const existingMembership = await db.organizationMembership.findFirst({
      where: { userId: existingUser.id, organizationId: ctx.organization.id },
    });
    if (existingMembership) {
      throw new AppError('CONFLICT', {
        message: 'Diese E-Mail-Adresse gehört bereits zu einem Mitglied der Organisation.',
      });
    }
  }

  const token = randomBytes(24).toString('base64url');
  await db.$transaction(async (tx) => {
    // Alte offene Einladungen für dieses Profil verfallen.
    await tx.invitation.deleteMany({
      where: { employeeId: input.employeeId, acceptedAt: null },
    });
    await tx.invitation.create({
      data: {
        organizationId: ctx.organization.id,
        email: input.email,
        role,
        employeeId: input.employeeId,
        tokenHash: hashToken(token),
        invitedByUserId: ctx.user.id,
        expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
      },
    });
    await tx.employee.update({
      where: { id: input.employeeId },
      data: { email: input.email },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'member.invited',
        entityType: 'Employee',
        entityId: input.employeeId,
        metadata: { role },
      },
      tx,
    );
  });

  const link = `${APP_URL}/invite/${token}`;
  await sendMail({
    to: input.email,
    subject: `${APP_NAME}: Einladung von ${ctx.organization.name}`,
    text: [
      `Hallo ${employee.firstName},`,
      '',
      `${ctx.user.firstName} ${ctx.user.lastName} lädt dich zu "${ctx.organization.name}" ein.`,
      'Über den folgenden Link legst du dein Passwort fest (7 Tage gültig):',
      '',
      link,
    ].join('\n'),
  });
}

/**
 * Leitungs-Konto einladen (Einstellungen → Leitung): Einladung mit Rolle ADMIN
 * ohne vorab angelegtes Mitarbeiterprofil – das Profil entsteht bei der
 * Annahme automatisch, damit die Person sofort selbst zuweisbar ist.
 */
export async function inviteLeadershipAccount(input: { email: string }): Promise<void> {
  const ctx = await requirePermission('members.manage');

  const existingUser = await db.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    const existingMembership = await db.organizationMembership.findFirst({
      where: { userId: existingUser.id, organizationId: ctx.organization.id },
    });
    if (existingMembership) {
      throw new AppError('CONFLICT', {
        message: 'Diese E-Mail-Adresse gehört bereits zu einem Mitglied.',
      });
    }
  }

  const token = randomBytes(24).toString('base64url');
  await db.$transaction(async (tx) => {
    await tx.invitation.deleteMany({
      where: { organizationId: ctx.organization.id, email: input.email, acceptedAt: null },
    });
    await tx.invitation.create({
      data: {
        organizationId: ctx.organization.id,
        email: input.email,
        role: 'ADMIN',
        tokenHash: hashToken(token),
        invitedByUserId: ctx.user.id,
        expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'member.invited',
        entityType: 'Organization',
        entityId: ctx.organization.id,
        metadata: { role: 'ADMIN', leadership: true, email: input.email },
      },
      tx,
    );
  });

  const link = `${APP_URL}/invite/${token}`;
  await sendMail({
    to: input.email,
    subject: `${APP_NAME}: Einladung in die Leitung von ${ctx.organization.name}`,
    text: [
      'Hallo,',
      '',
      `${ctx.user.firstName} ${ctx.user.lastName} lädt dich in die Leitung von "${ctx.organization.name}" ein.`,
      'Über den folgenden Link legst du dein Konto an (7 Tage gültig):',
      '',
      link,
    ].join('\n'),
  });
}

/** Einladung einlösen: Benutzer anlegen, Mitgliedschaft aktivieren, Profil verknüpfen. */
export async function acceptInvitation(input: {
  token: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
}): Promise<{ userId: string }> {
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { organization: true, employee: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
    throw new AppError('INVITATION_INVALID');
  }

  // Standard-Berechtigungen der Organisation für die jeweilige Konto-Art.
  const defaultPermissions =
    invitation.role === 'EMPLOYEE'
      ? sanitizePermissions(invitation.organization.defaultEmployeePermissions)
      : sanitizePermissions(invitation.organization.defaultLeadershipPermissions);

  /** Leitungs-Konten ohne verknüpftes Profil werden selbst zuweisbar. */
  const ensureLeaderProfile = async (
    tx: Prisma.TransactionClient,
    user: { id: string; firstName: string; lastName: string; email: string },
  ) => {
    if (invitation.role === 'EMPLOYEE' || invitation.employeeId) return;
    const profile = await tx.employee.findFirst({
      where: { organizationId: invitation.organizationId, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (profile) return;
    await tx.employee.create({
      data: {
        organizationId: invitation.organizationId,
        userId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        employmentType: 'FULL_TIME',
        canReceiveHours: true,
        canRecruitEmployees: invitation.role === 'ADMIN',
      },
    });
  };

  const existingUser = await db.user.findUnique({ where: { email: invitation.email } });
  if (existingUser) {
    // Bestehender Benutzer (andere Organisation): nur Mitgliedschaft ergänzen.
    const user = await db.$transaction(async (tx) => {
      await tx.organizationMembership.create({
        data: {
          organizationId: invitation.organizationId,
          userId: existingUser.id,
          role: invitation.role,
          status: 'ACTIVE',
          permissions: defaultPermissions ?? undefined,
          invitedByUserId: invitation.invitedByUserId,
        },
      });
      if (invitation.employeeId) {
        await tx.employee.update({
          where: { id: invitation.employeeId },
          data: { userId: existingUser.id },
        });
      }
      await ensureLeaderProfile(tx, existingUser);
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      await writeAuditLog(
        {
          organizationId: invitation.organizationId,
          actorUserId: existingUser.id,
          action: 'member.joined',
          entityType: 'Employee',
          entityId: invitation.employeeId ?? existingUser.id,
        },
        tx,
      );
      return existingUser;
    });
    return { userId: user.id };
  }

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: invitation.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    });
    await tx.organizationMembership.create({
      data: {
        organizationId: invitation.organizationId,
        userId: created.id,
        role: invitation.role,
        status: 'ACTIVE',
        permissions: defaultPermissions ?? undefined,
        invitedByUserId: invitation.invitedByUserId,
      },
    });
    if (invitation.employeeId) {
      await tx.employee.update({
        where: { id: invitation.employeeId },
        data: { userId: created.id, firstName: input.firstName, lastName: input.lastName },
      });
    }
    await ensureLeaderProfile(tx, created);
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    await writeAuditLog(
      {
        organizationId: invitation.organizationId,
        actorUserId: created.id,
        action: 'member.joined',
        entityType: 'Employee',
        entityId: invitation.employeeId ?? created.id,
      },
      tx,
    );
    return created;
  });
  return { userId: user.id };
}

/** Kontextinfos einer Einladung für die Annahme-Seite (ohne sensible Daten). */
export async function getInvitationInfo(token: string) {
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      organization: { select: { name: true } },
      employee: { select: { firstName: true, lastName: true } },
    },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
    return null;
  }
  return {
    organizationName: invitation.organization.name,
    email: invitation.email,
    firstName: invitation.employee?.firstName ?? '',
    lastName: invitation.employee?.lastName ?? '',
  };
}
