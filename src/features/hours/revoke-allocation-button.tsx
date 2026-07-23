'use client';

import { Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { revokeAllocationAction } from '@/server/actions/hours-actions';

export function RevokeAllocationButton({
  allocationId,
  customerId,
  description,
}: {
  allocationId: string;
  customerId: string;
  description: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zuweisung zurückziehen"
        onClick={() => setOpen(true)}
      >
        <Undo2 aria-hidden />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Zuweisung zurückziehen?"
        description={description}
        confirmLabel="Zurückziehen"
        destructive
        loading={pending}
        onConfirm={async () => {
          setPending(true);
          const result = await revokeAllocationAction(allocationId, customerId);
          setPending(false);
          setOpen(false);
          if (result.ok) {
            toast.success('Zuweisung zurückgezogen.');
            router.refresh();
          } else {
            toast.error(result.message);
          }
        }}
      />
    </>
  );
}
