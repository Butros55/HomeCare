import { Clock, Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EntityAvatar } from '@/components/ui/misc';
import { EmptyState, Panel, PanelBody, PanelHeader, PanelTitle, ProgressBar } from '@/components/ui/panel';
import { StatusPill } from '@/components/ui/status-pill';
import { Table, TableWrapper, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDate, formatDateTime, monthPeriodInZone, toDateInputValue } from '@/lib/dates';
import { formatMinutesAsHours, formatMinutesVerbose } from '@/lib/duration';
import { formatLocationLine } from '@/lib/geo';
import {
  APPOINTMENT_STATUS,
  ASSIGNMENT_STATUS,
  BUDGET_SOURCE_LABELS,
  CUSTOMER_STATUS,
  statusOf,
} from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { auditActionLabel } from '@/server/audit';
import { AppError } from '@/server/errors';
import { db } from '@/server/db';
import { hasPermission, uiModeFor } from '@/server/permissions';
import { getCustomerDetail } from '@/server/services/customer-service';
import { getCustomerHourStats } from '@/server/services/hours-service';
import { ContactActions } from '@/features/customers/contact-actions';
import { CustomerLocationMap } from '@/features/map/location-map';
import { AllocateHoursButton } from '@/features/hours/allocate-hours-button';
import { AdjustBudgetButton, CreateBudgetButton } from '@/features/hours/budget-dialogs';
import { CustomerHourTiles } from '@/features/hours/hour-detail-tiles';
import { CustomerAppointmentButtons } from '@/features/appointments/create-appointment-button';

export const metadata: Metadata = { title: 'Kunde' };

