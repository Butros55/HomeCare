'use client';

import { Pause, Pencil, Play, Plus, RefreshCcw, Scale } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { DurationInput } from '@/components/ui/duration-input';
import { FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMinutesAsHours } from '@/lib/duration';
import {
  createCorrectionAction,
  createRecurringGrantAction,
  createTopupAction,
  setGrantActiveAction,
  updateRecurringGrantAction,
} from '@/server/actions/account-actions';
import type { RecurringGrantDto } from '@/server/services/account-service';

/**
 * Stundenkonto-Dialoge: einmalige Aufladung, Korrekturbuchung (±) und
 * wiederkehrende Aufladungsregeln (anlegen, bearbeiten, pausieren).
 */

/** Einmalige Aufladung des Stundenkontos. */
export function TopupButton({
  customerId,
  defaultDate,
}: {
  customerId: string;
  /** Heutiges Datum (YYYY-MM-DD, Org-Zeitzone) als Vorbelegung. */
  defaultDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [minutes, setMinutes] = React.useState<number | null>(null);
  const [effectiveOn, setEffectiveOn] = React.useState(defaultDate);
  const [note, setNote] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    if (!minutes) return;
    startTransition(async () => {
      const result = await createTopupAction({
        customerId,
        minutes,
        effectiveOn: effectiveOn || undefined,
        note: note || undefined,
      });
      if (result.ok) {
        toast.success(`${formatMinutesAsHours(minutes)} aufgeladen.`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Aufladen
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Stunden aufladen"
          description="Einmalige Gutschrift auf dem Stundenkonto des Kunden."
        >
          <div className="space-y-4">
            <div>
              <Label htmlFor="topup-minutes" required>
                Stunden
              </Label>
              <DurationInput
                id="topup-minutes"
                value={minutes}
                onChange={setMinutes}
                placeholder='z. B. „8“ oder „8:30“'
              />
            </div>
            <div>
              <Label htmlFor="topup-date">Buchungsdatum</Label>
              <Input
                id="topup-date"
                type="date"
                value={effectiveOn}
                onChange={(event) => setEffectiveOn(event.target.value)}
              />
              <FieldHint>Ein Datum in der Zukunft merkt die Gutschrift vor.</FieldHint>
            </div>
            <div>
              <Label htmlFor="topup-note">Notiz</Label>
              <Textarea
                id="topup-note"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={!minutes}>
              Aufladen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Bewusste Korrekturbuchung (±) mit Pflicht-Begründung. */
export function CorrectionButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [direction, setDirection] = React.useState<'add' | 'remove'>('add');
  const [minutes, setMinutes] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    if (!minutes || !reason.trim()) return;
    startTransition(async () => {
      const result = await createCorrectionAction({
        customerId,
        minutes: direction === 'add' ? minutes : -minutes,
        reason: reason.trim(),
      });
      if (result.ok) {
        toast.success('Korrektur gebucht.');
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
        <Scale aria-hidden /> Korrektur
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Korrekturbuchung"
          description="Bewusste Auf- oder Abwertung des Stundenkontos mit Begründung."
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="corr-direction">Richtung</Label>
                <Select
                  value={direction}
                  onValueChange={(value) => setDirection(value as 'add' | 'remove')}
                >
                  <SelectTrigger id="corr-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add">Gutschrift (+)</SelectItem>
                    <SelectItem value="remove">Abzug (−)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="corr-minutes" required>
                  Stunden
                </Label>
                <DurationInput
                  id="corr-minutes"
                  value={minutes}
                  onChange={setMinutes}
                  placeholder='z. B. „2“ oder „2:30“'
                />
              </div>
            </div>
            <div>
              <Label htmlFor="corr-reason" required>
                Begründung
              </Label>
              <Textarea
                id="corr-reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
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

// ---------------------------------------------------------------------------
// Wiederkehrende Aufladung
// ---------------------------------------------------------------------------

function GrantFormFields(props: {
  idPrefix: string;
  minutes: number | null;
  setMinutes: (v: number | null) => void;
  intervalCount: string;
  setIntervalCount: (v: string) => void;
  intervalUnit: 'WEEK' | 'MONTH';
  setIntervalUnit: (v: 'WEEK' | 'MONTH') => void;
  startDate?: string;
  setStartDate?: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
}) {
  const p = props.idPrefix;
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={`${p}-minutes`} required>
          Stunden je Aufladung
        </Label>
        <DurationInput
          id={`${p}-minutes`}
          value={props.minutes}
          onChange={props.setMinutes}
          placeholder='z. B. „8“ oder „8:30“'
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${p}-count`} required>
            Alle …
          </Label>
          <Input
            id={`${p}-count`}
            type="number"
            min={1}
            max={24}
            value={props.intervalCount}
            onChange={(event) => props.setIntervalCount(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${p}-unit`}>Einheit</Label>
          <Select
            value={props.intervalUnit}
            onValueChange={(value) => props.setIntervalUnit(value as 'WEEK' | 'MONTH')}
          >
            <SelectTrigger id={`${p}-unit`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="WEEK">Woche(n)</SelectItem>
              <SelectItem value="MONTH">Monat(e)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {props.setStartDate ? (
          <div>
            <Label htmlFor={`${p}-start`} required>
              Erste Aufladung
            </Label>
            <Input
              id={`${p}-start`}
              type="date"
              value={props.startDate}
              onChange={(event) => props.setStartDate!(event.target.value)}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor={`${p}-end`}>Ende (optional)</Label>
          <Input
            id={`${p}-end`}
            type="date"
            value={props.endDate}
            onChange={(event) => props.setEndDate(event.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor={`${p}-note`}>Notiz</Label>
        <Textarea
          id={`${p}-note`}
          rows={2}
          value={props.note}
          onChange={(event) => props.setNote(event.target.value)}
          placeholder="z. B. Entlastungsbetrag §45b"
        />
      </div>
    </div>
  );
}

/** Neue wiederkehrende Aufladung anlegen. */
export function CreateRecurringGrantButton({
  customerId,
  defaultStartDate,
}: {
  customerId: string;
  defaultStartDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [minutes, setMinutes] = React.useState<number | null>(null);
  const [intervalCount, setIntervalCount] = React.useState('1');
  const [intervalUnit, setIntervalUnit] = React.useState<'WEEK' | 'MONTH'>('MONTH');
  const [startDate, setStartDate] = React.useState(defaultStartDate);
  const [endDate, setEndDate] = React.useState('');
  const [note, setNote] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  const parsedCount = Number.parseInt(intervalCount, 10);
  const valid = Boolean(minutes && startDate && Number.isInteger(parsedCount) && parsedCount >= 1);

  const submit = () => {
    if (!valid || !minutes) return;
    startTransition(async () => {
      const result = await createRecurringGrantAction({
        customerId,
        minutes,
        intervalUnit,
        intervalCount: parsedCount,
        startDate,
        endDate: endDate || undefined,
        note: note || undefined,
      });
      if (result.ok) {
        toast.success('Wiederkehrende Aufladung angelegt.');
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
        <RefreshCcw aria-hidden /> Wiederkehrend
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Wiederkehrende Aufladung"
          description="Lädt das Stundenkonto in festem Rhythmus automatisch auf."
        >
          <GrantFormFields
            idPrefix="grant-new"
            minutes={minutes}
            setMinutes={setMinutes}
            intervalCount={intervalCount}
            setIntervalCount={setIntervalCount}
            intervalUnit={intervalUnit}
            setIntervalUnit={setIntervalUnit}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            note={note}
            setNote={setNote}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={!valid}>
              Regel anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Bestehende Regel bearbeiten (wirkt nur auf zukünftige Aufladungen). */
export function EditRecurringGrantButton({
  customerId,
  grant,
}: {
  customerId: string;
  grant: RecurringGrantDto;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [minutes, setMinutes] = React.useState<number | null>(grant.minutes);
  const [intervalCount, setIntervalCount] = React.useState(String(grant.intervalCount));
  const [intervalUnit, setIntervalUnit] = React.useState<'WEEK' | 'MONTH'>(grant.intervalUnit);
  const [endDate, setEndDate] = React.useState(
    grant.endDateIso ? grant.endDateIso.slice(0, 10) : '',
  );
  const [note, setNote] = React.useState(grant.note ?? '');
  const [pending, startTransition] = React.useTransition();

  const parsedCount = Number.parseInt(intervalCount, 10);
  const valid = Boolean(minutes && Number.isInteger(parsedCount) && parsedCount >= 1);

  const submit = () => {
    if (!valid || !minutes) return;
    startTransition(async () => {
      const result = await updateRecurringGrantAction({
        grantId: grant.id,
        customerId,
        minutes,
        intervalUnit,
        intervalCount: parsedCount,
        endDate: endDate || null,
        note: note || undefined,
      });
      if (result.ok) {
        toast.success('Regel aktualisiert – gilt für zukünftige Aufladungen.');
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Regel bearbeiten"
      >
        <Pencil aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Aufladungsregel bearbeiten"
          description="Änderungen gelten nur für zukünftige Aufladungen – gebuchte bleiben bestehen."
        >
          <GrantFormFields
            idPrefix={`grant-${grant.id}`}
            minutes={minutes}
            setMinutes={setMinutes}
            intervalCount={intervalCount}
            setIntervalCount={setIntervalCount}
            intervalUnit={intervalUnit}
            setIntervalUnit={setIntervalUnit}
            endDate={endDate}
            setEndDate={setEndDate}
            note={note}
            setNote={setNote}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={!valid}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Regel pausieren bzw. fortsetzen (ohne Nachbuchung der Pausenzeit). */
export function GrantActiveToggle({
  customerId,
  grantId,
  active,
}: {
  customerId: string;
  grantId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const toggle = () => {
    startTransition(async () => {
      const result = await setGrantActiveAction({ customerId, grantId, active: !active });
      if (result.ok) {
        toast.success(active ? 'Regel pausiert.' : 'Regel fortgesetzt.');
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      loading={pending}
      aria-label={active ? 'Regel pausieren' : 'Regel fortsetzen'}
    >
      {active ? <Pause aria-hidden /> : <Play aria-hidden />}
    </Button>
  );
}
