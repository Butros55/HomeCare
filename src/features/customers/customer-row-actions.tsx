'use client';

import {
  Archive,
  ArchiveRestore,
  Clock,
  MapPin,
  MoreHorizontal,
  Pencil,
  Phone,
} from 'lucide-react';
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
import { googleMapsDirectionsUrl } from '@/lib/geo';
import {
  archiveCustomerAction,
  restoreCustomerAction,
} from '@/server/actions/customer-actions';

export function CustomerRowActions({
  customerId,
  name,
  phone,
  addressLine,
  archived,
  canManage,
  canAllocate,
}: {
  customerId: string;
  name: string;
  phone: string | null;
  addressLine: string | null;
  archived: boolean;
  canManage: boolean;
  canAllocate: boolean;
}) {
  const router = useRouter();
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Aktionen für ${name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {phone ? (
            <DropdownMenuItem asChild>
              <a href={`tel:${phone.replace(/\s/g, '')}`}>
                <Phone aria-hidden /> Anrufen
              </a>
            </DropdownMenuItem>
          ) : null}
          {addressLine ? (
            <DropdownMenuItem asChild>
              <a href={googleMapsDirectionsUrl(addressLine)} target="_blank" rel="noreferrer">
                <MapPin aria-hidden /> Navigation starten
              </a>
            </DropdownMenuItem>
          ) : null}
          {canAllocate ? (
            <DropdownMenuItem asChild>
              <Link href={`/customers/${customerId}?tab=stunden`}>
                <Clock aria-hidden /> Stunden zuweisen
              </Link>
            </DropdownMenuItem>
          ) : null}
          {canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`/customers/${customerId}/edit`}>
                  <Pencil aria-hidden /> Bearbeiten
                </Link>
              </DropdownMenuItem>
              {archived ? (
                <DropdownMenuItem
                  onSelect={async () => {
                    const result = await restoreCustomerAction(customerId);
                    if (result.ok) {
                      toast.success('Kunde wiederhergestellt.');
                      router.refresh();
                    } else toast.error(result.message);
                  }}
                >
                  <ArchiveRestore aria-hidden /> Wiederherstellen
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem destructive onSelect={() => setConfirmArchive(true)}>
                  <Archive aria-hidden /> Archivieren
                </DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`${name} archivieren?`}
        description="Zukünftige Termine werden abgesagt und aktive Serien beendet. Die Historie bleibt erhalten; der Kunde kann jederzeit wiederhergestellt werden."
        confirmLabel="Archivieren"
        destructive
        loading={pending}
        onConfirm={async () => {
          setPending(true);
          const result = await archiveCustomerAction(customerId);
          setPending(false);
          setConfirmArchive(false);
          if (result.ok) {
            toast.success('Kunde archiviert.');
            router.refresh();
          } else toast.error(result.message);
        }}
      />
    </>
  );
}
