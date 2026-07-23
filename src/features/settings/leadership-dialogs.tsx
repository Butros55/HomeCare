'use client';

import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { inviteLeadershipAction } from '@/server/actions/member-actions';
import { updateDefaultPermissionsAction } from '@/server/actions/settings-actions';
import { PermissionChecklist } from '@/features/settings/member-permissions-editor';

/** Weiteres Leitungs-Konto per E-Mail einladen. */
export function AddLeadershipButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await inviteLeadershipAction({ email });
      if (result.ok) {
        toast.success(`Einladung an ${email} verschickt.`);
        setEmail('');
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
        <UserPlus aria-hidden /> Leitungs-Konto hinzufügen
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Leitungs-Konto hinzufügen"
          description="Die Person erhält einen Einladungslink, legt ihr Konto an und kann danach alle leitenden Aufgaben übernehmen – mit den unten eingestellten Standard-Berechtigungen."
        >
          <div>
            <Label htmlFor="leader-email" required>
              E-Mail-Adresse
            </Label>
            <Input
              id="leader-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@beispiel.de"
              autoComplete="off"
            />
            <FieldHint>
              Die Person wird automatisch auch als zuweisbarer Mitarbeiter angelegt.
            </FieldHint>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button variant="primary" loading={pending} onClick={submit} disabled={!email}>
              Einladung senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Standard-Berechtigungen für neue Konten – getrennt für Leitung und
 * Mitarbeiter. Gilt beim Einladen bzw. beim Wechsel der Konto-Art.
 */
export function DefaultPermissionsSettings({
  initialLeadership,
  initialEmployee,
}: {
  initialLeadership: string[];
  initialEmployee: string[];
}) {
  const router = useRouter();
  const [leadership, setLeadership] = React.useState<string[]>(initialLeadership);
  const [employee, setEmployee] = React.useState<string[]>(initialEmployee);
  const [pending, startTransition] = React.useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await updateDefaultPermissionsAction({ leadership, employee });
      if (result.ok) {
        toast.success('Standard-Berechtigungen gespeichert.');
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Standard-Berechtigungen</PanelTitle>
        <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
          Gilt für neue Konten; bestehende bleiben unverändert.
        </span>
      </PanelHeader>
      <PanelBody className="space-y-6">
        <section>
          <h3 className="mb-2 text-[length:var(--text-sm)] font-semibold">Neue Leitungs-Konten</h3>
          <PermissionChecklist
            idPrefix="default-leader"
            value={leadership}
            onChange={setLeadership}
            disabled={pending}
          />
        </section>
        <section className="border-t border-[var(--color-line-subtle)] pt-4">
          <h3 className="mb-2 text-[length:var(--text-sm)] font-semibold">Neue Mitarbeiter-Konten</h3>
          <p className="mb-2 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
            Mitarbeiter sehen ihre eigenen Termine und Routen immer – hier geht es nur um
            zusätzliche Rechte.
          </p>
          <PermissionChecklist
            idPrefix="default-employee"
            value={employee}
            onChange={setEmployee}
            disabled={pending}
          />
        </section>
        <Button variant="primary" loading={pending} onClick={save}>
          Standards speichern
        </Button>
      </PanelBody>
    </Panel>
  );
}
