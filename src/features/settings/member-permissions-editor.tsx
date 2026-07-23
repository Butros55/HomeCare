'use client';

import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import {
  EDITABLE_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  type Permission,
} from '@/lib/permission-catalog';
import { updateMemberPermissionsAction } from '@/server/actions/member-actions';

/** Checkbox-Raster über alle editierbaren Berechtigungen (gruppiert). */
export function PermissionChecklist({
  value,
  onChange,
  idPrefix,
  disabled = false,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const selected = new Set(value);
  const toggle = (permission: Permission, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(permission);
    else next.delete(permission);
    onChange([...next]);
  };

  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map((group) => {
        const editable = group.permissions.filter((p) => EDITABLE_PERMISSIONS.includes(p));
        if (editable.length === 0) return null;
        return (
          <fieldset key={group.title}>
            <legend className="mb-1.5 text-[length:var(--text-2xs)] font-semibold tracking-wider text-[var(--color-ink-subtle)] uppercase">
              {group.title}
            </legend>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {editable.map((permission) => {
                const id = `${idPrefix}-${permission}`;
                return (
                  <span key={permission} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={selected.has(permission)}
                      onCheckedChange={(checked) => toggle(permission, checked === true)}
                      disabled={disabled}
                    />
                    <Label htmlFor={id} className="mb-0 cursor-pointer font-normal">
                      {PERMISSION_LABELS[permission]}
                    </Label>
                  </span>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * Berechtigungen eines Kontos bearbeiten (Einstellungen → Leitung/Mitglieder).
 * "Standard" = Rollen-/Organisations-Standard (permissions = null);
 * jede Anpassung speichert eine individuelle Liste.
 */
export function MemberPermissionsEditor({
  membershipId,
  memberName,
  effectivePermissions,
  isCustom,
}: {
  membershipId: string;
  memberName: string;
  /** Aktuell wirksame Berechtigungen (individuell oder Rollen-Standard). */
  effectivePermissions: string[];
  isCustom: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState<string[]>(effectivePermissions);
  const [pending, startTransition] = React.useTransition();

  const openDialog = () => {
    setValue(effectivePermissions);
    setOpen(true);
  };

  const save = (permissions: string[] | null) => {
    startTransition(async () => {
      const result = await updateMemberPermissionsAction(membershipId, permissions);
      if (result.ok) {
        toast.success('Berechtigungen gespeichert.');
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog} data-tour="member-permissions-button">
        <ShieldCheck aria-hidden />
        {isCustom
          ? `Berechtigungen (${effectivePermissions.length})`
          : 'Berechtigungen (Standard)'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Berechtigungen: ${memberName}`}
          description="Legt fest, was dieses Konto sehen und ändern darf. Änderungen gelten sofort."
        >
          <div className="max-h-[55dvh] overflow-y-auto pr-1">
            <PermissionChecklist
              idPrefix={`perm-${membershipId}`}
              value={value}
              onChange={setValue}
              disabled={pending}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => save(null)}
              title="Individuelle Liste entfernen – es gilt wieder der Standard der Konto-Art."
            >
              Auf Standard zurücksetzen
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button variant="primary" loading={pending} onClick={() => save(value)}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Kleine Zusammenfassung für Tabellenzeilen ohne Editor (z. B. Inhaber). */
export function PermissionSummaryBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-panel-sunken)] px-2.5 py-1 text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
      <ShieldCheck className="size-3.5 text-[var(--color-brand)]" aria-hidden />
      {label}
    </span>
  );
}

