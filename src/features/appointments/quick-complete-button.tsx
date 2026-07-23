'use client';

import { CircleCheckBig } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { completeAppointmentAction } from '@/server/actions/appointment-actions';

export function QuickCompleteButton({
  appointmentId,
  label = 'Abschließen',
  className,
  onCompleted,
  ...buttonProps
}: {
  appointmentId: string;
  label?: string;
  onCompleted?: () => void;
} & Omit<ButtonProps, 'children' | 'onClick' | 'loading'>) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const complete = () => {
    startTransition(async () => {
      const result = await completeAppointmentAction(appointmentId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success(
        result.data.alreadyCompleted
          ? 'Der Termin war bereits abgeschlossen.'
          : 'Termin abgeschlossen.',
      );
      onCompleted?.();
      router.refresh();
    });
  };

  return (
    <Button
      {...buttonProps}
      variant="primary"
      loading={pending}
      onClick={complete}
      className={cn(
        'bg-[var(--color-success)] shadow-[0_6px_16px_var(--color-success-soft)] hover:brightness-110',
        className,
      )}
    >
      <CircleCheckBig aria-hidden />
      {label}
    </Button>
  );
}
