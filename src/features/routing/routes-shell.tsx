'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  Car,
  Check,
  Home,
  LocateFixed,
  Navigation,
  RefreshCcw,
  Route as RouteIcon,
  Save,
  Send,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import * as React from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { RoutePlanningDataSkeleton } from '@/components/layout/page-loading-skeleton';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Checkbox, Skeleton } from '@/components/ui/misc';
import {
  EmptyState,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatTile,
} from '@/components/ui/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatTime } from '@/lib/dates';
import { formatMinutesVerbose } from '@/lib/duration';
import { formatDistance, formatTravelSeconds, googleMapsDirectionsUrl } from '@/lib/geo';
import {
  acceptRouteSuggestionAction,
  computeRouteAction,
  discardRouteAction,
  generateRouteSuggestionsAction,
  getRoutePathAction,
  getRoutePlanningDataAction,
  saveRouteAction,
  type ComputeRouteActionInput,
} from '@/server/actions/route-actions';
import type { RouteCandidate } from '@/server/services/route-service';
import type { ComputedRoute } from '@/server/services/route-service';
import type {
  EmployeeSuggestionPanel,
  GenerateSuggestionsResult,
  RouteSuggestionDto,
} from '@/server/services/route-suggestion-service';
import { SuggestionCard } from '@/features/routing/suggestion-card';

const LeafletMap = dynamic(() => import('@/features/map/leaflet-map').then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[var(--radius-lg)]" />,
});

type PlanningData = Extract<
  Awaited<ReturnType<typeof getRoutePlanningDataAction>>,
  { ok: true }
>['data'];

type OriginType = 'office' | 'home' | 'gps';

/** Browser-Standort erst beim Berechnen anfragen (Datenschutz). */
function requestGps(): Promise<{ latitude: number; longitude: number; timestamp: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: position.timestamp,
        }),
      (error) => reject(error),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

