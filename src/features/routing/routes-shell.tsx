'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Car,
  Check,
  Navigation,
  RefreshCcw,
  Route as RouteIcon,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import * as React from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Checkbox, Skeleton, Spinner } from '@/components/ui/misc';
import { EmptyState, Panel, PanelBody, PanelHeader, PanelTitle, StatTile } from '@/components/ui/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatTime } from '@/lib/dates';
import { formatMinutesVerbose } from '@/lib/duration';
import { formatDistance, formatTravelSeconds, googleMapsDirectionsUrl } from '@/lib/geo';
import {
  computeRouteAction,
  discardRouteAction,
  getRoutePlanningDataAction,
  saveRouteAction,
  type ComputeRouteActionInput,
} from '@/server/actions/route-actions';
import type { RouteCandidate } from '@/server/services/route-service';
import type { ComputedRoute } from '@/server/services/route-service';

const LeafletMap = dynamic(() => import('@/features/map/leaflet-map').then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[var(--radius-lg)]" />,
});

type PlanningData = Extract<
  Awaited<ReturnType<typeof getRoutePlanningDataAction>>,
  { ok: true }
>['data'];

export function RoutesShell({
  employees,
  initialEmployeeId,
  initialDate,
  canManage,
  timezone,
}: {
  employees: { id: string; name: string }[];
  initialEmployeeId: string;
  initialDate: string;
  canManage: boolean;
  timezone: string;
}) {
  const [employeeId, setEmployeeId] = React.useState(initialEmployeeId);
  const [date, setDate] = React.useState(initialDate);
  const [departureTime, setDepartureTime] = React.useState('08:00');
  const [bufferMinutes, setBufferMinutes] = React.useState(10);
  const [returnToStart, setReturnToStart] = React.useState(true);

  const [data, setData] = React.useState<PlanningData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [route, setRoute] = React.useState<ComputedRoute | null>(null);
  const [manualOrder, setManualOrder] = React.useState<string[] | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Planungsdaten laden.
  React.useEffect(() => {
    if (!employeeId || !date) return;
    let cancelled = false;
    startTransition(async () => {
      const result = await getRoutePlanningDataAction(employeeId, date);
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        setSelectedIds(
          result.data.existingPlan?.stopAppointmentIds ??
            result.data.assigned.map((a) => a.appointmentId),
        );
        setRoute(null);
        setManualOrder(null);
      } else {
        toast.error(result.message);
        setData(null);
      }
    });
    return () => {
      cancelled = true;
    };
     
  }, [employeeId, date]);

  void loading;
  void setLoading;

  const buildInput = React.useCallback(
    (order?: string[]): ComputeRouteActionInput | null => {
      if (!data?.defaultStart) return null;
      const end = data.defaultEnd ?? data.defaultStart;
      return {
        employeeId,
        date,
        appointmentIds: order ?? selectedIds,
        departureTime,
        bufferMinutes,
        returnToStart,
        start: {
          latitude: data.defaultStart.latitude,
          longitude: data.defaultStart.longitude,
          label: data.defaultStart.label,
        },
        end: { latitude: end.latitude, longitude: end.longitude, label: end.label },
        manualOrder: Boolean(order),
      };
    },
    [data, employeeId, date, selectedIds, departureTime, bufferMinutes, returnToStart],
  );

  const compute = (order?: string[]) => {
    const input = buildInput(order);
    if (!input) {
      toast.error('Kein Startpunkt konfiguriert (Organisation → Einstellungen).');
      return;
    }
    if (input.appointmentIds.length === 0) {
      toast.error('Bitte mindestens einen Termin auswählen.');
      return;
    }
    startTransition(async () => {
      const result = await computeRouteAction(input);
      if (result.ok) {
        setRoute(result.data);
        setManualOrder(order ?? null);
        if (result.data.warnings.length > 0) {
          toast.warning(`Route berechnet – ${result.data.warnings.length} Warnung(en).`);
        } else {
          toast.success('Route berechnet.');
        }
      } else {
        toast.error(result.message);
      }
    });
  };

  const save = (publish: boolean) => {
    const order = route ? route.stops.map((s) => s.appointmentId) : undefined;
    const input = buildInput(manualOrder ?? order);
    if (!input || !route) return;
    startTransition(async () => {
      const result = await saveRouteAction(input, publish);
      if (result.ok) {
        toast.success(publish ? 'Route gespeichert und freigegeben.' : 'Route gespeichert.');
        const refreshed = await getRoutePlanningDataAction(employeeId, date);
        if (refreshed.ok) setData(refreshed.data);
      } else {
        toast.error(result.message);
      }
    });
  };

  const discard = () => {
    startTransition(async () => {
      const result = await discardRouteAction(employeeId, date);
      if (result.ok) {
        toast.success('Route verworfen.');
        setRoute(null);
        const refreshed = await getRoutePlanningDataAction(employeeId, date);
        if (refreshed.ok) setData(refreshed.data);
      } else {
        toast.error(result.message);
      }
    });
  };

  const moveStop = (index: number, direction: -1 | 1) => {
    if (!route) return;
    const ids = route.stops.map((s) => s.appointmentId);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    compute(ids);
  };

  const excludeStop = (appointmentId: string) => {
    const next = selectedIds.filter((id) => id !== appointmentId);
    setSelectedIds(next);
    if (next.length > 0) compute(next.filter((id) => id !== appointmentId));
    else setRoute(null);
  };

  const toggleSelection = (appointmentId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...current, appointmentId] : current.filter((id) => id !== appointmentId),
    );
    setRoute(null);
  };

  const allCandidates = data ? [...data.assigned, ...data.suggestions] : [];
  const markers = route
    ? [
        ...(data?.defaultStart
          ? [
              {
                id: 'start',
                latitude: data.defaultStart.latitude,
                longitude: data.defaultStart.longitude,
                label: data.defaultStart.label ?? 'Start',
                color: '#1b1f36',
              },
            ]
          : []),
        ...route.stops.map((stop) => ({
          id: stop.appointmentId,
          latitude: stop.latitude,
          longitude: stop.longitude,
          label: stop.customerName,
          subtitle: `${formatTime(new Date(stop.serviceStartAt), timezone)} – ${formatTime(new Date(stop.serviceEndAt), timezone)}`,
          color: stop.customerColor,
          sequence: stop.sequence,
        })),
      ]
    : allCandidates
        .filter((c) => c.latitude != null && c.longitude != null && selectedIds.includes(c.appointmentId))
        .map((c) => ({
          id: c.appointmentId,
          latitude: c.latitude!,
          longitude: c.longitude!,
          label: c.customerName,
          color: c.customerColor,
        }));

  const polyline: [number, number][] | undefined = route
    ? [
        ...(data?.defaultStart
          ? ([[data.defaultStart.latitude, data.defaultStart.longitude]] as [number, number][])
          : []),
        ...route.stops.map((s) => [s.latitude, s.longitude] as [number, number]),
        ...(returnToStart && data?.defaultEnd
          ? ([[data.defaultEnd.latitude, data.defaultEnd.longitude]] as [number, number][])
          : []),
      ]
    : undefined;

  return (
    <>
      <PageHeader
        title="Tagesroute"
        description="Reihenfolge, Fahrzeiten und Zeitfenster für einen Arbeitstag planen."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {/* Parameter */}
        <Panel>
          <PanelBody className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <div className="col-span-2">
              <Label htmlFor="route-employee">Mitarbeiter</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger id="route-employee">
                  <SelectValue placeholder="Mitarbeiter wählen" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="route-date">Datum</Label>
              <Input
                id="route-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="route-departure">Abfahrt</Label>
              <Input
                id="route-departure"
                type="time"
                value={departureTime}
                onChange={(event) => setDepartureTime(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="route-buffer">Puffer (Min.)</Label>
              <Input
                id="route-buffer"
                type="number"
                min={0}
                max={120}
                value={bufferMinutes}
                onChange={(event) => setBufferMinutes(Number(event.target.value))}
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex h-9 pointer-coarse:h-11 flex-1 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-panel-sunken)] px-3 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                <Checkbox
                  checked={returnToStart}
                  onCheckedChange={(checked) => setReturnToStart(checked === true)}
                />
                Rückkehr
              </label>
            </div>
            <div className="col-span-2 flex items-end gap-2 lg:col-span-6">
              <p className="min-w-0 flex-1 truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                Start/Ziel: {data?.defaultStart?.label ?? 'Büro'}
                {data?.defaultStart
                  ? ''
                  : ' – kein Startpunkt konfiguriert (Einstellungen → Organisation)'}
                {' · '}Verkehrsmittel: Auto
              </p>
              <Button variant="primary" onClick={() => compute()} loading={pending} disabled={!data}>
                <RouteIcon aria-hidden /> Route berechnen
              </Button>
            </div>
          </PanelBody>
        </Panel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          {/* Terminauswahl */}
          <Panel className="xl:col-span-2">
            <PanelHeader>
              <PanelTitle>
                Termine {data ? `(${selectedIds.length}/${allCandidates.length} gewählt)` : ''}
              </PanelTitle>
              {data?.existingPlan ? (
                <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                  Gespeichert: {data.existingPlan.status === 'PUBLISHED' ? 'freigegeben' : 'Entwurf'}
                </span>
              ) : null}
            </PanelHeader>
            <PanelBody className="max-h-[420px] space-y-1.5 overflow-y-auto p-3">
              {!data ? (
                <div className="flex h-24 items-center justify-center">
                  <Spinner />
                </div>
              ) : allCandidates.length === 0 ? (
                <EmptyState
                  className="border-0"
                  icon={<Car />}
                  title="Keine routenrelevanten Termine"
                  description="Für diesen Tag gibt es keine passenden Termine."
                />
              ) : (
                <>
                  {data.suggestions.length > 0 ? (
                    <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] px-2.5 py-2 text-[length:var(--text-xs)]">
                      <AlertTriangle
                        className="mt-0.5 size-3.5 shrink-0 text-[var(--color-warning)]"
                        aria-hidden
                      />
                      <span>
                        {data.suggestions.length === 1
                          ? 'Ein Termin an diesem Tag hat noch keine Zuordnung.'
                          : `${data.suggestions.length} Termine an diesem Tag haben noch keine Zuordnung.`}{' '}
                        <a
                          href="/calendar?zuweisung=offen"
                          className="font-medium text-[var(--color-brand)] hover:underline"
                        >
                          Im Kalender zuweisen
                        </a>
                      </span>
                    </div>
                  ) : null}
                  {data.assigned.map((candidate) => (
                    <CandidateRow
                      key={candidate.appointmentId}
                      candidate={candidate}
                      checked={selectedIds.includes(candidate.appointmentId)}
                      onToggle={toggleSelection}
                      timezone={timezone}
                    />
                  ))}
                  {data.suggestions.length > 0 ? (
                    <>
                      <p className="pt-2 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
                        Vorschläge (nicht zugewiesen – Auswahl ändert die Zuweisung nicht)
                      </p>
                      {data.suggestions.map((candidate) => (
                        <CandidateRow
                          key={candidate.appointmentId}
                          candidate={candidate}
                          checked={selectedIds.includes(candidate.appointmentId)}
                          onToggle={toggleSelection}
                          timezone={timezone}
                        />
                      ))}
                    </>
                  ) : null}
                </>
              )}
            </PanelBody>
          </Panel>

          {/* Karte */}
          <Panel className="xl:col-span-3">
            <PanelHeader>
              <PanelTitle>Karte</PanelTitle>
            </PanelHeader>
            <PanelBody className="p-3">
              <div className="h-[400px] overflow-hidden rounded-[var(--radius-lg)]">
                {markers.length > 0 ? (
                  <LeafletMap markers={markers} polyline={polyline} />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-panel-sunken)] text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                    Termine wählen und Route berechnen.
                  </div>
                )}
              </div>
            </PanelBody>
          </Panel>
        </div>

        {/* Ergebnis */}
        {route ? (
          <>
            {route.warnings.length > 0 ? (
              <div className="space-y-1.5">
                {route.warnings.map((warning, index) => (
                  <p
                    key={index}
                    className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-2.5 text-[length:var(--text-sm)] text-[var(--color-warning)]"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatTile label="Abfahrt" value={formatTime(new Date(route.departureAt), timezone)} />
              <StatTile
                label="Kundenzeit"
                value={formatMinutesVerbose(route.totalServiceMinutes)}
                tone="success"
              />
              <StatTile label="Fahrtzeit" value={formatTravelSeconds(route.totalTravelSeconds)} />
              <StatTile label="Distanz" value={formatDistance(route.totalDistanceMeters)} />
              <StatTile
                label="Rückkehr"
                value={
                  route.returnArrivalAt ? formatTime(new Date(route.returnArrivalAt), timezone) : '—'
                }
              />
            </div>

            <Panel>
              <PanelHeader>
                <PanelTitle>Stoppliste & Zeitachse</PanelTitle>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => compute()} loading={pending}>
                      <RefreshCcw aria-hidden /> Neu optimieren
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => save(false)} loading={pending}>
                      <Save aria-hidden /> Speichern
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => save(true)} loading={pending}>
                      <Send aria-hidden /> Freigeben
                    </Button>
                    {data?.existingPlan ? (
                      <Button variant="danger" size="sm" onClick={discard} loading={pending}>
                        <Trash2 aria-hidden /> Verwerfen
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </PanelHeader>
              <PanelBody className="p-0">
                <ol className="divide-y divide-[var(--color-line-subtle)]">
                  {route.stops.map((stop, index) => (
                    <li key={stop.appointmentId} className="px-4 py-3">
                      {stop.travelSecondsFromPrevious > 0 ? (
                        <p className="mb-1.5 flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                          <Car className="size-3.5" aria-hidden />
                          {formatTravelSeconds(stop.travelSecondsFromPrevious)} ·{' '}
                          {formatDistance(stop.distanceMetersFromPrevious)}
                          {stop.waitSeconds > 60
                            ? ` · ${Math.round(stop.waitSeconds / 60)} Min. Wartezeit`
                            : ''}
                        </p>
                      ) : null}
                      <div className="flex items-center gap-3">
                        <span
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[length:var(--text-xs)] font-bold text-white"
                          style={{ backgroundColor: stop.customerColor }}
                          aria-hidden
                        >
                          {stop.sequence}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[length:var(--text-sm)] font-medium">
                            {stop.customerName} · {stop.title}
                            {stop.isFlexible ? (
                              <span className="ml-1.5 text-[length:var(--text-2xs)] text-[var(--color-info)]">
                                flexibel
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                            Ankunft {formatTime(new Date(stop.arrivalAt), timezone)} · Einsatz{' '}
                            {formatTime(new Date(stop.serviceStartAt), timezone)}–
                            {formatTime(new Date(stop.serviceEndAt), timezone)} · {stop.addressLine}
                          </span>
                          {stop.warning ? (
                            <span className="mt-0.5 flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--color-warning)]">
                              <AlertTriangle className="size-3" aria-hidden /> {stop.warning}
                            </span>
                          ) : null}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button asChild variant="ghost" size="icon-sm" aria-label="Navigation zum Stopp">
                            <a
                              href={googleMapsDirectionsUrl({ latitude: stop.latitude, longitude: stop.longitude })}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Navigation aria-hidden />
                            </a>
                          </Button>
                          {canManage ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Stopp nach oben"
                                disabled={index === 0 || pending}
                                onClick={() => moveStop(index, -1)}
                              >
                                <ArrowUp aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Stopp nach unten"
                                disabled={index === route.stops.length - 1 || pending}
                                onClick={() => moveStop(index, 1)}
                              >
                                <ArrowDown aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Stopp ausschließen"
                                className="text-[var(--color-danger)]"
                                disabled={pending}
                                onClick={() => excludeStop(stop.appointmentId)}
                              >
                                <X aria-hidden />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </PanelBody>
            </Panel>
          </>
        ) : null}
      </div>
    </>
  );
}

function CandidateRow({
  candidate,
  checked,
  onToggle,
  timezone,
}: {
  candidate: RouteCandidate;
  checked: boolean;
  onToggle: (appointmentId: string, checked: boolean) => void;
  timezone: string;
}) {
  const hasCoords = candidate.latitude != null && candidate.longitude != null;
  return (
    <label
      className={`flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 transition-colors ${
        checked ? 'bg-[var(--color-brand-subtle)]' : 'hover:bg-[var(--color-panel-raised)]'
      }`}
    >
      <Checkbox
        checked={checked}
        disabled={!hasCoords}
        onCheckedChange={(value) => onToggle(candidate.appointmentId, value === true)}
        aria-label={`${candidate.customerName} einplanen`}
      />
      <span
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: candidate.customerColor }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--text-sm)] font-medium">
          {candidate.customerName}
          {candidate.isFlexible ? (
            <span className="ml-1.5 text-[length:var(--text-2xs)] text-[var(--color-info)]">flexibel</span>
          ) : null}
          {!candidate.assigned ? (
            <span className="ml-1.5 text-[length:var(--text-2xs)] text-[var(--color-warning)]">offen</span>
          ) : null}
        </span>
        <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
          {candidate.isFlexible
            ? `Fenster ${candidate.earliestStartAt ? formatTime(new Date(candidate.earliestStartAt), timezone) : '—'}–${candidate.latestEndAt ? formatTime(new Date(candidate.latestEndAt), timezone) : '—'}`
            : `${formatTime(new Date(candidate.startAt), timezone)}–${formatTime(new Date(candidate.endAt), timezone)}`}
          {' · '}
          {formatMinutesVerbose(candidate.durationMinutes)}
          {candidate.addressLine ? ` · ${candidate.addressLine}` : ''}
          {!hasCoords ? ' · keine Koordinaten' : ''}
        </span>
      </span>
      {checked ? <Check className="size-4 shrink-0 text-[var(--color-brand)]" aria-hidden /> : null}
    </label>
  );
}
