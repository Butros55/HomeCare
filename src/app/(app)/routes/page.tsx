import type { Metadata } from 'next';

import { toDateInputValue } from '@/lib/dates';
import { employeeDisplayName } from '@/lib/utils';
import { db } from '@/server/db';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
  uiModeFor,
} from '@/server/permissions';
import { RoutesShell } from '@/features/routing/routes-shell';

export const metadata: Metadata = { title: 'Routen' };

export default async function RoutesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireOrganizationMembership();
  const params = await searchParams;
  const mode = uiModeFor(ctx);
  // Solo-, persönliche und Mitarbeiteransicht planen ausschließlich die eigene
  // Route; nur das volle Leitungs-UI erhält Mitarbeiterwahl + Teamplanung.
  const teamMode = mode === 'team';

  const employees = teamMode
    ? await db.employee.findMany({
        where: {
          organizationId: ctx.organization.id,
          deletedAt: null,
          status: 'ACTIVE',
          ...employeeScopeFilter(await getManagedEmployeeIds(ctx)),
        },
        select: { id: true, firstName: true, lastName: true, userId: true },
        orderBy: [{ lastName: 'asc' }],
      })
    : [];

  const ownEmployeeId = ctx.employee?.id ?? null;
  const initialEmployeeId = teamMode
    ? params.mitarbeiter && employees.some((e) => e.id === params.mitarbeiter)
      ? params.mitarbeiter
      : (ownEmployeeId ?? employees[0]?.id ?? '')
    : (ownEmployeeId ?? '');

  return (
    <RoutesShell
      teamMode={teamMode}
      employees={
        teamMode
          ? employees.map((e) => ({ id: e.id, name: employeeDisplayName(e, ctx.user.id) }))
          : []
      }
      ownEmployeeId={ownEmployeeId}
      initialEmployeeId={initialEmployeeId}
      initialDate={params.datum ?? toDateInputValue(new Date(), ctx.organization.timezone)}
      autoPlan={params.plan === '1'}
      canManage={hasPermission(ctx, 'routes.manage')}
      canAccept={ctx.membership.role !== 'EMPLOYEE'}
      soloMode={mode === 'solo'}
      timezone={ctx.organization.timezone}
    />
  );
}
