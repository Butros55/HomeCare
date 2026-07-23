'use client';

import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { Input, Label } from '@/components/ui/input';
import { loginFormAction, type AuthFormState } from '@/server/auth/form-actions';

/**
 * Login mit Progressive Enhancement: Das Formular POSTet direkt an die
 * Server Action – auch ohne/vor JavaScript. Zugangsdaten landen dadurch
 * niemals in der URL; Fehler erscheinen inline im Formular.
 */
export function LoginForm({ showDemoHint }: { showDemoHint: boolean }) {
  const [state, formAction, pending] = React.useActionState<AuthFormState, FormData>(
    loginFormAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-[length:var(--text-xl)] font-semibold">Anmelden</h1>

      <FormAlert>{state.error}</FormAlert>

      <div>
        <Label htmlFor="login-email" required>
          E-Mail-Adresse
        </Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="name@firma.de"
          defaultValue={state.values?.email ?? ''}
          invalid={Boolean(state.error)}
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="login-password" required>
            Passwort
          </Label>
          <Link
            href="/forgot-password"
            className="text-[length:var(--text-xs)] text-[var(--color-brand)] hover:underline"
          >
            Passwort vergessen?
          </Link>
        </div>
        <Input
          id="login-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          invalid={Boolean(state.error)}
        />
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        Anmelden
      </Button>
      <p className="text-center text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
        Noch kein Konto?{' '}
        <Link href="/register" className="font-medium text-[var(--color-brand)] hover:underline">
          Organisation registrieren
        </Link>
      </p>

      {showDemoHint ? (
        <div className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3.5 py-3 text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
          <p className="mb-1 font-semibold text-[var(--color-ink)]">Demo-Zugänge (nur Entwicklung)</p>
          <p>
            owner@demo.example · dispo@demo.example · maria@demo.example · anna@demo.example
            <br />
            Passwort jeweils: <code className="font-mono">Demo1234!</code>
          </p>
        </div>
      ) : null}
    </form>
  );
}
