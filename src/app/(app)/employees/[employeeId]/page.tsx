import { addDays } from 'date-fns';
import { AlertTriangle, CalendarDays, Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EntityAvatar } from '@/components/ui/misc';
import { Panel, PanelBody, PanelHeader, PanelTitle, StatTile } from '@/components/ui/panel';
import { StatusPill } from '@/components/ui/status-pill';
import { Table, TableWrapper, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDate, formatDateTime, monthPeriodInZone, weekPeriodInZone } from '@/lib/dates';
import { formatMinutesAsHours, formatMinutesVerbose } from '@/lib/duration';
import {
  ABSENCE_STATUS,
  ABSENCE_TYPE_LABELS,
  APPOINTMENT_STATUS,
  EMPLOYEE_STATUS,
  EMPLOYMENT_TYPE_LABELS,
  statusOf,
} from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { auditActionLabel } from '@/server/audit';
import { db } from '@/server/db';
import {
  canAccessEmployee,
  hasPermission,
  requireOrganizationMembership,
} from '@/server/permissions';
import {
  computeEmployeeWarningsBulk,
  warningLabels,
} from '@/server/services/employee-insights';
import { getEmployeeHourStats } from '@/server/services/hours-service';
import { AbsenceManager, DeleteAbsenceButton } from '@/features/employees/absence-manager';
import { AvailabilityEditor } from '@/features/employees/availability-editor';
import { EmployeeRowActions } from '@/features/employees/employee-row-actions';
import { AllocateFromEmployeeButton } from '@/features/hours/allocate-from-employee-button';
import { RevokeAllocationButton } from '@/features/hours/revoke-allocation-button';

export const metadata: Metadata = { title: 'Mitarbeiter' };