const TABS = [
  { key: 'uebersicht', label: 'Übersicht' },
  { key: 'termine', label: 'Termine' },
  { key: 'stunden', label: 'Stunden' },
  { key: 'mitarbeiter', label: 'Mitarbeiter' },
  { key: 'route', label: 'Route & Karte' },
  { key: 'notizen', label: 'Notizen' },
  { key: 'aktivitaet', label: 'Aktivität' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ tab?: string; monat?: string }>;
}) {
  const { customerId } = await params;
  const { tab: rawTab, monat } = await searchParams;
  let tab: TabKey = (TABS.some((t) => t.key === rawTab) ? rawTab : 'uebersicht') as TabKey;

  let detail: Awaited<ReturnType<typeof getCustomerDetail>>;
  try {
    detail = await getCustomerDetail(customerId);
  } catch (error) {
    if (error instanceof AppError) notFound();
    throw error;
  }
  const { ctx, customer, canManage, canAllocate: canAllocateRaw } = detail;
  if (!customer) notFound();

  // Solo-Modus: keine Mitarbeiter-/Zuweisungslogik im Kunden-UI.
  const solo = uiModeFor(ctx) === 'solo';
  const canAllocate = canAllocateRaw && !solo;
  const visibleTabs = TABS.filter((t) => !(solo && t.key === 'mitarbeiter'));
  if (!visibleTabs.some((t) => t.key === tab)) tab = 'uebersicht';

  const timezone = ctx.organization.timezone;
  // ?monat=YYYY-MM erlaubt den Blick auf andere Zeiträume (Stunden-Tab).
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(monat ?? '');
  const anchor = monthMatch
    ? new Date(Date.UTC(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 15))
    : new Date();
  const period = monthPeriodInZone(anchor, timezone);
  const monthIso = toDateInputValue(period.start, timezone).slice(0, 7);
  const stats = await getCustomerHourStats(customerId, period);
  const name = `${customer.firstName} ${customer.lastName}`;
  const address = customer.addresses[0] ?? null;
  const addressLine = address ? formatLocationLine(address) : null;

  const tabLink = (key: TabKey) =>
    key === 'uebersicht' ? `/customers/${customerId}` : `/customers/${customerId}?tab=${key}`;

  return (
    <>
      <PageHeader
        title={name}
        description={`${customer.customerNumber}${addressLine ? ` · ${addressLine}` : ''}`}
        breadcrumbs={[{ label: 'Kunden', href: '/customers' }, { label: name }]}
        actions={
          <>
            <StatusPill tone={statusOf(CUSTOMER_STATUS, customer.status).tone}>
              {statusOf(CUSTOMER_STATUS, customer.status).label}
            </StatusPill>
            {canAllocate ? (
              <AllocateHoursButton customerId={customerId} label="Stunden zuweisen" icon="clock" />
            ) : null}
            {canManage ? (
              <>
                <CustomerAppointmentButtons customerId={customerId} />
                <Button asChild variant="secondary">
                  <Link href={`/customers/${customerId}/edit`}>
                    <Pencil aria-hidden /> Bearbeiten
                  </Link>
                </Button>
              </>
            ) : null}
          </>
        }
      >
        <nav className="mt-4 -mb-px flex max-w-full gap-1 overflow-x-auto scrollbar-none rounded-full bg-[var(--color-panel-sunken)] p-1" aria-label="Kunden-Tabs">
          {visibleTabs.map((t) => (
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
        {tab === 'uebersicht' ? (
          <OverviewTab
            customerId={customerId}
            name={name}
            customer={customer}
            addressLine={addressLine}
            address={address}
            stats={stats}
            timezone={timezone}
            monthIso={monthIso}
            canAllocate={canAllocate}
            showAllocation={!solo}
          />
        ) : null}
        {tab === 'termine' ? <AppointmentsTab customerId={customerId} timezone={timezone} /> : null}
        {tab === 'stunden' ? (
          <HoursTab
            customerId={customerId}
            timezone={timezone}
            canAllocate={canAllocate}
            canManageBudgets={hasPermission(ctx, 'budgets.manage')}
            stats={stats}
            monthIso={monthIso}
            period={period}
            showAllocation={!solo}
          />
        ) : null}
        {tab === 'mitarbeiter' ? <EmployeesTab customerId={customerId} customer={customer} /> : null}
        {tab === 'route' ? (
          <RouteTab customer={customer} address={address} addressLine={addressLine} />
        ) : null}
        {tab === 'notizen' ? <NotesTab customer={customer} canManage={canManage} customerId={customerId} /> : null}
        {tab === 'aktivitaet' ? <ActivityTab customerId={customerId} timezone={timezone} /> : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

async function OverviewTab({
  customerId,
  name,
  customer,
  address,
  addressLine,
  stats,
  timezone,
  monthIso,
  canAllocate,
  showAllocation,
}: {
  customerId: string;
  name: string;
  customer: NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>['customer']>;
  address: { latitude: number | null; longitude: number | null } | null;
  addressLine: string | null;
  stats: Awaited<ReturnType<typeof getCustomerHourStats>>;
  timezone: string;
  monthIso: string;
  canAllocate: boolean;
  showAllocation: boolean;
}) {
  const [nextAppointment, recentActivity] = await Promise.all([
    db.appointment.findFirst({
      where: {
        customerId,
        deletedAt: null,
        startAt: { gte: new Date() },
        status: { in: ['PLANNED', 'CONFIRMED'] },
      },
      orderBy: { startAt: 'asc' },
      include: { assignedEmployee: { select: { firstName: true, lastName: true } } },
    }),
    db.auditLog.findMany({
      where: { entityType: 'Customer', entityId: customerId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { actor: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  return (
    <>
      <CustomerHourTiles
        customerId={customerId}
        monthIso={monthIso}
        stats={stats}
        canAllocate={canAllocate}
        showAllocation={showAllocation}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader>
            <PanelTitle>Kontakt & Adresse</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-3">
            <div className="flex items-center gap-3">
              <EntityAvatar id={customer.id} name={name} color={customer.color} size="lg" />
              <div>
                <div className="font-medium">{customer.salutation ? `${customer.salutation} ` : ''}{name}</div>
                {customer.companyName ? (
                  <div className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">{customer.companyName}</div>
                ) : null}
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-2 text-[length:var(--text-sm)] sm:grid-cols-2">
              <div>
                <dt className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">Telefon</dt>
                <dd>{customer.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">E-Mail</dt>
                <dd className="truncate">{customer.email ?? '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">Adresse</dt>
                <dd>{addressLine ?? '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">Bevorzugter Mitarbeiter</dt>
                <dd>
                  {customer.preferredEmployee ? (
                    <Link
                      href={`/employees/${customer.preferredEmployee.id}`}
                      className="text-[var(--color-brand)] hover:underline"
                    >
                      {customer.preferredEmployee.firstName} {customer.preferredEmployee.lastName}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
            <ContactActions
              phone={customer.phone}
              secondaryPhone={customer.secondaryPhone}
              email={customer.email}
              addressLine={addressLine}
              latitude={address?.latitude}
              longitude={address?.longitude}
            />
          </PanelBody>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader>
              <PanelTitle>Nächster Termin</PanelTitle>
            </PanelHeader>
            <PanelBody>
              {nextAppointment ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{nextAppointment.title}</div>
                    <div className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                      {formatDateTime(nextAppointment.startAt, timezone)} ·{' '}
                      {formatMinutesVerbose(nextAppointment.durationMinutes)}
                      {nextAppointment.assignedEmployee
                        ? ` · ${nextAppointment.assignedEmployee.firstName} ${nextAppointment.assignedEmployee.lastName}`
                        : ' · noch nicht zugewiesen'}
                    </div>
                  </div>
                  <StatusPill size="sm" tone={statusOf(APPOINTMENT_STATUS, nextAppointment.status).tone}>
                    {statusOf(APPOINTMENT_STATUS, nextAppointment.status).label}
                  </StatusPill>
                </div>
              ) : (
                <p className="text-[length:var(--text-sm)] text-[var(--color-warning)]">
                  Kein zukünftiger Termin geplant.
                </p>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitle>Karte</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <CustomerLocationMap
                latitude={address?.latitude ?? null}
                longitude={address?.longitude ?? null}
                label={name}
                color={customer.color}
                addressLine={addressLine}
              />
            </PanelBody>
          </Panel>
        </div>
      </div>

      {(customer.accessInstructions || customer.cleaningInstructions) ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {customer.accessInstructions ? (
            <Panel>
              <PanelHeader>
                <PanelTitle>Zugang</PanelTitle>
              </PanelHeader>
              <PanelBody className="text-[length:var(--text-sm)] whitespace-pre-wrap">
                {customer.accessInstructions}
              </PanelBody>
            </Panel>
          ) : null}
          {customer.cleaningInstructions ? (
            <Panel>
              <PanelHeader>
                <PanelTitle>Reinigungsanweisungen</PanelTitle>
              </PanelHeader>
              <PanelBody className="text-[length:var(--text-sm)] whitespace-pre-wrap">
                {customer.cleaningInstructions}
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      ) : null}

      <Panel>
        <PanelHeader>
          <PanelTitle>Letzte Änderungen</PanelTitle>
        </PanelHeader>
        <PanelBody className="p-0">
          {recentActivity.length === 0 ? (
            <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              Noch keine Aktivitäten.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-line-subtle)]">
              {recentActivity.map((entry) => (
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
    </>
  );
}

// ---------------------------------------------------------------------------

async function AppointmentsTab({ customerId, timezone }: { customerId: string; timezone: string }) {
  const now = new Date();
  const [upcoming, past] = await Promise.all([
    db.appointment.findMany({
      where: { customerId, deletedAt: null, startAt: { gte: now } },
      orderBy: { startAt: 'asc' },
      take: 25,
      include: { assignedEmployee: { select: { id: true, firstName: true, lastName: true } } },
    }),
    db.appointment.findMany({
      where: { customerId, deletedAt: null, startAt: { lt: now } },
      orderBy: { startAt: 'desc' },
      take: 15,
      include: { assignedEmployee: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);

  const renderTable = (rows: typeof upcoming, emptyText: string) =>
    rows.length === 0 ? (
      <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">{emptyText}</p>
    ) : (
      <Table>
        <THead>
          <Tr>
            <Th>Termin</Th>
            <Th>Datum & Zeit</Th>
            <Th>Dauer</Th>
            <Th>Mitarbeiter</Th>
            <Th>Status</Th>
            <Th>Zuweisung</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((appointment) => (
            <Tr key={appointment.id}>
              <Td className="font-medium">
                {appointment.title}
                {appointment.seriesId ? (
                  <span className="ml-1.5 text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">Serie</span>
                ) : null}
              </Td>
              <Td className="whitespace-nowrap">{formatDateTime(appointment.startAt, timezone)}</Td>
              <Td className="tabular whitespace-nowrap">{formatMinutesVerbose(appointment.durationMinutes)}</Td>
              <Td className="whitespace-nowrap">
                {appointment.assignedEmployee ? (
                  <Link
                    href={`/employees/${appointment.assignedEmployee.id}`}
                    className="hover:text-[var(--color-brand)]"
                  >
                    {appointment.assignedEmployee.firstName} {appointment.assignedEmployee.lastName}
                  </Link>
                ) : (
                  <span className="text-[var(--color-warning)]">offen</span>
                )}
              </Td>
              <Td>
                <StatusPill size="sm" tone={statusOf(APPOINTMENT_STATUS, appointment.status).tone}>
                  {statusOf(APPOINTMENT_STATUS, appointment.status).label}
                </StatusPill>
              </Td>
              <Td>
                <StatusPill size="sm" tone={statusOf(ASSIGNMENT_STATUS, appointment.assignmentStatus).tone}>
                  {statusOf(ASSIGNMENT_STATUS, appointment.assignmentStatus).label}
                </StatusPill>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    );

  return (
    <>
      <Panel>
        <PanelHeader>
          <PanelTitle>Bevorstehende Termine</PanelTitle>
        </PanelHeader>
        <div className="overflow-x-auto">{renderTable(upcoming, 'Keine bevorstehenden Termine.')}</div>
      </Panel>
      <Panel>
        <PanelHeader>
          <PanelTitle>Vergangene Termine</PanelTitle>
        </PanelHeader>
        <div className="overflow-x-auto">{renderTable(past, 'Keine vergangenen Termine.')}</div>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------

async function HoursTab({
  customerId,
  timezone,
  canAllocate,
  canManageBudgets,
  stats,
  monthIso,
  period,
  showAllocation,
}: {
  customerId: string;
  timezone: string;
  canAllocate: boolean;
  canManageBudgets: boolean;
  stats: Awaited<ReturnType<typeof getCustomerHourStats>>;
  monthIso: string;
  period: { start: Date; end: Date };
  showAllocation: boolean;
}) {
  const budgets = await db.customerHourBudget.findMany({
    where: { customerId },
    orderBy: { periodStart: 'desc' },
    take: 12,
    include: {
      adjustments: { include: { createdBy: { select: { firstName: true, lastName: true } } } },
      allocations: {
        where: { status: 'ACTIVE' },
        include: {
          allocatedTo: { select: { id: true, firstName: true, lastName: true } },
          allocatedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  // Monatswahl: ‹ vorheriger / nächster › Monat als Links (?monat=YYYY-MM).
  const monthLabel = new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone,
    month: 'long',
    year: 'numeric',
  }).format(period.start);
  const shiftMonth = (offset: number) => {
    const [y, m] = monthIso.split('-').map(Number);
    const shifted = new Date(Date.UTC(y!, m! - 1 + offset, 15));
    const iso = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
    return `/customers/${customerId}?tab=stunden&monat=${iso}`;
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[length:var(--text-base)] font-semibold">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="sm" aria-label="Vorheriger Monat">
            <Link href={shiftMonth(-1)}>‹</Link>
          </Button>
          <Button asChild variant="outline" size="sm" aria-label="Nächster Monat">
            <Link href={shiftMonth(1)}>›</Link>
          </Button>
        </div>
      </div>

      <CustomerHourTiles
        customerId={customerId}
        monthIso={monthIso}
        stats={stats}
        canAllocate={canAllocate}
        showFunnel
        showAllocation={showAllocation}
      />

      {canAllocate || canManageBudgets ? (
        <div className="flex flex-wrap justify-end gap-2">
          {canManageBudgets ? (
            <CreateBudgetButton
              customerId={customerId}
              defaultPeriodStart={toDateInputValue(period.start, timezone)}
              defaultPeriodEnd={toDateInputValue(new Date(period.end.getTime() - 1), timezone)}
            />
          ) : null}
          {canAllocate ? (
            <AllocateHoursButton customerId={customerId} label="Stunden zuweisen" icon="clock" />
          ) : null}
        </div>
      ) : null}

      {budgets.length === 0 ? (
        <EmptyState
          icon={<Clock />}
          title="Noch kein Stundenbudget"
          description="Lege ein Budget für einen Zeitraum an, um Stunden an Mitarbeiter zu verteilen."
        />
      ) : (
        budgets.map((budget) => {
          const adjusted =
            budget.budgetMinutes + budget.adjustments.reduce((sum, a) => sum + a.adjustmentMinutes, 0);
          const allocated = budget.allocations
            .filter((a) => a.allocatedByEmployeeId === null)
            .reduce((sum, a) => sum + a.allocatedMinutes, 0);
          return (
            <Panel key={budget.id}>
              <PanelHeader>
                <div>
                  <PanelTitle>
                    {formatDate(budget.periodStart, timezone)} – {formatDate(budget.periodEnd, timezone)}
                  </PanelTitle>
                  <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                    {BUDGET_SOURCE_LABELS[budget.sourceType] ?? budget.sourceType}
                    {budget.note ? ` · ${budget.note}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="tabular text-right">
                    <div className="font-semibold">{formatMinutesAsHours(adjusted)}</div>
                    <div className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                      {formatMinutesAsHours(allocated)} zugewiesen
                    </div>
                  </div>
                  {canManageBudgets ? (
                    <AdjustBudgetButton
                      budgetId={budget.id}
                      customerId={customerId}
                      budgetLabel={`${formatDate(budget.periodStart, timezone)} – ${formatDate(budget.periodEnd, timezone)}`}
                    />
                  ) : null}
                </div>
              </PanelHeader>
              <PanelBody className="space-y-3">
                <ProgressBar
                  value={allocated}
                  max={adjusted}
                  tone={allocated >= adjusted ? 'success' : 'brand'}
                />
                {budget.adjustments.length > 0 ? (
                  <div>
                    <h3 className="mb-1 text-[length:var(--text-xs)] font-semibold text-[var(--color-ink-subtle)] uppercase">
                      Korrekturen
                    </h3>
                    <ul className="space-y-1 text-[length:var(--text-sm)]">
                      {budget.adjustments.map((adjustment) => (
                        <li key={adjustment.id} className="flex justify-between gap-3">
                          <span>
                            {adjustment.reason}
                            <span className="text-[var(--color-ink-subtle)]">
                              {' '}· {adjustment.createdBy.firstName} {adjustment.createdBy.lastName}
                            </span>
                          </span>
                          <span
                            className="tabular font-medium"
                            style={{
                              color:
                                adjustment.adjustmentMinutes >= 0
                                  ? 'var(--color-success)'
                                  : 'var(--color-danger)',
                            }}
                          >
                            {adjustment.adjustmentMinutes >= 0 ? '+' : ''}
                            {formatMinutesAsHours(adjustment.adjustmentMinutes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {!showAllocation ? null : (
                <div>
                  <h3 className="mb-1 text-[length:var(--text-xs)] font-semibold text-[var(--color-ink-subtle)] uppercase">
                    Zuweisungen
                  </h3>
                  {budget.allocations.length === 0 ? (
                    <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                      Noch keine Stunden zugewiesen.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-[length:var(--text-sm)]">
                      {budget.allocations.map((allocation) => (
                        <li key={allocation.id} className="flex justify-between gap-3">
                          <span>
                            <Link
                              href={`/employees/${allocation.allocatedTo.id}`}
                              className="font-medium hover:text-[var(--color-brand)]"
                            >
                              {allocation.allocatedTo.firstName} {allocation.allocatedTo.lastName}
                            </Link>
                            {allocation.allocatedBy ? (
                              <span className="text-[var(--color-ink-subtle)]">
                                {' '}· weitergegeben von {allocation.allocatedBy.firstName}{' '}
                                {allocation.allocatedBy.lastName}
                              </span>
                            ) : (
                              <span className="text-[var(--color-ink-subtle)]"> · aus Org-Budget</span>
                            )}
                          </span>
                          <span className="tabular font-medium">
                            {formatMinutesAsHours(allocation.allocatedMinutes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                )}
              </PanelBody>
            </Panel>
          );
        })
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

async function EmployeesTab({
  customerId,
  customer,
}: {
  customerId: string;
  customer: { preferredEmployeeId: string | null };
}) {
  const [allocations, appointmentEmployees] = await Promise.all([
    db.hourAllocation.groupBy({
      by: ['allocatedToEmployeeId'],
      where: { customerId, status: 'ACTIVE' },
      _sum: { allocatedMinutes: true },
    }),
    db.appointment.groupBy({
      by: ['assignedEmployeeId'],
      where: { customerId, deletedAt: null, assignedEmployeeId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const employeeIds = new Set<string>();
  for (const a of allocations) employeeIds.add(a.allocatedToEmployeeId);
  for (const a of appointmentEmployees) if (a.assignedEmployeeId) employeeIds.add(a.assignedEmployeeId);
  if (customer.preferredEmployeeId) employeeIds.add(customer.preferredEmployeeId);

  const employees = await db.employee.findMany({
    where: { id: { in: [...employeeIds] } },
    select: { id: true, firstName: true, lastName: true, status: true, phone: true },
    orderBy: [{ lastName: 'asc' }],
  });
  const minutesByEmployee = new Map(
    allocations.map((a) => [a.allocatedToEmployeeId, a._sum.allocatedMinutes ?? 0]),
  );
  const countByEmployee = new Map(
    appointmentEmployees.map((a) => [a.assignedEmployeeId, a._count._all]),
  );

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Beteiligte Mitarbeiter</PanelTitle>
      </PanelHeader>
      {employees.length === 0 ? (
        <PanelBody>
          <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Diesem Kunden sind noch keine Mitarbeiter zugeordnet.
          </p>
        </PanelBody>
      ) : (
        <TableWrapper className="rounded-t-none border-0 shadow-none">
          <Table>
            <THead>
              <Tr>
                <Th>Mitarbeiter</Th>
                <Th className="text-right">Zugewiesene Stunden</Th>
                <Th className="text-right">Termine</Th>
                <Th>Hinweis</Th>
              </Tr>
            </THead>
            <TBody>
              {employees.map((employee) => (
                <Tr key={employee.id} interactive>
                  <Td>
                    <Link
                      href={`/employees/${employee.id}`}
                      className="flex items-center gap-2.5 font-medium hover:text-[var(--color-brand)]"
                    >
                      <EntityAvatar
                        id={employee.id}
                        name={`${employee.firstName} ${employee.lastName}`}
                        size="sm"
                      />
                      {employee.firstName} {employee.lastName}
                    </Link>
                  </Td>
                  <Td className="tabular text-right">
                    {formatMinutesAsHours(minutesByEmployee.get(employee.id) ?? 0)}
                  </Td>
                  <Td className="tabular text-right">{countByEmployee.get(employee.id) ?? 0}</Td>
                  <Td className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                    {customer.preferredEmployeeId === employee.id ? 'Bevorzugter Mitarbeiter' : ''}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function RouteTab({
  customer,
  address,
  addressLine,
}: {
  customer: { id: string; firstName: string; lastName: string; color: string; routeNotes: string | null };
  address: { latitude: number | null; longitude: number | null; geocodingQuality: string | null } | null;
  addressLine: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel>
        <PanelHeader>
          <PanelTitle>Karte</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <CustomerLocationMap
            latitude={address?.latitude ?? null}
            longitude={address?.longitude ?? null}
            label={`${customer.firstName} ${customer.lastName}`}
            color={customer.color}
            addressLine={addressLine}
            tall
          />
        </PanelBody>
      </Panel>
      <div className="space-y-4">
        <Panel>
          <PanelHeader>
            <PanelTitle>Navigation</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-3">
            <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              {addressLine ?? 'Keine Adresse hinterlegt.'}
            </p>
            {address?.latitude != null && address?.longitude != null ? (
              <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                Koordinaten: {address.latitude.toFixed(5)}, {address.longitude.toFixed(5)}
                {address.geocodingQuality === 'exact' ? ' · exakt geokodiert' : ''}
              </p>
            ) : (
              <p className="text-[length:var(--text-xs)] text-[var(--color-warning)]">
                Noch keine Koordinaten – Adresse bearbeiten und erneut speichern.
              </p>
            )}
            <ContactActions
              addressLine={addressLine}
              latitude={address?.latitude}
              longitude={address?.longitude}
            />
          </PanelBody>
        </Panel>
        {customer.routeNotes ? (
          <Panel>
            <PanelHeader>
              <PanelTitle>Routen-Hinweise</PanelTitle>
            </PanelHeader>
            <PanelBody className="text-[length:var(--text-sm)] whitespace-pre-wrap">
              {customer.routeNotes}
            </PanelBody>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NotesTab({
  customer,
  canManage,
  customerId,
}: {
  customer: {
    accessInstructions: string | null;
    cleaningInstructions: string | null;
    privateNotes: string | null;
    routeNotes: string | null;
  };
  canManage: boolean;
  customerId: string;
}) {
  const sections = [
    { title: 'Zugang', text: customer.accessInstructions },
    { title: 'Reinigungsanweisungen', text: customer.cleaningInstructions },
    { title: 'Routen-Hinweise', text: customer.routeNotes },
    { title: 'Interne Notizen (nur Leitung)', text: customer.privateNotes },
  ];
  return (
    <>
      {canManage ? (
        <div className="flex justify-end">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/customers/${customerId}/edit`}>
              <Pencil aria-hidden /> Notizen bearbeiten
            </Link>
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {sections.map((section) => (
          <Panel key={section.title}>
            <PanelHeader>
              <PanelTitle>{section.title}</PanelTitle>
            </PanelHeader>
            <PanelBody className="text-[length:var(--text-sm)] whitespace-pre-wrap">
              {section.text ? (
                section.text
              ) : (
                <span className="text-[var(--color-ink-subtle)]">Keine Einträge.</span>
              )}
            </PanelBody>
          </Panel>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

async function ActivityTab({ customerId, timezone }: { customerId: string; timezone: string }) {
  const entries = await db.auditLog.findMany({
    where: { entityType: 'Customer', entityId: customerId },
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
              <li key={entry.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3 text-[length:var(--text-sm)]">
                  <span className="font-medium">{auditActionLabel(entry.action)}</span>
                  <time className="shrink-0 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                    {formatDateTime(entry.createdAt, timezone)}
                  </time>
                </div>
                <div className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                  {entry.actor ? `${entry.actor.firstName} ${entry.actor.lastName}` : 'System'}
                  {entry.metadata && typeof entry.metadata === 'object' && 'changedFields' in entry.metadata
                    ? ` · Felder: ${(entry.metadata as { changedFields: string[] }).changedFields.join(', ') || '–'}`
                    : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
