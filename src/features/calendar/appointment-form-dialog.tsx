'use client';

import { AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { DurationInput } from '@/components/ui/duration-input';
import { FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  createAppointmentAction,
  updateAppointmentAction,
  type AppointmentFormValues,
} from '@/server/actions/appointment-actions';

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mo' },
  { value: 2, label: 'Di' },
  { value: 3, label: 'Mi' },
  { value: 4, label: 'Do' },
  { value: 5, label: 'Fr' },
  { value: 6, label: 'Sa' },
  { value: 7, label: 'So' },
];

export interface AppointmentEditRecurrence {
  frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY_DATE' | 'MONTHLY_WEEKDAY';
  weekdays: number[];
  endMode: 'never' | 'date' | 'count';
  endDate: string;
  count: number;
}

export interface AppointmentEditTarget {
  appointmentId: string;
  isSeriesMember: boolean;
  /** Aktuelle Wiederholung der Serie (zum Bearbeiten des Rhythmus). */
  recurrence?: AppointmentEditRecurrence | null;
  values: {
    title: string;
    description: string;
    assignedEmployeeId: string;
    date: string;
    startTime: string;
    durationMinutes: number;
    status: 'DRAFT' | 'PLANNED' | 'CONFIRMED';
    isFlexible: boolean;
    earliestTime: string;
    latestTime: string;
    routeRelevant: boolean;
    internalNotes: string;
  };
}

/**
 * Terminformular (Anforderung 12): Einzeltermin oder Serie, flexible Fenster,
 * Konflikt-Bestätigungsschritt; beim Bearbeiten von Serienterminen Auswahl
 * „nur dieser / dieser und folgende / ganze Serie“.
 */
