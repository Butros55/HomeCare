import {
  CalendarDays,
  CalendarPlus,
  Car,
  Clock,
  Contact,
  Navigation,
  Route as RouteIcon,
} from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EntityAvatar } from '@/components/ui/misc';
import { EmptyState, Panel, PanelBody, PanelHeader, PanelTitle, StatTile } from '@/components/ui/panel';
import { StatusPill } from '@/components/ui/status-pill';
import { formatDate, formatDateTime, formatTime, formatWeekday, toDateInputValue } from '@/lib/dates';
import { formatMinutesAsHours } from '@/lib/duration';
import { formatTravelSeconds, googleMapsDirectionsUrl } from '@/lib/geo';
import { APPOINTMENT_STATUS, statusOf } from '@/lib/status-maps';
import { hasPermission, type OrgContext } from '@/server/permissions';
import { getMyDayData } from '@/server/services/dashboard-service';

/**
 * „Mein Tag“ – das reduzierte Alltags-UI (Solo-Leitung & Mitarbeiter):
 * groß und übersichtlich nur das Wichtigste – heutige Termine mit Abfahrtszeiten,
 * Route des Tages, offene Stunden und die nächsten Termine.
 */
export async function MyDayDashboard({
  ctx,
  mode,
}: {
  ctx: OrgContext;
  /** 'personal' = Leitung in der eigenen Kompakt-Ansicht (nur eigene Termine). */
  mode: 'solo' | 'employee' | 'personal';
}) {
  const data = await getMyDayData(ctx, { includeUnassigned: mode === 'solo' });
  const timezone = ctx.organization.timezone;
  const now = new Date();
  const canManage = hasPermission(ctx, 'appointments.manage');
  const canSeeCustomers = hasPermission(ctx, 'customers.read');
  const todayIso = toDateInputValue(now, timezone);

  return (
    <>
      <PageHeader
        title={`Mein Tag`}
        description={`${formatWeekday(now, timezone)}, ${formatDate(now, timezone)} · ${ctx.user.firstName} ${ctx.user.lastName}`}
      />

      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-5">
        {/* Kompakte Kennzahlen */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-tour="my-day-stats">
          <StatTile
            icon={<CalendarDays />}
            label="Termine heute"
            value={data.counts.todayCount}
            hint={`${formatMinutesAsHours(data.counts.todayMinutes)} Einsatzzeit`}
          />
          <StatTile
            icon={<Car />}
            label="Losfahren um"
            value={data.firstDeparture ? formatTime(data.firstDeparture, timezone) : '—'}
            hint={
              data.counts.todayTravelSeconds > 0
                ? `${formatTravelSeconds(data.counts.todayTravelSeconds)} Fahrt heute`
                : 'keine Fahrten berechnet'
            }
            tone={data.firstDeparture ? 'default' : 'success'}
          />
          <StatTile
            icon={<Clock />}
            label="Offene Stunden"
            value={formatMinutesAsHours(data.counts.openMinutes)}
            hint={data.counts.openHint}
            tone={data.counts.openMinutes > 0 ? 'warning' : 'success'}
          />
          <StatTile
            icon={<CalendarDays />}
            label="Diese Woche"
            value={formatMinutesAsHours(data.counts.weekPlannedMinutes)}
            hint="geplante Einsätze"
          />
        </div>

        {/* Große Schnellaktionen – das tägliche Werkzeug */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-tour="my-day-actions">
          {canManage ? (
            <Button asChild variant="primary" size="lg" className="h-14 justify-start text-[length:var(--text-base)]">
              <Link href="/calendar?neu=1">
                <CalendarPlus aria-hidden /> Termin anlegen
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary" size="lg" className="h-14 justify-start text-[length:var(--text-base)]">
            <Link href={`/routes?datum=${todayIso}`}>
              <RouteIcon aria-hidden /> Route heute
            </Link>
          </Button>
          {canSeeCustomers ? (
            <Button asChild variant="secondary" size="lg" className="h-14 justify-start text-[length:var(--text-base)]">
              <Link href="/customers">
                <Contact aria-hidden /> Kunden
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary" size="lg" className="h-14 justify-start text-[length:var(--text-base)]">
            <Link href="/calendar">
              <CalendarDays aria-hidden /> Kalender
            </Link>
          </Button>
        </div>

        {/* Heutige Route – groß und lesbar */}
        <Panel data-tour="my-day-today">
          <PanelHeader>
            <PanelTitle>Heute</PanelTitle>
            <Link
              href={`/routes?datum=${todayIso}`}
              className="text-[length:var(--text-xs)] text-[var(--color-brand)] hover:underline"
            >
              Route planen →
            </Link>
          </PanelHeader>
          <PanelBody className="p-0">
            {data.entries.length === 0 ? (
              <EmptyState
                className="m-4 border-0"
                icon={<CalendarDays />}
                title="Heute keine Termine"
                description={canManage ? 'Der Tag ist frei – oder du planst jetzt einen Termin.' : 'Der Tag ist frei.'}
              />
            ) : (
              <ol className="divide-y divide-[var(--color-line-subtle)]">
                {data.entries.map((entry) => (
                  <li key={entry.appointmentId} className="px-4 py-3">
                    {entry.travelSeconds != null && entry.departureAt ? (
                      <p className="mb-2 flex items-center gap-1.5 text-[length:var(--text-xs)] font-medium text-[var(--color-brand)]">
                        <Car className="size-3.5" aria-hidden />
                        Abfahrt {formatTime(entry.departureAt, timezone)} · {formatTravelSeconds(entry.travelSeconds)} Fahrt
                      </p>
                    ) : null}
                    <div className="flex items-center gap-3">
                      <span className="tabular w-25 shrink-0 text-[length:var(--text-base)] font-semibold">
                        {formatTime(entry.startAt, timezone)}–{formatTime(entry.endAt, timezone)}
                      </span>
                      <span
                        className="h-10 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: entry.customerColor }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <Link
                          href={`/calendar?termin=${entry.appointmentId}`}
                          className="block truncate text-[length:var(--text-base)] font-medium hover:text-[var(--color-brand)]"
                        >
                          {entry.customerName}
                        </Link>
                        <span className="block truncate text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]">
                          {entry.title}
                          {entry.addressLine ? ` · ${entry.addressLine}` : ''}
                          {entry.unassigned && mode === 'solo' ? ' · keine Zuordnung' : ''}
                        </span>
                      </span>
                      <StatusPill size="sm" tone={statusOf(APPOINTMENT_STATUS, entry.status).tone}>
                        {statusOf(APPOINTMENT_STATUS, entry.status).label}
                      </StatusPill>
                      {entry.latitude != null && entry.longitude != null ? (
                        <Button asChild variant="secondary" size="icon" aria-label="Navigation starten">
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

        {/* Nächste Termine */}
        <Panel>
          <PanelHeader>
            <PanelTitle>Nächste Termine</PanelTitle>
            <Link href="/calendar" className="text-[length:var(--text-xs)] text-[var(--color-brand)] hover:underline">
              Zum Kalender →
            </Link>
          </PanelHeader>
          <PanelBody className="p-0">
            {data.upcoming.length === 0 ? (
              <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                Keine bevorstehenden Termine{canManage ? ' – jetzt planen.' : '.'}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-line-subtle)]">
                {data.upcoming.map((appointment) => (
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
                          {formatDateTime(appointment.startAt, timezone)} · {appointment.title}
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
    </>
  );
}
