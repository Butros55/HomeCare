import { AlertTriangle, ChevronRight, Plus, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EntityAvatar, Tooltip } from '@/components/ui/misc';
import { EmptyState } from '@/components/ui/panel';
import { SeverityPill, StatusPill } from '@/components/ui/status-pill';
import { Table, TableWrapper, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { weekPeriodInZone } from '@/lib/dates';
import { formatMinutesAsHours } from '@/lib/duration';
import { buildChildrenMap } from '@/lib/hierarchy';
import { EMPLOYEE_STATUS, EMPLOYMENT_TYPE_LABELS, statusOf } from '@/lib/status-maps';
import { db } from '@/server/db';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  hasPermission,
  requirePermission,
} from '@/server/permissions';
import { getEmployeeHourStatsBulk } from '@/server/services/hours-service';
import {
  computeEmployeeWarningsBulk,
  warningLabels,
} from '@/server/services/employee-insights';
import { employeeListParamsSchema } from '@/server/validation/employee';
import { EmployeeFilters } from '@/features/employees/employee-filters';
import { EmployeeRowActions } from '@/features/employees/employee-row-actions';

export const metadata: Metadata = { title: 'Mitarbeiter' };

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission('employees.read');
  const raw = await searchParams;
  const params = employeeListParamsSchema.parse({
    q: raw.q,
    status: raw.status,
    missingHours: raw.missingHours,
    view: raw.view,
  });

  const scope = await getManagedEmployeeIds(ctx);
  const employees = await db.employee.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      ...(params.status === 'ALL' ? {} : { status: params.status }),
      ...employeeScopeFilter(scope),
      ...(params.q
        ? {
            OR: [
              { firstName: { contains: params.q, mode: 'insensitive' } },
              { lastName: { contains: params.q, mode: 'insensitive' } },
              { personnelNumber: { contains: params.q, mode: 'insensitive' } },
              { email: { contains: params.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: { manager: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const timezone = ctx.organization.timezone;
  const week = weekPeriodInZone(new Date(), timezone);
  const [statsMap, warningsMap] = await Promise.all([
    getEmployeeHourStatsBulk(employees, week, 'week'),
    computeEmployeeWarningsBulk(employees, week, timezone),
  ]);

  let rows = employees.map((employee) => ({
    employee,
    stats: statsMap.get(employee.id)!,
    warnings: warningsMap.get(employee.id)!,
  }));
  if (params.missingHours) {
    rows = rows.filter((row) => row.stats.missingByAllocation > 0);
  }

  const canManage = hasPermission(ctx, 'employees.manage');
  const canInvite =
    hasPermission(ctx, 'employees.invite') ||
    (ctx.membership.role === 'TEAM_MANAGER' && Boolean(ctx.employee?.canRecruitEmployees));

  return (
    <>
      <PageHeader
        title="Mitarbeiter"
        description={`${rows.length} ${rows.length === 1 ? 'Mitarbeiter' : 'Mitarbeiter'} · Stundenwerte für die aktuelle Woche`}
        actions={
          canManage ? (
            <Button asChild variant="primary">
              <Link href="/employees/new">
                <Plus aria-hidden /> Mitarbeiter anlegen
              </Link>
            </Button>
          ) : undefined
        }
      >
        <div className="mt-4">
          <EmployeeFilters view={params.view} />
        </div>
      </PageHeader>

      <div className="p-4 sm:p-5">
        {rows.length === 0 ? (
          <EmptyState
            icon={<UsersRound />}
            title="Keine Mitarbeiter gefunden"
            description={
              params.q || params.missingHours
                ? 'Für die aktuellen Filter gibt es keine Treffer.'
                : 'Lege Mitarbeiter an und lade sie anschließend per E-Mail ein.'
            }
            action={
              canManage ? (
                <Button asChild variant="primary">
                  <Link href="/employees/new">
                    <Plus aria-hidden /> Mitarbeiter anlegen
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Mobil: reduzierte, app-artige Liste – Details auf der Mitarbeiterseite. */}
            <ul className="space-y-2 md:hidden">
              {rows.map(({ employee, stats, warnings }) => {
                const name = `${employee.firstName} ${employee.lastName}`;
                const labels = warningLabels(warnings);
                return (
                  <li key={employee.id}>
                    <Link
                      href={`/employees/${employee.id}`}
                      className="flex items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] px-3.5 py-3 shadow-[var(--shadow-panel)] transition-colors active:bg-[var(--color-panel-raised)]"
                    >
                      <EntityAvatar id={employee.id} name={name} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[length:var(--text-sm)] font-medium">
                            {name}
                          </span>
                          {labels.length > 0 ? (
                            <AlertTriangle
                              className="size-3.5 shrink-0 text-[var(--color-warning)]"
                              aria-label={labels.join(' · ')}
                            />
                          ) : null}
                        </span>
                        <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                          {EMPLOYMENT_TYPE_LABELS[employee.employmentType]}
                          {employee.manager
                            ? ` · Team ${employee.manager.firstName} ${employee.manager.lastName}`
                            : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className="tabular block text-[length:var(--text-sm)] font-semibold"
                          style={{
                            color:
                              stats.missingByAllocation > 0
                                ? 'var(--color-warning)'
                                : 'var(--color-success)',
                          }}
                        >
                          {formatMinutesAsHours(stats.missingByAllocation)}
                        </span>
                        <span className="block text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                          fehlend
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

            {params.view === 'hierarchy' ? (
              <div className="hidden md:block">
                <HierarchyView rows={rows} />
              </div>
            ) : params.view === 'cards' ? (
          <ul className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-3">
            {rows.map(({ employee, stats, warnings }) => {
              const name = `${employee.firstName} ${employee.lastName}`;
              const labels = warningLabels(warnings);
              return (
                <li key={employee.id}>
                  <Link
                    href={`/employees/${employee.id}`}
                    className="block rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-4 shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--color-line-strong)]"
                  >
                    <div className="flex items-center gap-3">
                      <EntityAvatar id={employee.id} name={name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{name}</div>
                        <div className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                          {EMPLOYMENT_TYPE_LABELS[employee.employmentType]}
                          {employee.manager
                            ? ` · Team ${employee.manager.firstName} ${employee.manager.lastName}`
                            : ''}
                        </div>
                      </div>
                      <StatusPill size="sm" tone={statusOf(EMPLOYEE_STATUS, employee.status).tone}>
                        {statusOf(EMPLOYEE_STATUS, employee.status).label}
                      </StatusPill>
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-2 py-1.5">
                        <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Ziel/Woche</dt>
                        <dd className="tabular text-[length:var(--text-sm)] font-semibold">
                          {stats.targetMinutes != null ? formatMinutesAsHours(stats.targetMinutes) : '—'}
                        </dd>
                      </div>
                      <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-2 py-1.5">
                        <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Geplant</dt>
                        <dd className="tabular text-[length:var(--text-sm)] font-semibold">
                          {formatMinutesAsHours(stats.plannedMinutes)}
                        </dd>
                      </div>
                      <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-2 py-1.5">
                        <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Fehlend</dt>
                        <dd
                          className="tabular text-[length:var(--text-sm)] font-semibold"
                          style={{
                            color:
                              stats.missingByAllocation > 0
                                ? 'var(--color-warning)'
                                : 'var(--color-success)',
                          }}
                        >
                          {formatMinutesAsHours(stats.missingByAllocation)}
                        </dd>
                      </div>
                    </dl>
                    {labels.length > 0 ? (
                      <p className="mt-2 flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--color-warning)]">
                        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                        {labels.join(' · ')}
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <TableWrapper className="hidden md:block">
            <Table>
              <THead>
                <Tr>
                  <Th>Mitarbeiter</Th>
                  <Th>Beschäftigung</Th>
                  <Th>Vorgesetzter</Th>
                  <Th className="text-right">Ziel (Woche)</Th>
                  <Th className="text-right">Zugewiesen</Th>
                  <Th className="text-right">Geplant</Th>
                  <Th className="text-right">Fehlend</Th>
                  <Th>Hinweise</Th>
                  <Th>Status</Th>
                  <Th aria-label="Aktionen" />
                </Tr>
              </THead>
              <TBody>
                {rows.map(({ employee, stats, warnings }) => {
                  const name = `${employee.firstName} ${employee.lastName}`;
                  const labels = warningLabels(warnings);
                  return (
                    <Tr key={employee.id} interactive>
                      <Td>
                        <Link
                          href={`/employees/${employee.id}`}
                          className="flex items-center gap-2.5 font-medium hover:text-[var(--color-brand)]"
                        >
                          <EntityAvatar id={employee.id} name={name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate">{name}</span>
                            <span className="block text-[length:var(--text-2xs)] font-normal text-[var(--color-ink-subtle)]">
                              {employee.personnelNumber ?? '—'}
                            </span>
                          </span>
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-[var(--color-ink-muted)]">
                        {EMPLOYMENT_TYPE_LABELS[employee.employmentType]}
                      </Td>
                      <Td className="whitespace-nowrap text-[var(--color-ink-muted)]">
                        {employee.manager ? (
                          <Link
                            href={`/employees/${employee.manager.id}`}
                            className="hover:text-[var(--color-brand)]"
                          >
                            {employee.manager.firstName} {employee.manager.lastName}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td className="tabular text-right">
                        {stats.targetMinutes != null ? formatMinutesAsHours(stats.targetMinutes) : '—'}
                      </Td>
                      <Td className="tabular text-right">{formatMinutesAsHours(stats.allocatedMinutes)}</Td>
                      <Td className="tabular text-right">{formatMinutesAsHours(stats.plannedMinutes)}</Td>
                      <Td
                        className="tabular text-right font-medium"
                        style={{
                          color:
                            stats.missingByAllocation > 0
                              ? 'var(--color-warning)'
                              : 'var(--color-success)',
                        }}
                      >
                        {formatMinutesAsHours(stats.missingByAllocation)}
                      </Td>
                      <Td>
                        {labels.length > 0 ? (
                          <Tooltip content={labels.join(' · ')}>
                            <span>
                              <SeverityPill tone={warnings.absenceCollisions > 0 || warnings.overlappingAppointments > 0 ? 'urgent' : 'high'}>
                                <AlertTriangle className="mr-1 size-3" aria-hidden />
                                {labels.length}
                              </SeverityPill>
                            </span>
                          </Tooltip>
                        ) : (
                          <span className="text-[var(--color-ink-subtle)]">—</span>
                        )}
                      </Td>
                      <Td>
                        <StatusPill size="sm" tone={statusOf(EMPLOYEE_STATUS, employee.status).tone}>
                          {statusOf(EMPLOYEE_STATUS, employee.status).label}
                        </StatusPill>
                      </Td>
                      <Td className="text-right">
                        <EmployeeRowActions
                          employeeId={employee.id}
                          name={name}
                          active={employee.status === 'ACTIVE'}
                          hasUser={Boolean(employee.userId)}
                          email={employee.email}
                          canManage={canManage}
                          canInvite={canInvite}
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
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function HierarchyView({
  rows,
}: {
  rows: Array<{
    employee: {
      id: string;
      firstName: string;
      lastName: string;
      managerEmployeeId: string | null;
      status: string;
    };
    stats: { missingByAllocation: number; allocatedMinutes: number };
    warnings: { overlappingAppointments: number; absenceCollisions: number };
  }>;
}) {
  const nodes = rows.map((row) => ({
    id: row.employee.id,
    managerEmployeeId: row.employee.managerEmployeeId,
  }));
  const childrenMap = buildChildrenMap(nodes);
  const inList = new Set(rows.map((r) => r.employee.id));
  // Wurzeln: ohne Manager oder Manager außerhalb der gefilterten Liste.
  const roots = rows.filter(
    (row) =>
      row.employee.managerEmployeeId === null || !inList.has(row.employee.managerEmployeeId),
  );
  const byId = new Map(rows.map((row) => [row.employee.id, row] as const));

  const renderNode = (id: string, depth: number): React.ReactNode => {
    const row = byId.get(id);
    if (!row) return null;
    const name = `${row.employee.firstName} ${row.employee.lastName}`;
    const children = childrenMap.get(id) ?? [];
    return (
      <li key={id}>
        <Link
          href={`/employees/${id}`}
          className="flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 transition-colors hover:bg-[var(--color-panel-raised)]"
          style={{ marginLeft: depth * 24 }}
        >
          {depth > 0 ? (
            <span className="text-[var(--color-line-strong)]" aria-hidden>
              └
            </span>
          ) : null}
          <EntityAvatar id={id} name={name} size="sm" />
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
          {row.stats.missingByAllocation > 0 ? (
            <span className="tabular text-[length:var(--text-xs)] text-[var(--color-warning)]">
              fehlen {formatMinutesAsHours(row.stats.missingByAllocation)}
            </span>
          ) : (
            <span className="tabular text-[length:var(--text-xs)] text-[var(--color-success)]">
              {formatMinutesAsHours(row.stats.allocatedMinutes)} erhalten
            </span>
          )}
          <StatusPill size="sm" tone={statusOf(EMPLOYEE_STATUS, row.employee.status).tone}>
            {statusOf(EMPLOYEE_STATUS, row.employee.status).label}
          </StatusPill>
        </Link>
        {children.length > 0 ? (
          <ul>{children.map((childId) => renderNode(childId, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-3 shadow-[var(--shadow-panel)]">
      <ul>{roots.map((row) => renderNode(row.employee.id, 0))}</ul>
    </div>
  );
}
