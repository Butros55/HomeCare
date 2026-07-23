'use client';

import { CalendarPlus, Clock, Loader2, Plus, Route, UserPlus, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { CustomerForm } from '@/features/customers/customer-form';
import { EmployeeForm } from '@/features/employees/employee-form';
import { AppointmentFormDialog } from '@/features/calendar/appointment-form-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  getQuickCreateContextAction,
  type QuickCreateContext,
} from '@/server/actions/quick-create-actions';

type QuickDialog = 'termin' | 'kunde' | 'mitarbeiter';

/**
 * Schnell-Anlegen-Menü der Topbar: statt auf eigene Seiten zu navigieren,
 * öffnet jede Auswahl ein Popup zum schnellen Anlegen (Termin/Kunde/Mitarbeiter).
 * Die Auswahllisten werden erst beim ersten Öffnen geladen (lazy).
 *
 * Im Alleine-Modus entfällt „Mitarbeiter" komplett – dort gibt es keine
 * Mitarbeiterverwaltung, also auch keinen Weg, welche anzulegen.
 */
export function QuickCreateMenu({
  soloMode,
  canManageEmployees,
}: {
  soloMode: boolean;
  canManageEmployees: boolean;
}) {
  const router = useRouter();
  const [context, setContext] = React.useState<QuickCreateContext | null>(null);
  const [loadingDialog, setLoadingDialog] = React.useState<QuickDialog | null>(null);
  const [dialog, setDialog] = React.useState<QuickDialog | null>(null);

  // Kontext (Kunden-/Mitarbeiterlisten) einmalig laden, dann den Dialog öffnen.
  const openDialog = (which: QuickDialog) => {
    if (context) {
      setDialog(which);
      return;
    }
    setLoadingDialog(which);
    getQuickCreateContextAction().then((result) => {
      setLoadingDialog(null);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setContext(result.data);
      setDialog(which);
    });
  };

  const closeDialog = () => setDialog(null);
  const showEmployee = canManageEmployees && !soloMode;
  const busy = loadingDialog !== null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Schnell anlegen"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] pointer-coarse:size-11 text-white shadow-[0_6px_16px_var(--color-brand-ring)] transition-colors hover:bg-[var(--color-brand-hover)]"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Neu anlegen</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => openDialog('kunde')}>
            <UserPlus aria-hidden /> Kunde
          </DropdownMenuItem>
          {showEmployee ? (
            <DropdownMenuItem onSelect={() => openDialog('mitarbeiter')}>
              <UsersRound aria-hidden /> Mitarbeiter
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => openDialog('termin')}>
            <CalendarPlus aria-hidden /> Termin
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/customers?openHours=1">
              <Clock aria-hidden /> Stunden verteilen
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/routes">
              <Route aria-hidden /> Route planen
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Termin schnell anlegen – nutzt denselben Dialog wie der Kalender. */}
      {dialog === 'termin' && context ? (
        <AppointmentFormDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          customers={context.customers}
          employees={context.employees}
          fixedEmployeeId={soloMode ? context.ownEmployeeId : null}
          soloMode={soloMode}
          onChanged={() => {
            closeDialog();
            router.refresh();
          }}
        />
      ) : null}

      {/* Kunde schnell anlegen – vollständiges Kundenformular im Popup. */}
      {dialog === 'kunde' && context ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
        >
          <DialogContent title="Kunde anlegen" wide>
            <CustomerForm
              initial={{}}
              employees={context.employees}
              canEditPrivateNotes={context.canEditPrivateNotes}
              onSuccess={() => {
                closeDialog();
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Mitarbeiter schnell anlegen (nur außerhalb des Alleine-Modus). */}
      {dialog === 'mitarbeiter' && context ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
        >
          <DialogContent title="Mitarbeiter anlegen" wide>
            <EmployeeForm
              initial={{}}
              managerOptions={context.managerOptions}
              onSuccess={() => {
                closeDialog();
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
