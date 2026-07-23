'use client';

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
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await inviteEmployeeAction({ employeeId, email, role });
      if (result.ok) {
        toast.success(`Einladung an ${email} verschickt.`);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`${name} einladen`}
        description="Der Mitarbeiter erhält einen Link, um ein Konto zu erstellen und seine Termine einzusehen."
      >
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
              Im Entwicklungsmodus wird der Einladungslink in das Server-Log geschrieben.
            </FieldHint>
          </div>
          {allowRoleSelection ? (
            <div>
              <Label htmlFor="invite-role">Rolle</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMPLOYEE">Mitarbeiter</SelectItem>
                  <SelectItem value="TEAM_MANAGER">Team-Manager</SelectItem>
                  <SelectItem value="DISPATCHER">Disponent</SelectItem>
                  <SelectItem value="ADMIN">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Abbrechen
          </Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!email}>
            Einladung senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
