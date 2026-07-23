'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { resetPasswordFormAction, type AuthFormState } from '@/server/auth/form-actions';

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = React.useActionState<AuthFormState, FormData>(
    resetPasswordFormAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h1 className="text-[length:var(--text-xl)] font-semibold">Neues Passwort festlegen</h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
          Danach wirst du automatisch angemeldet. Alle anderen Sitzungen werden abgemeldet.
        </p>
      </div>

      <FormAlert>{state.error}</FormAlert>

      <input type="hidden" name="token" value={token} />
      <div>
        <Label htmlFor="reset-password" required>
          Neues Passwort
        </Label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <FieldHint>Mindestens 8 Zeichen, mit Buchstabe und Ziffer.</FieldHint>
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        Passwort speichern
      </Button>
    </form>
  );
}
