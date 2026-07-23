'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { acceptInvitationFormAction, type AuthFormState } from '@/server/auth/form-actions';

export function AcceptInvitationForm({
  token,
  organizationName,
  email,
  initialFirstName,
  initialLastName,
}: {
  token: string;
  organizationName: string;
  email: string;
  initialFirstName: string;
  initialLastName: string;
}) {
  const [state, formAction, pending] = React.useActionState<AuthFormState, FormData>(
    acceptInvitationFormAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h1 className="text-[length:var(--text-xl)] font-semibold">Einladung annehmen</h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
          Du wurdest zu <strong>{organizationName}</strong> eingeladen ({email}).
        </p>
      </div>

      <FormAlert>{state.error}</FormAlert>

      <input type="hidden" name="token" value={token} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="inv-first" required>
            Vorname
          </Label>
          <Input
            id="inv-first"
            name="firstName"
            required
            defaultValue={state.values?.firstName ?? initialFirstName}
          />
        </div>
        <div>
          <Label htmlFor="inv-last" required>
            Nachname
          </Label>
          <Input
            id="inv-last"
            name="lastName"
            required
            defaultValue={state.values?.lastName ?? initialLastName}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="inv-password" required>
          Passwort festlegen
        </Label>
        <Input
          id="inv-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <FieldHint>Mindestens 8 Zeichen, mit Buchstabe und Ziffer.</FieldHint>
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        Konto erstellen & anmelden
      </Button>
    </form>
  );
}