export function RoutesShell({
  teamMode,
  employees,
  ownEmployeeId,
  initialEmployeeId,
  initialDate,
  canManage,
  canAccept,
  timezone,
}: {
  /** true = Leitungs-UI mit Einzelroute + Teamplanung; false = nur eigene Route. */
  teamMode: boolean;
  employees: { id: string; name: string }[];
  ownEmployeeId: string | null;
  initialEmployeeId: string;
  initialDate: string;
  canManage: boolean;
  /** Vorschläge übernehmen dürfen nur Leitungs-Konten. */
  canAccept: boolean;
  timezone: string;
}) {
  const [date, setDate] = React.useState(initialDate);
  const [bufferMinutes, setBufferMinutes] = React.useState(10);
  const [returnToStart, setReturnToStart] = React.useState(true);

  return (
    <>
      <PageHeader
        title="Tagesroute"
        description="Reihenfolge, Fahrzeiten und empfohlene Abfahrt für einen Arbeitstag planen."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {teamMode ? (
          <Tabs defaultValue="single">
            <TabsList data-tour="routes-mode-tabs">
              <TabsTrigger value="single">Einzelroute</TabsTrigger>
              <TabsTrigger value="team">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5" aria-hidden /> Teamplanung
                </span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="single" className="mt-4">
              <SingleRoutePlanner
                employees={employees}
                ownEmployeeId={ownEmployeeId}
                initialEmployeeId={initialEmployeeId}
                date={date}
                setDate={setDate}
                bufferMinutes={bufferMinutes}
                setBufferMinutes={setBufferMinutes}
                returnToStart={returnToStart}
                setReturnToStart={setReturnToStart}
                canManage={canManage}
                canAccept={canAccept}
                timezone={timezone}
                showEmployeeSelect
              />
            </TabsContent>
            <TabsContent value="team" className="mt-4">
              <TeamPlanner
                date={date}
                setDate={setDate}
                bufferMinutes={bufferMinutes}
                setBufferMinutes={setBufferMinutes}
                returnToStart={returnToStart}
                setReturnToStart={setReturnToStart}
                timezone={timezone}
                canAccept={canAccept}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <SingleRoutePlanner
            employees={employees}
            ownEmployeeId={ownEmployeeId}
            initialEmployeeId={initialEmployeeId}
            date={date}
            setDate={setDate}
            bufferMinutes={bufferMinutes}
            setBufferMinutes={setBufferMinutes}
            returnToStart={returnToStart}
            setReturnToStart={setReturnToStart}
            canManage={canManage}
            canAccept={canAccept}
            timezone={timezone}
            showEmployeeSelect={false}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Einzelroute
// ---------------------------------------------------------------------------

function SingleRoutePlanner({
  employees,
  ownEmployeeId,
  initialEmployeeId,
  date,
  setDate,
  bufferMinutes,
  setBufferMinutes,
  returnToStart,
  setReturnToStart,
  canManage,
  canAccept,
  timezone,
  showEmployeeSelect,
}: {
  employees: { id: string; name: string }[];
  ownEmployeeId: string | null;
  initialEmployeeId: string;
  date: string;
  setDate: (value: string) => void;
  bufferMinutes: number;
  setBufferMinutes: (value: number) => void;
  returnToStart: boolean;
  setReturnToStart: (value: boolean) => void;
  canManage: boolean;
  canAccept: boolean;
  timezone: string;
  showEmployeeSelect: boolean;
}) {
  const [employeeId, setEmployeeId] = React.useState(initialEmployeeId);
  const [originType, setOriginType] = React.useState<OriginType>('office');

  const [data, setData] = React.useState<PlanningData | null>(null);
  const [loading, setLoading] = React.useState(Boolean(initialEmployeeId && date));
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [route, setRoute] = React.useState<ComputedRoute | null>(null);
  const [manualOrder, setManualOrder] = React.useState<string[] | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Vorschläge (nur eigene Route).
  const isOwn = employeeId === ownEmployeeId;
  const [suggestions, setSuggestions] = React.useState<RouteSuggestionDto[] | null>(null);
  const [suggestionInfo, setSuggestionInfo] = React.useState<{ aiUsed: boolean } | null>(null);
  const [declinedTokens, setDeclinedTokens] = React.useState<Set<string>>(new Set());
  const [generating, setGenerating] = React.useState(false);
  const [acceptingToken, setAcceptingToken] = React.useState<string | null>(null);

  const reloadData = React.useCallback(
    async (keepRoute = false): Promise<string[] | null> => {
      if (!employeeId || !date) return null;
      setLoading(true);
      try {
        const result = await getRoutePlanningDataAction(employeeId, date);
        if (result.ok) {
          const ids =
            result.data.existingPlan?.stopAppointmentIds ??
            result.data.assigned.map((a) => a.appointmentId);
          setData(result.data);
          setSelectedIds(ids);
          // Ohne Zuhause-Adresse fällt der Startpunkt sichtbar auf das Büro zurück.
          if (!result.data.origins.home) {
            setOriginType((current) => (current === 'home' ? 'office' : current));
          }
          if (!keepRoute) {
            setRoute(null);
            setManualOrder(null);
          }
          return ids;
        }
        toast.error(result.message);
        setData(null);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [employeeId, date],
  );

  React.useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      if (cancelled) return;
      setSuggestions(null);
      setSuggestionInfo(null);
      setDeclinedTokens(new Set());
      await reloadData();
    });
    return () => {
      cancelled = true;
    };
  }, [reloadData]);

  // Verfügbarkeit der Startpunkte: fehlt „Zuhause“/„Büro“, Option deaktivieren.
  const homeAvailable = Boolean(data?.origins.home);
  const officeAvailable = Boolean(data?.origins.office);

  const buildInput = React.useCallback(
    async (order?: string[]): Promise<ComputeRouteActionInput | null> => {
      const ids = order ?? selectedIds;
      if (ids.length === 0) {
        toast.error('Bitte mindestens einen Termin auswählen.');
        return null;
      }
      let gps: { latitude: number; longitude: number; timestamp: number } | undefined;
      if (originType === 'gps') {
        try {
          gps = await requestGps();
        } catch {
          toast.error(
            'Standortfreigabe verweigert oder nicht verfügbar – bitte Büro oder Zuhause als Startpunkt wählen.',
          );
          return null;
        }
      }
      return {
        employeeId,
        date,
        appointmentIds: ids,
        originType,
        gps,
        bufferMinutes,
        returnToStart,
        manualOrder: Boolean(order),
      };
    },
    [employeeId, date, selectedIds, originType, bufferMinutes, returnToStart],
  );

  const compute = (order?: string[]) => {
    startTransition(async () => {
      const input = await buildInput(order);
      if (!input) return;
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
    startTransition(async () => {
      if (!route) return;
      const order = manualOrder ?? route.stops.map((s) => s.appointmentId);
      const input = await buildInput(order);
      if (!input) return;
      const result = await saveRouteAction(input, publish);
      if (result.ok) {
        toast.success(publish ? 'Route gespeichert und freigegeben.' : 'Route gespeichert.');
        await reloadData(true);
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
        await reloadData();
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
    if (next.length > 0) compute(next);
    else setRoute(null);
  };

  const toggleSelection = (appointmentId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...current, appointmentId] : current.filter((id) => id !== appointmentId),
    );
    setRoute(null);
  };

  // ---- Vorschläge ---------------------------------------------------------
  /** idsOverride: frische Terminliste nach einer Annahme (State ist dann noch alt). */
  const generateSuggestions = async (idsOverride?: string[]) => {
    setGenerating(true);
    setSuggestions(null);
    setSuggestionInfo(null);
    setDeclinedTokens(new Set());
    try {
      let gps: { latitude: number; longitude: number; timestamp: number } | undefined;
      if (originType === 'gps') {
        try {
          gps = await requestGps();
        } catch {
          toast.error(
            'Standortfreigabe verweigert – bitte Büro oder Zuhause als Startpunkt wählen.',
          );
          return;
        }
      }
      const ids = idsOverride ?? selectedIds;
      const result = await generateRouteSuggestionsAction({
        date,
        scope: 'self',
        originType,
        gps,
        bufferMinutes,
        returnToStart,
        appointmentIds: ids.length > 0 ? ids : undefined,
      });
      if (result.ok) {
        const panel = result.data.employees[0];
        setSuggestions(panel?.suggestions ?? []);
        setSuggestionInfo({ aiUsed: result.data.aiUsed });
      } else {
        toast.error(result.message);
      }
    } finally {
      setGenerating(false);
    }
  };

  const acceptSuggestion = async (suggestion: RouteSuggestionDto) => {
    setAcceptingToken(suggestion.token);
    try {
      const result = await acceptRouteSuggestionAction(suggestion.token);
      if (result.ok) {
        toast.success(
          `Termin für ${suggestion.customerName} übernommen. Der Routenentwurf wurde aktualisiert.`,
        );
        // Verbleibende Vorschläge gegen die FRISCHE Terminliste neu berechnen.
        const freshIds = await reloadData();
        await generateSuggestions(freshIds ?? undefined);
      } else {
        toast.error(result.message);
        if (result.code === 'SUGGESTION_STALE') {
          const freshIds = await reloadData();
          await generateSuggestions(freshIds ?? undefined);
        }
      }
    } finally {
      setAcceptingToken(null);
    }
  };

  const declineSuggestion = (suggestion: RouteSuggestionDto) => {
    setDeclinedTokens((current) => new Set(current).add(suggestion.token));
  };
  const undoDecline = (suggestion: RouteSuggestionDto) => {
    setDeclinedTokens((current) => {
      const next = new Set(current);
      next.delete(suggestion.token);
      return next;
    });
  };

  // ---- Karte --------------------------------------------------------------
  const allCandidates = data ? [...data.assigned, ...data.suggestions] : [];
  const markers = route
    ? [
        {
          id: 'start',
          latitude: route.origin.latitude,
          longitude: route.origin.longitude,
          label: route.originLabel,
          color: '#1b1f36',
        },
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
        .filter(
          (c) => c.latitude != null && c.longitude != null && selectedIds.includes(c.appointmentId),
        )
        .map((c) => ({
          id: c.appointmentId,
          latitude: c.latitude!,
          longitude: c.longitude!,
          label: c.customerName,
          color: c.customerColor,
        }));

  const polyline: [number, number][] | undefined = React.useMemo(() => {
    if (!route) return undefined;
    return [
      [route.origin.latitude, route.origin.longitude] as [number, number],
      ...route.stops.map((s) => [s.latitude, s.longitude] as [number, number]),
      ...(returnToStart
        ? ([[route.origin.latitude, route.origin.longitude]] as [number, number][])
        : []),
    ];
  }, [route, returnToStart]);

  // Echte Fahrstrecke (Straßenverlauf) nachladen, sobald die Stopp-Folge
  // feststeht. Das Ergebnis trägt den Schlüssel seiner Anfrage – so wird eine
  // veraltete Antwort nach einer Umplanung einfach ignoriert.
  const pathKey = React.useMemo(
    () => (polyline ? polyline.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(';') : null),
    [polyline],
  );
  const [roadPath, setRoadPath] = React.useState<{
    key: string;
    coordinates: [number, number][];
    road: boolean;
    provider: string;
  } | null>(null);

  React.useEffect(() => {
    if (!polyline || polyline.length < 2 || !pathKey) return;
    let cancelled = false;
    const points = polyline.map(([latitude, longitude]) => ({ latitude, longitude }));
    getRoutePathAction({ points }).then((result) => {
      if (cancelled || !result.ok) return;
      setRoadPath({
        key: pathKey,
        coordinates: result.data.coordinates,
        road: result.data.road,
        provider: result.data.provider,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pathKey, polyline]);

  /** Nur verwenden, wenn die Antwort zur aktuell gezeigten Route gehört. */
  const activeRoadPath =
    roadPath && roadPath.key === pathKey && roadPath.road ? roadPath.coordinates : undefined;

  const originOptions: { value: OriginType; label: string; icon: React.ReactNode; disabled: boolean; hint?: string }[] = [
    {
      value: 'office',
      label: data?.origins.office?.label ?? 'Büro',
      icon: <Building2 className="size-3.5" aria-hidden />,
      disabled: !officeAvailable,
      hint: officeAvailable ? undefined : 'Kein Büro-Standort konfiguriert',
    },
    {
      value: 'home',
      label: data?.origins.home?.label ?? 'Zuhause',
      icon: <Home className="size-3.5" aria-hidden />,
      disabled: !homeAvailable,
      hint: homeAvailable ? undefined : 'Keine Zuhause-Adresse hinterlegt',
    },
    ...(isOwn
      ? [
          {
            value: 'gps' as OriginType,
            label: 'Aktueller Standort',
            icon: <LocateFixed className="size-3.5" aria-hidden />,
            disabled: false,
            hint: 'GPS wird erst beim Berechnen abgefragt',
          },
        ]
      : []),
  ];

  const visibleSuggestions = suggestions?.filter((s) => !declinedTokens.has(s.token)) ?? null;
  const declinedList = suggestions?.filter((s) => declinedTokens.has(s.token)) ?? [];

  return (
    <div className="space-y-4">
      {/* Parameter */}
      <Panel data-tour="routes-params">
        <PanelBody className="grid grid-cols-2 gap-3 lg:grid-cols-12">
          {showEmployeeSelect ? (
            <div className="col-span-2 lg:col-span-3">
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
          ) : null}
          <div className="lg:col-span-2">
            <Label htmlFor="route-date">Datum</Label>
            <Input
              id="route-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className={showEmployeeSelect ? 'col-span-2 lg:col-span-3' : 'col-span-2 lg:col-span-4'}>
            <Label htmlFor="route-origin">Startpunkt</Label>
            <Select value={originType} onValueChange={(v) => setOriginType(v as OriginType)}>
              <SelectTrigger id="route-origin" data-tour="routes-origin">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {originOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                    <span className="inline-flex items-center gap-1.5">
                      {option.icon}
                      {option.label}
                      {option.hint ? (
                        <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                          · {option.hint}
                        </span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="lg:col-span-2">
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
          <div className="flex items-end gap-2 lg:col-span-2">
            <label className="flex h-9 pointer-coarse:h-11 flex-1 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-panel-sunken)] px-3 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              <Checkbox
                checked={returnToStart}
                onCheckedChange={(checked) => setReturnToStart(checked === true)}
              />
              Rückkehr
            </label>
          </div>
          <div className="col-span-2 flex items-end gap-2 lg:col-span-12">
            {loading ? (
              <Skeleton className="h-3 min-w-0 flex-1 rounded-full" />
            ) : (
              <p className="min-w-0 flex-1 truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                Die Abfahrtszeit wird automatisch berechnet (späteste empfohlene Abfahrt).
                {' · '}Verkehrsmittel: Auto
              </p>
            )}
            <Button
              variant="primary"
              onClick={() => compute()}
              loading={pending}
              disabled={!data}
              data-tour="routes-compute-button"
            >
              <RouteIcon aria-hidden /> Route berechnen
            </Button>
          </div>
        </PanelBody>
      </Panel>

      {/* Subtile Kennzahlen-Leiste über Karte & Terminen: Gesamtdauer unterwegs,
          Fahrt-, Warte- und Kundenzeit auf einen Blick. */}
      {route ? (
        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] px-4 py-2 text-[length:var(--text-xs)] shadow-[var(--shadow-panel)]"
          data-tour="routes-kpi-bar"
        >
          <RouteKpiInline label="Unterwegs" value={formatTravelSeconds(route.workdaySeconds)} strong />
          <RouteKpiInline label="Fahrt" value={formatTravelSeconds(route.totalTravelSeconds)} />
          <RouteKpiInline
            label="Wartezeit"
            value={route.totalWaitSeconds > 0 ? formatTravelSeconds(route.totalWaitSeconds) : 'keine'}
          />
          <RouteKpiInline label="Kundenzeit" value={formatMinutesVerbose(route.totalServiceMinutes)} />
          <RouteKpiInline label="Distanz" value={formatDistance(route.totalDistanceMeters)} />
          <span className="ml-auto text-[var(--color-ink-subtle)]">
            Abfahrt {formatTime(new Date(route.departureAt), timezone)}
            {route.returnArrivalAt
              ? ` → Rückkehr ${formatTime(new Date(route.returnArrivalAt), timezone)}`
              : ''}
          </span>
        </div>
      ) : null}

      {loading ? (
        <RoutePlanningDataSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          {/* Terminauswahl */}
          <Panel className="xl:col-span-2" data-tour="routes-candidates">
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
                <EmptyState
                  className="border-0"
                  icon={<Car />}
                  title="Keine Routendaten"
                  description="Die Planungsdaten konnten nicht geladen werden."
                />
              ) : allCandidates.length === 0 ? (
                <EmptyState
                  className="border-0"
                  icon={<Car />}
                  title="Keine routenrelevanten Termine"
                  description="Für diesen Tag gibt es keine passenden Termine. Über „Vorschläge generieren“ lassen sich offene Kundenstunden einplanen."
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
                        Ohne Zuordnung (Auswahl ändert die Zuweisung nicht)
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
              {/* Sichtbar machen, ob die echte Strecke oder nur die Luftlinie liegt. */}
              {polyline && polyline.length > 1 ? (
                <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                  {activeRoadPath
                    ? 'Tatsächliche Fahrstrecke'
                    : roadPath && roadPath.key === pathKey
                      ? 'Luftlinie – kein Routendienst erreichbar'
                      : 'Fahrstrecke wird geladen …'}
                </span>
              ) : null}
            </PanelHeader>
            <PanelBody className="p-3">
              <div className="h-[400px] overflow-hidden rounded-[var(--radius-lg)]">
                {markers.length > 0 ? (
                  <LeafletMap markers={markers} polyline={polyline} roadPath={activeRoadPath} />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-panel-sunken)] text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                    Termine wählen und Route berechnen.
                  </div>
                )}
              </div>
            </PanelBody>
          </Panel>
        </div>
      )}

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

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6" data-tour="routes-stats">
            <StatTile
              label="Späteste Abfahrt"
              value={formatTime(new Date(route.departureAt), timezone)}
            />
            <StatTile
              label="Kundenzeit"
              value={formatMinutesVerbose(route.totalServiceMinutes)}
              tone="success"
            />
            <StatTile label="Fahrtzeit" value={formatTravelSeconds(route.totalTravelSeconds)} />
            <StatTile
              label="Wartezeit"
              value={
                route.totalWaitSeconds > 0
                  ? formatTravelSeconds(route.totalWaitSeconds)
                  : 'keine'
              }
            />
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => save(false)}
                    loading={pending}
                    disabled={!route.feasible}
                    title={route.feasible ? undefined : 'Unzulässige Routen können nicht gespeichert werden.'}
                  >
                    <Save aria-hidden /> Speichern
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => save(true)}
                    loading={pending}
                    disabled={!route.feasible}
                    title={route.feasible ? undefined : 'Unzulässige Routen können nicht freigegeben werden.'}
                  >
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

      {/* Terminvorschläge (nur eigene Route) */}
      {isOwn ? (
        <Panel data-tour="routes-suggestions">
          <PanelHeader>
            <PanelTitle>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-4 text-[var(--color-brand)]" aria-hidden />
                Terminvorschläge aus offenen Kundenstunden
              </span>
            </PanelTitle>
            <div className="flex items-center gap-2">
              {suggestionInfo ? (
                <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                  {suggestionInfo.aiUsed ? 'Reihenfolge: KI (Ollama)' : 'Reihenfolge: regelbasiert'}
                </span>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => generateSuggestions()}
                loading={generating}
                disabled={loading || !data}
              >
                <Sparkles aria-hidden /> Vorschläge generieren
              </Button>
            </div>
          </PanelHeader>
          <PanelBody className="space-y-2.5">
            {generating ? (
              <div className="space-y-2.5" aria-label="Vorschläge werden berechnet">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] p-4"
                  >
                    <Skeleton className="h-4 w-2/5 rounded-full" />
                    <Skeleton className="h-3 w-3/5 rounded-full" />
                    <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
                      {[...Array(6)].map((_, j) => (
                        <Skeleton key={j} className="h-11 rounded-[var(--radius-md)]" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : suggestions === null ? (
              <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                Prüft Kunden mit offenen Stunden und Verfügbarkeit am {date} und schlägt Einsätze
                vor, die zur aktuellen Route passen – inklusive Auswirkungen auf Fahrzeit,
                Wartezeit und Arbeitstag.
              </p>
            ) : visibleSuggestions && visibleSuggestions.length === 0 && declinedList.length === 0 ? (
              <EmptyState
                className="border-0"
                icon={<Check />}
                title="Keine passenden Vorschläge"
                description="Alle Kunden sind versorgt, nicht verfügbar oder würden die Route unzulässig machen."
              />
            ) : (
              <>
                {visibleSuggestions?.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.token}
                    suggestion={suggestion}
                    timezone={timezone}
                    canAccept={canAccept}
                    declined={false}
                    pending={acceptingToken === suggestion.token}
                    onAccept={acceptSuggestion}
                    onDecline={declineSuggestion}
                    onUndoDecline={undoDecline}
                  />
                ))}
                {declinedList.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.token}
                    suggestion={suggestion}
                    timezone={timezone}
                    canAccept={canAccept}
                    declined
                    pending={false}
                    onAccept={acceptSuggestion}
                    onDecline={declineSuggestion}
                    onUndoDecline={undoDecline}
                  />
                ))}
                {!canAccept ? (
                  <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                    Vorschläge können nur von der Leitung übernommen werden.
                  </p>
                ) : null}
              </>
            )}
          </PanelBody>
        </Panel>
      ) : showEmployeeSelect ? (
        <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
          Terminvorschläge für Mitarbeiter gibt es gesammelt im Tab „Teamplanung“.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teamplanung
// ---------------------------------------------------------------------------

function TeamPlanner({
  date,
  setDate,
  bufferMinutes,
  setBufferMinutes,
  returnToStart,
  setReturnToStart,
  timezone,
  canAccept,
}: {
  date: string;
  setDate: (value: string) => void;
  bufferMinutes: number;
  setBufferMinutes: (value: number) => void;
  returnToStart: boolean;
  setReturnToStart: (value: boolean) => void;
  timezone: string;
  canAccept: boolean;
}) {
  const [result, setResult] = React.useState<GenerateSuggestionsResult | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [declinedTokens, setDeclinedTokens] = React.useState<Set<string>>(new Set());
  const [acceptingToken, setAcceptingToken] = React.useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    setResult(null);
    setDeclinedTokens(new Set());
    try {
      const response = await generateRouteSuggestionsAction({
        date,
        scope: 'team',
        bufferMinutes,
        returnToStart,
      });
      if (response.ok) {
        setResult(response.data);
      } else {
        toast.error(response.message);
      }
    } finally {
      setGenerating(false);
    }
  };

  const acceptSuggestion = async (suggestion: RouteSuggestionDto) => {
    setAcceptingToken(suggestion.token);
    try {
      const response = await acceptRouteSuggestionAction(suggestion.token);
      if (response.ok) {
        toast.success(`Termin für ${suggestion.customerName} übernommen.`);
        await generate();
      } else {
        toast.error(response.message);
        if (response.code === 'SUGGESTION_STALE') await generate();
      }
    } finally {
      setAcceptingToken(null);
    }
  };

  const declineSuggestion = (suggestion: RouteSuggestionDto) => {
    setDeclinedTokens((current) => new Set(current).add(suggestion.token));
  };
  const undoDecline = (suggestion: RouteSuggestionDto) => {
    setDeclinedTokens((current) => {
      const next = new Set(current);
      next.delete(suggestion.token);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <Panel data-tour="routes-team-params">
        <PanelBody className="grid grid-cols-2 gap-3 lg:grid-cols-8">
          <div className="lg:col-span-2">
            <Label htmlFor="team-date">Datum</Label>
            <Input
              id="team-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="lg:col-span-2">
            <Label htmlFor="team-buffer">Puffer (Min.)</Label>
            <Input
              id="team-buffer"
              type="number"
              min={0}
              max={120}
              value={bufferMinutes}
              onChange={(event) => setBufferMinutes(Number(event.target.value))}
            />
          </div>
          <div className="flex items-end gap-2 lg:col-span-2">
            <label className="flex h-9 pointer-coarse:h-11 flex-1 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-panel-sunken)] px-3 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              <Checkbox
                checked={returnToStart}
                onCheckedChange={(checked) => setReturnToStart(checked === true)}
              />
              Rückkehr
            </label>
          </div>
          <div className="col-span-2 flex items-end justify-end lg:col-span-2">
            <Button variant="primary" onClick={generate} loading={generating}>
              <Sparkles aria-hidden /> Teamplanung berechnen
            </Button>
          </div>
          <p className="col-span-2 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)] lg:col-span-8">
            Startpunkt je Mitarbeiter: Zuhause-Adresse, ersatzweise das Büro. Vorschläge
            berücksichtigen Verfügbarkeiten, Abwesenheiten, offene Stunden und die bestehende
            Tagesroute jedes Mitarbeiters; jeder Kundenbedarf erscheint nur bei einem Mitarbeiter.
          </p>
        </PanelBody>
      </Panel>

      {generating ? (
        <div className="space-y-4" aria-label="Teamplanung wird berechnet">
          {[0, 1].map((i) => (
            <Panel key={i}>
              <PanelHeader>
                <Skeleton className="h-4 w-48 rounded-full" />
              </PanelHeader>
              <PanelBody className="space-y-2.5">
                <Skeleton className="h-3 w-72 rounded-full" />
                <Skeleton className="h-24 rounded-[var(--radius-lg)]" />
              </PanelBody>
            </Panel>
          ))}
        </div>
      ) : result === null ? (
        <EmptyState
          icon={<Users />}
          title="Noch keine Teamplanung berechnet"
          description="„Teamplanung berechnen“ erstellt für jeden Mitarbeiter Terminvorschläge aus offenen Kundenstunden – getrennt nach Verfügbarkeit, Abwesenheiten und bestehender Route."
        />
      ) : (
        result.employees.map((panel) => (
          <TeamEmployeePanel
            key={panel.employeeId}
            panel={panel}
            timezone={timezone}
            canAccept={canAccept}
            declinedTokens={declinedTokens}
            acceptingToken={acceptingToken}
            onAccept={acceptSuggestion}
            onDecline={declineSuggestion}
            onUndoDecline={undoDecline}
          />
        ))
      )}
    </div>
  );
}

function TeamEmployeePanel({
  panel,
  timezone,
  canAccept,
  declinedTokens,
  acceptingToken,
  onAccept,
  onDecline,
  onUndoDecline,
}: {
  panel: EmployeeSuggestionPanel;
  timezone: string;
  canAccept: boolean;
  declinedTokens: Set<string>;
  acceptingToken: string | null;
  onAccept: (suggestion: RouteSuggestionDto) => void;
  onDecline: (suggestion: RouteSuggestionDto) => void;
  onUndoDecline: (suggestion: RouteSuggestionDto) => void;
}) {
  const visible = panel.suggestions.filter((s) => !declinedTokens.has(s.token));
  const declined = panel.suggestions.filter((s) => declinedTokens.has(s.token));

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{panel.employeeName}</PanelTitle>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
          <span className="inline-flex items-center gap-1">
            {panel.originType === 'home' ? (
              <Home className="size-3" aria-hidden />
            ) : (
              <Building2 className="size-3" aria-hidden />
            )}
            {panel.originLabel ?? (panel.originType === 'home' ? 'Zuhause' : 'Büro')}
          </span>
          <span>Arbeitsfenster: {panel.workWindows.join(', ')}</span>
          {panel.absenceNote ? (
            <span className="text-[var(--color-warning)]">{panel.absenceNote}</span>
          ) : null}
        </span>
      </PanelHeader>
      <PanelBody className="space-y-2.5">
        {panel.status === 'error' ? (
          <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-danger)]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {panel.statusMessage ?? 'Berechnung fehlgeschlagen.'}
          </p>
        ) : null}
        {panel.status === 'absent' ? (
          <p className="rounded-[var(--radius-md)] bg-[var(--color-warning-soft)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-warning)]">
            {panel.statusMessage}
          </p>
        ) : null}

        {panel.baseRoute ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2 text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
            <span className="font-medium text-[var(--color-ink)]">
              Bestehende Route: {panel.baseRoute.stopCount}{' '}
              {panel.baseRoute.stopCount === 1 ? 'Stopp' : 'Stopps'}
            </span>
            <span>Empfohlene Abfahrt {formatTime(new Date(panel.baseRoute.departureAt), timezone)}</span>
            {panel.baseRoute.returnAt ? (
              <span>Rückkehr {formatTime(new Date(panel.baseRoute.returnAt), timezone)}</span>
            ) : null}
            <span>Fahrtzeit {formatTravelSeconds(panel.baseRoute.totalTravelSeconds)}</span>
            <span>Kundenzeit {formatMinutesVerbose(panel.baseRoute.totalServiceMinutes)}</span>
          </p>
        ) : panel.status === 'ok' ? (
          <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
            Keine bestehende Route an diesem Tag – Vorschläge starten eine neue Route.
          </p>
        ) : null}

        {panel.status === 'ok' && visible.length === 0 && declined.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Keine passenden Vorschläge – alle Kunden sind versorgt, nicht verfügbar oder zu weit
            entfernt.
          </p>
        ) : null}

        {visible.map((suggestion) => (
          <SuggestionCard
            key={suggestion.token}
            suggestion={suggestion}
            timezone={timezone}
            canAccept={canAccept}
            declined={false}
            pending={acceptingToken === suggestion.token}
            onAccept={onAccept}
            onDecline={onDecline}
            onUndoDecline={onUndoDecline}
          />
        ))}
        {declined.map((suggestion) => (
          <SuggestionCard
            key={suggestion.token}
            suggestion={suggestion}
            timezone={timezone}
            canAccept={canAccept}
            declined
            pending={false}
            onAccept={onAccept}
            onDecline={onDecline}
            onUndoDecline={onUndoDecline}
          />
        ))}
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

/** Ein Kennzahlen-Element der subtilen Routen-Leiste (Label + Wert inline). */
function RouteKpiInline({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[var(--color-ink-subtle)]">{label}</span>
      <span
        className={
          strong
            ? 'tabular font-semibold text-[var(--color-ink)]'
            : 'tabular font-medium text-[var(--color-ink)]'
        }
      >
        {value}
      </span>
    </span>
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
