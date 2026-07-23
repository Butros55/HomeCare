'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { setMemberStatusAction, updateMemberRoleAction } from '@/server/actions/member-actions';

export function MemberRowControls({
  membershipId,
  role,
  status,
  isSelf,
  isOwnerRow,
}: {
  membershipId: string;
  role: string;
  status: string;
  isSelf: boolean;
  isOwnerRow: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  if (isSelf || isOwnerRow) {
    return <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">—</span>;
  }

  return (
    <span className="flex items-center justify-end gap-2">
      <Select
        value={role}
        onValueChange={(value) => {
          startTransition(async () => {
            const result = await updateMemberRoleAction(
              membershipId,
              value as 'ADMIN' | 'DISPATCHER' | 'TEAM_MANAGER' | 'EMPLOYEE',
            );
            if (result.ok) {
              toast.success('Rolle geändert.');
              router.refresh();
            } else toast.error(result.message);
          });
        }}
        disabled={pending}
      >
        <SelectTrigger className="h-8 w-44" aria-label="Konto-Art ändern">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ADMIN">Leitung</SelectItem>
          <SelectItem value="DISPATCHER">Leitung (Disposition)</SelectItem>
          <SelectItem value="TEAM_MANAGER">Leitung (Team)</SelectItem>
          <SelectItem value="EMPLOYEE">Mitarbeiter</SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant={status === 'ACTIVE' ? 'outline' : 'secondary'}
        size="sm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const result = await setMemberStatusAction(
              membershipId,
              status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
            );
            if (result.ok) {
              toast.success(status === 'ACTIVE' ? 'Mitglied gesperrt.' : 'Mitglied entsperrt.');
              router.refresh();
            } else toast.error(result.message);
          });
        }}
      >
        {status === 'ACTIVE' ? 'Sperren' : 'Entsperren'}
      </Button>
    </span>
  );
}
