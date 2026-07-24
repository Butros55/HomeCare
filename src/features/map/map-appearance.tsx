'use client';

import { Check, Map as MapIcon, Pencil, RotateCcw } from 'lucide-react';
import dynamic from 'next/dynamic';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Label } from '@/components/ui/input';
import { Skeleton, Switch } from '@/components/ui/misc';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import {
  DEFAULT_MAP_SETTINGS,
  MAP_STYLE_OPTIONS,
  ROUTE_COLOR_OPTIONS,
  ROUTE_WEIGHT_OPTIONS,
  useMapSettings,
} from '@/features/map/map-style';

const LeafletMap = dynamic(() => import('@/features/map/leaflet-map').then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[var(--radius-lg)]" />,
});

/** Ort für die Vorschau: Zuhause, sonst Büro, sonst Münster. */
export interface MapPreviewCenter {
  latitude: number;
  longitude: number;
  label: string;
}

const FALLBACK_CENTER: MapPreviewCenter = {
  latitude: 51.9607,
  longitude: 7.6261,
  label: 'Münster (Standard)',
};

/** Kleine Demo-Strecke um den Ort, damit Farbe/Stärke der Route sichtbar sind. */
function demoPolyline(center: MapPreviewCenter): [number, number][] {
  const { latitude, longitude } = center;
  return [
    [latitude, longitude],
    [latitude + 0.004, longitude + 0.006],
    [latitude + 0.007, longitude - 0.002],
    [latitude + 0.003, longitude - 0.009],
    [latitude, longitude],
  ];
}

function previewMarkers(center: MapPreviewCenter) {
  return [
    {
      id: 'preview-home',
      latitude: center.latitude,
      longitude: center.longitude,
      label: center.label,
      color: '#6c5ce7',
    },
  ];
}

/**
 * Karte in den Einstellungen (Darstellung): zeigt die aktuell konfigurierte
 * Darstellung live am eigenen Ort; „Bearbeiten“ öffnet das Popup mit
 * Einstellungen links und sofort aktualisierter Karte rechts.
 */
export function MapAppearanceCard({ center }: { center: MapPreviewCenter | null }) {
  const { settings } = useMapSettings();
  const [open, setOpen] = React.useState(false);
  const resolvedCenter = center ?? FALLBACK_CENTER;

  const styleLabel =
    MAP_STYLE_OPTIONS.find((option) => option.value === settings.style)?.label ?? 'Automatisch';

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          <span className="inline-flex items-center gap-1.5">
            <MapIcon className="size-4 text-[var(--color-brand)]" aria-hidden />
            Kartendarstellung
          </span>
        </PanelTitle>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> Bearbeiten
        </Button>
      </PanelHeader>
      <PanelBody className="space-y-3">
        <div className="h-56 overflow-hidden rounded-[var(--radius-lg)]">
          <LeafletMap
            markers={previewMarkers(resolvedCenter)}
            roadPath={demoPolyline(resolvedCenter)}
          />
        </div>
        <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
          Aktuell: <span className="font-medium text-[var(--color-ink)]">{styleLabel}</span>
          {' · '}Beschriftungen {settings.labels ? 'an' : 'aus'}
          {' · '}Routenlinie{' '}
          <span
            className="inline-block size-2.5 rounded-full align-middle"
            style={{ backgroundColor: settings.routeColor }}
            aria-hidden
          />
          {' – '}gilt für alle Karten und wird auf diesem Gerät gespeichert. Vorschau:{' '}
          {resolvedCenter.label}.
        </p>
      </PanelBody>

      <MapSettingsDialog open={open} onOpenChange={setOpen} center={resolvedCenter} />
    </Panel>
  );
}

