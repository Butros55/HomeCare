import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  CalendarPlus,
  Car,
  Clock,
  Contact,
  Navigation,
  Plus,
  Route as RouteIcon,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EntityAvatar } from '@/components/ui/misc';
import { EmptyState, Panel, PanelBody, PanelHeader, PanelTitle, ProgressBar, StatTile } from '@/components/ui/panel';
import { StatusPill } from '@/components/ui/status-pill';
import { formatDate, formatDateTime, formatTime, formatWeekday } from '@/lib/dates';
import { formatMinutesAsHours } from '@/lib/duration';
import { formatTravelSeconds, googleMapsDirectionsUrl } from '@/lib/geo';
import { APPOINTMENT_STATUS, statusOf } from '@/lib/status-maps';
import { hasPermission, requireOrganizationMembership, uiModeFor } from '@/server/permissions';
import { getDashboardData } from '@/server/services/dashboard-service';
import { MyDayDashboard } from './my-day';

export const metadata: Metadata = { title: 'Dashboard' };

/** Operatives Dashboard (Anforderung 15): Wichtigstes oben links, alles klickbar. */
export default async function DashboardPage() {
  const ctx = await requireOrganizationMembership();

  // Solo-Leitung & Mitarbeiter: reduziertes Alltags-UI statt Leitungs-Dashboard.
  const mode = uiModeFor(ctx);
  if (mode !== 'team') {
    return <MyDayDashboard ctx={ctx} mode={mode} />;
  }

  const data = await getDashboardData(ctx);
  const timezone = ctx.organization.timezone;
  const now = new Date();

  const canManage = hasPermission(ctx, 'appointments.manage');
  const canManageEmployees = hasPermission(ctx, 'employees.manage');
  const canAllocate =
    hasPermission(ctx, 'hours.allocateOrg') || hasPermission(ctx, 'hours.allocateOwnPool');

  return (
    <>
      <PageHeader
        title={`Willkommen, ${ctx.user.firstName}`}
        description={`${formatWeekday(now, timezone)}, ${formatDate(now, timezone)} · ${ctx.organization.name}`}
      />

      <div className="space-y-4 p-4 sm:p-5">
        {/* Kennzahlkarten – klickbar, führen zu gefilterten Ansichten */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <Link href="/calendar" className="rounded-[var(--radius-xl)]">
            <StatTile icon={<CalendarDays />} label="Termine heute" value={data.counts.todayCount} hint="Zum Kalender" />
          </Link>
          {data.isPlanner ? (
            <Link href="/customers?openHours=1" className="rounded-[var(--radius-xl)]">
              <StatTile
                icon={<Clock />}
                label="Offene Kundenstunden"
                value={formatMinutesAsHours(data.counts.openHoursTotalMinutes)}
                hint={`${data.counts.openHoursCustomerCount} Kunden betroffen`}
                tone={data.counts.openHoursTotalMinutes > 0 ? 'warning' : 'success'}
              />
            </Link>
          ) : null}
          {ctx.employee ? (
            <Link
              href={`/employees/${ctx.employee.id}?tab=stunden`}
              className={cn('rounded-[var(--radius-xl)]', data.isPlanner && 'hidden sm:block')}
            >
              <StatTile
                icon={<Clock />}
                label="Eigene offene Stunden"
                value={formatMinutesAsHours(data.counts.ownObligationMinutes)}
                hint="erhalten minus weitergegeben"
              />
            </Link>
          ) : null}
          {data.isPlanner ? (
            <Link href="/calendar?zuweisung=offen" className="rounded-[var(--radius-xl)]">
              <StatTile
                icon={<CalendarPlus />}
                label="Nicht zugewiesen"
                value={data.counts.unassignedCount}
                hint="Termine ohne Mitarbeiter"
                tone={data.counts.unassignedCount > 0 ? 'warning' : 'success'}
              />
            </Link>
          ) : null}
          <Link href="/employees?missingHours=1" className="hidden rounded-[var(--radius-xl)] sm:block">
            <StatTile
              icon={<UsersRound />}
              label="Brauchen Stunden"
              value={data.counts.employeesNeedingHoursCount}
              hint="Mitarbeiter unter Ziel"
              tone={data.counts.employeesNeedingHoursCount > 0 ? 'warning' : 'success'}
            />
          </Link>
          <Link href="/calendar?konflikte=1" className="rounded-[var(--radius-xl)]">
            <StatTile
              icon={<AlertTriangle />}
              label="Konflikte"
              value={data.counts.conflictCount}
              hint="diese Woche"
              tone={data.counts.conflictCount > 0 ? 'danger' : 'success'}
            />
          </Link>
          {data.isPlanner ? (
            <Link href="/customers" className="hidden rounded-[var(--radius-xl)] sm:block">
              <StatTile
                icon={<Contact />}
                label="Ohne nächste Planung"
                value={data.counts.customersWithoutNextAppointment}
                hint="aktive Kunden ohne Termin"
                tone={data.counts.customersWithoutNextAppointment > 0 ? 'warning' : 'success'}
              />
            </Link>
          ) : null}
          <Link href="/routes" className="hidden rounded-[var(--radius-xl)] sm:block">
            <StatTile
              icon={<Car />}
              label="Fahrtzeit heute"
              value={formatTravelSeconds(data.counts.todayTravelSeconds)}
              hint="geschätzt, alle Mitarbeiter"
            />
          </Link>
          <Link href="/notifications" className="hidden rounded-[var(--radius-xl)] sm:block">
            <StatTile
              icon={<Bell />}
              label="Benachrichtigungen"
              value={data.counts.unreadNotifications}
              hint="ungelesen"
              tone={data.counts.unreadNotifications > 0 ? 'default' : 'success'}
            />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Heute */}
          <Panel className="xl:col-span-2">
            <PanelHeader>
              <PanelTitle>Heute</PanelTitle>
              <Link
                href="/calendar"
                className="flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--color-brand)] hover:underline"
              >
                Zum Kalender <ArrowRight className="size-3" aria-hidden />
              </Link>
            </PanelHeader>
            <PanelBody className="p-0">
              {data.timeline.length === 0 ? (
                <EmptyState
                  className="m-4 border-0"
                  icon={<CalendarDays />}
                  title="Heute keine Termine"
                  description="Der Tag ist frei – oder die Planung wartet noch."
                />
              ) : (
                <ol className="divide-y divide-[var(--color-line-subtle)]">
                  {data.timeline.map((entry) => (
                    <li key={entry.appointmentId} className="px-4 py-2.5">
                      {entry.travelSecondsFromPrevious != null ? (
                        <p className="mb-1.5 flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                          <Car className="size-3.5" aria-hidden />
                          {formatTravelSeconds(entry.travelSecondsFromPrevious)} Fahrt
                          {entry.departureFromPreviousAt
                            ? ` · Abfahrt ${formatTime(entry.departureFromPreviousAt, timezone)}`
                            : ''}
                        </p>
                      ) : null}
                      <div className="flex items-center gap-3">
                        <span className="tabular w-24 shrink-0 text-[length:var(--text-sm)] font-semibold">
                          {formatTime(entry.startAt, timezone)}–{formatTime(entry.endAt, timezone)}
                        </span>
                        <span
                          className="h-8 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: entry.customerColor }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <Link
                            href={`/calendar?termin=${entry.appointmentId}`}
                            className="block truncate text-[length:var(--text-sm)] font-medium hover:text-[var(--color-brand)]"
                          >
                            {entry.customerName} · {entry.title}
                          </Link>
                          <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                            {entry.employeeName ?? 'Nicht zugewiesen'}
                            {entry.addressLine ? ` · ${entry.addressLine}` : ''}
                          </span>
                        </span>
                        {entry.hasConflict ? (
                          <AlertTriangle className="size-4 shrink-0 text-[var(--color-warning)]" aria-label="Konflikt" />
                        ) : null}
                        <StatusPill size="sm" tone={statusOf(APPOINTMENT_STATUS, entry.status).tone}>
                          {statusOf(APPOINTMENT_STATUS, entry.status).label}
                        </StatusPill>
                        {entry.latitude != null && entry.longitude != null ? (
                          <Button asChild variant="ghost" size="icon-sm" aria-label="Navigation starten">
                            <a
                              href={googleMapsDirectionsUrl({ latitude: entry.latitude, longitude: entry.longitude })}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Navigation aria-hidden />
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </PanelBody>
          </Panel>

          <div className="space-y-4">
            {/* Schnellaktionen */}
            <Panel>
              <PanelHeader>
                <PanelTitle>Schnellaktionen</PanelTitle>
              </PanelHeader>
              <PanelBody className="grid grid-cols-2 gap-2">
                {canManage ? (
                  <Button asChild variant="secondary" className="justify-start">
                    <Link href="/customers/new">
                      <UserPlus aria-hidden /> Kunde
                    </Link>
                  </Button>
                ) : null}
                {canManageEmployees ? (
                  <Button asChild variant="secondary" className="justify-start">
                    <Link href="/employees/new">
                      <UsersRound aria-hidden /> Mitarbeiter
                    </Link>
                  </Button>
                ) : null}
                {canManage ? (
                  <>
                    <Button asChild variant="secondary" className="justify-start">
                      <Link href="/calendar?neu=1">
                        <CalendarPlus aria-hidden /> Termin
                      </Link>
                    </Button>
                    <Button asChild variant="secondary" className="justify-start">
                      <Link href="/calendar?neu=1&serie=1">
                        <Plus aria-hidden /> Serie
                      </Link>
                    </Button>
                  </>
                ) : null}
                {canAllocate ? (
                  <Button asChild variant="secondary" className="justify-start">
                    <Link href="/customers?openHours=1">
                      <Clock aria-hidden /> Stunden
                    </Link>
                  </Button>
                ) : null}
                <Button asChild variant="secondary" className="justify-start">
                  <Link href="/routes">
                    <RouteIcon aria-hidden /> Route
                  </Link>
                </Button>
              </PanelBody>
            </Panel>

            {/* Nächste Termine */}
            <Panel>
              <PanelHeader>
                <PanelTitle>Nächste Termine</PanelTitle>
              </PanelHeader>
              <PanelBody className="p-0">
                {data.upcomingAppointments.length === 0 ? (
                  <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                    Keine bevorstehenden Termine.
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--color-line-subtle)]">
                    {data.upcomingAppointments.map((appointment) => (
                      <li key={appointment.id}>
                        <Link
                          href={`/calendar?termin=${appointment.id}`}
                          className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-[var(--color-panel-raised)]"
                        >
                          <EntityAvatar
                            id={appointment.id}
                            name={appointment.customerName}
                            color={appointment.customerColor}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[length:var(--text-sm)] font-medium">
                              {appointment.customerName}
                            </span>
                            <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                              {formatDateTime(appointment.startAt, timezone)}
                              {appointment.employeeName ? ` · ${appointment.employeeName}` : ' · offen'}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Handlungsbedarf */}
          <Panel className="xl:col-span-2">
            <PanelHeader>
              <PanelTitle>Handlungsbedarf</PanelTitle>
            </PanelHeader>
            <PanelBody className="p-0">
              {data.actionItems.length === 0 ? (
                <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-success)]">
                  Alles im grünen Bereich – kein Handlungsbedarf.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-line-subtle)]">
                  {data.actionItems.map((item, index) => (
                    <li key={`${item.kind}-${index}`}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-panel-raised)]"
                      >
                        <span
                          className="flex size-8 shrink-0 items-center justify-center rounded-full"
                          style={{
                            backgroundColor:
                              item.kind === 'CONFLICT' || item.kind === 'ASSIGNMENT_DECLINED'
                                ? 'var(--color-danger-soft)'
                                : 'var(--color-warning-soft)',
                            color:
                              item.kind === 'CONFLICT' || item.kind === 'ASSIGNMENT_DECLINED'
                                ? 'var(--color-danger)'
                                : 'var(--color-warning)',
                          }}
                          aria-hidden
                        >
                          <AlertTriangle className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[length:var(--text-sm)] font-medium">
                            {item.title}
                          </span>
                          <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                            {item.detail}
                          </span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-[var(--color-ink-subtle)]" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>

          {/* Nächste 7 Tage */}
          <Panel>
            <PanelHeader>
              <PanelTitle>Nächste 7 Tage</PanelTitle>
            </PanelHeader>
            <PanelBody className="space-y-4">
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">Auslastung</span>
                  <span className="tabular text-[length:var(--text-sm)] font-semibold">
                    {data.next7.utilizationPercent != null ? `${data.next7.utilizationPercent} %` : '—'}
                  </span>
                </div>
                <ProgressBar
                  value={data.next7.plannedMinutes}
                  max={Math.max(data.next7.capacityMinutes, 1)}
                  tone={
                    data.next7.utilizationPercent != null && data.next7.utilizationPercent > 100
                      ? 'danger'
                      : 'brand'
                  }
                />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-2.5">
                  <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Termine</dt>
                  <dd className="tabular text-[length:var(--text-lg)] font-semibold">
                    {data.next7.appointmentCount}
                  </dd>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-2.5">
                  <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Geplant</dt>
                  <dd className="tabular text-[length:var(--text-lg)] font-semibold">
                    {formatMinutesAsHours(data.next7.plannedMinutes)}
                  </dd>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-2.5">
                  <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Frei</dt>
                  <dd className="tabular text-[length:var(--text-lg)] font-semibold text-[var(--color-success)]">
                    {formatMinutesAsHours(data.next7.freeMinutes)}
                  </dd>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-2.5">
                  <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Fahrtzeit ca.</dt>
                  <dd className="tabular text-[length:var(--text-lg)] font-semibold">
                    {formatTravelSeconds(data.next7.expectedTravelSeconds)}
                  </dd>
                </div>
              </dl>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
