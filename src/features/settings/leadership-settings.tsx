import { formatDate } from '@/lib/dates';
import { MEMBERSHIP_ROLE_LABELS } from '@/lib/status-maps';
import { db } from '@/server/db';
import {
  membershipPermissions,
  requirePermission,
  rolePermissions,
} from '@/server/permissions';
import { ensureLeadershipEmployeeProfiles } from '@/server/services/employee-service';
import { EntityAvatar } from '@/components/ui/misc';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { StatusPill } from '@/components/ui/status-pill';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import {
  AddLeadershipButton,
  DefaultPermissionsSettings,
} from '@/features/settings/leadership-dialogs';
import {
  MemberPermissionsEditor,
  PermissionSummaryBadge,
} from '@/features/settings/member-permissions-editor';
import {
  EMPLOYEE_DEFAULT_PERMISSIONS,
  LEADERSHIP_DEFAULT_PERMISSIONS,
  sanitizePermissions,
} from '@/lib/permission-catalog';

/**
 * Leitung (Einstellungen): Wer leitet die Organisation, welche Konten haben
 * leitende Rechte, mit welchen Berechtigungen – plus Standard-Berechtigungen
 * für neue Konten. Der Ersteller (Inhaber) hat immer Vollzugriff.
 */
export async function LeadershipSettings() {
  const ctx = await requirePermission('members.manage');

  // Leitungs-Konten sind selbst zuweisbar – fehlende Profile hier ergänzen
  // (idempotent; heilt auch Organisationen aus älteren Versionen).
  await ensureLeadershipEmployeeProfiles(ctx);

  const [leaders, leaderProfiles, pendingInvitations] = await Promise.all([
    db.organizationMembership.findMany({
      where: { organizationId: ctx.organization.id, role: { not: 'EMPLOYEE' } },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, lastLoginAt: true } },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    }),
    db.employee.findMany({
      where: { organizationId: ctx.organization.id, deletedAt: null, userId: { not: null } },
      select: { userId: true },
    }),
    db.invitation.findMany({
      where: {
        organizationId: ctx.organization.id,
        role: { not: 'EMPLOYEE' },
        acceptedAt: null,
        expiresAt: { gte: new Date() },
      },
      select: { id: true, email: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const assignable = new Set(leaderProfiles.map((profile) => profile.userId));

  return (
    <>
      <Panel>
        <PanelHeader>
          <PanelTitle>Leitung ({leaders.length})</PanelTitle>
          <AddLeadershipButton />
        </PanelHeader>
        <PanelBody className="pt-0 pb-2 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
          Leitungs-Konten verwalten Mitarbeiter, Kunden und Routen – und sind selbst als
          Mitarbeiter zuweisbar (im Dropdown als „(Ich)“ markiert, wenn es das eigene Konto ist).
        </PanelBody>
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Tr>
                <Th>Konto</Th>
                <Th>Art</Th>
                <Th>Status</Th>
                <Th>Berechtigungen</Th>
              </Tr>
            </THead>
            <TBody>
              {leaders.map((leader) => {
                const custom = membershipPermissions(leader);
                const effective = custom ?? [...rolePermissions(leader.role)];
                const isOwner = leader.role === 'ORGANIZATION_OWNER';
                const isSelf = leader.userId === ctx.user.id;
                return (
                  <Tr key={leader.id}>
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <EntityAvatar
                          id={leader.user.id}
                          name={`${leader.user.firstName} ${leader.user.lastName}`}
                          size="sm"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {leader.user.firstName} {leader.user.lastName}
                            {isSelf ? ' (Ich)' : ''}
                          </span>
                          <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                            {leader.user.email}
                            {assignable.has(leader.userId) ? ' · zuweisbar' : ''}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">{MEMBERSHIP_ROLE_LABELS[leader.role]}</Td>
                    <Td>
                      <StatusPill size="sm" tone={leader.status === 'ACTIVE' ? 'done' : 'stuck'}>
                        {leader.status === 'ACTIVE' ? 'Aktiv' : 'Gesperrt'}
                      </StatusPill>
                    </Td>
                    <Td>
                      {isOwner ? (
                        <PermissionSummaryBadge label="Vollzugriff (Admin)" />
                      ) : isSelf ? (
                        <PermissionSummaryBadge label="Eigenes Konto" />
                      ) : (
                        <MemberPermissionsEditor
                          membershipId={leader.id}
                          memberName={`${leader.user.firstName} ${leader.user.lastName}`}
                          effectivePermissions={effective}
                          isCustom={custom !== null}
                        />
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
        {pendingInvitations.length > 0 ? (
          <PanelBody className="border-t border-[var(--color-line-subtle)]">
            <h3 className="mb-1.5 text-[length:var(--text-xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
              Offene Leitungs-Einladungen
            </h3>
            <ul className="space-y-1 text-[length:var(--text-sm)]">
              {pendingInvitations.map((invitation) => (
                <li key={invitation.id} className="flex items-center justify-between gap-3">
                  <span>{invitation.email}</span>
                  <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                    gültig bis {formatDate(invitation.expiresAt, ctx.organization.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          </PanelBody>
        ) : null}
      </Panel>

      <DefaultPermissionsSettings
        initialLeadership={
          sanitizePermissions(ctx.organization.defaultLeadershipPermissions) ?? [
            ...LEADERSHIP_DEFAULT_PERMISSIONS,
          ]
        }
        initialEmployee={
          sanitizePermissions(ctx.organization.defaultEmployeePermissions) ?? [
            ...EMPLOYEE_DEFAULT_PERMISSIONS,
          ]
        }
      />
    </>
  );
}
