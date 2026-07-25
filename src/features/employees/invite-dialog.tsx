'use client';

import { Check, Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { FieldHint, Input, Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { inviteEmployeeAction } from '@/server/actions/employee-actions';

/** Mitarbeiter per E-Mail einladen (Einladungslink, 7 Tage gültig). */
export function InviteEmployeeDialog({
  employeeId,
  name,
  defaultEmail,
  open,
  onOpenChange,
  allowRoleSelection = false,
}: {
  employeeId: string;
  name: string;
  defaultEmail: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowRoleSelection?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState(defaultEmail);
  const [role, setRole] = React.useState<'ADMIN' | 'DISPATCHER' | 'TEAM_MANAGER' | 'EMPLOYEE'>(
    'EMPLOYEE',
  );
  const [invite, setInvite] = React.useState<{
    link: string;
    mailConfigured: boolean;
    emailDelivered: boolean;
  } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await inviteEmployeeAction({ employeeId, email, role });
      if (result.ok) {
        setInvite(result.data);
        toast.success(
          result.data.emailDelivered
            ? `Einladung an ${email} versendet.`
            : `Einladung für ${email} erstellt.`,
        );
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  const copyLink = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Kopieren nicht möglich – Link bitte manuell markieren.');
    }
  };

  const close = () => {
    setInvite(null);
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title={`${name} einladen`}
        description="Der Mitarbeiter erhält einen Link, um ein Konto zu erstellen und seine Termine einzusehen."
      >
        {invite ? (
          <div className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-line-subtle)] bg-[var(--color-panel-sunken)] p-3">
              <p className="text-[length:var(--text-sm)] font-medium">
                {invite.emailDelivered ? 'Einladung versendet' : 'Einladungslink erstellt'}
              </p>
              <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                {invite.emailDelivered ? (
                  <>
                    Die Einladung wurde per E-Mail an <strong>{email}</strong> versendet. Den Link (7
                    Tage gültig) kannst du bei Bedarf zusätzlich weitergeben.
                  </>
                ) : invite.mailConfigured ? (
                  <>
                    Der E-Mail-Versand ist fehlgeschlagen – gib diesen Link (7 Tage gültig) sicher an{' '}
                    <strong>{email}</strong> weiter. Nur über den Link ist die Registrierung möglich.
                  </>
                ) : (
                  <>
                    Gib diesen Link (7 Tage gültig) an <strong>{email}</strong> weiter. Nur über den
                    Link ist die Registrierung möglich.
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input readOnly value={invite.link} onFocus={(e) => e.target.select()} className="flex-1" />
              <Button variant="secondary" onClick={copyLink} aria-label="Link kopieren">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? 'Kopiert' : 'Kopieren'}
              </Button>
            </div>
            <DialogFooter>
              <Button variant="primary" onClick={close}>
                Fertig
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <Label htmlFor="invite-email" required>
                  E-Mail-Adresse
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@beispiel.de"
                  autoComplete="off"
                />
                <FieldHint>
                  Ist der E-Mail-Versand konfiguriert, wird die Einladung direkt zugestellt. Den
                  Einladungslink (7 Tage gültig) erhältst du anschließend immer zum Weitergeben.
                </FieldHint>
              </div>
              {allowRoleSelection ? (
                <div>
                  <Label htmlFor="invite-role">Konto-Art</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                    <SelectTrigger id="invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EMPLOYEE">Mitarbeiter</SelectItem>
                      <SelectItem value="TEAM_MANAGER">Leitung (Team)</SelectItem>
                      <SelectItem value="DISPATCHER">Leitung (Disposition)</SelectItem>
                      <SelectItem value="ADMIN">Leitung</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={close} disabled={pending}>
                Abbrechen
              </Button>
              <Button variant="primary" loading={pending} onClick={submit} disabled={!email}>
                Einladungslink erstellen
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
