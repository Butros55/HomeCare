'use client';

import { Clock } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { DialogDataSkeleton } from '@/components/layout/page-loading-skeleton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMinutesAsHours } from '@/lib/duration';
import { listAllocatableCustomersAction } from '@/server/actions/hours-actions';
import { AllocateHoursDialog } from '@/features/hours/allocate-hours-button';

/**
 * Einstieg „Stunden zuweisen“ von der Mitarbeiterseite: zuerst den Kunden
 * wählen (mit verfügbarem Guthaben), dann öffnet sich der Zuweisungsdialog mit
 * vorausgewähltem Mitarbeiter.
 */
export function AllocateFromEmployeeButton({ employeeId }: { employeeId: string }) {
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [customers, setCustomers] = React.useState<
    Array<{ id: string; name: string; availableMinutes: number }> | null
  >(null);
  const [customerId, setCustomerId] = React.useState('');
  const [dialogCustomerId, setDialogCustomerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!chooserOpen || customers !== null) return;
    let cancelled = false;
    listAllocatableCustomersAction().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setCustomers(result.data);
        const first = result.data.find((c) => c.availableMinutes > 0) ?? result.data[0];
        if (first) setCustomerId(first.id);
      } else {
        toast.error(result.message);
        setChooserOpen(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [chooserOpen, customers]);

  return (
    <>
      <Button variant="primary" onClick={() => setChooserOpen(true)}>
        <Clock aria-hidden /> Stunden zuweisen
      </Button>

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent
          title="Kunde wählen"
          description="Aus welchem Kunden-Stundenkonto sollen Stunden übertragen werden?"
        >
          {customers === null ? (
            <DialogDataSkeleton />
          ) : customers.length === 0 ? (
            <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              Keine Kunden mit verfügbarem Stundenguthaben gefunden.
            </p>
          ) : (
            <div>
              <Label htmlFor="afe-customer">Kunde</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger id="afe-customer">
                  <SelectValue placeholder="Kunde wählen" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name} · {formatMinutesAsHours(customer.availableMinutes)} verfügbar
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChooserOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
              disabled={!customerId}
              onClick={() => {
                setChooserOpen(false);
                setDialogCustomerId(customerId);
              }}
            >
              Weiter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialogCustomerId ? (
        <AllocateHoursDialog
          customerId={dialogCustomerId}
          open={dialogCustomerId !== null}
          onOpenChange={(open) => {
            if (!open) setDialogCustomerId(null);
          }}
          preselectedEmployeeId={employeeId}
        />
      ) : null}
    </>
  );
}
