'use client';

import { Car, Check, Clock, MapPin, RotateCcw, Sparkles, Undo2, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/dates';
import { formatMinutesVerbose } from '@/lib/duration';
import { formatDistance } from '@/lib/geo';
import type { RouteSuggestionDto } from '@/server/services/route-suggestion-service';

/** Sekunden → vorzeichenbehaftete Minutenangabe ("+12 Min.", "±0 Min."). */
function signedMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return '±0 Min.';
  return `${minutes > 0 ? '+' : '−'}${Math.abs(minutes)} Min.`;
}

function DeltaTile({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-2.5 py-1.5">
      <p className="text-[length:var(--text-2xs)] tracking-wide text-[var(--color-ink-subtle)] uppercase">
        {label}
      </p>
      <p
        className={`text-[length:var(--text-sm)] font-medium ${
          tone === 'warn' ? 'text-[var(--color-warning)]' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Vorschlagskarte: neuer Einsatz mit allen Auswirkungen auf die aktuelle Route.
 * „Ablehnen" gilt nur für den aktuellen Generierungslauf und ist umkehrbar.
 */
export function SuggestionCard({
  suggestion,
  timezone,
  canAccept,
  declined,
  pending,
  onAccept,
  onDecline,
  onUndoDecline,
}: {
  suggestion: RouteSuggestionDto;
  timezone: string;
  canAccept: boolean;
  declined: boolean;
  pending: boolean;
  onAccept: (suggestion: RouteSuggestionDto) => void;
  onDecline: (suggestion: RouteSuggestionDto) => void;
  onUndoDecline: (suggestion: RouteSuggestionDto) => void;
}) {
  const { impact } = suggestion;

  if (declined) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line)] px-4 py-2.5 text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]">
        <span className="min-w-0 truncate">
          Vorschlag für {suggestion.customerName} abgelehnt (nur für diesen Lauf).
        </span>
        <Button variant="ghost" size="sm" onClick={() => onUndoDecline(suggestion)}>
          <Undo2 aria-hidden /> Rückgängig
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="mt-0.5 h-9 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: suggestion.customerColor }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="truncate text-[length:var(--text-sm)] font-semibold">
              {suggestion.customerName}
              {suggestion.isPreferredEmployee ? (
                <span className="ml-1.5 text-[length:var(--text-2xs)] font-medium text-[var(--color-info)]">
                  Wunschmitarbeiter
                </span>
              ) : null}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden />
                {formatTime(new Date(suggestion.startAt), timezone)}–
                {formatTime(new Date(suggestion.endAt), timezone)} ·{' '}
                {formatMinutesVerbose(suggestion.durationMinutes)}
              </span>
              {suggestion.addressLine ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{suggestion.addressLine}</span>
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--color-brand-subtle)] px-2.5 py-1 text-[length:var(--text-2xs)] font-medium text-[var(--color-brand)]">
          {formatMinutesVerbose(suggestion.openMinutes)} offen
        </span>
      </div>

      <p className="flex items-start gap-1.5 text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
        {suggestion.aiRanked ? (
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--color-brand)]" aria-hidden />
        ) : null}
        <span>
          {suggestion.reason}
          {suggestion.insertAfterLabel
            ? ` · Einfügeposition: Stopp ${suggestion.position} (nach ${suggestion.insertAfterLabel})`
            : ` · Einfügeposition: Stopp ${suggestion.position}`}
          {suggestion.needsAllocation
            ? ' · beim Übernehmen wird die Stundenzuweisung automatisch angelegt'
            : ''}
        </span>
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <DeltaTile
          label="Fahrzeit"
          value={signedMinutes(impact.extraTravelSeconds)}
          tone={impact.extraTravelSeconds > 15 * 60 ? 'warn' : undefined}
        />
        <DeltaTile label="Distanz" value={`+${formatDistance(Math.max(0, impact.extraDistanceMeters))}`} />
        <DeltaTile
          label="Wartezeit"
          value={signedMinutes(impact.extraWaitSeconds)}
          tone={impact.extraWaitSeconds > 20 * 60 ? 'warn' : undefined}
        />
        <DeltaTile label="Arbeitstag" value={signedMinutes(impact.workdayDeltaSeconds)} />
        <DeltaTile
          label="Neue Abfahrt"
          value={formatTime(new Date(impact.departureAt), timezone)}
        />
        <DeltaTile
          label="Neue Rückkehr"
          value={impact.returnAt ? formatTime(new Date(impact.returnAt), timezone) : '—'}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
          {impact.previousDepartureAt ? (
            <span className="inline-flex items-center gap-1">
              <Car className="size-3" aria-hidden />
              Bisher: Abfahrt {formatTime(new Date(impact.previousDepartureAt), timezone)}
              {impact.previousReturnAt
                ? ` · Rückkehr ${formatTime(new Date(impact.previousReturnAt), timezone)}`
                : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <RotateCcw className="size-3" aria-hidden />
              Bisher keine Route an diesem Tag
            </span>
          )}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => onDecline(suggestion)}
          >
            <X aria-hidden /> Ablehnen
          </Button>
          {canAccept ? (
            <Button
              variant="primary"
              size="sm"
              loading={pending}
              onClick={() => onAccept(suggestion)}
            >
              <Check aria-hidden /> Termin übernehmen
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