export function AppointmentFormDialog({
  open,
  onOpenChange,
  customers,
  employees,
  prefill,
  editTarget,
  fixedEmployeeId,
  soloMode = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: { id: string; name: string }[];
  employees: { id: string; name: string }[];
  prefill?: { customerId?: string; date?: string; startTime?: string; series?: boolean };
  editTarget?: AppointmentEditTarget;
  /**
   * Reduziertes UI (Solo/Mitarbeiter): Termine werden automatisch dem eigenen
   * Profil zugewiesen – das Mitarbeiter-Feld entfällt komplett.
   */
  fixedEmployeeId?: string | null;
  /** Alleine-Modus: nur die für eine schnelle Terminpflege nötigen Felder. */
  soloMode?: boolean;
}) {
  const router = useRouter();
  const isEdit = Boolean(editTarget);
  const [pending, startTransition] = React.useTransition();

  const today = new Date().toISOString().slice(0, 10);
  const [customerId, setCustomerId] = React.useState(prefill?.customerId ?? '');
  const [employeeId, setEmployeeId] = React.useState(
    editTarget?.values.assignedEmployeeId || fixedEmployeeId || '',
  );
  const [title, setTitle] = React.useState(editTarget?.values.title ?? 'Hauswirtschaftlicher Einsatz');
  const [description, setDescription] = React.useState(editTarget?.values.description ?? '');
  const [date, setDate] = React.useState(editTarget?.values.date ?? prefill?.date ?? today);
  const [startTime, setStartTime] = React.useState(
    editTarget?.values.startTime ?? prefill?.startTime ?? '09:00',
  );
  const [durationMinutes, setDurationMinutes] = React.useState<number | null>(
    editTarget?.values.durationMinutes ?? 120,
  );
  const [status, setStatus] = React.useState<'DRAFT' | 'PLANNED' | 'CONFIRMED'>(
    editTarget?.values.status ?? 'PLANNED',
  );
  const [isFlexible, setIsFlexible] = React.useState(editTarget?.values.isFlexible ?? false);
  const [earliestTime, setEarliestTime] = React.useState(editTarget?.values.earliestTime ?? '');
  const [latestTime, setLatestTime] = React.useState(editTarget?.values.latestTime ?? '');
  const [routeRelevant, setRouteRelevant] = React.useState(
    editTarget?.values.routeRelevant ?? true,
  );
  const [internalNotes, setInternalNotes] = React.useState(editTarget?.values.internalNotes ?? '');

  // Wiederholung: beim Anlegen frei wählbar; beim Bearbeiten aus der Serie
  // vorbelegt (der Rhythmus lässt sich für die ganze Serie ändern).
  const editRec = editTarget?.recurrence ?? null;
  const [recurrenceEnabled, setRecurrenceEnabled] = React.useState(prefill?.series ?? false);
  const [frequency, setFrequency] = React.useState<
    'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY_DATE' | 'MONTHLY_WEEKDAY'
  >(editRec?.frequency ?? 'WEEKLY');
  const [weekdays, setWeekdays] = React.useState<number[]>(editRec?.weekdays ?? []);
  const [endMode, setEndMode] = React.useState<'never' | 'date' | 'count'>(
    editRec?.endMode ?? 'never',
  );
  const [endDate, setEndDate] = React.useState(editRec?.endDate ?? '');
  const [count, setCount] = React.useState(editRec?.count ?? 10);

  // Serien-Bearbeitungsumfang.
  const [scope, setScope] = React.useState<'single' | 'following' | 'all'>('single');

  // Rhythmus lässt sich bei „Ganze Serie“ und „Dieser und folgende“ ändern –
  // beide planen künftige Termine. „Nur dieser Termin“ ändert die Serie nicht.
  const showRecurrenceEditor = isEdit
    ? Boolean(editTarget?.isSeriesMember) && (scope === 'all' || scope === 'following')
    : true;

  // Konflikt-Bestätigung (WARNING: „trotzdem speichern?").
  const [conflicts, setConflicts] = React.useState<{ message: string; severity: string }[] | null>(
    null,
  );
  // Harte Fehler (ERROR): Speichern nicht möglich – Gründe werden gelistet.
  const [blockingErrors, setBlockingErrors] = React.useState<string[] | null>(null);

  const buildValues = (): AppointmentFormValues => ({
    customerId,
    assignedEmployeeId: employeeId,
    title,
    description,
    date,
    startTime,
    durationMinutes: durationMinutes ?? 0,
    status: soloMode ? 'PLANNED' : status,
    isFlexible,
    earliestTime: isFlexible ? earliestTime : '',
    latestTime: isFlexible ? latestTime : '',
    routeRelevant,
    internalNotes,
    recurrence:
      !isEdit && recurrenceEnabled
        ? {
            enabled: true,
            frequency,
            weekdays: weekdays.length > 0 ? weekdays : undefined,
            endMode,
            endDate: endMode === 'date' && endDate ? endDate : undefined,
            count: endMode === 'count' ? count : undefined,
          }
        : undefined,
  });

  // Geänderter Rhythmus für „Ganze Serie“.
  const buildRecurrenceEdit = () =>
    showRecurrenceEditor && isEdit
      ? {
          frequency,
          weekdays: weekdays.length > 0 ? weekdays : undefined,
          endMode,
          endDate: endMode === 'date' && endDate ? endDate : undefined,
          count: endMode === 'count' ? count : undefined,
        }
      : undefined;

  const submit = (confirmed: boolean) => {
    startTransition(async () => {
      const values = buildValues();
      const result = editTarget
        ? await updateAppointmentAction(
            editTarget.appointmentId,
            {
              title: values.title,
              description: values.description,
              assignedEmployeeId: values.assignedEmployeeId,
              date: values.date,
              startTime: values.startTime,
              durationMinutes: values.durationMinutes,
              ...(!soloMode ? { status: values.status } : {}),
              isFlexible: values.isFlexible,
              earliestTime: values.earliestTime,
              latestTime: values.latestTime,
              routeRelevant: values.routeRelevant,
              internalNotes: values.internalNotes,
              recurrence: buildRecurrenceEdit(),
            },
            editTarget.isSeriesMember ? scope : 'single',
            confirmed,
          )
        : await createAppointmentAction(values, confirmed);

      if (!result.ok) {
        const details = result.details as
          | { conflicts?: { message: string; severity: string }[] }
          | undefined;
        const allConflicts = details?.conflicts ?? [];
        const errors = allConflicts.filter((conflict) => conflict.severity === 'ERROR');
        const warnings = allConflicts.filter((conflict) => conflict.severity === 'WARNING');

        // Harte Konflikte → Speichern nicht möglich, Gründe klar auflisten.
        if (errors.length > 0) {
          setConflicts(null);
          setBlockingErrors(errors.map((conflict) => conflict.message));
          return;
        }
        // Nur Warnungen → Bestätigungsschritt „trotzdem speichern".
        if (warnings.length > 0) {
          setBlockingErrors(null);
          setConflicts(warnings);
          return;
        }
        // Sonstige Fehler (Validierung, Berechtigung …): Grund immer anzeigen.
        setBlockingErrors([result.message]);
        toast.error(result.message);
        return;
      }
      setBlockingErrors(null);
      if (result.data.requiresConfirmation) {
        setConflicts(result.data.conflicts);
        return;
      }
      toast.success(
        isEdit
          ? 'Termin gespeichert.'
          : recurrenceEnabled
            ? 'Serientermin angelegt.'
            : 'Termin angelegt.',
      );
      onOpenChange(false);
      router.refresh();
    });
  };

  const valid =
    (isEdit || customerId) && title.trim() && date && startTime && (durationMinutes ?? 0) >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? 'Termin bearbeiten' : 'Termin anlegen'}
        description={
          isEdit && editTarget?.isSeriesMember
            ? 'Dieser Termin gehört zu einer Serie.'
            : undefined
        }
        wide
      >
        {blockingErrors ? (
          <div className="space-y-4">
            <p className="text-[length:var(--text-sm)] font-medium text-[var(--color-danger)]">
              Der Termin konnte nicht gespeichert werden:
            </p>
            <ul className="space-y-1.5">
              {blockingErrors.map((message, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-danger)]"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {message}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="primary" onClick={() => setBlockingErrors(null)} disabled={pending}>
                Zurück zum Formular
              </Button>
            </DialogFooter>
          </div>
        ) : conflicts ? (
          <div className="space-y-4">
            <p className="text-[length:var(--text-sm)] font-medium">
              Es gibt Warnungen – trotzdem speichern?
            </p>
            <ul className="space-y-1.5">
              {conflicts.map((conflict, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-warning-soft)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-warning)]"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {conflict.message}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConflicts(null)} disabled={pending}>
                Zurück
              </Button>
              <Button variant="primary" loading={pending} onClick={() => submit(true)}>
                Trotzdem speichern
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {isEdit && editTarget?.isSeriesMember ? (
              <div>
                <Label>Änderungsumfang</Label>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Änderungsumfang">
                  {(
                    [
                      ['single', 'Nur dieser Termin'],
                      ['following', 'Dieser und folgende'],
                      ['all', 'Ganze Serie'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={scope === value}
                      onClick={() => setScope(value)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-[length:var(--text-sm)] transition-colors',
                        scope === value
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)] font-medium text-[var(--color-brand)]'
                          : 'border-[var(--color-line)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)]',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-tour="appointment-form-basics">
              {!isEdit ? (
                <div>
                  <Label htmlFor="af-customer" required>
                    Kunde
                  </Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger id="af-customer">
                      <SelectValue placeholder="Kunde wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {!fixedEmployeeId && !soloMode ? (
                <div>
                  <Label htmlFor="af-employee">Mitarbeiter</Label>
                  <Select
                    value={employeeId || 'NONE'}
                    onValueChange={(v) => setEmployeeId(v === 'NONE' ? '' : v)}
                  >
                    <SelectTrigger id="af-employee">
                      <SelectValue placeholder="Noch offen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Noch offen (nicht zugewiesen)</SelectItem>
                      {employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div>
                <Label htmlFor="af-title" required>
                  Titel
                </Label>
                <Input id="af-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              {!soloMode ? (
                <div>
                  <Label htmlFor="af-status">Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                    <SelectTrigger id="af-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Entwurf</SelectItem>
                      <SelectItem value="PLANNED">Geplant</SelectItem>
                      <SelectItem value="CONFIRMED">Bestätigt</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div data-tour="appointment-form-when">
                <Label htmlFor="af-date" required>
                  Datum
                </Label>
                <Input id="af-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="af-time" required>
                    Startzeit
                  </Label>
                  <Input
                    id="af-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="af-duration" required>
                    Dauer
                  </Label>
                  <DurationInput
                    id="af-duration"
                    value={durationMinutes}
                    onChange={setDurationMinutes}
                    allowEmpty={false}
                    placeholder="z. B. „2“"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="af-description">Beschreibung</Label>
              <Textarea
                id="af-description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {!soloMode ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2.5">
                  <span className="text-[length:var(--text-sm)]">
                    <span className="block font-medium">Flexibler Termin</span>
                    <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                      Kann in der Routenplanung verschoben werden.
                    </span>
                  </span>
                  <Switch checked={isFlexible} onCheckedChange={setIsFlexible} />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2.5">
                  <span className="text-[length:var(--text-sm)]">
                    <span className="block font-medium">Routenrelevant</span>
                    <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                      Wird in Tagesrouten eingeplant.
                    </span>
                  </span>
                  <Switch checked={routeRelevant} onCheckedChange={setRouteRelevant} />
                </label>
              </div>
            ) : null}

            {!soloMode && isFlexible ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="af-earliest">Frühester Start</Label>
                  <Input
                    id="af-earliest"
                    type="time"
                    value={earliestTime}
                    onChange={(e) => setEarliestTime(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="af-latest">Spätestes Ende</Label>
                  <Input
                    id="af-latest"
                    type="time"
                    value={latestTime}
                    onChange={(e) => setLatestTime(e.target.value)}
                  />
                </div>
              </div>
            ) : null}

            {showRecurrenceEditor ? (
              <div
                className="rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] p-3"
                data-tour="appointment-form-recurrence"
              >
                {!isEdit ? (
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-[length:var(--text-sm)] font-medium">Wiederholung</span>
                    <Switch checked={recurrenceEnabled} onCheckedChange={setRecurrenceEnabled} />
                  </label>
                ) : (
                  <div>
                    <span className="block text-[length:var(--text-sm)] font-medium">
                      Wiederholung der Serie
                    </span>
                    <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                      Änderungen gelten für alle künftigen Termine der Serie.
                    </span>
                  </div>
                )}
                {recurrenceEnabled || isEdit ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="af-freq">Rhythmus</Label>
                        <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
                          <SelectTrigger id="af-freq">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DAILY">Täglich</SelectItem>
                            <SelectItem value="WEEKLY">Wöchentlich</SelectItem>
                            <SelectItem value="BIWEEKLY">Alle zwei Wochen</SelectItem>
                            <SelectItem value="MONTHLY_DATE">Monatlich am gleichen Datum</SelectItem>
                            <SelectItem value="MONTHLY_WEEKDAY">Monatlich am gleichen Wochentag</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="af-endmode">Ende</Label>
                        <Select value={endMode} onValueChange={(v) => setEndMode(v as typeof endMode)}>
                          <SelectTrigger id="af-endmode">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="never">Ohne festes Ende</SelectItem>
                            <SelectItem value="date">Am Datum</SelectItem>
                            <SelectItem value="count">Nach Anzahl</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {(frequency === 'WEEKLY' || frequency === 'BIWEEKLY') ? (
                      <div>
                        <Label>Wochentage</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAY_OPTIONS.map((day) => {
                            const active = weekdays.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                type="button"
                                aria-pressed={active}
                                onClick={() =>
                                  setWeekdays((current) =>
                                    active
                                      ? current.filter((v) => v !== day.value)
                                      : [...current, day.value],
                                  )
                                }
                                className={cn(
                                  'size-9 pointer-coarse:size-11 rounded-full border text-[length:var(--text-sm)] transition-colors',
                                  active
                                    ? 'border-[var(--color-brand)] bg-[var(--color-brand)] font-medium text-white'
                                    : 'border-[var(--color-line)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)]',
                                )}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                        <FieldHint>Leer = Wochentag des Startdatums.</FieldHint>
                      </div>
                    ) : null}
                    {endMode === 'date' ? (
                      <div>
                        <Label htmlFor="af-enddate">Enddatum (einschließlich)</Label>
                        <Input
                          id="af-enddate"
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </div>
                    ) : null}
                    {endMode === 'count' ? (
                      <div>
                        <Label htmlFor="af-count">Anzahl Termine</Label>
                        <Input
                          id="af-count"
                          type="number"
                          min={1}
                          max={500}
                          value={count}
                          onChange={(e) => setCount(Number(e.target.value))}
                          className="w-28"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {!soloMode ? (
              <div>
                <Label htmlFor="af-notes">Interne Notiz</Label>
                <Textarea
                  id="af-notes"
                  rows={2}
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                />
              </div>
            ) : null}

            <DialogFooter data-tour="appointment-form-actions">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                Abbrechen
              </Button>
              <Button variant="primary" loading={pending} disabled={!valid} onClick={() => submit(false)}>
                {isEdit ? 'Speichern' : recurrenceEnabled ? 'Serie anlegen' : 'Termin anlegen'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
