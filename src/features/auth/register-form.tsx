'use client';

import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { registerFormAction, type AuthFormState } from '@/server/auth/form-actions';

/** Registrierung mit Progressive Enhancement (POST an Server Action, Inline-Fehler). */
export function RegisterForm() {
  const [state, formAction, pending] = React.useActionState<AuthFormState, FormData>(
    registerFormAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h1 className="text-[length:var(--text-xl)] font-semibold">Organisation registrieren</h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
          Du wirst Inhaber der neuen Organisation und kannst danach Mitarbeiter einladen.
        </p>
      </div>

      <FormAlert>{state.error}</FormAlert>

      <div>
        <Label htmlFor="reg-org" required>
          Name der Organisation
        </Label>
        <Input
          id="reg-org"
          name="organizationName"
          required
          minLength={2}
          placeholder="z. B. Blitzblank Hauswirtschaft"
          defaultValue={state.values?.organizationName ?? ''}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="reg-first" required>
            Vorname
          </Label>
          <Input
            id="reg-first"
            name="firstName"
            required
            autoComplete="given-name"
            defaultValue={state.values?.firstName ?? ''}
          />
        </div>
        <div>
          <Label htmlFor="reg-last" required>
            Nachname
          </Label>
          <Input
            id="reg-last"
            name="lastName"
            required
            autoComplete="family-name"
            defaultValue={state.values?.lastName ?? ''}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="reg-email" required>
          E-Mail-Adresse
        </Label>
        <Input
          id="reg-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={state.values?.email ?? ''}
        />
      </div>
      <div>
        <Label htmlFor="reg-password" required>
          Passwort
        </Label>
        <Input
          id="reg-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <FieldHint>Mindestens 8 Zeichen, mit Buchstabe und Ziffer.</FieldHint>
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-[length:var(--text-sm)] font-medium">
          Wie startest du?
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-line)] p-3 transition-colors has-checked:border-[var(--color-brand)] has-checked:bg-[var(--color-brand-subtle)]">
            <input type="radio" name="startMode" value="solo" defaultChecked className="mt-0.5 accent-[var(--color-brand)]" />
            <span>
              <span className="block text-[length:var(--text-sm)] font-medium">Erstmal alleine</span>
              <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                Eigene Termine, Kunden und Routen – schlankes Alltags-UI.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-line)] p-3 transition-colors has-checked:border-[var(--color-brand)] has-checked:bg-[var(--color-brand-subtle)]">
            <input type="radio" name="startMode" value="team" className="mt-0.5 accent-[var(--color-brand)]" />
            <span>
              <span className="block text-[length:var(--text-sm)] font-medium">Mit Mitarbeitern</span>
              <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                Volle Leitungs-Ansicht mit Zuweisung und Verwaltung.
              </span>
            </span>
          </label>
        </div>
        <FieldHint>Lässt sich jederzeit in den Einstellungen umstellen.</FieldHint>
      </fieldset>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        Kostenlos starten
      </Button>
      <p className="text-center text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
        Bereits ein Konto?{' '}
        <Link href="/login" className="font-medium text-[var(--color-brand)] hover:underline">
          Anmelden
        </Link>
      </p>
    </form>
  );
}
