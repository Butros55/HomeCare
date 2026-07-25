'use client';

import dynamic from 'next/dynamic';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Skeleton, Switch } from '@/components/ui/misc';
import { formatDistance } from '@/lib/geo';
import { updateEmployeeCoverageAction } from '@/server/actions/employee-actions';

const LeafletMap = dynamic(() => import('@/features/map/leaflet-map').then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[var(--radius-lg)]" />,
});

interface Point {
  latitude: number;
  longitude: number;
}

/**
 * Zuständigkeitsgebiet eines Mitarbeiters: Umkreis (km) um ein Zentrum
 * (Zuhause-Adresse oder manuelle Adresse), auf einer Karte dargestellt.
 * Leitung bearbeitet, der Mitarbeiter sieht es nur (readOnly).
 */
export function CoverageEditor({
  employeeId,
  readOnly,
  initial,
  homePoint,
  homeLine,
  centerPoint,
}: {
  employeeId: string;
  readOnly: boolean;
  initial: {
    radiusKm: number | null;
    useHome: boolean;
    center: { street: string; houseNumber: string; postalCode: string; city: string } | null;
  };
  homePoint: Point | null;
  homeLine: string | null;
  centerPoint: Point | null;
}) {
  const [limited, setLimited] = React.useState(initial.radiusKm != null);
  const [radiusKm, setRadiusKm] = React.useState(initial.radiusKm ?? 15);
  const [useHome, setUseHome] = React.useState(initial.useHome);
  const [street, setStreet] = React.useState(initial.center?.street ?? '');
  const [houseNumber, setHouseNumber] = React.useState(initial.center?.houseNumber ?? '');
  const [postalCode, setPostalCode] = React.useState(initial.center?.postalCode ?? '');
  const [city, setCity] = React.useState(initial.center?.city ?? '');
  const [pending, startTransition] = React.useTransition();

  const effectiveCenter = useHome ? homePoint : centerPoint;
  const showCircle = limited && effectiveCenter;

  const markers = effectiveCenter
    ? [
        {
          id: 'center',
          latitude: effectiveCenter.latitude,
          longitude: effectiveCenter.longitude,
          label: 'Zentrum',
          subtitle: useHome ? (homeLine ?? 'Zuhause') : 'Zuständigkeitszentrum',
          color: '#6c5ce7',
        },
      ]
    : [];

  const save = () => {
    if (!useHome) {
      const touched = street || houseNumber || postalCode || city;
      if (touched && !(street && houseNumber && postalCode && city)) {
        toast.error('Bitte das Zentrum vollständig ausfüllen oder Zuhause verwenden.');
        return;
      }
    }
    startTransition(async () => {
      const result = await updateEmployeeCoverageAction({
        employeeId,
        radiusKm: limited ? radiusKm : null,
        useHome,
        center:
          !useHome && street && houseNumber && postalCode && city
            ? { street, houseNumber, postalCode, city }
            : null,
      });
      if (result.ok) {
        toast.success(
          result.data.geocoded || useHome || !limited
            ? 'Zuständigkeitsgebiet gespeichert.'
            : 'Gespeichert – Zentrum konnte nicht geokodiert werden (Karte bleibt leer).',
        );
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4">
        {readOnly ? (
          <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-3 text-[length:var(--text-sm)]">
            {limited ? (
              <>
                Umkreis <strong>{radiusKm} km</strong> um{' '}
                {useHome ? 'die Zuhause-Adresse' : 'ein festgelegtes Zentrum'}.
              </>
            ) : (
              <>Kein Umkreis festgelegt – der Mitarbeiter ist für alle Kunden zuständig.</>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Umkreis begrenzen</Label>
                <FieldHint>
                  Aus = keine Begrenzung. Ein = nur Kunden im gewählten Radius vorschlagen/planen.
                </FieldHint>
              </div>
              <Switch checked={limited} onCheckedChange={setLimited} aria-label="Umkreis begrenzen" />
            </div>

            {limited ? (
              <>
                <div>
                  <Label htmlFor="cov-radius">Umkreis (km)</Label>
                  <div className="flex items-center gap-3">
                    <input
                      id="cov-radius"
                      type="range"
                      min={1}
                      max={100}
                      value={radiusKm}
                      onChange={(e) => setRadiusKm(Number(e.target.value))}
                      className="flex-1 accent-[var(--color-brand)]"
                    />
                    <Input
                      type="number"
                      min={1}
                      max={300}
                      value={radiusKm}
                      onChange={(e) => setRadiusKm(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>Zentrum = Zuhause-Adresse</Label>
                    <FieldHint>
                      Aus = eigenes Zentrum unten festlegen (z. B. Standort/Büro).
                    </FieldHint>
                  </div>
                  <Switch checked={useHome} onCheckedChange={setUseHome} aria-label="Zuhause als Zentrum" />
                </div>

                {useHome ? (
                  <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-3 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                    {homePoint
                      ? `Zentrum: ${homeLine ?? 'Zuhause-Adresse'}`
                      : 'Keine Zuhause-Adresse mit Koordinaten hinterlegt – bitte im Profil pflegen oder eigenes Zentrum verwenden.'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-[1fr_auto] gap-3">
                      <div>
                        <Label htmlFor="cov-street">Straße</Label>
                        <Input id="cov-street" value={street} onChange={(e) => setStreet(e.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor="cov-house">Nr.</Label>
                        <Input id="cov-house" value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} className="w-24" />
                      </div>
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-3">
                      <div>
                        <Label htmlFor="cov-zip">PLZ</Label>
                        <Input id="cov-zip" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="w-28" inputMode="numeric" />
                      </div>
                      <div>
                        <Label htmlFor="cov-city">Ort</Label>
                        <Input id="cov-city" value={city} onChange={(e) => setCity(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : null}

            <div className="flex justify-end">
              <Button variant="primary" onClick={save} loading={pending}>
                Zuständigkeit speichern
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="h-72 overflow-hidden rounded-[var(--radius-lg)] lg:h-full lg:min-h-72">
        {effectiveCenter ? (
          <LeafletMap
            markers={markers}
            circle={
              showCircle
                ? {
                    latitude: effectiveCenter.latitude,
                    longitude: effectiveCenter.longitude,
                    radiusMeters: radiusKm * 1000,
                  }
                : undefined
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-panel-sunken)] p-4 text-center text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Kein Zentrum mit Koordinaten – {useHome ? 'Zuhause-Adresse' : 'Zentrum-Adresse'} speichern,
            um das Gebiet {limited ? `(${formatDistance(radiusKm * 1000)})` : ''} anzuzeigen.
          </div>
        )}
      </div>
    </div>
  );
}
