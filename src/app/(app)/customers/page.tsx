import { ChevronLeft, ChevronRight, Contact, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EntityAvatar } from '@/components/ui/misc';
import { EmptyState } from '@/components/ui/panel';
import { StatusPill } from '@/components/ui/status-pill';
import { Table, TableWrapper, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDateShort, formatDateTime } from '@/lib/dates';
import { employeeDisplayName } from '@/lib/utils';
import { formatMinutesAsHours } from '@/lib/duration';
import { formatLocationLine } from '@/lib/geo';
import { CUSTOMER_STATUS, statusOf } from '@/lib/status-maps';
import { CustomerCsvActions } from '@/features/customers/customer-csv';
import { db } from '@/server/db';
import { employeeScopeFilter, getManagedEmployeeIds, requirePermission } from '@/server/permissions';
import { listCustomerCities, listCustomers } from '@/server/services/customer-service';
import { customerListParamsSchema } from '@/server/validation/customer';
import { CustomerFilters, SortHeader } from '@/features/customers/customer-filters';
import { CustomerRowActions } from '@/features/customers/customer-row-actions';

export const metadata: Metadata = { title: 'Kunden' };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission('customers.read');
  const raw = await searchParams;
  const params = customerListParamsSchema.parse({
    q: raw.q,
    status: raw.status,
    city: raw.city,
    employeeId: raw.employeeId,
    openHours: raw.openHours,
    sort: raw.sort,
    dir: raw.dir,
    page: raw.page,
    view: raw.view,
  });

  const scope = await getManagedEmployeeIds(ctx);
  const [result, cities, employees] = await Promise.all([
    listCustomers(params),
    listCustomerCities(),
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
  ]);

  const timezone = ctx.organization.timezone;

  const pageLink = (page: number) => {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value) sp.set(key, value);
    }
    sp.set('page', String(page));
    return `/customers?${sp.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Kunden"
        description={`${result.total} ${result.total === 1 ? 'Kunde' : 'Kunden'} · Stundenwerte für den aktuellen Monat`}
        actions={
          <>
            <CustomerCsvActions canManage={result.canManage} />
            {result.canManage ? (
              <Button asChild variant="primary" data-tour="customers-create-button">
                <Link href="/customers/new">
                  <Plus aria-hidden /> Kunde anlegen
                </Link>
              </Button>
            ) : null}
          </>
        }
      >
        <div className="mt-4" data-tour="customers-filters">
          <CustomerFilters
            cities={cities}
            employees={employees.map((e) => ({ id: e.id, name: employeeDisplayName(e, ctx.user.id) }))}
            view={params.view}
          />
        </div>
      </PageHeader>

      <div className="p-4 sm:p-5" data-tour="customers-list">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={<Contact />}
            title="Keine Kunden gefunden"
            description={
              params.q || params.city || params.employeeId || params.openHours
                ? 'Für die aktuellen Filter gibt es keine Treffer.'
                : 'Lege den ersten Kunden an, um mit der Planung zu starten.'
            }
            action={
              result.canManage ? (
                <Button asChild variant="primary">
                  <Link href="/customers/new">
                    <Plus aria-hidden /> Kunde anlegen
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Mobil: reduzierte, app-artige Liste – Details & Aktionen auf der Kundenseite. */}
            <ul className="space-y-2 md:hidden">
              {result.rows.map(({ customer, address, stats, nextAppointmentAt }) => {
                const name = `${customer.firstName} ${customer.lastName}`;
                return (
                  <li key={customer.id}>
                    <Link
                      href={`/customers/${customer.id}`}
                      className="flex items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] px-3.5 py-3 shadow-[var(--shadow-panel)] transition-colors active:bg-[var(--color-panel-raised)]"
                    >
                      <EntityAvatar id={customer.id} name={name} color={customer.color} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[length:var(--text-sm)] font-medium">
                          {name}
                        </span>
                        <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                          {address ? `${address.postalCode} ${address.city}` : customer.customerNumber}
                          {nextAppointmentAt
                            ? ` · ${formatDateShort(nextAppointmentAt, timezone)}`
                            : ' · kein Termin'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className="tabular block text-[length:var(--text-sm)] font-semibold"
                          style={{
                            color:
                              stats.balanceMinutes - stats.allocatedMinutes > 0
                                ? 'var(--color-warning)'
                                : 'var(--color-success)',
                          }}
                        >
                          {formatMinutesAsHours(stats.balanceMinutes - stats.allocatedMinutes)}
                        </span>
                        <span className="block text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                          offen
                        </span>
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-[var(--color-ink-subtle)]"
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>

            {params.view === 'cards' ? (
          <ul className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-3">
            {result.rows.map(({ customer, address, stats, nextAppointmentAt }) => (
              <li key={customer.id}>
                <Link
                  href={`/customers/${customer.id}`}
                  className="block rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-4 shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--color-line-strong)]"
                >
                  <div className="flex items-center gap-3">
                    <EntityAvatar
                      id={customer.id}
                      name={`${customer.firstName} ${customer.lastName}`}
                      color={customer.color}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {customer.firstName} {customer.lastName}
                      </div>
                      <div className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                        {customer.customerNumber}
                        {address ? ` · ${address.postalCode} ${address.city}` : ''}
                      </div>
                    </div>
                    <StatusPill size="sm" tone={statusOf(CUSTOMER_STATUS, customer.status).tone}>
                      {statusOf(CUSTOMER_STATUS, customer.status).label}
                    </StatusPill>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-2 py-1.5">
                      <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Kontostand</dt>
                      <dd
                        className="tabular text-[length:var(--text-sm)] font-semibold"
                        style={{ color: stats.balanceMinutes < 0 ? 'var(--color-danger)' : undefined }}
                      >
                        {formatMinutesAsHours(stats.balanceMinutes)}
                      </dd>
                    </div>
                    <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-2 py-1.5">
                      <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Geplant</dt>
                      <dd className="tabular text-[length:var(--text-sm)] font-semibold">
                        {formatMinutesAsHours(stats.reservedMinutes)}
                      </dd>
                    </div>
                    <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-2 py-1.5">
                      <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Offen</dt>
                      <dd
                        className="tabular text-[length:var(--text-sm)] font-semibold"
                        style={{
                          color:
                            stats.balanceMinutes - stats.allocatedMinutes > 0
                              ? 'var(--color-warning)'
                              : 'var(--color-success)',
                        }}
                      >
                        {formatMinutesAsHours(stats.balanceMinutes - stats.allocatedMinutes)}
                      </dd>
                    </div>
                  </dl>
                  {nextAppointmentAt ? (
                    <p className="mt-2 text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                      Nächster Termin: {formatDateTime(nextAppointmentAt, timezone)}
                    </p>
                  ) : (
                    <p className="mt-2 text-[length:var(--text-xs)] text-[var(--color-warning)]">
                      Kein nächster Termin geplant
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <TableWrapper className="hidden md:block">
            <Table>
              <THead>
                <Tr>
                  <Th>
                    <SortHeader label="Kunde" sortKey="name" />
                  </Th>
                  <Th>
                    <SortHeader label="Adresse" sortKey="city" />
                  </Th>
                  <Th>Telefon</Th>
                  <Th>Zuständig</Th>
                  <Th className="text-right">Kontostand</Th>
                  <Th className="text-right">Zugewiesen</Th>
                  <Th className="text-right">Geplant</Th>
                  <Th className="text-right">
                    <SortHeader label="Offen" sortKey="openMinutes" />
                  </Th>
                  <Th>
                    <SortHeader label="Nächster Termin" sortKey="nextAppointment" />
                  </Th>
                  <Th>Status</Th>
                  <Th aria-label="Aktionen" />
                </Tr>
              </THead>
              <TBody>
                {result.rows.map(({ customer, address, stats, nextAppointmentAt }) => {
                  const name = `${customer.firstName} ${customer.lastName}`;
                  return (
                    <Tr key={customer.id} interactive>
                      <Td>
                        <Link
                          href={`/customers/${customer.id}`}
                          className="flex items-center gap-2.5 font-medium hover:text-[var(--color-brand)]"
                        >
                          <EntityAvatar id={customer.id} name={name} color={customer.color} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate">{name}</span>
                            <span className="block text-[length:var(--text-2xs)] font-normal text-[var(--color-ink-subtle)]">
                              {customer.customerNumber}
                            </span>
                          </span>
                        </Link>
                      </Td>
                      <Td className="text-[var(--color-ink-muted)]">
                        {address ? formatLocationLine(address) : '—'}
                      </Td>
                      <Td className="whitespace-nowrap text-[var(--color-ink-muted)]">
                        {customer.phone ?? '—'}
                      </Td>
                      <Td className="whitespace-nowrap text-[var(--color-ink-muted)]">
                        {customer.preferredEmployee
                          ? `${customer.preferredEmployee.firstName} ${customer.preferredEmployee.lastName}`
                          : '—'}
                      </Td>
                      <Td
                        className="tabular text-right"
                        style={{ color: stats.balanceMinutes < 0 ? 'var(--color-danger)' : undefined }}
                      >
                        {formatMinutesAsHours(stats.balanceMinutes)}
                      </Td>
                      <Td className="tabular text-right">
                        {formatMinutesAsHours(stats.allocatedMinutes)}
                      </Td>
                      <Td className="tabular text-right">{formatMinutesAsHours(stats.reservedMinutes)}</Td>
                      <Td
                        className="tabular text-right font-medium"
                        style={{
                          color:
                            stats.balanceMinutes - stats.allocatedMinutes > 0
                              ? 'var(--color-warning)'
                              : 'var(--color-success)',
                        }}
                      >
                        {formatMinutesAsHours(stats.balanceMinutes - stats.allocatedMinutes)}
                      </Td>
                      <Td className="whitespace-nowrap text-[var(--color-ink-muted)]">
                        {nextAppointmentAt ? formatDateTime(nextAppointmentAt, timezone) : '—'}
                      </Td>
                      <Td>
                        <StatusPill size="sm" tone={statusOf(CUSTOMER_STATUS, customer.status).tone}>
                          {statusOf(CUSTOMER_STATUS, customer.status).label}
                        </StatusPill>
                      </Td>
                      <Td className="text-right">
                        <CustomerRowActions
                          customerId={customer.id}
                          name={name}
                          phone={customer.phone}
                          addressLine={address ? formatLocationLine(address) : null}
                          archived={customer.status === 'ARCHIVED' || customer.deletedAt !== null}
                          canManage={result.canManage}
                          canAllocate={result.canManage}
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </TableWrapper>
            )}
          </>
        )}

        {result.pageCount > 1 ? (
          <nav className="mt-4 flex items-center justify-between" aria-label="Seitennavigation">
            <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
              Seite {result.page} von {result.pageCount}
            </span>
            <div className="flex gap-2">
              <Button asChild variant="secondary" size="sm" disabled={result.page <= 1}>
                <Link href={pageLink(Math.max(1, result.page - 1))} aria-label="Vorherige Seite">
                  <ChevronLeft aria-hidden /> Zurück
                </Link>
              </Button>
              <Button asChild variant="secondary" size="sm" disabled={result.page >= result.pageCount}>
                <Link
                  href={pageLink(Math.min(result.pageCount, result.page + 1))}
                  aria-label="Nächste Seite"
                >
                  Weiter <ChevronRight aria-hidden />
                </Link>
              </Button>
            </div>
          </nav>
        ) : null}
      </div>
    </>
  );
}
