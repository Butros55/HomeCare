import type { Metadata } from 'next';

import { employeeDisplayName } from '@/lib/utils';
import { db } from '@/server/db';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
  uiModeFor,
} from '@/server/permissions';
import { ProCalendarShell } from '@/features/calendar/pro/pro-calendar-shell';

export const metadata: Metadata = { title: 'Kalender' };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireOrganizationMembership();
  const params = await searchParams;
  const scope = await getManagedEmployeeIds(ctx);

  const [employees, customers] = await Promise.all([
    db.employee.findMany({
      where: {
        organizationId: ctx.organization.id,
        deletedAt: null,
        status: 'ACTIVE',
        ...employeeScopeFilter(scope),
      },
      select: { id: true, firstName: true, lastName: true, userId: true },
      orderBy: [{ lastName: 'asc' }],
    }),
    hasPermission(ctx, 'customers.read')
      ? db.customer.findMany({
          where: { organizationId: ctx.organization.id, deletedAt: null, status: { not: 'ARCHIVED' } },
          select: { id: true, firstName: true, lastName: true, color: true },
          orderBy: [{ lastName: 'asc' }],
          take: 500,
        })
      : Promise.resolve([]),
  ]);

  const canManage = hasPermission(ctx, 'appointments.manage');
  const uiMode = uiModeFor(ctx);

  // Portierter StudyMate-Kalender: füllt die Seitenhöhe, App-Sidebar bleibt.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProCalendarShell
        canManage={canManage}
        ownEmployeeId={ctx.employee?.id ?? null}
        simplePlanning={uiMode !== 'team'}
        soloMode={uiMode === 'solo'}
        employees={employees.map((e) => ({ id: e.id, name: employeeDisplayName(e, ctx.user.id) }))}
        customers={customers.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, color: c.color }))}
        urlParams={{
          neu: params.neu === '1',
          kunde: params.kunde,
          serie: params.serie === '1',
          termin: params.termin,
        }}
      />
    </div>
  );
}
