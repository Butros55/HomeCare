'use client';

import { AlertTriangle, Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { FieldError, FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMinutesAsHours } from '@/lib/duration';
import { parseDurationInput } from '@/lib/duration';
import {
  allocateHoursAction,
  getAllocationContextAction,
} from '@/server/actions/hours-actions';
import type { AllocationContext } from '@/server/services/allocation-service';

/**
 * Stundenzuweisung (Anforderung 11): Dialog mit Budgetübersicht,
 * Mitarbeiterhierarchie, Zielstunden-Anzeige, Live-Parser („2,5“ → 150 min)
 * und Bestätigungsschritt mit Vorher/Nachher-Verteilung.
 */
export function AllocateHoursButton({
  customerId,
  label = 'Stunden zuweisen',
  icon,
  variant = 'primary',
  size = 'md',
  preselectedEmployeeId,
}: {
  customerId: string;
  label?: string;
  icon?: 'clock';
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  preselectedEmployeeId?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {icon === 'clock' ? <Clock aria-hidden /> : null}
        {label}
      </Button>
      {open ? (
        <AllocateHoursDialog
          customerId={customerId}
          open={open}
          onOpenChange={setOpen}
          preselectedEmployeeId={preselectedEmployeeId}
        />
      ) : null}
    </>
  );
}

export function AllocateHoursDialog({
  customerId,
  open,
  onOpenChange,
  preselectedEmployeeId,
}: {
  customerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedEmployeeId?: string;
}) {
  const router = useRouter();
  const [context, setContext] = React.useState<AllocationContext | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [step, setStep] = React.useState<'form' | 'confirm'>('form');
  const [budgetId, setBudgetId] = React.useState('');
  const [employeeId, setEmployeeId] = React.useState(preselectedEmployeeId ?? '');
  const [durationText, setDurationText] = React.useState('');
  const [note, setNote] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  // Der Dialog wird je Öffnung frisch gemountet – loading startet auf true.
  React.useEffect(() => {
    let cancelled = false;
    getAllocationContextAction(customerId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setContext(result.data);
        const firstWithBudget =
          result.data.budgets.find((b) => b.availableMinutes > 0) ?? result.data.budgets[0];
        if (firstWithBudget) setBudgetId(firstWithBudget.id);
      } else {
        toast.error(result.message);
        onOpenChange(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, onOpenChange]);

  const budget = context?.budgets.find((b) => b.id === budgetId) ?? null;
  const recipient = context?.recipients.find((r) => r.id === employeeId) ?? null;
  const parsed = parseDurationInput(durationText);
  const minutes = parsed.ok ? parsed.minutes : null;

  const overBudget = budget !== null && minutes !== null && minutes > budget.availableMinutes;
  const remainingAfter =
    budget !== null && minutes !== null ? budget.availableMinutes - minutes : null;

  const budgetLabel = (b: AllocationContext['budgets'][number]) =>
    `${new Date(b.periodStart).toLocaleDateString('de-DE')} – ${new Date(b.periodEnd).toLocaleDateString('de-DE')} · ${formatMinutesAsHours(b.availableMinutes)} verfügbar`;

  const submit = () => {
    if (!minutes || !budget || !recipient) return;
    startTransition(async () => {
      const result = await allocateHoursAction({
        customerId,
        budgetId: budget.id,
        toEmployeeId: recipient.id,
        minutes,
        note: note || undefined,
      });
      if (result.ok) {
        toast.success(`${formatMinutesAsHours(minutes)} an ${recipient.name} übertragen.`);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.message);
        setStep('form');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={step === 'form' ? 'Stunden zuweisen' : 'Zuweisung bestätigen'}
        description={context ? `Kunde: ${context.customer.name}` : undefined}
        wide
      >
        {loading || !context ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : context.budgets.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Für diesen Kunden gibt es noch kein Stundenbudget im aktuellen Zeitraum. Lege zuerst
            unter „Stunden“ ein Budget an.
          </p>
        ) : step === 'form' ? (
          <div className="space-y-4">
            {context.mode === 'pool' ? (
              <p className="rounded-[var(--radius-md)] bg-[var(--color-info-soft)] px-3 py-2 text-[length:var(--text-xs)] text-[var(--color-info)]">
                Du gibst Stunden aus deinem eigenen Pool an dein Team weiter.
              </p>
            ) : null}

            <div>
              <Label htmlFor="alloc-budget" required>
                Budgetzeitraum
              </Label>
              <Select value={budgetId} onValueChange={setBudgetId}>
                <SelectTrigger id="alloc-budget">
                  <SelectValue placeholder="Budget wählen" />
                </SelectTrigger>
                <SelectContent>
                  {context.budgets.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {budgetLabel(b)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {budget ? (
                <FieldHint>
                  Gesamt {formatMinutesAsHours(budget.totalMinutes)} ·{' '}
                  {formatMinutesAsHours(budget.availableMinutes)}{' '}
                  {context.mode === 'pool' ? 'in deinem Pool' : 'noch nicht zugewiesen'}
                </FieldHint>
              ) : null}
            </div>

            <div>
              <Label htmlFor="alloc-employee" required>
                Mitarbeiter
              </Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger id="alloc-employee">
                  <SelectValue placeholder="Mitarbeiter wählen" />
                </SelectTrigger>
                <SelectContent>
                  {context.recipients.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {' '.repeat(r.depth * 2)}
                      {r.name}
                      {r.missingMonthMinutes > 0
                        ? ` · fehlen ${formatMinutesAsHours(r.missingMonthMinutes)}`
                        : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {recipient ? (
                <div className="mt-2 grid grid-cols-3 gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-2.5 text-center">
                  <div>
                    <div className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Ziel (Monat)</div>
                    <div className="tabular text-[length:var(--text-sm)] font-semibold">
                      {recipient.targetMonthMinutes != null
                        ? formatMinutesAsHours(recipient.targetMonthMinutes)
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Erhalten</div>
                    <div className="tabular text-[length:var(--text-sm)] font-semibold">
                      {formatMinutesAsHours(recipient.receivedMonthMinutes)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Fehlend</div>
                    <div
                      className="tabular text-[length:var(--text-sm)] font-semibold"
                      style={{
                        color:
                          recipient.missingMonthMinutes > 0
                            ? 'var(--color-warning)'
                            : 'var(--color-success)',
                      }}
                    >
                      {formatMinutesAsHours(recipient.missingMonthMinutes)}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <Label htmlFor="alloc-duration" required>
                Stunden
              </Label>
              <Input
                id="alloc-duration"
                value={durationText}
                onChange={(event) => setDurationText(event.target.value)}
                placeholder='z. B. "2,5", "2:30" oder "150 Minuten"'
                invalid={durationText.length > 0 && !parsed.ok}
                autoComplete="off"
              />
              {durationText.length > 0 && !parsed.ok ? (
                <FieldError>
                  {parsed.error === 'TOO_LARGE'
                    ? 'Diese Menge ist unrealistisch groß.'
                    : 'Eingabe nicht erkannt – z. B. „2,5“, „2:30“ oder „150 Minuten“.'}
                </FieldError>
              ) : minutes !== null ? (
                <FieldHint>
                  = {minutes} Minuten ({formatMinutesAsHours(minutes)})
                  {remainingAfter !== null && !overBudget
                    ? ` · danach verfügbar: ${formatMinutesAsHours(remainingAfter)}`
                    : ''}
                </FieldHint>
              ) : (
                <FieldHint>Eingaben wie „2“, „2,5“, „2:30“ oder „150 Minuten“ sind möglich.</FieldHint>
              )}
            </div>

            {overBudget && budget ? (
              <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-danger)]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                Nur noch {formatMinutesAsHours(budget.availableMinutes)} verfügbar. Eine Überziehung
                ist nur über eine Korrekturbuchung des Budgets möglich.
              </p>
            ) : null}

            <div>
              <Label htmlFor="alloc-note">Notiz (optional)</Label>
              <Textarea
                id="alloc-note"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Abbrechen
              </Button>
              <Button
                variant="primary"
                disabled={!minutes || !budget || !recipient || overBudget}
                onClick={() => setStep('confirm')}
              >
                Weiter zur Bestätigung
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <ConfirmSummary
              context={context}
              budgetId={budgetId}
              recipientName={recipient?.name ?? ''}
              recipientId={recipient?.id ?? ''}
              minutes={minutes ?? 0}
              remainingAfter={remainingAfter ?? 0}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep('form')} disabled={pending}>
                Zurück
              </Button>
              <Button variant="primary" loading={pending} onClick={submit}>
                Stunden übertragen
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmSummary({
  context,
  budgetId,
  recipientName,
  recipientId,
  minutes,
  remainingAfter,
}: {
  context: AllocationContext;
  budgetId: string;
  recipientName: string;
  recipientId: string;
  minutes: number;
  remainingAfter: number;
}) {
  const existing = context.currentAllocations.filter((a) => a.budgetId === budgetId);
  const recipient = context.recipients.find((r) => r.id === recipientId);
  const missingAfter = recipient
    ? Math.max(0, recipient.missingMonthMinutes - minutes)
    : null;

  return (
    <div className="space-y-3 text-[length:var(--text-sm)]">
      <div>
        <h3 className="mb-1 text-[length:var(--text-xs)] font-semibold text-[var(--color-ink-subtle)] uppercase">
          Bisherige Verteilung
        </h3>
        {existing.length === 0 ? (
          <p className="text-[var(--color-ink-muted)]">Noch keine Zuweisungen in diesem Budget.</p>
        ) : (
          <ul className="space-y-1">
            {existing.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span>
                  {a.toName}
                  {a.byName ? (
                    <span className="text-[var(--color-ink-subtle)]"> · von {a.byName}</span>
                  ) : null}
                </span>
                <span className="tabular">{formatMinutesAsHours(a.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-[var(--radius-md)] bg-[var(--color-brand-subtle)] p-3">
        <h3 className="mb-1 text-[length:var(--text-xs)] font-semibold text-[var(--color-brand)] uppercase">
          Neue Zuweisung
        </h3>
        <div className="flex justify-between gap-3 font-medium">
          <span>{recipientName}</span>
          <span className="tabular">{formatMinutesAsHours(minutes)}</span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-2.5 text-center">
          <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">Danach verfügbar</dt>
          <dd className="tabular font-semibold">{formatMinutesAsHours(remainingAfter)}</dd>
        </div>
        <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-2.5 text-center">
          <dt className="text-[10px] text-[var(--color-ink-subtle)] uppercase">
            Fehlende Zielstunden danach
          </dt>
          <dd className="tabular font-semibold">
            {missingAfter != null ? formatMinutesAsHours(missingAfter) : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}
