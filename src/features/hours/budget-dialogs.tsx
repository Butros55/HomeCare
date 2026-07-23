'use client';

import { Plus, Scale } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { DurationInput } from '@/components/ui/duration-input';
import { Input, Label, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMinutesAsHours } from '@/lib/duration';
import { adjustBudgetAction, createBudgetAction } from '@/server/actions/budget-actions';

/** Neues Stundenbudget für einen Kunden anlegen. */
export function CreateBudgetButton({
  customerId,
  defaultPeriodStart,
  defaultPeriodEnd,
}: {
  customerId: string;
  defaultPeriodStart: string;
  defaultPeriodEnd: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [periodStart, setPeriodStart] = React.useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = React.useState(defaultPeriodEnd);
  const [minutes, setMinutes] = React.useState<number | null>(null);
  const [sourceType, setSourceType] = React.useState<'CONTRACT' | 'INSURANCE' | 'PRIVATE' | 'OTHER'>(
    'CONTRACT',
  );
  const [note, setNote] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    if (!minutes) return;
    startTransition(async () => {
      const result = await createBudgetAction({
        customerId,
        periodStart,
        periodEnd,
        budgetMinutes: minutes,
        sourceType,
        note: note || undefined,
      });
      if (result.ok) {
        toast.success('Stundenbudget angelegt.');
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Budget anlegen
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Stundenbudget anlegen" description="Gebuchte Stunden des Kunden für einen Zeitraum.">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="nb-start" required>
                  Von
                </Label>
                <Input
                  id="nb-start"
                  type="date"
                  value={periodStart}
                  onChange={(event) => setPeriodStart(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="nb-end" required>
                  Bis (einschließlich)
                </Label>
                <Input
                  id="nb-end"
                  type="date"
                  value={periodEnd}
                  onChange={(event) => setPeriodEnd(event.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="nb-minutes" required>
                Stunden
              </Label>
              <DurationInput id="nb-minutes" value={minutes} onChange={setMinutes} placeholder='z. B. „12“ oder „12:30“' />
            </div>
            <div>
              <Label htmlFor="nb-source">Quelle</Label>
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as typeof sourceType)}>
                <SelectTrigger id="nb-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONTRACT">Vertrag</SelectItem>
                  <SelectItem value="INSURANCE">Kasse/Versicherung</SelectItem>
                  <SelectItem value="PRIVATE">Privat</SelectItem>
                  <SelectItem value="OTHER">Sonstiges</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="nb-note">Notiz</Label>
              <Textarea id="nb-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={!minutes || !periodStart || !periodEnd}>
              Budget anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Bewusste Korrekturbuchung (+/−) mit Pflicht-Begründung. */
export function AdjustBudgetButton({
  budgetId,
  customerId,
  budgetLabel,
}: {
  budgetId: string;
  customerId: string;
  budgetLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [direction, setDirection] = React.useState<'plus' | 'minus'>('plus');
  const [minutes, setMinutes] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    if (!minutes || !reason.trim()) return;
    startTransition(async () => {
      const result = await adjustBudgetAction({
        budgetId,
        customerId,
        adjustmentMinutes: direction === 'plus' ? minutes : -minutes,
        reason,
      });
      if (result.ok) {
        toast.success(
          `Budget ${direction === 'plus' ? 'um' : 'um −'}${formatMinutesAsHours(minutes)} korrigiert.`,
        );
        setOpen(false);
        setMinutes(null);
        setReason('');
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Scale aria-hidden /> Korrektur
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Korrekturbuchung"
          description={`${budgetLabel} – bewusste Auf- oder Abwertung mit Begründung.`}
        >
          <div className="space-y-4">
            <div>
              <Label>Richtung</Label>
              <div className="flex gap-2" role="radiogroup" aria-label="Korrekturrichtung">
                <Button
                  type="button"
                  variant={direction === 'plus' ? 'primary' : 'secondary'}
                  size="sm"
                  role="radio"
                  aria-checked={direction === 'plus'}
                  onClick={() => setDirection('plus')}
                >
                  + Aufstocken
                </Button>
                <Button
                  type="button"
                  variant={direction === 'minus' ? 'danger' : 'secondary'}
                  size="sm"
                  role="radio"
                  aria-checked={direction === 'minus'}
                  onClick={() => setDirection('minus')}
                >
                  − Kürzen
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="adj-minutes" required>
                Stunden
              </Label>
              <DurationInput id="adj-minutes" value={minutes} onChange={setMinutes} />
            </div>
            <div>
              <Label htmlFor="adj-reason" required>
                Begründung
              </Label>
              <Textarea
                id="adj-reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="z. B. Zusätzlicher Bedarf nach Krankenhausaufenthalt"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button
              variant={direction === 'minus' ? 'danger' : 'primary'}
              onClick={submit}
              loading={pending}
              disabled={!minutes || !reason.trim()}
            >
              Korrektur buchen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
