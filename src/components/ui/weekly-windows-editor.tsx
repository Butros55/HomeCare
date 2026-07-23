'use client';

import { Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface WeeklyWindowSlot {
  weekday: number;
  startTime: string;
  endTime: string;
}

const WEEKDAYS = [
  { value: 1, label: 'Montag' },
  { value: 2, label: 'Dienstag' },
  { value: 3, label: 'Mittwoch' },
  { value: 4, label: 'Donnerstag' },
  { value: 5, label: 'Freitag' },
  { value: 6, label: 'Samstag' },
  { value: 7, label: 'Sonntag' },
];

interface KeyedSlot extends WeeklyWindowSlot {
  key: string;
}

/**
 * Wiederverwendbarer Wochenzeitfenster-Editor: Zeitfenster je Wochentag
 * hinzufügen/ändern/entfernen. Initialisiert sich einmalig aus `value` und
 * meldet jede Änderung über `onChange` (unkontrollierte Zeilen-Keys, damit
 * Eingabefelder beim Entfernen stabil bleiben). Wird für Kunden-
 * Verfügbarkeiten genutzt; bei Bedarf per anderem `key` zurücksetzen.
 */
export function WeeklyWindowsEditor({
  value,
  onChange,
  emptyHint,
  idPrefix,
  disabled,
}: {
  value: WeeklyWindowSlot[];
  onChange: (slots: WeeklyWindowSlot[]) => void;
  /** Hinweistext, wenn keine Fenster gepflegt sind. */
  emptyHint: string;
  idPrefix: string;
  disabled?: boolean;
}) {
  const [slots, setSlots] = React.useState<KeyedSlot[]>(() =>
    value.map((slot, index) => ({ ...slot, key: `${idPrefix}-initial-${index}` })),
  );

  const apply = (next: KeyedSlot[]) => {
    setSlots(next);
    onChange(next.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })));
  };

  const update = (key: string, patch: Partial<WeeklyWindowSlot>) => {
    apply(slots.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)));
  };

  const remove = (key: string) => {
    apply(slots.filter((slot) => slot.key !== key));
  };

  const add = () => {
    apply([
      ...slots,
      {
        key: `${idPrefix}-new-${Date.now()}-${slots.length}`,
        weekday: 1,
        startTime: '08:00',
        endTime: '12:00',
      },
    ]);
  };

  return (
    <div className="space-y-2">
      {slots.length === 0 ? (
        <p className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
          {emptyHint}
        </p>
      ) : null}

      <ul className="space-y-2">
        {slots.map((slot) => (
          <li
            key={slot.key}
            className="flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-2.5"
          >
            <div className="min-w-36 flex-1">
              <Label htmlFor={`${slot.key}-day`}>Wochentag</Label>
              <Select
                value={String(slot.weekday)}
                onValueChange={(v) => update(slot.key, { weekday: Number(v) })}
                disabled={disabled}
              >
                <SelectTrigger id={`${slot.key}-day`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((day) => (
                    <SelectItem key={day.value} value={String(day.value)}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${slot.key}-start`}>Von</Label>
              <Input
                id={`${slot.key}-start`}
                type="time"
                value={slot.startTime}
                onChange={(e) => update(slot.key, { startTime: e.target.value })}
                disabled={disabled}
                className="w-28"
              />
            </div>
            <div>
              <Label htmlFor={`${slot.key}-end`}>Bis</Label>
              <Input
                id={`${slot.key}-end`}
                type="time"
                value={slot.endTime}
                onChange={(e) => update(slot.key, { endTime: e.target.value })}
                disabled={disabled}
                className="w-28"
              />
            </div>
            {!disabled ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(slot.key)}
                aria-label="Zeitfenster entfernen"
                className="text-[var(--color-danger)]"
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {!disabled ? (
        <Button type="button" variant="secondary" size="sm" onClick={add}>
          <Plus aria-hidden /> Zeitfenster hinzufügen
        </Button>
      ) : null}
    </div>
  );
}