const TABS = [
  { key: 'uebersicht', label: 'Übersicht' },
  { key: 'kalender', label: 'Kalender' },
  { key: 'kunden', label: 'Kunden' },
  { key: 'stunden', label: 'Stunden' },
  { key: 'verfuegbarkeit', label: 'Verfügbarkeit' },
  { key: 'abwesenheiten', label: 'Abwesenheiten' },
  { key: 'team', label: 'Unterstellte' },
  { key: 'auswertungen', label: 'Auswertungen' },
  { key: 'aktivitaet', label: 'Aktivität' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { employeeId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: TabKey = (TABS.some((t) => t.key === rawTab) ? rawTab : 'uebersicht') as TabKey;

  const ctx = await requireOrganizationMembership();
  if (!(await canAccessEmployee(ctx, employeeId, 'read'))) notFound();

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      manager: { select: { id: true, firstName: true, lastName: true } },
      user: { select: { id: true, email: true, lastLoginAt: true } },
    },
  });
  if (!employee || employee.deletedAt) notFound();

  const timezone = ctx.organization.timezone;
  const week = weekPeriodInZone(new Date(), timezone);
  const month = monthPeriodInZone(new Date(), timezone);
  const [weekStats, monthStats, warningsMap] = await Promise.all([
    getEmployeeHourStats(employee, week, 'week'),
    getEmployeeHourStats(employee, month, 'month'),
    computeEmployeeWarningsBulk([employee], week, timezone),
  ]);
  const warnings = warningsMap.get(employee.id)!;
  const labels = warningLabels(warnings);

  const name = `${employee.firstName} ${employee.lastName}`;
  const canManage =
    hasPermission(ctx, 'employees.manage') && (await canAccessEmployee(ctx, employeeId, 'manage'));
  const canInvite =
    (hasPermission(ctx, 'employees.invite') ||
      (ctx.membership.role === 'TEAM_MANAGER' && Boolean(ctx.employee?.canRecruitEmployees))) &&
    !employee.userId;
  const canAllocate =
    hasPermission(ctx, 'hours.allocateOrg') ||
    (hasPermission(ctx, 'hours.allocateOwnPool') && Boolean(ctx.employee));
  const isSelf = ctx.employee?.id === employeeId;

  const tabLink = (key: TabKey) =>
    key === 'uebersicht' ? `/employees/${employeeId}` : `/employees/${employeeId}?tab=${key}`;

  return (
    <>
      <PageHeader
        title={name}
        description={`${EMPLOYMENT_TYPE_LABELS[employee.employmentType]}${employee.personnelNumber ? ` · ${employee.personnelNumber}` : ''}${employee.manager ? ` · Team ${employee.manager.firstName} ${employee.manager.lastName}` : ''}`}
        breadcrumbs={[{ label: 'Mitarbeiter', href: '/employees' }, { label: name }]}
        actions={
          <>
            <StatusPill tone={statusOf(EMPLOYEE_STATUS, employee.status).tone}>
              {statusOf(EMPLOYEE_STATUS, employee.status).label}
            </StatusPill>
            {canAllocate && employee.status === 'ACTIVE' && employee.canReceiveHours ? (
              <AllocateFromEmployeeButton employeeId={employeeId} />
            ) : null}
            {canManage ? (
              <Button asChild variant="secondary">
                <Link href={`/employees/${employeeId}/edit`}>
                  <Pencil aria-hidden /> Bearbeiten
                </Link>
              </Button>
            ) : null}
            <EmployeeRowActions
              employeeId={employeeId}
              name={name}
              active={employee.status === 'ACTIVE'}
              hasUser={Boolean(employee.userId)}
              email={employee.email}
              canManage={canManage}
              canInvite={canInvite}
            />
          </>
        }
      >
        <nav
          className="mt-4 flex max-w-full gap-1 overflow-x-auto scrollbar-none rounded-full bg-[var(--color-panel-sunken)] p-1"
          aria-label="Mitarbeiter-Tabs"
        >
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={tabLink(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-[length:var(--text-sm)] whitespace-nowrap transition-colors pointer-coarse:px-4 pointer-coarse:py-2.5',
                tab === t.key
                  ? 'bg-[var(--color-panel)] font-medium text-[var(--color-ink)] shadow-[var(--shadow-panel)]'
                  : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </PageHeader>

      <div className="space-y-4 p-4 sm:p-5">
        {labels.length > 0 && (tab === 'uebersicht' || tab === 'kalender') ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-2.5 text-[length:var(--text-sm)] text-[var(--color-warning)]">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {labels.join(' · ')}
          </div>
        ) : null}

        {tab === 'uebersicht' ? (
          <OverviewTab
            employee={employee}
            weekStats={weekStats}
            monthStats={monthStats}
            timezone={timezone}
            isSelf={isSelf}
          />
        ) : null}
        {tab === 'kalender' ? <CalendarTab employeeId={employeeId} timezone={timezone} /> : null}
        {tab === 'kunden' ? <CustomersTab employeeId={employeeId} /> : null}
        {tab === 'stunden' ? (
          <HoursTab employeeId={employeeId} timezone={timezone} canRevoke={hasPermission(ctx, 'hours.allocateOrg')} />
        ) : null}
        {tab === 'verfuegbarkeit' ? (
          <AvailabilityTab employeeId={employeeId} readOnly={!canManage && !isSelf} />
        ) : null}
        {tab === 'abwesenheiten' ? (
          <AbsencesTab employeeId={employeeId} timezone={timezone} readOnly={!canManage && !isSelf} />
        ) : null}
        {tab === 'team' ? <TeamTab employeeId={employeeId} /> : null}
        {tab === 'auswertungen' ? (
          <ReportsTab employeeId={employeeId} monthStats={monthStats} />
        ) : null}
        {tab === 'aktivitaet' ? <ActivityTab employeeId={employeeId} timezone={timezone} /> : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

async function OverviewTab({
  employee,
  weekStats,
  monthStats,
  timezone,
  isSelf,
}: {
  employee: {
    id: string;
    email: string | null;
    phone: string | null;
    canReceiveHours: boolean;
    canRecruitEmployees: boolean;
    notes: string | null;
    user: { email: string; lastLoginAt: Date | null } | null;
  };
  weekStats: Awaited<ReturnType<typeof getEmployeeHourStats>>;
  monthStats: Awaited<ReturnType<typeof getEmployeeHourStats>>;
  timezone: string;
  isSelf: boolean;
}) {
  const [nextAppointments, customerCount] = await Promise.all([
    db.appointment.findMany({
      where: {
        assignedEmployeeId: employee.id,
        deletedAt: null,
        startAt: { gte: new Date() },
        status: { in: ['PLANNED', 'CONFIRMED'] },
      },
      orderBy: { startAt: 'asc' },
      take: 5,
      include: { customer: { select: { id: true, firstName: true, lastName: true, color: true } } },
    }),
    db.customer.count({
      where: {
        deletedAt: null,
        OR: [
          { preferredEmployeeId: employee.id },
          { allocations: { some: { status: 'ACTIVE', allocatedToEmployeeId: employee.id } } },
          { appointments: { some: { deletedAt: null, assignedEmployeeId: employee.id } } },
        ],
      },
    }),
  ]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Ziel (Woche)"
          value={weekStats.targetMinutes != null ? formatMinutesAsHours(weekStats.targetMinutes) : '—'}
          hint={`Monat: ${monthStats.targetMinutes != null ? formatMinutesAsHours(monthStats.targetMinutes) : '—'}`}
        />
        <StatTile
          label="Zugewiesen (Woche)"
          value={formatMinutesAsHours(weekStats.allocatedMinutes)}
          hint={
            weekStats.forwardedMinutes > 0
              ? `${formatMinutesAsHours(weekStats.forwardedMinutes)} weitergegeben`
              : 'aus Kundenbudgets'
          }
        />
        <StatTile
          label="Geplant (Woche)"
          value={formatMinutesAsHours(weekStats.plannedMinutes)}
          hint={`Geleistet: ${formatMinutesAsHours(weekStats.completedMinutes)}`}
        />
        <StatTile
          label="Fehlend zum Ziel"
          value={formatMinutesAsHours(weekStats.missingByAllocation)}
          tone={weekStats.missingByAllocation > 0 ? 'warning' : 'success'}
          hint={`nach Planung: ${formatMinutesAsHours(weekStats.missingByPlanning)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader>
            <PanelTitle>Nächste Termine</PanelTitle>
            <Link
              href={`/calendar?mitarbeiter=${employee.id}`}
              className="text-[length:var(--text-xs)] text-[var(--color-brand)] hover:underline"
            >
              Im Kalender öffnen
            </Link>
          </PanelHeader>
          <PanelBody className="p-0">
            {nextAppointments.length === 0 ? (
              <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                Keine bevorstehenden Termine.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-line-subtle)]">
                {nextAppointments.map((appointment) => (
                  <li key={appointment.id} className="flex items-center gap-3 px-4 py-2.5">
                    <EntityAvatar
                      id={appointment.customer.id}
                      name={`${appointment.customer.firstName} ${appointment.customer.lastName}`}
                      color={appointment.customer.color}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[length:var(--text-sm)] font-medium">
                        {appointment.title} · {appointment.customer.firstName}{' '}
                        {appointment.customer.lastName}
                      </div>
                      <div className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                        {formatDateTime(appointment.startAt, timezone)} ·{' '}
                        {formatMinutesVerbose(appointment.durationMinutes)}
                      </div>
                    </div>
                    <StatusPill size="sm" tone={statusOf(APPOINTMENT_STATUS, appointment.status).tone}>
                      {statusOf(APPOINTMENT_STATUS, appointment.status).label}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Profil</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <dl className="grid grid-cols-1 gap-2 text-[length:var(--text-sm)] sm:grid-cols-2">
              <div>
                <dt className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">E-Mail</dt>
                <dd className="truncate">{employee.email ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">Telefon</dt>
                <dd>{employee.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">Benutzerkonto</dt>
                <dd>
                  {employee.user
                    ? `${employee.user.email}${employee.user.lastLoginAt ? ` · zuletzt ${formatDate(employee.user.lastLoginAt, timezone)}` : ''}`
                    : 'kein Konto (einladen möglich)'}
                </dd>
              </div>
              <div>
                <dt className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">Kunden</dt>
                <dd>{customerCount}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">Stundenempfang</dt>
                <dd>{employee.canReceiveHours ? 'aktiv' : 'deaktiviert'}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">Darf anwerben</dt>
                <dd>{employee.canRecruitEmployees ? 'ja' : 'nein'}</dd>
              </div>
            </dl>
            {employee.notes && !isSelf ? (
              <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-3 text-[length:var(--text-sm)] whitespace-pre-wrap">
                {employee.notes}
              </p>
            ) : null}
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

async function CalendarTab({ employeeId, timezone }: { employeeId: string; timezone: string }) {
  const since = addDays(new Date(), -7);
  const appointments = await db.appointment.findMany({
    where: {
      assignedEmployeeId: employeeId,
      deletedAt: null,
      startAt: { gte: since },
    },
    orderBy: { startAt: 'asc' },
    take: 30,
    include: { customer: { select: { id: true, firstName: true, lastName: true } } },
  });

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Termine (letzte 7 Tage & Zukunft)</PanelTitle>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/calendar?mitarbeiter=${employeeId}`}>
            <CalendarDays aria-hidden /> Im Kalender öffnen
          </Link>
        </Button>
      </PanelHeader>
      <div className="overflow-x-auto">
        {appointments.length === 0 ? (
          <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">Keine Termine.</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Termin</Th>
                <Th>Kunde</Th>
                <Th>Datum & Zeit</Th>
                <Th>Dauer</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {appointments.map((appointment) => (
                <Tr key={appointment.id}>
                  <Td className="font-medium">{appointment.title}</Td>
                  <Td>
                    <Link
                      href={`/customers/${appointment.customer.id}`}
                      className="hover:text-[var(--color-brand)]"
                    >
                      {appointment.customer.firstName} {appointment.customer.lastName}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(appointment.startAt, timezone)}</Td>
                  <Td className="tabular whitespace-nowrap">
                    {formatMinutesVerbose(appointment.durationMinutes)}
                  </Td>
                  <Td>
                    <StatusPill size="sm" tone={statusOf(APPOINTMENT_STATUS, appointment.status).tone}>
                      {statusOf(APPOINTMENT_STATUS, appointment.status).label}
                    </StatusPill>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

async function CustomersTab({ employeeId }: { employeeId: string }) {
  const customers = await db.customer.findMany({
    where: {
      deletedAt: null,
      OR: [
        { preferredEmployeeId: employeeId },
        { allocations: { some: { status: 'ACTIVE', allocatedToEmployeeId: employeeId } } },
        { appointments: { some: { deletedAt: null, assignedEmployeeId: employeeId } } },
      ],
    },
    include: {
      addresses: { take: 1 },
      allocations: {
        where: { status: 'ACTIVE', allocatedToEmployeeId: employeeId },
        select: { allocatedMinutes: true },
      },
    },
    orderBy: [{ lastName: 'asc' }],
  });

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Zugeordnete Kunden</PanelTitle>
      </PanelHeader>
      <div className="overflow-x-auto">
        {customers.length === 0 ? (
          <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Noch keine Kundenzuordnung.
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Kunde</Th>
                <Th>Ort</Th>
                <Th className="text-right">Zugewiesene Stunden</Th>
                <Th>Bevorzugt</Th>
              </Tr>
            </THead>
            <TBody>
              {customers.map((customer) => (
                <Tr key={customer.id} interactive>
                  <Td>
                    <Link
                      href={`/customers/${customer.id}`}
                      className="flex items-center gap-2.5 font-medium hover:text-[var(--color-brand)]"
                    >
                      <EntityAvatar
                        id={customer.id}
                        name={`${customer.firstName} ${customer.lastName}`}
                        color={customer.color}
                        size="sm"
                      />
                      {customer.firstName} {customer.lastName}
                    </Link>
                  </Td>
                  <Td className="text-[var(--color-ink-muted)]">
                    {customer.addresses[0]?.city ?? '—'}
                  </Td>
                  <Td className="tabular text-right">
                    {formatMinutesAsHours(
                      customer.allocations.reduce((sum, a) => sum + a.allocatedMinutes, 0),
                    )}
                  </Td>
                  <Td>{customer.preferredEmployeeId === employeeId ? 'Ja' : '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

async function HoursTab({
  employeeId,
  timezone,
  canRevoke,
}: {
  employeeId: string;
  timezone: string;
  canRevoke: boolean;
}) {
  const [received, forwarded] = await Promise.all([
    db.hourAllocation.findMany({
      where: { allocatedToEmployeeId: employeeId, status: 'ACTIVE' },
      orderBy: { validFrom: 'desc' },
      take: 30,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        allocatedBy: { select: { firstName: true, lastName: true } },
      },
    }),
    db.hourAllocation.findMany({
      where: { allocatedByEmployeeId: employeeId, status: 'ACTIVE' },
      orderBy: { validFrom: 'desc' },
      take: 30,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        allocatedTo: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const renderList = (
    rows: typeof received,
    direction: 'received' | 'forwarded',
    emptyText: string,
  ) =>
    rows.length === 0 ? (
      <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">{emptyText}</p>
    ) : (
      <TableWrapper className="rounded-t-none border-0 shadow-none">
        <Table>
          <THead>
            <Tr>
              <Th>Kunde</Th>
              <Th>{direction === 'received' ? 'Von' : 'An'}</Th>
              <Th>Zeitraum</Th>
              <Th className="text-right">Stunden</Th>
              {canRevoke ? <Th aria-label="Aktionen" /> : null}
            </Tr>
          </THead>
          <TBody>
            {rows.map((allocation) => (
              <Tr key={allocation.id}>
                <Td>
                  <Link
                    href={`/customers/${allocation.customer.id}?tab=stunden`}
                    className="font-medium hover:text-[var(--color-brand)]"
                  >
                    {allocation.customer.firstName} {allocation.customer.lastName}
                  </Link>
                </Td>
                <Td className="text-[var(--color-ink-muted)]">
                  {direction === 'received'
                    ? allocation.allocatedBy
                      ? `${allocation.allocatedBy.firstName} ${allocation.allocatedBy.lastName}`
                      : 'Org-Budget'
                    : 'allocatedTo' in allocation && allocation.allocatedTo
                      ? `${(allocation as (typeof forwarded)[number]).allocatedTo.firstName} ${(allocation as (typeof forwarded)[number]).allocatedTo.lastName}`
                      : '—'}
                </Td>
                <Td className="whitespace-nowrap text-[var(--color-ink-muted)]">
                  {formatDate(allocation.validFrom, timezone)} – {formatDate(allocation.validUntil, timezone)}
                </Td>
                <Td className="tabular text-right font-medium">
                  {formatMinutesAsHours(allocation.allocatedMinutes)}
                </Td>
                {canRevoke ? (
                  <Td className="text-right">
                    <RevokeAllocationButton
                      allocationId={allocation.id}
                      customerId={allocation.customer.id}
                      description={`${formatMinutesAsHours(allocation.allocatedMinutes)} für ${allocation.customer.firstName} ${allocation.customer.lastName}`}
                    />
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrapper>
    );

  return (
    <>
      <Panel>
        <PanelHeader>
          <PanelTitle>Erhaltene Stunden</PanelTitle>
        </PanelHeader>
        {renderList(received, 'received', 'Noch keine Stunden erhalten.')}
      </Panel>
      <Panel>
        <PanelHeader>
          <PanelTitle>Weitergegebene Stunden</PanelTitle>
        </PanelHeader>
        {renderList(forwarded as unknown as typeof received, 'forwarded', 'Keine Stunden weitergegeben.')}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------

async function AvailabilityTab({ employeeId, readOnly }: { employeeId: string; readOnly: boolean }) {
  const slots = await db.employeeAvailability.findMany({
    where: { employeeId },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Wöchentliche Verfügbarkeit</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <AvailabilityEditor
          employeeId={employeeId}
          initialSlots={slots.map((slot) => ({
            weekday: slot.weekday,
            startTime: slot.startTime,
            endTime: slot.endTime,
          }))}
          readOnly={readOnly}
        />
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

async function AbsencesTab({
  employeeId,
  timezone,
  readOnly,
}: {
  employeeId: string;
  timezone: string;
  readOnly: boolean;
}) {
  const absences = await db.employeeAbsence.findMany({
    where: { employeeId },
    orderBy: { startAt: 'desc' },
    take: 30,
  });

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Abwesenheiten</PanelTitle>
        <AbsenceManager employeeId={employeeId} readOnly={readOnly} />
      </PanelHeader>
      <div className="overflow-x-auto">
        {absences.length === 0 ? (
          <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Keine Abwesenheiten eingetragen.
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Zeitraum</Th>
                <Th>Art</Th>
                <Th>Status</Th>
                <Th>Notiz</Th>
                {!readOnly ? <Th aria-label="Aktionen" /> : null}
              </Tr>
            </THead>
            <TBody>
              {absences.map((absence) => {
                const label = `${formatDate(absence.startAt, timezone)} – ${formatDate(new Date(absence.endAt.getTime() - 1), timezone)}`;
                return (
                  <Tr key={absence.id}>
                    <Td className="whitespace-nowrap font-medium">{label}</Td>
                    <Td>{ABSENCE_TYPE_LABELS[absence.type]}</Td>
                    <Td>
                      <StatusPill size="sm" tone={statusOf(ABSENCE_STATUS, absence.status).tone}>
                        {statusOf(ABSENCE_STATUS, absence.status).label}
                      </StatusPill>
                    </Td>
                    <Td className="text-[var(--color-ink-muted)]">{absence.note ?? '—'}</Td>
                    {!readOnly ? (
                      <Td className="text-right">
                        <DeleteAbsenceButton
                          absenceId={absence.id}
                          employeeId={employeeId}
                          label={label}
                        />
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

async function TeamTab({ employeeId }: { employeeId: string }) {
  const direct = await db.employee.findMany({
    where: { managerEmployeeId: employeeId, deletedAt: null },
    orderBy: [{ lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, status: true, employmentType: true },
  });

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Direkt unterstellte Mitarbeiter ({direct.length})</PanelTitle>
      </PanelHeader>
      <PanelBody className="p-0">
        {direct.length === 0 ? (
          <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Keine unterstellten Mitarbeiter.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line-subtle)]">
            {direct.map((report) => (
              <li key={report.id}>
                <Link
                  href={`/employees/${report.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-panel-raised)]"
                >
                  <EntityAvatar id={report.id} name={`${report.firstName} ${report.lastName}`} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {report.firstName} {report.lastName}
                  </span>
                  <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                    {EMPLOYMENT_TYPE_LABELS[report.employmentType]}
                  </span>
                  <StatusPill size="sm" tone={statusOf(EMPLOYEE_STATUS, report.status).tone}>
                    {statusOf(EMPLOYEE_STATUS, report.status).label}
                  </StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function ReportsTab({
  employeeId,
  monthStats,
}: {
  employeeId: string;
  monthStats: Awaited<ReturnType<typeof getEmployeeHourStats>>;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Zugewiesen (Monat)" value={formatMinutesAsHours(monthStats.allocatedMinutes)} />
        <StatTile label="Geplant (Monat)" value={formatMinutesAsHours(monthStats.plannedMinutes)} />
        <StatTile label="Geleistet (Monat)" value={formatMinutesAsHours(monthStats.completedMinutes)} tone="success" />
        <StatTile
          label="Eigenverpflichtung"
          value={formatMinutesAsHours(monthStats.selfObligationMinutes)}
          hint="erhalten minus weitergegeben"
        />
      </div>
      <div className="flex justify-end">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/reports?employeeId=${employeeId}`}>Detaillierte Auswertung öffnen</Link>
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

async function ActivityTab({ employeeId, timezone }: { employeeId: string; timezone: string }) {
  const entries = await db.auditLog.findMany({
    where: { entityType: 'Employee', entityId: employeeId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { actor: { select: { firstName: true, lastName: true } } },
  });

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Aktivitätsverlauf</PanelTitle>
      </PanelHeader>
      <PanelBody className="p-0">
        {entries.length === 0 ? (
          <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Noch keine Aktivitäten.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line-subtle)]">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[length:var(--text-sm)]">
                <span>
                  {auditActionLabel(entry.action)}
                  {entry.actor ? (
                    <span className="text-[var(--color-ink-subtle)]">
                      {' '}· {entry.actor.firstName} {entry.actor.lastName}
                    </span>
                  ) : null}
                </span>
                <time className="shrink-0 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                  {formatDateTime(entry.createdAt, timezone)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
