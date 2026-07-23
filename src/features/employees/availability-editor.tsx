'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { replaceAvailabilityAction } from '@/server/actions/employee-actions';

const WEEKDAYS = [
  { value: 1, label: 'Montag' },
  { value: 2, label: 'Dienstag' },
  { value: 3, label: 'Mittwoch' },
  { value: 4, label: 'Donnerstag' },
  { value: 5, label: 'Freitag' },
  { value: 6, label: 'Samstag' },
  { value: 7, label: 'Sonntag' },
];

interface Slot {
  key: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

/** Wochenverfügbarkeit: Zeitfenster je Wochentag hinzufügen/entfernen/speichern. */
export function AvailabilityEditor({
  employeeId,
  initialSlots,
  readOnly,
}: {
  employeeId: string;
  initialSlots: { weekday: number; startTime: string; endTime: string }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [slots, setSlots] = React.useState<Slot[]>(
    initialSlots.map((slot, index) => ({ ...slot, key: `initial-${index}` })),
  );
  const [pending, startTransition] = React.useTransition();

  const addSlot = () => {
    setSlots((current) => [
      ...current,
      { key: `new-${Date.now()}-${current.length}`, weekday: 1, startTime: '08:00', endTime: '12:00' },
    ]);
  };

  const updateSlot = (key: string, patch: Partial<Slot>) => {
    setSlots((current) => current.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)));
  };

  const removeSlot = (key: string) => {
    setSlots((current) => current.filter((slot) => slot.key !== key));
  };

  const save = () => {
    startTransition(async () => {
      const invalid = slots.some((slot) => slot.startTime >= slot.endTime);
      if (invalid) {
        toast.error('Jedes Zeitfenster braucht ein Ende nach dem Beginn.');
        return;
      }
      const result = await replaceAvailabilityAction({
        employeeId,
        slots: slots.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
      });
      if (result.ok) {
        toast.success('Verfügbarkeit gespeichert.');
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  const sorted = [...slots].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));

  return (
    <div className="space-y-3">
      {sorted.length === 0 ? (
        <p className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
          Keine Verfügbarkeit hinterlegt – der Mitarbeiter gilt als uneingeschränkt verfügbar
          (alle Tage und Zeiten). Zeitfenster begrenzen Planung und Terminvorschläge.
        </p>
      ) : null}

      <ul className="space-y-2">
        {sorted.map((slot) => (
          <li key={slot.key} className="flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-2.5">
            <div className="min-w-36 flex-1">
              <Label htmlFor={`day-${slot.key}`}>Wochentag</Label>
              <Select
                value={String(slot.weekday)}
                onValueChange={(value) => updateSlot(slot.key, { weekday: Number(value) })}
                disabled={readOnly}
              >
                <SelectTrigger id={`day-${slot.key}`}>
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
              <Label htmlFor={`start-${slot.key}`}>Von</Label>
              <Input
                id={`start-${slot.key}`}
                type="time"
                value={slot.startTime}
                onChange={(event) => updateSlot(slot.key, { startTime: event.target.value })}
                disabled={readOnly}
                className="w-28"
              />
            </div>
            <div>
              <Label htmlFor={`end-${slot.key}`}>Bis</Label>
              <Input
                id={`end-${slot.key}`}
                type="time"
                value={slot.endTime}
                onChange={(event) => updateSlot(slot.key, { endTime: event.target.value })}
                disabled={readOnly}
                className="w-28"
              />
            </div>
            {!readOnly ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeSlot(slot.key)}
                aria-label="Zeitfenster entfernen"
                className="text-[var(--color-danger)]"
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {!readOnly ? (
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={addSlot}>
            <Plus aria-hidden /> Zeitfenster hinzufügen
          </Button>
          <Button variant="primary" size="sm" onClick={save} loading={pending}>
            Verfügbarkeit speichern
          </Button>
        </div>
      ) : null}
    </div>
  );
}
