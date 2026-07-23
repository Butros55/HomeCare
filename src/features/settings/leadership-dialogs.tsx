'use client';

import { User, UserPlus, UsersRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { inviteLeadershipAction } from '@/server/actions/member-actions';
import {
  updateDefaultPermissionsAction,
  updateSoloModeAction,
} from '@/server/actions/settings-actions';
import { PermissionChecklist } from '@/features/settings/member-permissions-editor';

/**
 * Umschalter „Alleine“ ↔ „Leitung mit Team“: bestimmt, ob das reduzierte
 * Alltags-UI oder die volle Verwaltung angezeigt wird.
 */
export function ModeSettings({ soloMode }: { soloMode: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const setMode = (nextSolo: boolean) => {
    if (nextSolo === soloMode) return;
    startTransition(async () => {
      const result = await updateSoloModeAction(nextSolo);
      if (result.ok) {
        const moved = result.data.movedCount;
        toast.success(
          nextSolo
            ? moved > 0
              ? `Alleine-Modus aktiv – ${moved} künftige${moved === 1 ? 'r' : ''} Termin${moved === 1 ? '' : 'e'} auf dich übertragen.`
              : 'Alleine-Modus aktiv – die App zeigt jetzt das reduzierte Alltags-UI.'
            : moved > 0
              ? `Leitungs-Modus aktiv – ${moved} Termin${moved === 1 ? '' : 'e'} wieder den Mitarbeitern zugeordnet.`
              : 'Leitungs-Modus aktiv – volle Verwaltung eingeblendet.',
        );
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  const optionClass = (active: boolean) =>
    cn(
      'flex flex-1 cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border p-3.5 text-left transition-colors',
      active
        ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)]'
        : 'border-[var(--color-line)] hover:border-[var(--color-line-strong)]',
    );

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Ansicht & Modus</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button type="button" disabled={pending} onClick={() => setMode(true)} className={optionClass(soloMode)}>
            <User className="mt-0.5 size-4.5 shrink-0 text-[var(--color-brand)]" aria-hidden />
            <span>
              <span className="block text-[length:var(--text-sm)] font-semibold">Alleine</span>
              <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                Nur eigene Termine, Kunden und Routen – stark reduziertes UI für den täglichen
                Betrieb, ohne Mitarbeiter- und Zuweisungslogik.
              </span>
            </span>
          </button>
          <button type="button" disabled={pending} onClick={() => setMode(false)} className={optionClass(!soloMode)}>
            <UsersRound className="mt-0.5 size-4.5 shrink-0 text-[var(--color-brand)]" aria-hidden />
            <span>
              <span className="block text-[length:var(--text-sm)] font-semibold">Leitung mit Team</span>
              <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                Volle Ansicht: Mitarbeiter verwalten, Stunden zuweisen, alle Termine und Routen
                der Organisation planen.
              </span>
            </span>
          </button>
        </div>
        <p className="mt-2.5 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
          Beim Wechsel zu „Alleine“ werden alle künftigen Mitarbeiter-Termine auf dich übertragen
          (Mitarbeiter und Kunden bleiben gespeichert); beim Wechsel zurück erhalten die Mitarbeiter
          ihre Zuordnungen automatisch wieder. Tipp: Für einen schnellen Blick auf die eigenen
          Termine reicht der Umschalter „Meine Ansicht“ oben in der Leiste – der ändert keine Daten.
        </p>
      </PanelBody>
    </Panel>
  );
}

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
