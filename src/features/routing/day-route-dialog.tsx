'use client';

import {
  Car,
  Check,
  ChevronLeft,
  Clock,
  Home,
  Lock,
  MapPin,
  Navigation,
  Sparkles,
  Wallet,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Label, FieldHint } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState } from '@/components/ui/panel';
import { formatTime } from '@/lib/dates';
import { formatMinutesVerbose } from '@/lib/duration';
import { formatEuroCents } from '@/lib/earnings';
import { formatDistance, formatTravelSeconds } from '@/lib/geo';
import { cn } from '@/lib/utils';
import type { DayRouteVariantDto, GenerateDayRoutesResult } from '@/server/services/day-route-service';

const LeafletMap = dynamic(() => import('@/features/map/leaflet-map').then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[var(--radius-md)]" />,
});

export interface DayRouteFormValues {
  targetWorkMinutes: number | null;
  earliestDepartureMinute: number | null;
  latestReturnMinute: number | null;
}

/** "HH:mm" → Minuten seit Mitternacht (null bei leer/ungültig). */
function timeInputToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Stunden-Eingabe („6" oder „6,5") → Minuten (null bei leer/ungültig). */
function hoursInputToMinutes(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const hours = Number(normalized);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 16) return null;
  return Math.round(hours * 60);
}

