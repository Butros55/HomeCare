'use client';

import { Lock, LockOpen, Mail, MoreHorizontal, Pencil, Trash2, UserCheck, UserX } from 'lucide-react';
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
import {
  deleteEmployeeAccountAction,
  setEmployeeAccountSuspendedAction,
  setEmployeeStatusAction,
} from '@/server/actions/employee-actions';
import { InviteEmployeeDialog } from '@/features/employees/invite-dialog';

export function EmployeeRowActions({
  employeeId,
  name,
  active,
  hasUser,
  email,
  canManage,
  canInvite,
  accountSuspended,
  redirectAfterDelete,
}: {
  employeeId: string;
  name: string;
  active: boolean;
  hasUser: boolean;
  email: string | null;
  canManage: boolean;
  canInvite: boolean;
  /** Login gesperrt? Nur gesetzt, wo der Mitgliedschaftsstatus bekannt ist (Detailseite). */
  accountSuspended?: boolean;
  /** Nach dem Löschen dorthin navigieren (sonst nur Liste aktualisieren). */
  redirectAfterDelete?: string;
}) {
  const router = useRouter();
  const [confirmDeactivate, setConfirmDeactivate] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  if (!canManage && !canInvite) return null;

  const toggleSuspended = async () => {
    const result = await setEmployeeAccountSuspendedAction(employeeId, !accountSuspended);
    if (result.ok) {
      toast.success(accountSuspended ? 'Zugang entsperrt.' : 'Zugang gesperrt.');
      router.refresh();
    } else toast.error(result.message);
  };

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
              {hasUser && accountSuspended !== undefined ? (
                <DropdownMenuItem onSelect={toggleSuspended}>
                  {accountSuspended ? (
                    <>
                      <LockOpen aria-hidden /> Zugang entsperren
                    </>
                  ) : (
                    <>
                      <Lock aria-hidden /> Zugang sperren
                    </>
                  )}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden /> Löschen
              </DropdownMenuItem>
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

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`${name} löschen?`}
        description={
          hasUser
            ? 'Das Mitarbeiterprofil wird archiviert und der zugehörige Login entfernt – eine Anmeldung ist danach nicht mehr möglich. Bereits geleistete Termine und Stunden bleiben zur Nachvollziehbarkeit erhalten.'
            : 'Das Mitarbeiterprofil wird archiviert. Bereits geleistete Termine und Stunden bleiben zur Nachvollziehbarkeit erhalten.'
        }
        confirmLabel="Löschen"
        destructive
        loading={pending}
        onConfirm={async () => {
          setPending(true);
          const result = await deleteEmployeeAccountAction(employeeId);
          setPending(false);
          setConfirmDelete(false);
          if (result.ok) {
            toast.success('Mitarbeiter gelöscht.');
            if (redirectAfterDelete) router.push(redirectAfterDelete);
            else router.refresh();
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
