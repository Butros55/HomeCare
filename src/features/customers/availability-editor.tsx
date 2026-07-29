'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  WeeklyWindowsEditor,
  type WeeklyWindowSlot,
} from '@/components/ui/weekly-windows-editor';
import { replaceCustomerAvailabilityAction } from '@/server/actions/customer-actions';

/**
 * Wochenzeitfenster eines Kunden pflegen – eigener Bereich wie beim
 * Mitarbeiter, damit die Zeitfenster nicht bei jedem Speichern der Stammdaten
 * mitgeschrieben werden müssen.
 */
export function CustomerAvailabilityEditor({
  customerId,
  initialSlots,
  readOnly,
}: {
  customerId: string;
  initialSlots: WeeklyWindowSlot[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [slots, setSlots] = React.useState<WeeklyWindowSlot[]>(initialSlots);
  const [pending, startTransition] = React.useTransition();

  const save = () => {
    startTransition(async () => {
      if (slots.some((slot) => slot.startTime >= slot.endTime)) {
        toast.error('Jedes Zeitfenster braucht ein Ende nach dem Beginn.');
        return;
      }
      const result = await replaceCustomerAvailabilityAction({ customerId, slots });
      if (result.ok) {
        toast.success('Verfügbarkeit gespeichert.');
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <div className="space-y-3">
      <WeeklyWindowsEditor
        idPrefix="cust-avail"
        value={initialSlots}
        onChange={setSlots}
        disabled={readOnly}
        emptyHint="Keine Zeitfenster hinterlegt – der Kunde gilt als an allen Tagen und Zeiten verfügbar. Zeitfenster begrenzen Terminvorschläge und werden bei Konflikten konkret benannt."
      />
      {!readOnly ? (
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            onClick={save}
            loading={pending}
            className="w-full sm:w-auto"
          >
            Verfügbarkeit speichern
          </Button>
        </div>
      ) : null}
    </div>
  );
}
