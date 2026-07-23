'use client';

import { Mail, MoreHorizontal, Pencil, UserCheck, UserX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setEmployeeStatusAction } from '@/server/actions/employee-actions';
import { InviteEmployeeDialog } from '@/features/employees/invite-dialog';

export function EmployeeRowActions({
  employeeId,
  name,
  active,
  hasUser,
  email,
  canManage,
  canInvite,
}: {
  employeeId: string;
  name: string;
  active: boolean;
  hasUser: boolean;
  email: string | null;
  canManage: boolean;
  canInvite: boolean;
}) {
  const router = useRouter();
  const [confirmDeactivate, setConfirmDeactivate] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  if (!canManage && !canInvite) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Aktionen für ${name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canManage ? (
            <DropdownMenuItem asChild>
              <Link href={`/employees/${employeeId}/edit`}>
                <Pencil aria-hidden /> Bearbeiten
              </Link>
            </DropdownMenuItem>
          ) : null}
          {canInvite && !hasUser ? (
            <DropdownMenuItem onSelect={() => setInviteOpen(true)}>
              <Mail aria-hidden /> Einladen
            </DropdownMenuItem>
          ) : null}
          {canManage ? (
            <>
              <DropdownMenuSeparator />
              {active ? (
                <DropdownMenuItem destructive onSelect={() => setConfirmDeactivate(true)}>
                  <UserX aria-hidden /> Deaktivieren
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={async () => {
                    const result = await setEmployeeStatusAction(employeeId, 'ACTIVE');
                    if (result.ok) {
                      toast.success('Mitarbeiter reaktiviert.');
                      router.refresh();
                    } else toast.error(result.message);
                  }}
                >
                  <UserCheck aria-hidden /> Reaktivieren
                </DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={`${name} deaktivieren?`}
        description="Der Mitarbeiter kann keine neuen Stunden oder Termine erhalten. Bestehende Daten bleiben erhalten."
        confirmLabel="Deaktivieren"
        destructive
        loading={pending}
        onConfirm={async () => {
          setPending(true);
          const result = await setEmployeeStatusAction(employeeId, 'INACTIVE');
          setPending(false);
          setConfirmDeactivate(false);
          if (result.ok) {
            toast.success('Mitarbeiter deaktiviert.');
            router.refresh();
          } else toast.error(result.message);
        }}
      />

      {inviteOpen ? (
        <InviteEmployeeDialog
          employeeId={employeeId}
          name={name}
          defaultEmail={email ?? ''}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
        />
      ) : null}
    </>
  );
}
