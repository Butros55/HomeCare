'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/layout/theme-provider';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { changePasswordAction, updateProfileAction } from '@/server/auth/actions';
import { updateOwnHomeLocationAction } from '@/server/actions/employee-actions';
import { saveNotificationPrefsAction } from '@/server/actions/preference-actions';
import { updateOrganizationAction } from '@/server/actions/settings-actions';
import { AddressAutocomplete } from '@/features/geo/address-autocomplete';

// ---------------------------- Profil ---------------------------------------

export function ProfileSettings({
  initial,
}: {
  initial: { firstName: string; lastName: string; phone: string; email: string };
}) {
  const router = useRouter();
  const [firstName, setFirstName] = React.useState(initial.firstName);
  const [lastName, setLastName] = React.useState(initial.lastName);
  const [phone, setPhone] = React.useState(initial.phone);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateProfileAction({ firstName, lastName, phone });
      if (result.ok) {
        setError(null);
        toast.success('Profil gespeichert.');
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Profil</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <form onSubmit={submit} method="post" className="max-w-md space-y-4">
          <FormAlert>{error}</FormAlert>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ps-first" required>
                Vorname
              </Label>
              <Input
                id="ps-first"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ps-last" required>
                Nachname
              </Label>
              <Input
                id="ps-last"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ps-phone">Telefon</Label>
            <Input id="ps-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ps-email">E-Mail-Adresse</Label>
            <Input id="ps-email" value={initial.email} disabled />
            <FieldHint>Die Anmelde-Adresse kann derzeit nicht geändert werden.</FieldHint>
          </div>
          <Button type="submit" variant="primary" loading={pending}>
            Profil speichern
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}

/** Zuhause-Adresse des eigenen Mitarbeiterprofils (Startpunkt „Zuhause" für Routen). */
export function HomeAddressSettings({
  initial,
}: {
  initial: { street: string; houseNumber: string; postalCode: string; city: string } | null;
}) {
  const router = useRouter();
  const [location, setLocation] = React.useState(
    initial ?? { street: '', houseNumber: '', postalCode: '', city: '' },
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const hasLocation = location.street.trim() && location.city.trim();
      const result = await updateOwnHomeLocationAction(hasLocation ? location : null);
      if (result.ok) {
        setError(null);
        toast.success(
          !hasLocation
            ? 'Zuhause-Adresse entfernt.'
            : result.data.geocoded
              ? 'Zuhause-Adresse gespeichert und geokodiert.'
              : 'Zuhause-Adresse gespeichert – Koordinaten wurden nicht gefunden.',
        );
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Zuhause-Adresse</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <form onSubmit={submit} method="post" className="max-w-xl space-y-4">
          <FormAlert>{error}</FormAlert>
          <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
            Startpunkt „Zuhause“ für deine Tagesroute und die Teamplanung. Felder leeren und
            speichern entfernt die Adresse.
          </p>
          <div>
            <Label htmlFor="home-search">Adresse suchen</Label>
            <AddressAutocomplete
              id="home-search"
              onSelect={(suggestion) =>
                setLocation({
                  street: suggestion.street,
                  houseNumber: suggestion.houseNumber,
                  postalCode: suggestion.postalCode,
                  city: suggestion.city,
                })
              }
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <div className="sm:col-span-4">
              <Label htmlFor="home-street">Straße</Label>
              <Input
                id="home-street"
                value={location.street}
                onChange={(e) => setLocation({ ...location, street: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="home-no">Nr.</Label>
              <Input
                id="home-no"
                value={location.houseNumber}
                onChange={(e) => setLocation({ ...location, houseNumber: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="home-plz">PLZ</Label>
              <Input
                id="home-plz"
                inputMode="numeric"
                value={location.postalCode}
                onChange={(e) => setLocation({ ...location, postalCode: e.target.value })}
              />
            </div>
            <div className="sm:col-span-4">
              <Label htmlFor="home-city">Ort</Label>
              <Input
                id="home-city"
                value={location.city}
                onChange={(e) => setLocation({ ...location, city: e.target.value })}
              />
            </div>
          </div>
          <FieldHint>Wird beim Speichern automatisch geokodiert (für die Routenplanung).</FieldHint>
          <Button type="submit" variant="primary" loading={pending}>
            Zuhause-Adresse speichern
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}

export function PasswordSettings() {
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await changePasswordAction({ currentPassword, newPassword });
      if (result.ok) {
        setError(null);
        setCurrentPassword('');
        setNewPassword('');
        toast.success('Passwort geändert. Andere Sitzungen wurden abgemeldet.');
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Passwort ändern</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <form onSubmit={submit} method="post" className="max-w-md space-y-4">
          <FormAlert>{error}</FormAlert>
          <div>
            <Label htmlFor="pw-current" required>
              Aktuelles Passwort
            </Label>
            <Input
              id="pw-current"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pw-new" required>
              Neues Passwort
            </Label>
            <Input
              id="pw-new"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <FieldHint>Mindestens 8 Zeichen, mit Buchstabe und Ziffer.</FieldHint>
          </div>
          <Button type="submit" variant="primary" loading={pending}>
            Passwort ändern
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}

// -------------------------- Darstellung ------------------------------------

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  // Hydration-sicher: Theme erst nach Mount anzeigen (useSyncExternalStore-Muster).
  const mounted = React.useSyncExternalStore(
    React.useCallback(() => () => {}, []),
    () => true,
    () => false,
  );

  const options = [
    { value: 'light', label: 'Hell', icon: Sun },
    { value: 'dark', label: 'Dunkel', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Darstellung</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Farbschema">
          {options.map((option) => {
            const Icon = option.icon;
            const active = mounted && theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(option.value)}
                className={cn(
                  'flex min-w-28 flex-col items-center gap-2 rounded-[var(--radius-lg)] border px-5 py-4 transition-colors',
                  active
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)] text-[var(--color-brand)]'
                    : 'border-[var(--color-line)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)]',
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span className="text-[length:var(--text-sm)] font-medium">{option.label}</span>
              </button>
            );
          })}
        </div>
      </PanelBody>
    </Panel>
  );
}

// -------------------------- Organisation -----------------------------------

export function OrganizationSettings({
  initial,
}: {
  initial: {
    name: string;
    timezone: string;
    startLocation: {
      label: string;
      street: string;
      houseNumber: string;
      postalCode: string;
      city: string;
    } | null;
  };
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [timezone, setTimezone] = React.useState(initial.timezone);
  const [location, setLocation] = React.useState(
    initial.startLocation ?? { label: 'Büro', street: '', houseNumber: '', postalCode: '', city: '' },
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const hasLocation = location.street.trim() && location.city.trim();
      const result = await updateOrganizationAction({
        name,
        timezone,
        startLocation: hasLocation ? location : null,
      });
      if (result.ok) {
        setError(null);
        toast.success(
          result.data.geocoded
            ? 'Organisation gespeichert – Startpunkt geokodiert.'
            : 'Organisation gespeichert.',
        );
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <Panel data-tour="leadership-organisation">
      <PanelHeader>
        <PanelTitle>Organisation</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <form onSubmit={submit} method="post" className="max-w-xl space-y-4">
          <FormAlert>{error}</FormAlert>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="org-name" required>
                Name
              </Label>
              <Input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="org-tz">Zeitzone</Label>
              <Input
                id="org-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Europe/Berlin"
              />
            </div>
          </div>
          <fieldset className="rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] p-3">
            <legend className="px-1 text-[length:var(--text-xs)] font-semibold text-[var(--color-ink-subtle)] uppercase">
              Standard-Start/-Ziel für Routen
            </legend>
            <div className="mb-3">
              <Label htmlFor="org-search">Adresse suchen</Label>
              <AddressAutocomplete
                id="org-search"
                onSelect={(suggestion) =>
                  setLocation((previous) => ({
                    label: previous.label || 'Büro',
                    street: suggestion.street,
                    houseNumber: suggestion.houseNumber,
                    postalCode: suggestion.postalCode,
                    city: suggestion.city,
                  }))
                }
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
              <div className="sm:col-span-2">
                <Label htmlFor="org-label">Bezeichnung</Label>
                <Input
                  id="org-label"
                  value={location.label}
                  onChange={(e) => setLocation({ ...location, label: e.target.value })}
                />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="org-street">Straße</Label>
                <Input
                  id="org-street"
                  value={location.street}
                  onChange={(e) => setLocation({ ...location, street: e.target.value })}
                />
              </div>
              <div className="sm:col-span-1">
                <Label htmlFor="org-no">Nr.</Label>
                <Input
                  id="org-no"
                  value={location.houseNumber}
                  onChange={(e) => setLocation({ ...location, houseNumber: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="org-plz">PLZ</Label>
                <Input
                  id="org-plz"
                  inputMode="numeric"
                  value={location.postalCode}
                  onChange={(e) => setLocation({ ...location, postalCode: e.target.value })}
                />
              </div>
              <div className="sm:col-span-4">
                <Label htmlFor="org-city">Ort</Label>
                <Input
                  id="org-city"
                  value={location.city}
                  onChange={(e) => setLocation({ ...location, city: e.target.value })}
                />
              </div>
            </div>
            <FieldHint>Wird beim Speichern automatisch geokodiert (für die Routenplanung).</FieldHint>
          </fieldset>
          <Button type="submit" variant="primary" loading={pending}>
            Organisation speichern
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}

// ----------------------- Benachrichtigungen --------------------------------

const NOTIFICATION_TYPES: { key: string; label: string }[] = [
  { key: 'APPOINTMENT_ASSIGNED', label: 'Termin zugewiesen' },
  { key: 'APPOINTMENT_CHANGED', label: 'Termin geändert' },
  { key: 'APPOINTMENT_CANCELLED', label: 'Termin abgesagt' },
  { key: 'ASSIGNMENT_DECLINED', label: 'Zuweisung abgelehnt' },
  { key: 'HOURS_ALLOCATED', label: 'Stunden erhalten' },
  { key: 'CUSTOMER_OPEN_HOURS', label: 'Kunde hat offene Stunden' },
  { key: 'EMPLOYEE_NEEDS_HOURS', label: 'Mitarbeiter benötigt Stunden' },
  { key: 'ROUTE_PROBLEM', label: 'Routen-Hinweise' },
  { key: 'APPOINTMENT_CONFLICT', label: 'Terminkonflikte' },
  { key: 'SERIES_ENDING', label: 'Serie endet bald' },
  { key: 'BUDGET_ENDING', label: 'Budget endet bald' },
];

export function NotificationPrefsSettings({ initial }: { initial: Record<string, boolean> }) {
  const [prefs, setPrefs] = React.useState<Record<string, boolean>>(initial);
  const [pending, startTransition] = React.useTransition();

  const toggle = (key: string, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    startTransition(async () => {
      const result = await saveNotificationPrefsAction(next);
      if (!result.ok) toast.error(result.message);
    });
  };

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Benachrichtigungen</PanelTitle>
        <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
          In-App · E-Mail/Push folgen später
        </span>
      </PanelHeader>
      <PanelBody className="p-0">
        <ul className="divide-y divide-[var(--color-line-subtle)]">
          {NOTIFICATION_TYPES.map((type) => (
            <li key={type.key} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[length:var(--text-sm)]">{type.label}</span>
              <Switch
                checked={prefs[type.key] !== false}
                onCheckedChange={(value) => toggle(type.key, value)}
                disabled={pending}
                aria-label={`${type.label} aktivieren`}
              />
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}
