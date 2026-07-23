import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader, PanelTitle, StatTile } from '@/components/ui/panel';
import { Table, TableWrapper, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { monthPeriodInZone, toDateInputValue } from '@/lib/dates';
import { formatMinutesAsHours } from '@/lib/duration';
import { formatDistance, formatTravelSeconds } from '@/lib/geo';
import { APPOINTMENT_STATUS, statusOf } from '@/lib/status-maps';
import { employeeDisplayName } from '@/lib/utils';
import { db } from '@/server/db';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  requirePermission,
} from '@/server/permissions';
import { getReportData } from '@/server/services/report-service';
import { ReportFilterBar } from '@/features/reports/report-filter-bar';
import { SimpleBarChart } from '@/features/reports/simple-bar-chart';

export const metadata: Metadata = { title: 'Auswertungen' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePermission('reports.view');
  const params = await searchParams;

  const month = monthPeriodInZone(new Date(), ctx.organization.timezone);
  const defaultFrom = toDateInputValue(month.start, ctx.organization.timezone);
  const defaultTo = toDateInputValue(new Date(month.end.getTime() - 1), ctx.organization.timezone);

  const filters = {
    from: params.from ?? defaultFrom,
    to: params.to ?? defaultTo,
    employeeId: params.employeeId || undefined,
    teamId: params.teamId || undefined,
    customerId: params.customerId || undefined,
    status: params.status || undefined,
  };

  const scope = await getManagedEmployeeIds(ctx);
  const [data, employees, customers, teamManagers] = await Promise.all([
    getReportData(filters),
    db.employee.findMany({
      where: {
        organizationId: ctx.organization.id,
        deletedAt: null,
        ...employeeScopeFilter(scope),
      },
      select: { id: true, firstName: true, lastName: true, userId: true },
      orderBy: [{ lastName: 'asc' }],
    }),
    db.customer.findMany({
      where: { organizationId: ctx.organization.id, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: 'asc' }],
      take: 300,
    }),
    db.employee.findMany({
      where: {
        organizationId: ctx.organization.id,
        deletedAt: null,
        subordinates: { some: { deletedAt: null } },
        ...employeeScopeFilter(scope),
      },
      select: { id: true, firstName: true, lastName: true, userId: true },
    }),
  ]);

  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) exportParams.set(key, value);
  }

  return (
    <>
      <PageHeader
        title="Auswertungen"
        description={`Zeitraum ${filters.from} bis ${filters.to}`}
        actions={
          <Button asChild variant="secondary">
            <Link href={`/api/reports/export?${exportParams.toString()}`} prefetch={false}>
              <Download aria-hidden /> CSV-Export
            </Link>
          </Button>
        }
      >
        <div className="mt-4">
          <ReportFilterBar
            defaultFrom={defaultFrom}
            defaultTo={defaultTo}
            employees={employees.map((e) => ({ id: e.id, name: employeeDisplayName(e, ctx.user.id) }))}
            customers={customers.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` }))}
            teamManagers={teamManagers.map((t) => ({ id: t.id, name: employeeDisplayName(t, ctx.user.id) }))}
          />
        </div>
      </PageHeader>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile label="Kundenstunden (Budget)" value={formatMinutesAsHours(data.totals.budgetMinutes)} />
          <StatTile label="Zugewiesen" value={formatMinutesAsHours(data.totals.allocatedMinutes)} />
          <StatTile label="Geplant" value={formatMinutesAsHours(data.totals.plannedMinutes)} />
          <StatTile label="Geleistet" value={formatMinutesAsHours(data.totals.completedMinutes)} tone="success" />
          <StatTile
            label="Offen"
            value={formatMinutesAsHours(data.totals.openMinutes)}
            tone={data.totals.openMinutes > 0 ? 'warning' : 'success'}
          />
          <StatTile label="Fahrtzeit (Routen)" value={formatTravelSeconds(data.totals.travelSeconds)} />
          <StatTile label="Entfernung" value={formatDistance(data.totals.distanceMeters)} />
          <StatTile
            label="Auslastung"
            value={data.totals.utilizationPercent != null ? `${data.totals.utilizationPercent} %` : '—'}
          />
          <StatTile
            label="Ausfälle"
            value={data.totals.cancelledCount}
            hint="abgesagt / nicht angetroffen"
            tone={data.totals.cancelledCount > 0 ? 'warning' : 'success'}
          />
          <StatTile
            label="Unbesetzt"
            value={data.totals.unassignedCount}
            hint="Termine ohne Mitarbeiter"
            tone={data.totals.unassignedCount > 0 ? 'warning' : 'success'}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel>
            <PanelHeader>
              <PanelTitle>Geplante Stunden je Mitarbeiter</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <SimpleBarChart
                items={data.employeeRows
                  .filter((row) => row.plannedMinutes > 0 || row.allocatedMinutes > 0)
                  .slice(0, 12)
                  .map((row) => ({
                    label: row.name,
                    value: Math.round((row.plannedMinutes / 60) * 100) / 100,
                    secondaryValue: Math.round((row.allocatedMinutes / 60) * 100) / 100,
                  }))}
                unit="h"
                legend={{ primary: 'geplant', secondary: 'zugewiesen' }}
              />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>
              <PanelTitle>Termine nach Status</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <SimpleBarChart
                items={Object.entries(data.statusCounts).map(([status, count]) => ({
                  label: statusOf(APPOINTMENT_STATUS, status).label,
                  value: count,
                }))}
                unit=""
              />
            </PanelBody>
          </Panel>
        </div>

        <Panel>
          <PanelHeader>
            <PanelTitle>Mitarbeiter</PanelTitle>
          </PanelHeader>
          <TableWrapper className="rounded-t-none border-0 shadow-none">
            <Table>
              <THead>
                <Tr>
                  <Th>Mitarbeiter</Th>
                  <Th className="text-right">Zugewiesen</Th>
                  <Th className="text-right">Geplant</Th>
                  <Th className="text-right">Geleistet</Th>
                  <Th className="text-right">Eigenverpflichtung</Th>
                </Tr>
              </THead>
              <TBody>
                {data.employeeRows.map((row) => (
                  <Tr key={row.id} interactive>
                    <Td>
                      <Link href={`/employees/${row.id}`} className="font-medium hover:text-[var(--color-brand)]">
                        {row.name}
                      </Link>
                    </Td>
                    <Td className="tabular text-right">{formatMinutesAsHours(row.allocatedMinutes)}</Td>
                    <Td className="tabular text-right">{formatMinutesAsHours(row.plannedMinutes)}</Td>
                    <Td className="tabular text-right">{formatMinutesAsHours(row.completedMinutes)}</Td>
                    <Td className="tabular text-right">{formatMinutesAsHours(row.selfObligationMinutes)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Kunden</PanelTitle>
          </PanelHeader>
          <TableWrapper className="rounded-t-none border-0 shadow-none">
            <Table>
              <THead>
                <Tr>
                  <Th>Kunde</Th>
                  <Th className="text-right">Budget</Th>
                  <Th className="text-right">Zugewiesen</Th>
                  <Th className="text-right">Geplant</Th>
                  <Th className="text-right">Geleistet</Th>
                  <Th className="text-right">Offen</Th>
                </Tr>
              </THead>
              <TBody>
                {data.customerRows.map((row) => (
                  <Tr key={row.id} interactive>
                    <Td>
                      <Link href={`/customers/${row.id}`} className="font-medium hover:text-[var(--color-brand)]">
                        {row.name}
                      </Link>
                    </Td>
                    <Td className="tabular text-right">{formatMinutesAsHours(row.budgetMinutes)}</Td>
                    <Td className="tabular text-right">{formatMinutesAsHours(row.allocatedMinutes)}</Td>
                    <Td className="tabular text-right">{formatMinutesAsHours(row.plannedMinutes)}</Td>
                    <Td className="tabular text-right">{formatMinutesAsHours(row.completedMinutes)}</Td>
                    <Td
                      className="tabular text-right font-medium"
                      style={{
                        color: row.openMinutes > 0 ? 'var(--color-warning)' : 'var(--color-success)',
                      }}
                    >
                      {formatMinutesAsHours(row.openMinutes)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        </Panel>
      </div>
    </>
  );
}
