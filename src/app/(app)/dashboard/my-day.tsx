import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Car,
  Clock,
  Contact,
  Navigation,
  Route as RouteIcon,
  Wallet,
  Wand2,
} from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EntityAvatar } from '@/components/ui/misc';
import { EmptyState, Panel, PanelBody, PanelHeader, PanelTitle, StatTile } from '@/components/ui/panel';
import { StatusPill } from '@/components/ui/status-pill';
import { QuickCompleteButton } from '@/features/appointments/quick-complete-button';
import { formatDate, formatDateTime, formatTime, formatWeekday, toDateInputValue } from '@/lib/dates';
import { formatMinutesAsHours } from '@/lib/duration';
import { formatEuroCents } from '@/lib/earnings';
import { formatDistance, formatTravelSeconds, googleMapsDirectionsUrl } from '@/lib/geo';
import {
  APPOINTMENT_STATUS,
  SIMPLE_APPOINTMENT_STATUS,
  simpleAppointmentStatus,
  statusOf,
} from '@/lib/status-maps';
import { cn } from '@/lib/utils';
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

      <div className="mx-auto w-full max-w-[var(--page-max)] space-y-4 p-4 sm:p-5">
        {/* Auffälliger Hinweis-Banner: Termine mit Konflikt (Überschneidung,
            Abwesenheit, außerhalb der Verfügbarkeit) direkt zum Prüfen. */}
        {data.counts.conflictCount > 0 ? (
          <Link
            href="/calendar?konflikte=1"
            className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-4 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)]"
          >
            <AlertTriangle className="size-5 shrink-0 text-[var(--color-danger)]" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[length:var(--text-sm)] font-semibold text-[var(--color-danger)]">
                {data.counts.conflictCount === 1
                  ? '1 Termin heute mit Hinweis'
                  : `${data.counts.conflictCount} Termine heute mit Hinweis`}
              </span>
              <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                Bitte prüfen – z. B. außerhalb der Verfügbarkeit oder Überschneidung.
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[length:var(--text-sm)] font-medium text-[var(--color-danger)]">
              Prüfen <ArrowRight className="size-4" aria-hidden />
            </span>
          </Link>
        ) : null}

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
          {data.counts.showOpenHours ? (
            <StatTile
              icon={<Clock />}
              label="Offene Stunden"
              value={formatMinutesAsHours(data.counts.openMinutes)}
              hint={data.counts.openHint}
              tone={data.counts.openMinutes > 0 ? 'warning' : 'success'}
            />
          ) : null}
          <StatTile
            icon={<CalendarDays />}
            label="Diese Woche"
            value={formatMinutesAsHours(data.counts.weekPlannedMinutes)}
            hint="geplante Einsätze"
          />
          {data.counts.projectedEarningsCents != null ? (
            <StatTile
              icon={<Wallet />}
              label="Verdienst heute (voraussichtlich)"
              value={formatEuroCents(data.counts.projectedEarningsCents)}
              hint={
                data.counts.projectedMileageCents > 0
                  ? `inkl. ${formatEuroCents(data.counts.projectedMileageCents)} Kilometergeld`
                  : 'aus den geplanten Einsätzen'
              }
              tone="success"
              className="col-span-2 xl:col-span-4"
            />
          ) : null}
        </div>

        {/* Große Schnellaktionen – das tägliche Werkzeug. min-w-0 + truncate:
            das Raster darf nie breiter werden als der Bildschirm. */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-tour="my-day-actions">
          {canManage ? (
            <Button asChild variant="primary" size="lg" className="h-14 min-w-0 justify-start text-[length:var(--text-base)]">
              <Link href="/calendar?neu=1">
                <CalendarPlus aria-hidden /> <span className="truncate">Termin anlegen</span>
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary" size="lg" className="h-14 min-w-0 justify-start text-[length:var(--text-base)]">
            <Link href={`/routes?datum=${todayIso}`}>
              <RouteIcon aria-hidden /> <span className="truncate">Route heute</span>
            </Link>
          </Button>
          {canSeeCustomers ? (
            <Button asChild variant="secondary" size="lg" className="h-14 min-w-0 justify-start text-[length:var(--text-base)]">
              <Link href="/customers">
                <Contact aria-hidden /> <span className="truncate">Kunden</span>
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary" size="lg" className="h-14 min-w-0 justify-start text-[length:var(--text-base)]">
            <Link href="/calendar">
              <CalendarDays aria-hidden /> <span className="truncate">Kalender</span>
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
            {/* Geplante Tagesroute – eigener Block, unabhängig von den Terminen.
                Zeigt genau das, was im Routenplaner gespeichert wurde. */}
            {data.route ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--color-line-subtle)] bg-[var(--color-panel-sunken)] px-4 py-2.5">
                <span className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-medium text-[var(--color-ink)]">
                  <RouteIcon className="size-3.5 text-[var(--color-brand)]" aria-hidden />
                  Geplante Route
                  <span className="text-[length:var(--text-2xs)] font-normal text-[var(--color-ink-subtle)]">
                    {data.route.status === 'PUBLISHED' ? 'freigegeben' : 'Entwurf'}
                  </span>
                </span>
                <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-muted)]">
                  {data.route.stops.length} Stopps ab {data.route.originLabel}
                </span>
                {data.route.departureAt ? (
                  <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-muted)]">
                    Abfahrt {formatTime(data.route.departureAt, timezone)}
                  </span>
                ) : null}
                <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-muted)]">
                  {formatTravelSeconds(data.route.totalTravelSeconds)} ·{' '}
                  {formatDistance(data.route.totalDistanceMeters)}
                </span>
                <Link
                  href={`/routes?datum=${todayIso}`}
                  className="ml-auto text-[length:var(--text-2xs)] text-[var(--color-brand)] hover:underline"
                >
                  Route öffnen →
                </Link>
              </div>
            ) : data.needsRoutePlanning ? (
              // Termine da, aber noch keine Route → direkt zum automatischen Planen.
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--color-brand-subtle)] bg-[var(--color-brand-subtle)] px-4 py-2.5">
                <span className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-medium text-[var(--color-brand)]">
                  <RouteIcon className="size-3.5" aria-hidden />
                  Für heute ist noch keine Route geplant
                </span>
                <Button asChild variant="primary" size="sm" className="ml-auto">
                  <Link href={`/routes?datum=${todayIso}&plan=1`}>
                    <Wand2 aria-hidden /> Tag automatisch planen
                  </Link>
                </Button>
              </div>
            ) : null}

            {data.entries.length === 0 ? (
              <EmptyState
                className="m-4 border-0"
                icon={<CalendarDays />}
                title="Heute keine Termine"
                description={canManage ? 'Der Tag ist frei – oder du planst jetzt einen Termin.' : 'Der Tag ist frei.'}
              />
            ) : (
                <ol className="divide-y divide-[var(--color-line-subtle)]">
                {data.entries.map((entry) => {
                  const displayedStatus =
                    mode === 'solo'
                      ? statusOf(
                          SIMPLE_APPOINTMENT_STATUS,
                          simpleAppointmentStatus(entry.status),
                        )
                      : statusOf(APPOINTMENT_STATUS, entry.status);
                  return (
                  <li
                    key={entry.appointmentId}
                    className={cn(
                      'px-4 py-3',
                      entry.isCurrent && 'bg-[var(--color-success-soft)]',
                    )}
                  >
                    {entry.travelSeconds != null && entry.departureAt ? (
                      <p className="mb-2 flex items-center gap-1.5 text-[length:var(--text-xs)] font-medium text-[var(--color-brand)]">
                        <Car className="size-3.5" aria-hidden />
                        Abfahrt {formatTime(entry.departureAt, timezone)} · {formatTravelSeconds(entry.travelSeconds)} Fahrt
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="tabular w-25 shrink-0 text-[length:var(--text-base)] font-semibold">
                        {formatTime(entry.startAt, timezone)}–{formatTime(entry.endAt, timezone)}
                      </span>
                      <span
                        className="h-10 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: entry.customerColor }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        {entry.isCurrent ? (
                          <span className="mb-0.5 block text-[length:var(--text-2xs)] font-semibold tracking-wide text-[var(--color-success)] uppercase">
                            Aktueller Termin
                          </span>
                        ) : null}
                        <Link
                          href={`/calendar?termin=${entry.appointmentId}`}
                          className="block truncate text-[length:var(--text-base)] font-medium hover:text-[var(--color-brand)]"
                        >
                          {entry.customerName}
                        </Link>
                        <span className="block truncate text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]">
                          {entry.title}
                          {entry.addressLine ? ` · ${entry.addressLine}` : ''}
                        </span>
                      </span>
                      {entry.hasConflict ? (
                        <Link
                          href={`/calendar?termin=${entry.appointmentId}`}
                          className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-danger-soft)] px-2 py-0.5 text-[length:var(--text-2xs)] font-semibold text-[var(--color-danger)]"
                          title="Hinweis – bitte prüfen"
                        >
                          <AlertTriangle className="size-3.5" aria-hidden /> Hinweis
                        </Link>
                      ) : null}
                      <StatusPill size="sm" tone={displayedStatus.tone}>
                        {displayedStatus.label}
                      </StatusPill>
                      {entry.canComplete ? (
                        <QuickCompleteButton
                          appointmentId={entry.appointmentId}
                          label={entry.isCurrent ? 'Jetzt abschließen' : 'Abschließen'}
                          size="sm"
                          className="shrink-0"
                        />
                      ) : null}
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
                  );
                })}
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
