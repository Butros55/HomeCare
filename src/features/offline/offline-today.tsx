'use client';

import { CloudOff, MapPin, Phone, RefreshCcw } from 'lucide-react';
import * as React from 'react';

import { DataRowsSkeleton } from '@/components/layout/page-loading-skeleton';
import { Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';

interface TodayData {
  generatedAt: string;
  timezone: string;
  employeeName: string | null;
  appointments: Array<{
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    status: string;
    customer: {
      firstName: string;
      lastName: string;
      phone: string | null;
      accessInstructions: string | null;
      color: string;
    };
    locationAddress: {
      street: string;
      houseNumber: string;
      postalCode: string;
      city: string;
    } | null;
  }>;
}

export function OfflineToday() {
  const [data, setData] = React.useState<TodayData | null>(null);
  const [state, setState] = React.useState<'loading' | 'cached' | 'empty'>('loading');

  React.useEffect(() => {
    let cancelled = false;
    // Der Service Worker beantwortet das offline aus dem Cache.
    fetch('/api/my/today')
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (json?.appointments) {
          setData(json as TodayData);
          setState('cached');
        } else {
          setState('empty');
        }
      })
      .catch(() => {
        if (!cancelled) setState('empty');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-3 text-[var(--color-warning)]">
        <CloudOff className="size-5 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">Keine Internetverbindung</p>
          <p className="text-[length:var(--text-sm)]">
            Angezeigt werden die zuletzt geladenen heutigen Termine. Änderungen sind offline nicht
            möglich.
          </p>
        </div>
      </div>

      {state === 'loading' ? (
        <Panel className="overflow-hidden" role="status" aria-busy="true">
          <span className="sr-only">Gespeicherte Termine werden geladen</span>
          <PanelHeader>
            <Skeleton className="h-4 w-36 rounded-full" />
            <Skeleton className="h-3 w-20 rounded-full" />
          </PanelHeader>
          <DataRowsSkeleton rows={4} />
        </Panel>
      ) : null}

      {state === 'empty' ? (
        <Panel>
          <PanelBody>
            <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              Keine zwischengespeicherten Daten vorhanden. Bitte einmal online das Dashboard öffnen –
              danach sind die heutigen Termine auch offline verfügbar.
            </p>
          </PanelBody>
        </Panel>
      ) : null}

      {data ? (
        <Panel>
          <PanelHeader>
            <PanelTitle>
              Heutige Termine{data.employeeName ? ` · ${data.employeeName}` : ''}
            </PanelTitle>
            <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
              Stand {new Date(data.generatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </PanelHeader>
          <PanelBody className="p-0">
            {data.appointments.length === 0 ? (
              <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                Für heute sind keine Termine gespeichert.
              </p>
            ) : (
              <ol className="divide-y divide-[var(--color-line-subtle)]">
                {data.appointments.map((appointment) => (
                  <li key={appointment.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="tabular w-20 shrink-0 text-[length:var(--text-sm)] font-semibold">
                      {time(appointment.startAt)}–{time(appointment.endAt)}
                    </span>
                    <span
                      className="mt-1 h-8 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: appointment.customer.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 text-[length:var(--text-sm)]">
                      <span className="block font-medium">
                        {appointment.customer.firstName} {appointment.customer.lastName} ·{' '}
                        {appointment.title}
                      </span>
                      {appointment.locationAddress ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                          <MapPin className="size-3" aria-hidden />
                          {appointment.locationAddress.street} {appointment.locationAddress.houseNumber},{' '}
                          {appointment.locationAddress.postalCode} {appointment.locationAddress.city}
                        </span>
                      ) : null}
                      {appointment.customer.phone ? (
                        <a
                          href={`tel:${appointment.customer.phone.replace(/\s/g, '')}`}
                          className="mt-0.5 flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--color-brand)]"
                        >
                          <Phone className="size-3" aria-hidden />
                          {appointment.customer.phone}
                        </a>
                      ) : null}
                      {appointment.customer.accessInstructions ? (
                        <span className="mt-0.5 block text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                          Zugang: {appointment.customer.accessInstructions}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </PanelBody>
        </Panel>
      ) : null}

      <Button variant="primary" className="w-full" onClick={() => window.location.replace('/dashboard')}>
        <RefreshCcw aria-hidden /> Erneut verbinden
      </Button>
    </div>
  );
}
