'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ABSENCE_TYPE_LABELS } from '@/lib/status-maps';
import { createAbsenceAction, deleteAbsenceAction } from '@/server/actions/employee-actions';

export function AbsenceManager({
  employeeId,
  readOnly,
}: {
  employeeId: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [type, setType] = React.useState<'VACATION' | 'SICK' | 'TRAINING' | 'OTHER'>('VACATION');
  const [note, setNote] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  if (readOnly) return null;

  const submit = () => {
    startTransition(async () => {
      const result = await createAbsenceAction({ employeeId, startDate, endDate, type, note });
      if (result.ok) {
        toast.success('Abwesenheit eingetragen.');
        setOpen(false);
        setStartDate('');
        setEndDate('');
        setNote('');
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Abwesenheit eintragen
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Abwesenheit eintragen">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="abs-start" required>
                  Von
                </Label>
                <Input
                  id="abs-start"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="abs-end" required>
                  Bis (einschließlich)
                </Label>
                <Input
                  id="abs-end"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="abs-type">Art</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger id="abs-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ABSENCE_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="abs-note">Notiz</Label>
              <Textarea
                id="abs-note"
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
            <Button
              variant="primary"
              onClick={submit}
              loading={pending}
              disabled={!startDate || !endDate}
            >
              Eintragen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteAbsenceButton({
  absenceId,
  employeeId,
  label,
}: {
  absenceId: string;
  employeeId: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Abwesenheit ${label} löschen`}
        className="text-[var(--color-danger)]"
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Abwesenheit löschen?"
        description={label}
        confirmLabel="Löschen"
        destructive
        loading={pending}
        onConfirm={async () => {
          setPending(true);
          const result = await deleteAbsenceAction(absenceId, employeeId);
          setPending(false);
          setOpen(false);
          if (result.ok) {
            toast.success('Abwesenheit gelöscht.');
            router.refresh();
          } else {
            toast.error(result.message);
          }
        }}
      />
    </>
  );
}
