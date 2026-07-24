import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/page-header';
import { db } from '@/server/db';
import { employeeScopeFilter, getManagedEmployeeIds, requirePermission } from '@/server/permissions';
import { EmployeeForm } from '@/features/employees/employee-form';

export const metadata: Metadata = { title: 'Mitarbeiter anlegen' };

export default async function NewEmployeePage() {
  const ctx = await requirePermission('employees.manage');
  const scope = await getManagedEmployeeIds(ctx);
  const managers = await db.employee.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      status: 'ACTIVE',
      ...employeeScopeFilter(scope),
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: 'asc' }],
  });

  return (
    <>
      <PageHeader
        title="Mitarbeiter anlegen"
        breadcrumbs={[{ label: 'Mitarbeiter', href: '/employees' }, { label: 'Neu' }]}
      />
      <div className="mx-auto w-full max-w-[var(--page-max)] p-4 sm:p-5">
        <EmployeeForm
          initial={{
            values:
              ctx.membership.role === 'TEAM_MANAGER' && ctx.employee
                ? { managerEmployeeId: ctx.employee.id }
                : {},
          }}
          managerOptions={managers.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` }))}
        />
      </div>
    </>
  );
}
