'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  Car,
  Check,
  ChevronUp,
  Clock,
  Home,
  LocateFixed,
  Lock,
  MapPin,
  Navigation,
  Plus,
  RefreshCcw,
  Route as RouteIcon,
  Save,
  Send,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  Wand2,
  X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import * as React from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { RoutePlanningDataSkeleton } from '@/components/layout/page-loading-skeleton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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
import { cn } from '@/lib/utils';
import { formatDistance, formatTravelSeconds, googleMapsDirectionsUrl } from '@/lib/geo';
import {
  acceptDayRouteAction,
  acceptRouteSuggestionAction,
  computeRouteAction,
  discardRouteAction,
  generateDayRoutesAction,
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
import { DayRouteDialog, type DayRouteFormValues } from '@/features/routing/day-route-dialog';
import { computeRouteEarnings, formatEuroCents } from '@/lib/earnings';

const LeafletMap = dynamic(() => import('@/features/map/leaflet-map').then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[var(--radius-lg)]" />,
});

type PlanningData = Extract<
  Awaited<ReturnType<typeof getRoutePlanningDataAction>>,
  { ok: true }
>['data'];

type OriginType = 'office' | 'home' | 'gps';

/** Dauer der Ausblende-Animation eines nicht mehr machbaren Vorschlags (muss
 *  zur CSS-Klasse `.suggestion-anim` in globals.css passen). */
