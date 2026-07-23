import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/page-header';
import { employeeDisplayName } from '@/lib/utils';
import { db } from '@/server/db';
import { requirePermission } from '@/server/permissions';
import { CustomerForm } from '@/features/customers/customer-form';
import { hasPermission } from '@/server/permissions';

export const metadata: Metadata = { title: 'Kunde anlegen' };

export default async function NewCustomerPage() {
  const ctx = await requirePermission('customers.manage');
  const employees = await db.employee.findMany({
    where: { organizationId: ctx.organization.id, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true, userId: true },
    orderBy: [{ lastName: 'asc' }],
  });

  return (
    <>
      <PageHeader
        title="Kunde anlegen"
        breadcrumbs={[{ label: 'Kunden', href: '/customers' }, { label: 'Neu' }]}
      />
      <div className="mx-auto max-w-3xl p-4 sm:p-5">
        <CustomerForm
          initial={{}}
          employees={employees.map((e) => ({ id: e.id, name: employeeDisplayName(e, ctx.user.id) }))}
          canEditPrivateNotes={hasPermission(ctx, 'customers.privateNotes')}
        />
      </div>
    </>
  );
}
