import type { Metadata } from 'next';

import { db } from '@/server/db';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
} from '@/server/permissions';
import { CalendarShell } from '@/features/calendar/calendar-shell';

export const metadata: Metadata = { title: 'Kalender' };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireOrganizationMembership();
  const params = await searchParams;
  const scope = await getManagedEmployeeIds(ctx);

  const [employees, customers, teamManagers, preference] = await Promise.all([
    db.employee.findMany({
      where: {
        organizationId: ctx.organization.id,
        deletedAt: null,
        status: 'ACTIVE',
        ...employeeScopeFilter(scope),
      },
      select: { id: true, firstName: true, lastName: true },
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
    hasPermission(ctx, 'appointments.viewAll')
      ? db.employee.findMany({
          where: {
            organizationId: ctx.organization.id,
            deletedAt: null,
            subordinates: { some: { deletedAt: null } },
          },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ lastName: 'asc' }],
        })
      : Promise.resolve([]),
    db.userPreference.findUnique({ where: { userId: ctx.user.id } }),
  ]);

  const canManage = hasPermission(ctx, 'appointments.manage');

  return (
    <CalendarShell
      canManage={canManage}
      isEmployeeOnly={ctx.membership.role === 'EMPLOYEE'}
      ownEmployeeId={ctx.employee?.id ?? null}
      initialView={preference?.calendarView ?? 'timeGridWeek'}
      initialColorBy={(preference?.calendarColorBy as 'customer' | 'employee' | 'status' | 'team') ?? 'customer'}
      employees={employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))}
      customers={customers.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, color: c.color }))}
      teamManagers={teamManagers.map((t) => ({ id: t.id, name: `${t.firstName} ${t.lastName}` }))}
      urlParams={{
        neu: params.neu === '1',
        kunde: params.kunde,
        serie: params.serie === '1',
        mitarbeiter: params.mitarbeiter,
        termin: params.termin,
        zuweisung:
          params.zuweisung === 'offen'
            ? 'unassigned'
            : params.zuweisung === 'abgelehnt'
              ? 'declined'
              : undefined,
        konflikte: params.konflikte === '1',
      }}
    />
  );
}