export function DayRouteDialog({
  open,
  onOpenChange,
  timezone,
  canAccept,
  onGenerate,
  onAccept,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  /** Nur die Leitung darf generierte Routen übernehmen. */
  canAccept: boolean;
  onGenerate: (form: DayRouteFormValues) => Promise<GenerateDayRoutesResult | null>;
  onAccept: (token: string) => Promise<boolean>;
}) {
  const [hours, setHours] = React.useState('');
  const [departure, setDeparture] = React.useState('');
  const [homeBy, setHomeBy] = React.useState('');

  const [generating, setGenerating] = React.useState(false);
  const [result, setResult] = React.useState<GenerateDayRoutesResult | null>(null);
  const [acceptingToken, setAcceptingToken] = React.useState<string | null>(null);

  // Beim Öffnen zurücksetzen – ein neuer Lauf startet immer beim Formular.
  // (Zustand während des Renderns anpassen statt im Effekt – kein Re-Render-Kaskade.)
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setResult(null);
      setAcceptingToken(null);
      setGenerating(false);
    }
  }

  const generate = async () => {
    setGenerating(true);
    setResult(null);
    try {
      const form: DayRouteFormValues = {
        targetWorkMinutes: hoursInputToMinutes(hours),
        earliestDepartureMinute: timeInputToMinutes(departure),
        latestReturnMinute: timeInputToMinutes(homeBy),
      };
      const data = await onGenerate(form);
      setResult(data);
    } finally {
      setGenerating(false);
    }
  };

  const accept = async (token: string) => {
    setAcceptingToken(token);
    try {
      const ok = await onAccept(token);
      if (ok) onOpenChange(false);
    } finally {
      setAcceptingToken(null);
    }
  };

  const showForm = !result && !generating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Tag automatisch planen"
        description="Baut aus festen und flexiblen Terminen sowie offenen Kundenstunden komplette Tagesrouten – wähle die beste aus."
        wide
      >
        {showForm ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="day-target-hours">Zielarbeitszeit</Label>
                <div className="relative">
                  <Input
                    id="day-target-hours"
                    inputMode="decimal"
                    placeholder="z. B. 6"
                    value={hours}
                    onChange={(event) => setHours(event.target.value)}
                    className="pr-12"
                  />
                  <span
                    className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]"
                    aria-hidden
                  >
                    Std.
                  </span>
                </div>
              </div>
              <div>
                <Label htmlFor="day-departure">Abfahrt frühestens</Label>
                <Input
                  id="day-departure"
                  type="time"
                  value={departure}
                  onChange={(event) => setDeparture(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="day-home-by">Zuhause spätestens</Label>
                <Input
                  id="day-home-by"
                  type="time"
                  value={homeBy}
                  onChange={(event) => setHomeBy(event.target.value)}
                />
              </div>
            </div>
            <FieldHint>
              Alle Angaben sind optional. Feste Termine bleiben unverändert, flexible werden neu
              eingeplant und passende offene Kundenstunden aufgefüllt.
            </FieldHint>
            <div className="flex justify-end">
              <Button variant="primary" onClick={generate} loading={generating}>
                <Sparkles aria-hidden /> Routen generieren
              </Button>
            </div>
          </div>
        ) : generating ? (
          <div className="space-y-3" aria-label="Routen werden berechnet">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] p-3"
              >
                <Skeleton className="mb-3 h-4 w-40 rounded-full" />
                <Skeleton className="h-40 rounded-[var(--radius-md)]" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                {result && result.variants.length > 0
                  ? `${result.variants.length} ${result.variants.length === 1 ? 'Vorschlag' : 'Vorschläge'} – wähle eine Route zum Übernehmen.`
                  : 'Keine passende Route gefunden.'}
              </p>
              <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
                <ChevronLeft aria-hidden /> Vorgaben ändern
              </Button>
            </div>

            {!result || result.variants.length === 0 ? (
              <EmptyState
                icon={<Navigation />}
                title="Keine Route möglich"
                description={
                  result?.message ??
                  'Für diesen Tag ließ sich keine zulässige Route bilden. Lockere die Vorgaben oder prüfe offene Kundenstunden.'
                }
              />
            ) : (
              <div className="space-y-3">
                {result.variants.map((variant, index) => (
                  <VariantCard
                    key={variant.token}
                    variant={variant}
                    origin={result.origin}
                    recommended={index === 0}
                    timezone={timezone}
                    canAccept={canAccept}
                    accepting={acceptingToken === variant.token}
                    disabled={acceptingToken !== null && acceptingToken !== variant.token}
                    onAccept={() => accept(variant.token)}
                  />
                ))}
                {!canAccept ? (
                  <p className="text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                    Routen übernehmen kann nur die Leitung – die Vorschläge sind für dich zur
                    Ansicht.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VariantCard({
  variant,
  origin,
  recommended,
  timezone,
  canAccept,
  accepting,
  disabled,
  onAccept,
}: {
  variant: DayRouteVariantDto;
  origin: { latitude: number; longitude: number; label: string };
  recommended: boolean;
  timezone: string;
  canAccept: boolean;
  accepting: boolean;
  disabled: boolean;
  onAccept: () => void;
}) {
  const markers = [
    {
      id: 'start',
      latitude: origin.latitude,
      longitude: origin.longitude,
      label: origin.label,
      color: '#1b1f36',
    },
    ...variant.stops.map((stop) => ({
      id: `${stop.sequence}-${stop.customerName}`,
      latitude: stop.latitude,
      longitude: stop.longitude,
      label: stop.customerName,
      color: stop.customerColor,
      sequence: stop.sequence,
    })),
  ];
  const polyline: [number, number][] = [
    [origin.latitude, origin.longitude],
    ...variant.stops.map((stop) => [stop.latitude, stop.longitude] as [number, number]),
    ...(variant.returnArrivalAt ? [[origin.latitude, origin.longitude] as [number, number]] : []),
  ];

  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border bg-[var(--color-panel)] p-3',
        recommended ? 'border-[var(--color-brand)]' : 'border-[var(--color-line)]',
      )}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[length:var(--text-sm)] font-semibold">{variant.label}</span>
          {recommended ? (
            <span className="rounded-full bg-[var(--color-brand-subtle)] px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-[var(--color-brand)]">
              Empfohlen
            </span>
          ) : null}
          {!variant.feasible ? (
            <span className="rounded-full bg-[var(--color-warning-soft)] px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-[var(--color-warning)]">
              Mit Hinweisen
            </span>
          ) : null}
        </div>
        <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
          {variant.stops.length} {variant.stops.length === 1 ? 'Stopp' : 'Stopps'}
          {variant.newVisitCount > 0 ? ` · ${variant.newVisitCount} neu` : ''}
        </span>
      </div>

      {/* Desktop: kleine Karte links, Kennzahlen rechts. Mobil gestapelt. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="h-40 overflow-hidden rounded-[var(--radius-md)] sm:h-44">
          <LeafletMap markers={markers} polyline={polyline} />
        </div>
        <div className="grid grid-cols-2 gap-2 self-start">
          <MiniStat icon={<Navigation aria-hidden />} label="Abfahrt" value={formatTime(new Date(variant.departureAt), timezone)} />
          <MiniStat
            icon={<Home aria-hidden />}
            label="Rückkehr"
            value={variant.returnArrivalAt ? formatTime(new Date(variant.returnArrivalAt), timezone) : '—'}
          />
          <MiniStat icon={<Car aria-hidden />} label="Fahrtzeit" value={formatTravelSeconds(variant.totalTravelSeconds)} />
          <MiniStat icon={<MapPin aria-hidden />} label="Distanz" value={formatDistance(variant.totalDistanceMeters)} />
          <MiniStat
            icon={<Check aria-hidden />}
            label="Kundenzeit"
            value={formatMinutesVerbose(variant.totalServiceMinutes)}
            tone="success"
          />
          {variant.earnings ? (
            <MiniStat
              icon={<Wallet aria-hidden />}
              label="Verdienst"
              value={formatEuroCents(variant.earnings.totalCents)}
              tone="success"
            />
          ) : (
            <MiniStat
              icon={<Clock aria-hidden />}
              label="Wartezeit"
              value={variant.totalWaitSeconds > 0 ? formatTravelSeconds(variant.totalWaitSeconds) : 'keine'}
            />
          )}
        </div>
      </div>

      {/* Stoppfolge mit klarer Kennzeichnung: fix / flexibel / neu. */}
      <ol className="mt-2.5 space-y-1">
        {variant.stops.map((stop) => (
          <li key={stop.sequence} className="flex items-center gap-2 text-[length:var(--text-xs)]">
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-[length:var(--text-2xs)] font-bold text-white"
              style={{ backgroundColor: stop.customerColor }}
              aria-hidden
            >
              {stop.sequence}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{stop.customerName}</span>
            <span className="shrink-0 text-[var(--color-ink-subtle)]">
              {formatTime(new Date(stop.serviceStartAt), timezone)}–
              {formatTime(new Date(stop.serviceEndAt), timezone)}
            </span>
            {stop.kind === 'new' ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--color-brand-subtle)] px-1.5 py-px text-[length:var(--text-2xs)] font-medium text-[var(--color-brand)]">
                neu
              </span>
            ) : stop.isFlexible ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--color-info-soft)] px-1.5 py-px text-[length:var(--text-2xs)] font-medium text-[var(--color-info)]">
                flexibel
              </span>
            ) : (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--color-panel-sunken)] px-1.5 py-px text-[length:var(--text-2xs)] font-medium text-[var(--color-ink-muted)]"
                title="Fester Termin – Zeit bleibt unverändert"
              >
                <Lock className="size-2.5" aria-hidden /> fix
              </span>
            )}
          </li>
        ))}
      </ol>

      {variant.warnings.length > 0 ? (
        <p className="mt-2 text-[length:var(--text-2xs)] text-[var(--color-warning)]">
          {variant.warnings[0]}
          {variant.warnings.length > 1 ? ` (+${variant.warnings.length - 1})` : ''}
        </p>
      ) : null}

      {canAccept ? (
        <div className="mt-3 flex justify-end">
          <Button
            variant={recommended ? 'primary' : 'secondary'}
            size="sm"
            onClick={onAccept}
            loading={accepting}
            disabled={disabled || !variant.feasible}
            title={!variant.feasible ? 'Route mit Hinweisen kann nicht übernommen werden.' : undefined}
          >
            <Check aria-hidden /> Diese Route übernehmen
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'success';
}) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-2.5 py-1.5">
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-subtle)] text-[var(--color-brand)] [&_svg]:size-3.5"
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">{label}</span>
        <span
          className="block truncate text-[length:var(--text-sm)] font-semibold"
          style={{ color: tone === 'success' ? 'var(--color-success)' : 'var(--color-ink)' }}
        >
          {value}
        </span>
      </span>
    </div>
  );
}
