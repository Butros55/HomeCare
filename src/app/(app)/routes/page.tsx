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
          where: {
            organizationId: ctx.organization.id,
            deletedAt: null,
            status: { not: 'ARCHIVED' },
          },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ lastName: 'asc' }],
          take: 500,
        })
      : Promise.resolve([]),
  ]);

  const ownEmployeeId = ctx.employee?.id ?? null;
  const initialEmployeeId = teamMode
    ? params.mitarbeiter && employees.some((e) => e.id === params.mitarbeiter)
      ? params.mitarbeiter
      : (ownEmployeeId ?? employees[0]?.id ?? '')
    : (ownEmployeeId ?? '');

  const canManageRoutes = hasPermission(ctx, 'routes.manage');
  // Reine Eigen-Ansicht (Mitarbeiter/solo/persönlich): die eigene Route darf
  // selbst geplant, gespeichert und übernommen werden. Serverseitig ist jede
  // Schreibaktion auf die eigene employeeId begrenzt (isOwn/Scope).
  const canSelfPlan = !teamMode && Boolean(ownEmployeeId);

  return (
    <RoutesShell
      teamMode={teamMode}
      employees={
        employees.map((e) => ({ id: e.id, name: employeeDisplayName(e, ctx.user.id) }))
      }
      customers={customers.map((customer) => ({
        id: customer.id,
        name: `${customer.firstName} ${customer.lastName}`,
      }))}
      ownEmployeeId={ownEmployeeId}
      initialEmployeeId={initialEmployeeId}
      initialDate={params.datum ?? toDateInputValue(new Date(), ctx.organization.timezone)}
      autoPlan={params.plan === '1'}
      canManage={canManageRoutes || canSelfPlan}
      canAccept={canManageRoutes || canSelfPlan}
      canManageAppointments={hasPermission(ctx, 'appointments.manage')}
      soloMode={mode === 'solo'}
      hourBudgetsEnabled={ctx.organization.hourBudgetsEnabled}
      timezone={ctx.organization.timezone}
    />
  );
}
