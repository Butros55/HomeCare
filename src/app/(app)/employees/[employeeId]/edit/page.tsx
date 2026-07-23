import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/layout/page-header';
import { db } from '@/server/db';
import {
  assertSameOrg,
  canAccessEmployee,
  employeeScopeFilter,
  getManagedEmployeeIds,
  requirePermission,
} from '@/server/permissions';
import { EmployeeForm } from '@/features/employees/employee-form';

export const metadata: Metadata = { title: 'Mitarbeiter bearbeiten' };

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;
  const ctx = await requirePermission('employees.manage');

  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) notFound();
  assertSameOrg(ctx, employee);
  if (!(await canAccessEmployee(ctx, employeeId, 'manage'))) notFound();

  const scope = await getManagedEmployeeIds(ctx);
  const managers = await db.employee.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      status: 'ACTIVE',
      id: { not: employeeId },
      ...employeeScopeFilter(scope),
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: 'asc' }],
  });

  const name = `${employee.firstName} ${employee.lastName}`;

  return (
    <>
      <PageHeader
        title={`${name} bearbeiten`}
        breadcrumbs={[
          { label: 'Mitarbeiter', href: '/employees' },
          { label: name, href: `/employees/${employee.id}` },
          { label: 'Bearbeiten' },
        ]}
      />
      <div className="mx-auto max-w-3xl p-4 sm:p-5">
        <EmployeeForm
          initial={{
            employeeId: employee.id,
            values: {
              firstName: employee.firstName,
              lastName: employee.lastName,
              email: employee.email ?? '',
              phone: employee.phone ?? '',
              personnelNumber: employee.personnelNumber ?? '',
              status: employee.status,
              employmentType: employee.employmentType,
              managerEmployeeId: employee.managerEmployeeId ?? '',
              targetMinutesPerWeek: employee.targetMinutesPerWeek,
              targetMinutesPerMonth: employee.targetMinutesPerMonth,
              maximumMinutesPerDay: employee.maximumMinutesPerDay,
              canRecruitEmployees: employee.canRecruitEmployees,
              canReceiveHours: employee.canReceiveHours,
              notes: employee.notes ?? '',
            },
          }}
          managerOptions={managers.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` }))}
        />
      </div>
    </>
  );
}
