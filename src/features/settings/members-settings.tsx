import { db } from '@/server/db';
import { formatDate } from '@/lib/dates';
import { MEMBERSHIP_ROLE_LABELS } from '@/lib/status-maps';
import { membershipPermissions, requirePermission, rolePermissions } from '@/server/permissions';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { EntityAvatar } from '@/components/ui/misc';
import { StatusPill } from '@/components/ui/status-pill';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { MemberRowControls } from '@/features/settings/member-row-controls';
import {
  MemberPermissionsEditor,
  PermissionSummaryBadge,
} from '@/features/settings/member-permissions-editor';

/** Mitgliederverwaltung (Konto-Art, Berechtigungen, Sperren). Einladungen laufen über Mitarbeiter bzw. Leitung. */
export async function MembersSettings() {
  const ctx = await requirePermission('members.manage');
  const members = await db.organizationMembership.findMany({
    where: { organizationId: ctx.organization.id },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true, lastLoginAt: true } } },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });

  const pendingInvitations = await db.invitation.findMany({
    where: { organizationId: ctx.organization.id, acceptedAt: null, expiresAt: { gte: new Date() } },
    select: { id: true, email: true, role: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <>
      <Panel>
        <PanelHeader>
          <PanelTitle>Mitglieder ({members.length})</PanelTitle>
          <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
            Einladen: Mitarbeiter → „Einladen“
          </span>
        </PanelHeader>
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Tr>
                <Th>Mitglied</Th>
                <Th>Art</Th>
                <Th>Status</Th>
                <Th>Berechtigungen</Th>
                <Th>Letzte Anmeldung</Th>
                <Th aria-label="Aktionen" />
              </Tr>
            </THead>
            <TBody>
              {members.map((member) => {
                const custom = membershipPermissions(member);
                const effective = custom ?? [...rolePermissions(member.role)];
                const isSelf = member.userId === ctx.user.id;
                const isOwnerRow = member.role === 'ORGANIZATION_OWNER';
                return (
                  <Tr key={member.id}>
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <EntityAvatar
                          id={member.user.id}
                          name={`${member.user.firstName} ${member.user.lastName}`}
                          size="sm"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {member.user.firstName} {member.user.lastName}
                            {isSelf ? ' (Ich)' : ''}
                          </span>
                          <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                            {member.user.email}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">{MEMBERSHIP_ROLE_LABELS[member.role]}</Td>
                    <Td>
                      <StatusPill size="sm" tone={member.status === 'ACTIVE' ? 'done' : 'stuck'}>
                        {member.status === 'ACTIVE' ? 'Aktiv' : 'Gesperrt'}
                      </StatusPill>
                    </Td>
                    <Td>
                      {isOwnerRow ? (
                        <PermissionSummaryBadge label="Vollzugriff (Admin)" />
                      ) : isSelf ? (
                        <PermissionSummaryBadge label="Eigenes Konto" />
                      ) : (
                        <MemberPermissionsEditor
                          membershipId={member.id}
                          memberName={`${member.user.firstName} ${member.user.lastName}`}
                          effectivePermissions={effective}
                          isCustom={custom !== null}
                        />
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-[var(--color-ink-muted)]">
                      {member.user.lastLoginAt
                        ? formatDate(member.user.lastLoginAt, ctx.organization.timezone)
                        : '—'}
                    </Td>
                    <Td className="text-right">
                      <MemberRowControls
                        membershipId={member.id}
                        role={member.role}
                        status={member.status}
                        isSelf={isSelf}
                        isOwnerRow={isOwnerRow}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      </Panel>

      {pendingInvitations.length > 0 ? (
        <Panel>
          <PanelHeader>
            <PanelTitle>Offene Einladungen</PanelTitle>
          </PanelHeader>
          <PanelBody className="p-0">
            <ul className="divide-y divide-[var(--color-line-subtle)]">
              {pendingInvitations.map((invitation) => (
                <li key={invitation.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[length:var(--text-sm)]">
                  <span>
                    {invitation.email}
                    <span className="text-[var(--color-ink-subtle)]">
                      {' '}· {MEMBERSHIP_ROLE_LABELS[invitation.role]}
                    </span>
                  </span>
                  <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                    gültig bis {formatDate(invitation.expiresAt, ctx.organization.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      ) : null}
    </>
  );
}
