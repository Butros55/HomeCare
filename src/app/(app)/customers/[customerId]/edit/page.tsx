import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/layout/page-header';
import { employeeDisplayName } from '@/lib/utils';
import { db } from '@/server/db';
import { assertSameOrg, hasPermission, requirePermission } from '@/server/permissions';
import { CustomerForm } from '@/features/customers/customer-form';

export const metadata: Metadata = { title: 'Kunde bearbeiten' };

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const ctx = await requirePermission('customers.manage');

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: { addresses: { take: 1, orderBy: { label: 'asc' } } },
  });
  if (!customer) notFound();
  assertSameOrg(ctx, customer);

  const employees = await db.employee.findMany({
    where: { organizationId: ctx.organization.id, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true, userId: true },
    orderBy: [{ lastName: 'asc' }],
  });

  const address = customer.addresses[0];
  const name = `${customer.firstName} ${customer.lastName}`;

  return (
    <>
      <PageHeader
        title={`${name} bearbeiten`}
        breadcrumbs={[
          { label: 'Kunden', href: '/customers' },
          { label: name, href: `/customers/${customer.id}` },
          { label: 'Bearbeiten' },
        ]}
      />
      <div className="mx-auto max-w-3xl p-4 sm:p-5">
        <CustomerForm
          initial={{
            customerId: customer.id,
            values: {
              salutation: customer.salutation ?? '',
              firstName: customer.firstName,
              lastName: customer.lastName,
              companyName: customer.companyName ?? '',
              customerNumber: customer.customerNumber,
              email: customer.email ?? '',
              phone: customer.phone ?? '',
              secondaryPhone: customer.secondaryPhone ?? '',
              status: customer.status,
              preferredEmployeeId: customer.preferredEmployeeId ?? '',
              color: customer.color,
              accessInstructions: customer.accessInstructions ?? '',
              cleaningInstructions: customer.cleaningInstructions ?? '',
              privateNotes: hasPermission(ctx, 'customers.privateNotes')
                ? (customer.privateNotes ?? '')
                : '',
              routeNotes: customer.routeNotes ?? '',
              address: {
                street: address?.street ?? '',
                houseNumber: address?.houseNumber ?? '',
                addressAddition: address?.addressAddition ?? '',
                postalCode: address?.postalCode ?? '',
                city: address?.city ?? '',
                countryCode: address?.countryCode ?? 'DE',
              },
            },
          }}
          employees={employees.map((e) => ({ id: e.id, name: employeeDisplayName(e, ctx.user.id) }))}
          canEditPrivateNotes={hasPermission(ctx, 'customers.privateNotes')}
        />
      </div>
    </>
  );
}
