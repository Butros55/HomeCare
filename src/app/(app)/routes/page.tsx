import type { Metadata } from 'next';

import { toDateInputValue } from '@/lib/dates';
import { employeeDisplayName } from '@/lib/utils';
import { db } from '@/server/db';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
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
  const scope = await getManagedEmployeeIds(ctx);

  const employees = await db.employee.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      status: 'ACTIVE',
      ...employeeScopeFilter(scope),
    },
    select: { id: true, firstName: true, lastName: true, userId: true },
    orderBy: [{ lastName: 'asc' }],
  });

  const initialEmployeeId =
    params.mitarbeiter && employees.some((e) => e.id === params.mitarbeiter)
      ? params.mitarbeiter
      : (ctx.employee?.id ?? employees[0]?.id ?? '');

  return (
    <RoutesShell
      employees={employees.map((e) => ({ id: e.id, name: employeeDisplayName(e, ctx.user.id) }))}
      initialEmployeeId={initialEmployeeId}
      initialDate={params.datum ?? toDateInputValue(new Date(), ctx.organization.timezone)}
      canManage={hasPermission(ctx, 'routes.manage')}
      timezone={ctx.organization.timezone}
    />
  );
}