/** Popup im Studio-Stil: links Einstellungen, rechts die live folgende Karte. */
function MapSettingsDialog({
  open,
  onOpenChange,
  center,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  center: MapPreviewCenter;
}) {
  const { settings, setStyle, setLabels, setRouteColor, setRouteWeight } = useMapSettings();

  const reset = () => {
    setStyle(DEFAULT_MAP_SETTINGS.style);
    setLabels(DEFAULT_MAP_SETTINGS.labels);
    setRouteColor(DEFAULT_MAP_SETTINGS.routeColor);
    setRouteWeight(DEFAULT_MAP_SETTINGS.routeWeight);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Karte anpassen"
        description="Änderungen wirken sofort auf die Vorschau – und damit auf alle Karten der Anwendung."
        wide
        className="lg:max-w-5xl"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Einstellungen links (mobil unter der Karte). */}
          <div className="order-2 space-y-4 lg:order-1 lg:col-span-2">
            <div>
              <Label>Grundkarte</Label>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Grundkarte">
                {MAP_STYLE_OPTIONS.map((option) => {
                  const active = settings.style === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setStyle(option.value)}
                      className={cn(
                        'flex flex-col items-start gap-0.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors',
                        active
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)] text-[var(--color-brand)]'
                          : 'border-[var(--color-line)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)]',
                      )}
                    >
                      <span className="inline-flex items-center gap-1 text-[length:var(--text-sm)] font-medium">
                        {active ? <Check className="size-3.5" aria-hidden /> : null}
                        {option.label}
                      </span>
                      <span className="text-[length:var(--text-2xs)] opacity-80">{option.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] px-3 py-2.5">
              <span>
                <span className="block text-[length:var(--text-sm)] font-medium">
                  Beschriftungen
                </span>
                <span className="block text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                  Orts- und Straßennamen auf der Karte
                </span>
              </span>
              <Switch checked={settings.labels} onCheckedChange={(value) => setLabels(value === true)} />
            </label>

            <div>
              <Label>Farbe der Routenlinie</Label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Routenfarbe">
                {ROUTE_COLOR_OPTIONS.map((option) => {
                  const active = settings.routeColor.toLowerCase() === option.value.toLowerCase();
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      title={option.label}
                      aria-label={option.label}
                      onClick={() => setRouteColor(option.value)}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-full border-2 transition-transform',
                        active
                          ? 'scale-110 border-[var(--color-ink)]'
                          : 'border-transparent hover:scale-105',
                      )}
                      style={{ backgroundColor: option.value }}
                    >
                      {active ? <Check className="size-4 text-white" aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>Stärke der Routenlinie</Label>
              <div className="flex gap-2" role="radiogroup" aria-label="Routenstärke">
                {ROUTE_WEIGHT_OPTIONS.map((option) => {
                  const active = settings.routeWeight === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setRouteWeight(option.value)}
                      className={cn(
                        'flex-1 rounded-[var(--radius-md)] border px-3 py-2 transition-colors',
                        active
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)]'
                          : 'border-[var(--color-line)] hover:border-[var(--color-line-strong)]',
                      )}
                    >
                      <span
                        className="mx-auto block rounded-full"
                        style={{
                          height: `${option.weight}px`,
                          width: '70%',
                          backgroundColor: settings.routeColor,
                        }}
                        aria-hidden
                      />
                      <span className="mt-1.5 block text-center text-[length:var(--text-2xs)] text-[var(--color-ink-muted)]">
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw aria-hidden /> Zurücksetzen
              </Button>
              <Button variant="primary" size="sm" onClick={() => onOpenChange(false)}>
                <Check aria-hidden /> Fertig
              </Button>
            </div>
          </div>

          {/* Live-Vorschau rechts (mobil oben) – folgt jeder Änderung sofort,
              weil die Karte dieselben gespeicherten Einstellungen liest. */}
          <div className="order-1 lg:order-2 lg:col-span-3">
            <div className="h-56 overflow-hidden rounded-[var(--radius-lg)] sm:h-72 lg:h-full lg:min-h-[26rem]">
              <LeafletMap markers={previewMarkers(center)} roadPath={demoPolyline(center)} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