const SUGGESTION_EXIT_MS = 360;
/** Sammelt schnelle Datenänderungen, bevor die Vorschläge revalidiert werden. */
const REVALIDATE_DEBOUNCE_MS = 450;

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
  soloMode,
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
  /**
   * Alleine-Modus: Es gibt niemanden, für den etwas freigegeben werden müsste.
   * Änderungen werden deshalb sofort gespeichert, „Freigeben" entfällt.
   */
  soloMode: boolean;
  timezone: string;
}) {
  const [date, setDate] = React.useState(initialDate);
  const [bufferMinutes, setBufferMinutes] = React.useState(10);
  const [returnToStart, setReturnToStart] = React.useState(true);

  return (
    <>
      {/* Werkzeugseite: Karte + Editor brauchen die volle Breite (fluid). */}
      <PageHeader
        title="Tagesroute"
        description="Reihenfolge, Fahrzeiten und empfohlene Abfahrt für einen Arbeitstag planen."
        fluid
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
                soloMode={soloMode}
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
            soloMode={soloMode}
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
  soloMode,
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
  /** Alleine-Modus: sofort speichern statt speichern/freigeben. */
  soloMode: boolean;
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
  // Nach dem Laden einmal rechnen, wenn es Termine, aber noch keine
  // gespeicherte Route gibt – so ist sofort eine Route zum Optimieren da.
  const pendingInitialComputeRef = React.useRef(false);

  // Vorschläge (nur eigene Route).
  const isOwn = employeeId === ownEmployeeId;
  // „Selbstplanung": die eigene Route (oder Alleine-Modus) wird automatisch
  // gespeichert – ohne „Freigeben". Freigegeben werden muss nur, was man einem
  // ANDEREN Mitarbeiter zuweist.
  const selfPlanning = soloMode || isOwn;
  const [suggestions, setSuggestions] = React.useState<RouteSuggestionDto[] | null>(null);
  const [suggestionInfo, setSuggestionInfo] = React.useState<{ aiUsed: boolean } | null>(null);
  const [declinedTokens, setDeclinedTokens] = React.useState<Set<string>>(new Set());
  const [generating, setGenerating] = React.useState(false);
  const [acceptingToken, setAcceptingToken] = React.useState<string | null>(null);

  // Nach einer Datenänderung nicht mehr annehmbare Vorschläge blenden nach links
  // aus (customerId-basiert, da die Tokens bei jeder Revalidierung neu vergeben
  // werden). Neue Kunden kommen nur über einen manuellen „Generieren"-Klick.
  const [exitingCustomerIds, setExitingCustomerIds] = React.useState<Set<string>>(new Set());
  const suggestionsRef = React.useRef(suggestions);
  const revalidateRef = React.useRef<() => void>(() => {});
  const revalidateSeqRef = React.useRef(0);
  // Zählt jede vollständige Ersetzung der Liste (Generieren/Reset). Eine noch
  // laufende Ausblende-Animation darf einen frisch erzeugten Satz nicht anfassen.
  const listEpochRef = React.useRef(0);
  const lastGpsRef = React.useRef<
    { latitude: number; longitude: number; timestamp: number } | undefined
  >(undefined);
  React.useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  /**
   * Entfernt Vorschläge animiert: erst als „ausblendend" markieren (CSS lässt
   * sie nach links verschwinden und die Höhe kollabieren – die restlichen
   * rücken nach oben), nach der Animation aus der Liste nehmen. Überlebende
   * bekommen dabei ihre frischen Kennzahlen/Tokens (`refresh`).
   */
  const animateRemoval = React.useCallback(
    (removedCustomerIds: string[], refresh?: Map<string, RouteSuggestionDto>) => {
      if (removedCustomerIds.length === 0) {
        if (refresh) {
          setSuggestions((prev) =>
            prev ? prev.map((s) => refresh.get(s.customerId) ?? s) : prev,
          );
        }
        return;
      }
      const removed = new Set(removedCustomerIds);
      const epoch = listEpochRef.current;
      setExitingCustomerIds((prev) => new Set([...prev, ...removedCustomerIds]));
      window.setTimeout(() => {
        // Wurde die Liste zwischenzeitlich neu generiert, die Animation verwerfen.
        if (epoch === listEpochRef.current) {
          setSuggestions((prev) =>
            prev
              ? prev
                  .filter((s) => !removed.has(s.customerId))
                  .map((s) => refresh?.get(s.customerId) ?? s)
              : prev,
          );
        }
        setExitingCustomerIds((prev) => {
          const next = new Set(prev);
          for (const id of removed) next.delete(id);
          return next;
        });
      }, SUGGESTION_EXIT_MS);
    },
    [],
  );

  // Tagesrouten-Generator (Popup mit kompletten Routen-Varianten).
  const [dayDialogOpen, setDayDialogOpen] = React.useState(false);

  const reloadData = React.useCallback(
    async (options?: { keepRoute?: boolean; clear?: boolean }): Promise<string[] | null> => {
      if (!employeeId || !date) return null;
      const keepRoute = options?.keepRoute ?? false;
      const clear = options?.clear ?? false;
      setLoading(true);
      try {
        const result = await getRoutePlanningDataAction(employeeId, date);
        if (result.ok) {
          // Nur Termine auswählen, die es wirklich noch gibt – sonst zählt der
          // Planer gelöschte Stopps mit („3/2 gewählt") und man wird sie nicht los.
          // `clear` (nach „Verwerfen"): bewusst mit leerer Auswahl starten, damit
          // die Route NICHT sofort aus den Tagesterminen neu aufgebaut wird.
          const existing = new Set(
            [...result.data.assigned, ...result.data.suggestions].map((c) => c.appointmentId),
          );
          const ids = clear
            ? []
            : (
                result.data.existingPlan?.stopAppointmentIds ??
                result.data.assigned.map((a) => a.appointmentId)
              ).filter((id) => existing.has(id));
          setData(result.data);
          setSelectedIds(ids);
          // Gespeicherte Einstellungen der Route übernehmen (Startpunkt, Puffer,
          // Rückkehr) – sonst weicht eine Neuberechnung vom Gespeicherten ab.
          const plan = result.data.existingPlan;
          if (plan) {
            setOriginType(plan.originType);
            setBufferMinutes(plan.bufferMinutes);
            setReturnToStart(plan.returnToStart);
          } else {
            // Sinnvoller Standard-Startpunkt für die erste Berechnung.
            const officeOk = Boolean(result.data.origins.office);
            const homeOk = Boolean(result.data.origins.home);
            setOriginType(
              officeOk ? 'office' : homeOk ? 'home' : employeeId === ownEmployeeId ? 'gps' : 'office',
            );
          }
          // Ohne Zuhause-Adresse fällt der Startpunkt sichtbar auf das Büro zurück.
          if (!result.data.origins.home) {
            setOriginType((current) => (current === 'home' ? 'office' : current));
          }
          if (!keepRoute) {
            // Gespeicherte Route direkt anzeigen – sie überlebt den Seitenwechsel.
            setRoute(clear ? null : result.data.savedRoute);
            setManualOrder(null);
            // Keine gespeicherte Route, aber Termine da → gleich einmal rechnen
            // (nur anzeigen, noch nicht speichern). Nach „Verwerfen" NICHT.
            pendingInitialComputeRef.current = !clear && !result.data.savedRoute && ids.length > 0;
          }
          if (plan?.droppedStopCount) {
            toast.info(
              plan.droppedStopCount === 1
                ? 'Ein Termin der gespeicherten Route existiert nicht mehr – bitte neu berechnen.'
                : `${plan.droppedStopCount} Termine der gespeicherten Route existieren nicht mehr – bitte neu berechnen.`,
            );
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
    [employeeId, date, ownEmployeeId, setBufferMinutes, setReturnToStart],
  );

  React.useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      if (cancelled) return;
      setSuggestions(null);
      setSuggestionInfo(null);
      setDeclinedTokens(new Set());
      setExitingCustomerIds(new Set());
      revalidateSeqRef.current += 1; // laufende Revalidierungen verwerfen
      listEpochRef.current += 1;
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
    async (order?: string[], manual?: boolean): Promise<ComputeRouteActionInput | null> => {
      const ids = order ?? selectedIds;
      if (ids.length === 0) {
        toast.error('Bitte mindestens einen Termin auswählen.');
        return null;
      }
      let gps: { latitude: number; longitude: number; timestamp: number } | undefined;
      if (originType === 'gps') {
        try {
          gps = await requestGps();
          lastGpsRef.current = gps; // für die stille Vorschlags-Revalidierung merken
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
        manualOrder: manual ?? Boolean(order),
      };
    },
    [employeeId, date, selectedIds, originType, bufferMinutes, returnToStart],
  );

  /**
   * Alleine-Modus: Es gibt niemanden, dem etwas freigegeben werden müsste –
   * jede berechnete Route wird sofort gespeichert. Der bereits gebaute Input
   * wird wiederverwendet, damit keine erneute Standortabfrage aufpoppt.
   */
  const autoPersist = async (input: ComputeRouteActionInput, computed: ComputedRoute) => {
    if (!selfPlanning || !canManage || !computed.feasible) return;
    const result = await saveRouteAction(
      {
        ...input,
        appointmentIds: computed.stops.map((stop) => stop.appointmentId),
        manualOrder: true,
      },
      false,
    );
    if (!result.ok) toast.error(`Route konnte nicht gespeichert werden: ${result.message}`);
  };

  /**
   * Route neu berechnen und anzeigen.
   *  - `silent`: keine Erfolgs-Toasts (für Live-Bearbeitung – nur die Karte und
   *    die Kennzahlen sollen sich sofort ändern, nicht die Meldungen häufen).
   *  - `skipPersist`: nicht speichern (nur zum Anzeigen beim Laden – der Nutzer
   *    hat ja noch nichts geändert).
   */
  const compute = (
    order?: string[],
    options?: { manual?: boolean; silent?: boolean; skipPersist?: boolean },
  ) => {
    startTransition(async () => {
      const input = await buildInput(order, options?.manual);
      if (!input) return;
      const result = await computeRouteAction(input);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setRoute(result.data);
      setManualOrder(order ?? null);
      if (result.data.warnings.length > 0) {
        toast.warning(`Route aktualisiert – ${result.data.warnings.length} Hinweis(e).`);
      } else if (!options?.silent && !selfPlanning) {
        toast.success('Route berechnet.');
      }
      if (!options?.skipPersist) {
        await autoPersist(input, result.data);
        if (!options?.silent && selfPlanning && result.data.warnings.length === 0) {
          toast.success('Route gespeichert.');
        }
      }
    });
  };

  // Beim Laden ohne gespeicherte Route einmal rechnen, damit die zugeordneten
  // Termine sofort als Route und auf der Karte erscheinen (noch nicht gesichert).
  React.useEffect(() => {
    if (!pendingInitialComputeRef.current) return;
    if (!data || selectedIds.length === 0) return;
    pendingInitialComputeRef.current = false;
    compute(selectedIds, { manual: false, silent: true, skipPersist: true });
    // compute bewusst nicht in den Deps – der Ref-Guard sichert die Einmaligkeit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedIds]);

  const save = (publish: boolean) => {
    startTransition(async () => {
      if (!route) return;
      const order = manualOrder ?? route.stops.map((s) => s.appointmentId);
      const input = await buildInput(order);
      if (!input) return;
      const result = await saveRouteAction(input, publish);
      if (result.ok) {
        toast.success(publish ? 'Route gespeichert und freigegeben.' : 'Route gespeichert.');
        await reloadData({ keepRoute: true });
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
        setManualOrder(null);
        // clear: Auswahl leeren und NICHT sofort neu aufbauen – sonst käme die
        // gerade verworfene Route direkt wieder (und verlangte erneut Freigeben).
        await reloadData({ clear: true });
      } else {
        toast.error(result.message);
      }
    });
  };

  const moveStop = (index: number, direction: -1 | 1) => {
    if (!route) return;
    const target = index + direction;
    if (target < 0 || target >= route.stops.length) return;
    // Fixe Termine sind verankert: sie lassen sich weder selbst verschieben
    // noch von flexiblen Stopps überspringen (ihre Zeit steht fest).
    if (!route.stops[index]!.isFlexible || !route.stops[target]!.isFlexible) return;
    const ids = route.stops.map((s) => s.appointmentId);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    // Manuelle Reihenfolge behalten, still neu berechnen → Karte folgt sofort.
    compute(ids, { manual: true, silent: true });
  };

  /**
   * Termin zur Route hinzufügen oder daraus entfernen – die einzige Stelle für
   * beides. Die Route wird sofort neu berechnet (Karte + Kennzahlen folgen live)
   * und im Alleine-Modus gleich gesichert. Kein „Abhaken" mehr an anderer Stelle.
   */
  const setStopMembership = (appointmentId: string, include: boolean) => {
    const next = include
      ? [...selectedIds, appointmentId]
      : selectedIds.filter((id) => id !== appointmentId);
    setSelectedIds(next);
    if (next.length > 0) {
      compute(next, { manual: false, silent: true });
    } else {
      setRoute(null);
      setManualOrder(null);
      if (selfPlanning && canManage) void discardRouteAction(employeeId, date);
    }
  };

  // ---- Vorschläge ---------------------------------------------------------
  /** idsOverride: frische Terminliste nach einer Annahme (State ist dann noch alt). */
  const generateSuggestions = async (idsOverride?: string[]) => {
    setGenerating(true);
    setSuggestions(null);
    setSuggestionInfo(null);
    setDeclinedTokens(new Set());
    setExitingCustomerIds(new Set());
    revalidateSeqRef.current += 1; // laufende Revalidierung verwerfen (Voll-Neulauf)
    listEpochRef.current += 1;
    try {
      let gps: { latitude: number; longitude: number; timestamp: number } | undefined;
      if (originType === 'gps') {
        try {
          gps = await requestGps();
          lastGpsRef.current = gps;
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
        // Angenommene Karte sofort ausblenden; die Route neu laden. Die dadurch
        // geänderte Terminauswahl stößt die stille Revalidierung an, die auch
        // alle weiteren jetzt unmöglichen Vorschläge entfernt – OHNE komplett
        // neu zu generieren (neue Kunden kommen nur per „Generieren").
        animateRemoval([suggestion.customerId]);
        await reloadData();
      } else {
        toast.error(result.message);
        if (result.code === 'SUGGESTION_STALE') {
          // Daten haben sich geändert → nur revalidieren (die nicht mehr
          // machbaren Vorschläge fallen weg), nicht neu generieren.
          await reloadData();
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

  /**
   * Stille Revalidierung: prüft die aktuell angezeigten Vorschläge gegen den
   * neuen Datenstand (geänderte Termine/Startpunkt/Puffer/Rückkehr). Nicht mehr
   * annehmbare fallen animiert weg, die übrigen bleiben mit frischen Kennzahlen
   * stehen. Es werden bewusst KEINE neuen Kunden vorgeschlagen (restrictCustomerIds).
   */
  const revalidate = async () => {
    const current = suggestions;
    const declined = declinedTokens;
    if (!current || current.length === 0) return;
    const visible = current.filter((s) => !declined.has(s.token));
    if (visible.length === 0) return;

    const seq = (revalidateSeqRef.current += 1);

    let gps = lastGpsRef.current;
    if (originType === 'gps' && !gps) {
      try {
        gps = await requestGps();
        lastGpsRef.current = gps;
      } catch {
        return; // Ohne Standort lieber nichts entfernen.
      }
    }
    if (originType !== 'gps') gps = undefined;

    const result = await generateRouteSuggestionsAction({
      date,
      scope: 'self',
      originType,
      gps,
      bufferMinutes,
      returnToStart,
      appointmentIds: selectedIds.length > 0 ? selectedIds : undefined,
      restrictCustomerIds: visible.map((s) => s.customerId),
    });
    if (seq !== revalidateSeqRef.current) return; // durch neueren Lauf überholt
    if (!result.ok) return; // Fehler: Liste unverändert lassen

    const fresh = result.data.employees[0]?.suggestions ?? [];
    const freshById = new Map(fresh.map((s) => [s.customerId, s]));
    const removedIds = visible
      .filter((s) => !freshById.has(s.customerId))
      .map((s) => s.customerId);
    animateRemoval(removedIds, freshById);
  };

  // Immer die aktuellste Revalidierungs-Closure bereithalten (liest den neuesten
  // State), ohne den Debounce-Effekt bei jedem Render neu zu starten.
  React.useEffect(() => {
    revalidateRef.current = () => {
      void revalidate();
    };
  });

  // Datenänderung (Termine/Startpunkt/Puffer/Rückkehr) → nach kurzem Sammeln
  // still revalidieren. Läuft nur, wenn bereits Vorschläge sichtbar sind; ein
  // frisch generierter Satz löst nichts aus (Signale unverändert).
  React.useEffect(() => {
    if (!suggestionsRef.current || suggestionsRef.current.length === 0) return;
    const handle = window.setTimeout(() => revalidateRef.current(), REVALIDATE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [selectedIds, originType, bufferMinutes, returnToStart]);

  // ---- Tagesrouten-Generator ---------------------------------------------
  const generateDayRoutes = async (form: DayRouteFormValues) => {
    let gps: { latitude: number; longitude: number; timestamp: number } | undefined;
    if (originType === 'gps') {
      try {
        gps = await requestGps();
      } catch {
        toast.error('Standortfreigabe verweigert – bitte Büro oder Zuhause als Startpunkt wählen.');
        return null;
      }
    }
    const result = await generateDayRoutesAction({
      employeeId,
      date,
      originType,
      gps,
      bufferMinutes,
      returnToStart,
      targetWorkMinutes: form.targetWorkMinutes,
      earliestDepartureMinute: form.earliestDepartureMinute,
      latestReturnMinute: form.latestReturnMinute,
    });
    if (!result.ok) {
      toast.error(result.message);
      return null;
    }
    return result.data;
  };

  const acceptDayRoute = async (token: string): Promise<boolean> => {
    // Eigene Route/Alleine-Modus: direkt verbindlich; für andere als Entwurf
    // (dann noch „Freigeben").
    const result = await acceptDayRouteAction(token, selfPlanning);
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    toast.success(
      result.data.appointmentIds.length > 0
        ? `Route übernommen – ${result.data.appointmentIds.length} neue${result.data.appointmentIds.length === 1 ? 'r Termin' : ' Termine'} angelegt.`
        : 'Route übernommen.',
    );
    await reloadData();
    return true;
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

  // Termine, die man der Route noch hinzufügen kann: mit Koordinaten und noch
  // nicht Teil der Route. Zugeordnete UND offene Termine des Tages.
  const inRoute = new Set(selectedIds);
  const availableCandidates = allCandidates.filter(
    (candidate) =>
      candidate.latitude != null &&
      candidate.longitude != null &&
      !inRoute.has(candidate.appointmentId),
  );

  return (
    <div className="space-y-4">
      {/* Kompakte Steuerleiste: mobil ein 2-Spalten-Raster mit vollbreiten
          Feldern, ab sm eine schlanke Zeile. */}
      <div
        className="grid grid-cols-2 gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-3 sm:flex sm:flex-wrap sm:items-end sm:gap-x-3 sm:gap-y-2 sm:p-2.5"
        data-tour="routes-params"
      >
        {showEmployeeSelect ? (
          <ControlField label="Mitarbeiter" className="col-span-2 sm:w-[11rem]">
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger id="route-employee" className="h-8 w-full">
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
          </ControlField>
        ) : null}

        <ControlField label="Datum" className="sm:w-[9.5rem]">
          <Input
            id="route-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-8 w-full"
          />
        </ControlField>

        <ControlField label="Startpunkt" className="sm:w-[11rem]">
          <Select value={originType} onValueChange={(v) => setOriginType(v as OriginType)}>
            <SelectTrigger id="route-origin" data-tour="routes-origin" className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {originOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  <span className="inline-flex items-center gap-1.5">
                    {option.icon}
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ControlField>

        <ControlField label="Puffer" className="sm:w-[5.75rem]">
          <div className="relative">
            <Input
              id="route-buffer"
              type="number"
              min={0}
              max={120}
              value={bufferMinutes}
              onChange={(event) => setBufferMinutes(Number(event.target.value))}
              className="h-8 w-full pr-9"
            />
            <span
              className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]"
              aria-hidden
            >
              Min.
            </span>
          </div>
        </ControlField>

        <label className="flex h-8 cursor-pointer items-center gap-2 self-end rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-panel-sunken)] px-2.5 text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
          <Checkbox
            checked={returnToStart}
            onCheckedChange={(checked) => setReturnToStart(checked === true)}
          />
          <span className="truncate">Rückkehr</span>
        </label>

        <div className="col-span-2 flex items-center gap-2 self-end sm:col-auto sm:ml-auto">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDayDialogOpen(true)}
            disabled={!data || loading}
            title="Kompletten Tag aus Terminen und offenen Stunden planen"
          >
            <Wand2 aria-hidden /> Tag planen
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => compute()}
            loading={pending}
            disabled={!data || selectedIds.length === 0}
            data-tour="routes-compute-button"
          >
            <RefreshCcw aria-hidden /> Optimieren
          </Button>
        </div>
      </div>


      {loading ? (
        <RoutePlanningDataSkeleton />
      ) : !data ? (
        <Panel>
          <PanelBody>
            <EmptyState
              className="border-0"
              icon={<Car />}
              title="Keine Routendaten"
              description="Die Planungsdaten konnten nicht geladen werden."
            />
          </PanelBody>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
          {/* Ein Editor: geplante Stopps oben, Termine zum Hinzufügen darunter,
              darunter die Vorschläge. Mobil steht die Karte oben (order-1),
              der Editor darunter (order-2); am Desktop links neben der Karte. */}
          <div className="order-2 space-y-3 xl:order-none xl:col-span-2">
            {route && route.warnings.length > 0 ? (
              <div className="space-y-1.5">
                {route.warnings.map((warning, index) => (
                  <p
                    key={index}
                    className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-[length:var(--text-xs)] text-[var(--color-warning)]"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}

            <Panel data-tour="routes-candidates">
              <PanelHeader>
                <PanelTitle>
                  <span className="inline-flex items-center gap-1.5">
                    <RouteIcon className="size-4 text-[var(--color-brand)]" aria-hidden />
                    Route
                    {route ? (
                      <span className="text-[length:var(--text-xs)] font-normal text-[var(--color-ink-subtle)]">
                        · {route.stops.length} {route.stops.length === 1 ? 'Stopp' : 'Stopps'}
                      </span>
                    ) : null}
                  </span>
                </PanelTitle>
                {canManage ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {selfPlanning ? (
                      route ? (
                        <span className="flex items-center gap-1.5 text-[length:var(--text-2xs)] text-[var(--color-success)]">
                          <Check className="size-3.5" aria-hidden />
                          {route.feasible ? 'Automatisch gespeichert' : 'Unzulässig – nicht gespeichert'}
                        </span>
                      ) : null
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => save(false)}
                          loading={pending}
                          disabled={!route || !route.feasible}
                          title={route && !route.feasible ? 'Unzulässige Routen können nicht gespeichert werden.' : undefined}
                        >
                          <Save aria-hidden /> Speichern
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => save(true)}
                          loading={pending}
                          disabled={!route || !route.feasible}
                          title={route && !route.feasible ? 'Unzulässige Routen können nicht freigegeben werden.' : undefined}
                        >
                          <Send aria-hidden /> Freigeben
                        </Button>
                      </>
                    )}
                    {data.existingPlan ? (
                      <Button variant="danger" size="sm" onClick={discard} loading={pending}>
                        <Trash2 aria-hidden /> Verwerfen
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </PanelHeader>

              {/* Geplante Stopps: Reihenfolge ändern und entfernen. */}
              <PanelBody className="max-h-[460px] overflow-y-auto p-0">
                {route && route.stops.length > 0 ? (
                  <ol className="divide-y divide-[var(--color-line-subtle)]">
                    {route.stops.map((stop, index) => (
                      <StopRow
                        key={stop.appointmentId}
                        stop={stop}
                        index={index}
                        canManage={canManage}
                        pending={pending}
                        timezone={timezone}
                        // Fixe Stopps sind verankert – bewegen geht nur zwischen
                        // zwei flexiblen Nachbarn.
                        canMoveUp={
                          index > 0 && stop.isFlexible && route.stops[index - 1]!.isFlexible
                        }
                        canMoveDown={
                          index < route.stops.length - 1 &&
                          stop.isFlexible &&
                          route.stops[index + 1]!.isFlexible
                        }
                        onMove={moveStop}
                        onRemove={(id) => setStopMembership(id, false)}
                      />
                    ))}
                  </ol>
                ) : (
                  <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
                    <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                      {allCandidates.length === 0
                        ? 'Keine routenrelevanten Termine an diesem Tag.'
                        : 'Noch keine Stopps – unten Termine hinzufügen.'}
                    </p>
                    <Button variant="primary" size="sm" onClick={() => setDayDialogOpen(true)}>
                      <Wand2 aria-hidden /> Tag automatisch planen
                    </Button>
                    <p className="text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                      Erstellt komplette Routenvorschläge aus offenen Kundenstunden
                      {allCandidates.length > 0 ? ' und den Terminen des Tages' : ''}.
                    </p>
                  </div>
                )}
              </PanelBody>

              {/* Termine hinzufügen (zugeordnete + offene des Tages). */}
              {canManage ? (
                <div className="border-t border-[var(--color-line-subtle)] p-3">
                  <p className="mb-2 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
                    Termine hinzufügen
                  </p>
                  {availableCandidates.length === 0 ? (
                    <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                      {allCandidates.length === 0
                        ? 'Keine passenden Termine.'
                        : 'Alle verfügbaren Termine sind eingeplant.'}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {availableCandidates.map((candidate) => (
                        <AddRow
                          key={candidate.appointmentId}
                          candidate={candidate}
                          pending={pending}
                          timezone={timezone}
                          onAdd={(id) => setStopMembership(id, true)}
                        />
                      ))}
                    </ul>
                  )}
                  {data.suggestions.length > 0 ? (
                    <p className="mt-2 flex items-start gap-1.5 text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-[var(--color-warning)]" aria-hidden />
                      <span>
                        {data.suggestions.length === 1 ? 'Ein Termin ist' : `${data.suggestions.length} Termine sind`}{' '}
                        ohne Zuordnung – Hinzufügen ändert die Zuweisung nicht.{' '}
                        <a href="/calendar?zuweisung=offen" className="font-medium text-[var(--color-brand)] hover:underline">
                          Im Kalender zuweisen
                        </a>
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Panel>

            {/* Vorschläge aus offenen Kundenstunden – angenommene werden zu Stopps. */}
            {isOwn ? (
              <OpenHoursSuggestions
                date={date}
                hasData={Boolean(data)}
                generating={generating}
                loading={loading}
                suggestions={suggestions}
                suggestionInfo={suggestionInfo}
                visibleSuggestions={visibleSuggestions}
                declinedList={declinedList}
                exitingCustomerIds={exitingCustomerIds}
                canAccept={canAccept}
                acceptingToken={acceptingToken}
                timezone={timezone}
                onGenerate={() => generateSuggestions()}
                onAccept={acceptSuggestion}
                onDecline={declineSuggestion}
                onUndoDecline={undoDecline}
              />
            ) : showEmployeeSelect ? (
              <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                Terminvorschläge für Mitarbeiter gibt es gesammelt im Tab „Teamplanung“.
              </p>
            ) : null}
          </div>

          {/* Karte + Kennzahlen – bleiben beim Scrollen zusammen sichtbar und
              folgen jeder Bearbeitung sofort. Mobil stehen sie oben (order-1). */}
          <div className="order-1 xl:order-none xl:col-span-3">
            {/* Karte + Kennzahlen bleiben beim Scrollen sichtbar (sticky). Die
                Karte hat eine feste, angenehme Höhe (rund 42 % der Fensterhöhe,
                gedeckelt) – sie soll auf großen Displays NICHT die ganze Höhe
                ausfüllen. */}
            <div className="@container flex flex-col gap-3 xl:sticky xl:top-4">
              <Panel className="xl:flex xl:flex-col">
                <PanelHeader>
                  <PanelTitle>Karte</PanelTitle>
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
                  <div className="h-[360px] overflow-hidden rounded-[var(--radius-lg)] xl:h-[clamp(20rem,42vh,30rem)]">
                    {markers.length > 0 ? (
                      <LeafletMap markers={markers} polyline={polyline} roadPath={activeRoadPath} />
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-panel-sunken)] text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                        Termine hinzufügen, um die Route zu sehen.
                      </div>
                    )}
                  </div>
                </PanelBody>
              </Panel>

              {/* Alle Kennzahlen mit Farb-Chips – aktualisieren sich sofort. */}
              {route ? (
                <div
                  className="grid shrink-0 grid-cols-2 gap-2.5 @2xl:grid-cols-3"
                  data-tour="routes-kpi-bar"
                >
                  <StatTile
                    icon={<Navigation aria-hidden />}
                    label="Späteste Abfahrt"
                    value={formatTime(new Date(route.departureAt), timezone)}
                  />
                  <StatTile
                    icon={<Home aria-hidden />}
                    label="Rückkehr (zuhause)"
                    value={
                      route.returnArrivalAt
                        ? formatTime(new Date(route.returnArrivalAt), timezone)
                        : '—'
                    }
                  />
                  <StatTile
                    icon={<Clock aria-hidden />}
                    label="Unterwegs"
                    value={formatTravelSeconds(route.workdaySeconds)}
                  />
                  <StatTile
                    icon={<Car aria-hidden />}
                    label="Fahrtzeit"
                    value={formatTravelSeconds(route.totalTravelSeconds)}
                  />
                  <StatTile
                    icon={<Check aria-hidden />}
                    label="Kundenzeit"
                    value={formatMinutesVerbose(route.totalServiceMinutes)}
                    tone="success"
                  />
                  <StatTile
                    icon={<Clock aria-hidden />}
                    label="Wartezeit"
                    value={route.totalWaitSeconds > 0 ? formatTravelSeconds(route.totalWaitSeconds) : 'keine'}
                    tone={route.totalWaitSeconds > 20 * 60 ? 'warning' : 'default'}
                  />
                  <StatTile
                    icon={<MapPin aria-hidden />}
                    label="Distanz"
                    value={formatDistance(route.totalDistanceMeters)}
                    className={data.earningsRates ? undefined : 'col-span-2 @2xl:col-span-3'}
                  />
                  {data.earningsRates ? (
                    <StatTile
                      icon={<Wallet aria-hidden />}
                      label="Verdienst (Tag)"
                      value={formatEuroCents(
                        computeRouteEarnings({
                          serviceMinutes: route.totalServiceMinutes,
                          distanceMeters: route.totalDistanceMeters,
                          hourlyWageCents: data.earningsRates.hourlyWageCents ?? 0,
                          taxFreeBonusCentsPerHour:
                            data.earningsRates.taxFreeBonusCentsPerHour ?? 0,
                          mileageRatePerKmCents: data.earningsRates.mileageRatePerKmCents ?? 0,
                        }).totalCents,
                      )}
                      hint={
                        data.earningsRates.mileageRatePerKmCents > 0
                          ? 'inkl. Kilometergeld'
                          : 'Kundenzeit × Stundenlohn'
                      }
                      tone="success"
                      className="col-span-1 @2xl:col-span-2"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <DayRouteDialog
        open={dayDialogOpen}
        onOpenChange={setDayDialogOpen}
        timezone={timezone}
        canAccept={canAccept}
        onGenerate={generateDayRoutes}
        onAccept={acceptDayRoute}
      />
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

/** Kompaktes Steuerelement mit Mini-Beschriftung für die Routenleiste. */
function ControlField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="text-[length:var(--text-2xs)] font-medium text-[var(--color-ink-subtle)]">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Ein Stopp der geplanten Route: Reihenfolge ändern und entfernen. */
function StopRow({
  stop,
  index,
  canManage,
  pending,
  timezone,
  canMoveUp,
  canMoveDown,
  onMove,
  onRemove,
}: {
  stop: ComputedRoute['stops'][number];
  index: number;
  canManage: boolean;
  pending: boolean;
  timezone: string;
  /** false z. B. bei fixen Terminen – die sind zeitlich verankert. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (appointmentId: string) => void;
}) {
  return (
    <li className="px-3 py-2.5">
      {stop.travelSecondsFromPrevious > 0 ? (
        <p className="mb-1.5 flex items-center gap-1.5 text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
          <Car className="size-3" aria-hidden />
          {formatTravelSeconds(stop.travelSecondsFromPrevious)} ·{' '}
          {formatDistance(stop.distanceMetersFromPrevious)}
          {stop.waitSeconds > 60 ? ` · ${Math.round(stop.waitSeconds / 60)} Min. Warten` : ''}
        </p>
      ) : null}
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-[length:var(--text-2xs)] font-bold text-white"
          style={{ backgroundColor: stop.customerColor }}
          aria-hidden
        >
          {stop.sequence}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate text-[length:var(--text-sm)] font-medium">
            <span className="truncate">{stop.customerName}</span>
            {stop.isFlexible ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--color-info-soft)] px-1.5 py-px text-[length:var(--text-2xs)] font-medium text-[var(--color-info)]">
                flexibel
              </span>
            ) : (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--color-panel-sunken)] px-1.5 py-px text-[length:var(--text-2xs)] font-medium text-[var(--color-ink-muted)]"
                title="Fester Termin – Zeit und Position sind verankert"
              >
                <Lock className="size-2.5" aria-hidden /> fix
              </span>
            )}
          </span>
          <span className="block truncate text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
            {formatTime(new Date(stop.serviceStartAt), timezone)}–
            {formatTime(new Date(stop.serviceEndAt), timezone)} · {stop.addressLine}
          </span>
          {stop.warning ? (
            <span className="mt-0.5 flex items-center gap-1 text-[length:var(--text-2xs)] text-[var(--color-warning)]">
              <AlertTriangle className="size-3 shrink-0" aria-hidden /> {stop.warning}
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
              {stop.isFlexible ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Stopp nach oben"
                    disabled={!canMoveUp || pending}
                    title={!canMoveUp && index > 0 ? 'Fixe Termine können nicht übersprungen werden.' : undefined}
                    onClick={() => onMove(index, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Stopp nach unten"
                    disabled={!canMoveDown || pending}
                    title={!canMoveDown ? 'Fixe Termine können nicht übersprungen werden.' : undefined}
                    onClick={() => onMove(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                </>
              ) : (
                // Fixe Termine sind verankert – statt Pfeilen ein Schloss.
                <span
                  className="flex size-7 items-center justify-center text-[var(--color-ink-subtle)]"
                  title="Fester Termin – Reihenfolge ergibt sich aus der Uhrzeit"
                  aria-hidden
                >
                  <Lock className="size-3.5" />
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Stopp entfernen"
                className="text-[var(--color-danger)]"
                disabled={pending}
                onClick={() => onRemove(stop.appointmentId)}
              >
                <X aria-hidden />
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Ein noch nicht eingeplanter Termin: kompakt mit „+"-Knopf zum Hinzufügen. */
function AddRow({
  candidate,
  pending,
  timezone,
  onAdd,
}: {
  candidate: RouteCandidate;
  pending: boolean;
  timezone: string;
  onAdd: (appointmentId: string) => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-[var(--radius-md)] px-1.5 py-1 hover:bg-[var(--color-panel-raised)]">
      <span
        className="h-7 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: candidate.customerColor }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate text-[length:var(--text-sm)] font-medium">
          <span className="truncate">{candidate.customerName}</span>
          {candidate.isFlexible ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--color-info-soft)] px-1.5 py-px text-[length:var(--text-2xs)] font-medium text-[var(--color-info)]">
              flexibel
            </span>
          ) : (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--color-panel-sunken)] px-1.5 py-px text-[length:var(--text-2xs)] font-medium text-[var(--color-ink-muted)]"
              title="Fester Termin – Zeit steht fest"
            >
              <Lock className="size-2.5" aria-hidden /> fix
            </span>
          )}
          {!candidate.assigned ? (
            <span className="shrink-0 text-[length:var(--text-2xs)] text-[var(--color-warning)]">
              offen
            </span>
          ) : null}
        </span>
        <span className="block truncate text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
          {candidate.isFlexible
            ? `Fenster ${candidate.earliestStartAt ? formatTime(new Date(candidate.earliestStartAt), timezone) : '—'}–${candidate.latestEndAt ? formatTime(new Date(candidate.latestEndAt), timezone) : '—'}`
            : `${formatTime(new Date(candidate.startAt), timezone)}–${formatTime(new Date(candidate.endAt), timezone)}`}
          {' · '}
          {formatMinutesVerbose(candidate.durationMinutes)}
        </span>
      </span>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label={`${candidate.customerName} hinzufügen`}
        disabled={pending}
        onClick={() => onAdd(candidate.appointmentId)}
      >
        <Plus aria-hidden />
      </Button>
    </li>
  );
}

/**
 * Vorschläge aus offenen Kundenstunden – als eigener Block direkt unter der
 * Route. Angenommene Vorschläge werden zu echten Terminen und landen sofort
 * als Stopp in der Route (die Karte oben folgt).
 */
interface SuggestionListProps {
  date: string;
  hasData: boolean;
  generating: boolean;
  loading: boolean;
  suggestions: RouteSuggestionDto[] | null;
  suggestionInfo: { aiUsed: boolean } | null;
  visibleSuggestions: RouteSuggestionDto[] | null;
  declinedList: RouteSuggestionDto[];
  /** customerIds, die gerade animiert ausgeblendet werden. */
  exitingCustomerIds: Set<string>;
  canAccept: boolean;
  acceptingToken: string | null;
  timezone: string;
  onGenerate: () => void;
  onAccept: (suggestion: RouteSuggestionDto) => void;
  onDecline: (suggestion: RouteSuggestionDto) => void;
  onUndoDecline: (suggestion: RouteSuggestionDto) => void;
}

/** „Generieren"-Knopf – gleich in Panel (Desktop) und Sheet (Mobil). */
function SuggestionsGenerateButton({
  generating,
  loading,
  hasData,
  onGenerate,
}: Pick<SuggestionListProps, 'generating' | 'loading' | 'hasData' | 'onGenerate'>) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onGenerate}
      loading={generating}
      disabled={loading || !hasData}
    >
      <Sparkles aria-hidden /> Generieren
    </Button>
  );
}

/** Reiner Inhalt der Vorschläge (Skelett / Hinweis / Karten) ohne Rahmen. */
function SuggestionsBody({
  date,
  generating,
  suggestions,
  visibleSuggestions,
  declinedList,
  exitingCustomerIds,
  canAccept,
  acceptingToken,
  timezone,
  onAccept,
  onDecline,
  onUndoDecline,
}: SuggestionListProps) {
  if (generating) {
    return (
      <div className="space-y-2.5" aria-label="Vorschläge werden berechnet">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] p-4"
          >
            <Skeleton className="h-4 w-2/5 rounded-full" />
            <Skeleton className="h-3 w-3/5 rounded-full" />
            <div className="grid grid-cols-3 gap-2">
              {[...Array(3)].map((_, j) => (
                <Skeleton key={j} className="h-11 rounded-[var(--radius-md)]" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (suggestions === null) {
    return (
      <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
        Prüft Kunden mit offenen Stunden und Verfügbarkeit am {date} und schlägt Einsätze vor, die
        zur aktuellen Route passen – inklusive Auswirkung auf Fahrzeit und Arbeitstag.
      </p>
    );
  }
  if (visibleSuggestions && visibleSuggestions.length === 0 && declinedList.length === 0) {
    return (
      <EmptyState
        className="border-0"
        icon={<Check />}
        title="Keine passenden Vorschläge"
        description="Alle Kunden sind versorgt, nicht verfügbar oder würden die Route unzulässig machen."
      />
    );
  }
  return (
    <div>
      {/* Sichtbare Vorschläge: nach customerId gekeyt, damit Karten beim
          Revalidieren erhalten bleiben und nur weggefallene ausblenden. */}
      <div className="suggestion-anim-list">
        {visibleSuggestions?.map((suggestion) => (
          <div
            key={suggestion.customerId}
            className={cn(
              'suggestion-anim',
              exitingCustomerIds.has(suggestion.customerId) && 'is-exiting',
            )}
          >
            <div className="suggestion-anim__inner">
              <SuggestionCard
                suggestion={suggestion}
                timezone={timezone}
                canAccept={canAccept}
                declined={false}
                pending={acceptingToken === suggestion.token}
                onAccept={onAccept}
                onDecline={onDecline}
                onUndoDecline={onUndoDecline}
              />
            </div>
          </div>
        ))}
      </div>
      {declinedList.length > 0 ? (
        <div className="mt-2.5 space-y-2.5">
          {declinedList.map((suggestion) => (
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
        </div>
      ) : null}
      {!canAccept ? (
        <p className="mt-2.5 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
          Vorschläge können nur von der Leitung übernommen werden.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Vorschläge aus offenen Stunden. Am Desktop inline als Panel; auf dem Handy
 * hinter einem Auslöser, der ein Bottom-Sheet öffnet – so bleibt die
 * Mobilansicht schlank und die Karte oben sichtbar.
 */
function OpenHoursSuggestions(props: SuggestionListProps) {
  return (
    <>
      {/* Desktop: inline. */}
      <div className="hidden xl:block">
        <Panel data-tour="routes-suggestions">
          <PanelHeader>
            <PanelTitle>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-4 text-[var(--color-brand)]" aria-hidden />
                Vorschläge aus offenen Stunden
              </span>
            </PanelTitle>
            <div className="flex items-center gap-2">
              {props.suggestionInfo ? (
                <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                  {props.suggestionInfo.aiUsed ? 'Reihenfolge: KI' : 'Reihenfolge: regelbasiert'}
                </span>
              ) : null}
              <SuggestionsGenerateButton {...props} />
            </div>
          </PanelHeader>
          <PanelBody>
            <SuggestionsBody {...props} />
          </PanelBody>
        </Panel>
      </div>

      {/* Mobil: Bottom-Sheet. */}
      <div className="xl:hidden">
        <SuggestionsSheet {...props} />
      </div>
    </>
  );
}

/** Mobiler Auslöser + Bottom-Sheet für die Vorschläge. */
function SuggestionsSheet(props: SuggestionListProps) {
  const [open, setOpen] = React.useState(false);
  const count = props.visibleSuggestions?.length ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tour="routes-suggestions"
        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] px-4 py-3 text-left shadow-[var(--shadow-panel)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-[var(--color-brand)]" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[length:var(--text-sm)] font-medium">
              Vorschläge aus offenen Stunden
            </span>
            <span className="block text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
              {count > 0
                ? `${count} ${count === 1 ? 'Vorschlag' : 'Vorschläge'} – tippen zum Ansehen`
                : 'Einsätze aus offenen Kundenstunden finden'}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[length:var(--text-xs)] font-medium text-[var(--color-brand)]">
          {count > 0 ? count : null}
          <ChevronUp className="size-4" aria-hidden />
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Vorschläge aus offenen Stunden" wide>
          <div className="mb-3 flex items-center justify-between gap-2">
            {props.suggestionInfo ? (
              <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                {props.suggestionInfo.aiUsed ? 'Reihenfolge: KI' : 'Reihenfolge: regelbasiert'}
              </span>
            ) : (
              <span />
            )}
            <SuggestionsGenerateButton {...props} />
          </div>
          <SuggestionsBody {...props} />
        </DialogContent>
      </Dialog>
    </>
  );
}
