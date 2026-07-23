'use client';

import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { Input, Label } from '@/components/ui/input';
import { forgotPasswordFormAction, type ForgotFormState } from '@/server/auth/form-actions';

export function ForgotPasswordForm() {
  const [state, formAction, pending] = React.useActionState<ForgotFormState, FormData>(
    forgotPasswordFormAction,
    {},
  );

  if (state.done) {
    return (
      <div className="space-y-4">
        <h1 className="text-[length:var(--text-xl)] font-semibold">E-Mail unterwegs</h1>
        <FormAlert tone="success">
          Falls ein Konto mit dieser Adresse existiert, haben wir einen Link zum Zurücksetzen
          geschickt. Der Link ist 60 Minuten gültig.
        </FormAlert>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/login">Zurück zur Anmeldung</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h1 className="text-[length:var(--text-xl)] font-semibold">Passwort zurücksetzen</h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
          Wir schicken dir einen Link zum Zurücksetzen an deine E-Mail-Adresse.
        </p>
      </div>

      <FormAlert>{state.error}</FormAlert>

      <div>
        <Label htmlFor="forgot-email" required>
          E-Mail-Adresse
        </Label>
        <Input id="forgot-email" name="email" type="email" required autoComplete="email" />
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        Link anfordern
      </Button>
      <p className="text-center text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
        <Link href="/login" className="font-medium text-[var(--color-brand)] hover:underline">
          Zurück zur Anmeldung
        </Link>
      </p>
    </form>
  );
}
