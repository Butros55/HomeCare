'use client';

import type { TaxEmploymentType } from '@prisma/client';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/layout/theme-provider';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Checkbox, Switch } from '@/components/ui/misc';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { changePasswordAction, updateProfileAction } from '@/server/auth/actions';
import { updateOwnHomeLocationAction } from '@/server/actions/employee-actions';
import {
  saveEarningsSettingsAction,
  saveNotificationPrefsAction,
} from '@/server/actions/preference-actions';
import { updateOrganizationAction } from '@/server/actions/settings-actions';
import { AddressAutocomplete } from '@/features/geo/address-autocomplete';
import { MapAppearanceCard, type MapPreviewCenter } from '@/features/map/map-appearance';

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

// -------------------------- Verdienst -------------------------------------

function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function inputValueToCents(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

export function EarningsSettings({
  initial,
  showCommission,
}: {
  initial: {
    hourlyWageCents: number;
    employeeCommissionCentsPerHour: number;
    taxEmploymentType: TaxEmploymentType | null;
    incomeTaxRatePercent: number | null;
    churchTaxRatePercent: number;
    healthInsuranceExtraRatePercent: number;
    hasChildren: boolean;
    applySolidarity: boolean;
    taxFreeBonusCentsPerHour: number;
    taxFreeBonusLabel: string;
    mileageRatePerKmCents: number;
  };
  showCommission: boolean;
}) {
  const router = useRouter();
  const [hourlyWage, setHourlyWage] = React.useState(
    centsToInputValue(initial.hourlyWageCents),
  );
  const [commission, setCommission] = React.useState(
    centsToInputValue(initial.employeeCommissionCentsPerHour),
  );
  const [taxEmploymentType, setTaxEmploymentType] = React.useState<TaxEmploymentType | ''>(
    initial.taxEmploymentType ?? '',
  );
  const [incomeTaxRate, setIncomeTaxRate] = React.useState(
    initial.incomeTaxRatePercent != null ? String(initial.incomeTaxRatePercent) : '',
  );
  const [churchTaxRate, setChurchTaxRate] = React.useState(String(initial.churchTaxRatePercent));
  const [healthExtraRate, setHealthExtraRate] = React.useState(
    String(initial.healthInsuranceExtraRatePercent),
  );
  const [hasChildren, setHasChildren] = React.useState(initial.hasChildren);
  const [applySolidarity, setApplySolidarity] = React.useState(initial.applySolidarity);
  const [bonus, setBonus] = React.useState(centsToInputValue(initial.taxFreeBonusCentsPerHour));
  const [bonusLabel, setBonusLabel] = React.useState(initial.taxFreeBonusLabel);
  const [mileageRate, setMileageRate] = React.useState(
    centsToInputValue(initial.mileageRatePerKmCents),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  /** Netto braucht die Beschäftigungsart; außer Minijob zusätzlich den Steuersatz. */
  const needsTaxRate = taxEmploymentType === 'EMPLOYED' || taxEmploymentType === 'SELF_EMPLOYED';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const hourlyWageCents = inputValueToCents(hourlyWage);
    const employeeCommissionCentsPerHour =
      inputValueToCents(commission);
    const taxFreeBonusCentsPerHour = inputValueToCents(bonus);
    const mileageRatePerKmCents = inputValueToCents(mileageRate);
    if (
      hourlyWageCents === null ||
      taxFreeBonusCentsPerHour === null ||
      mileageRatePerKmCents === null ||
      (showCommission && employeeCommissionCentsPerHour === null)
    ) {
      setError('Bitte einen gültigen Betrag mit höchstens zwei Nachkommastellen eingeben.');
      return;
    }
    const parsedTaxRate = incomeTaxRate.trim() === '' ? null : Number(incomeTaxRate.replace(',', '.'));
    if (needsTaxRate && (parsedTaxRate === null || !Number.isFinite(parsedTaxRate))) {
      setError('Bitte den geschätzten Steuersatz in Prozent angeben – sonst ist kein Netto möglich.');
      return;
    }

    startTransition(async () => {
      const result = await saveEarningsSettingsAction({
        hourlyWageCents,
        ...(showCommission
          ? { employeeCommissionCentsPerHour: employeeCommissionCentsPerHour! }
          : {}),
        taxEmploymentType: taxEmploymentType === '' ? null : taxEmploymentType,
        incomeTaxRatePercent: parsedTaxRate,
        churchTaxRatePercent: Number(churchTaxRate.replace(',', '.')) || 0,
        healthInsuranceExtraRatePercent: Number(healthExtraRate.replace(',', '.')) || 0,
        hasChildren,
        applySolidarity,
        taxFreeBonusCentsPerHour,
        taxFreeBonusLabel: bonusLabel.trim() || 'Werbepauschale',
        mileageRatePerKmCents,
      });
      if (result.ok) {
        setError(null);
        setHourlyWage(centsToInputValue(result.data.hourlyWageCents));
        if (showCommission) {
          setCommission(
            centsToInputValue(
              result.data.employeeCommissionCentsPerHour,
            ),
          );
        }
        toast.success('Verdienst-Einstellungen gespeichert.');
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Verdienst</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <form onSubmit={submit} method="post" className="max-w-xl space-y-4">
          <FormAlert>{error}</FormAlert>
          <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
            Diese persönlichen Sätze gelten nur in dieser Organisation. Im Bericht werden
            ausschließlich abgeschlossene Termine berücksichtigt.
          </p>
          <div
            className={cn(
              'grid grid-cols-1 gap-3',
              showCommission && 'sm:grid-cols-2',
            )}
          >
            <div>
              <Label htmlFor="earnings-hourly-wage">Eigener Stundenlohn</Label>
              <div className="relative">
                <Input
                  id="earnings-hourly-wage"
                  inputMode="decimal"
                  value={hourlyWage}
                  onChange={(event) => setHourlyWage(event.target.value)}
                  className="pr-12"
                />
                <span
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]"
                  aria-hidden
                >
                  €/Std.
                </span>
              </div>
              <FieldHint>Grundlage für deinen eigenen Verdienst.</FieldHint>
            </div>
            {showCommission ? (
              <div>
                <Label htmlFor="earnings-commission">Provision je Mitarbeiterstunde</Label>
                <div className="relative">
                  <Input
                    id="earnings-commission"
                    inputMode="decimal"
                    value={commission}
                    onChange={(event) => setCommission(event.target.value)}
                    className="pr-12"
                  />
                  <span
                    className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]"
                    aria-hidden
                  >
                    €/Std.
                  </span>
                </div>
                <FieldHint>
                  Gilt für abgeschlossene Stunden deiner Mitarbeiter.
                </FieldHint>
              </div>
            ) : null}
          </div>

          {/* Steuerfreier Zuschlag – z. B. Werbepauschale fürs Flyerverteilen. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="earnings-bonus">Steuerfreier Zuschlag je Stunde</Label>
              <div className="relative">
                <Input
                  id="earnings-bonus"
                  inputMode="decimal"
                  value={bonus}
                  onChange={(event) => setBonus(event.target.value)}
                  className="pr-12"
                />
                <span
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]"
                  aria-hidden
                >
                  €/Std.
                </span>
              </div>
              <FieldHint>
                Wird zusätzlich zum Stundenlohn gezahlt und nicht besteuert.
              </FieldHint>
            </div>
            <div>
              <Label htmlFor="earnings-bonus-label">Bezeichnung des Zuschlags</Label>
              <Input
                id="earnings-bonus-label"
                value={bonusLabel}
                maxLength={60}
                onChange={(event) => setBonusLabel(event.target.value)}
              />
              <FieldHint>Erscheint so im Bericht.</FieldHint>
            </div>
            <div>
              <Label htmlFor="earnings-mileage-rate">Kilometergeld</Label>
              <div className="relative">
                <Input
                  id="earnings-mileage-rate"
                  inputMode="decimal"
                  value={mileageRate}
                  onChange={(event) => setMileageRate(event.target.value)}
                  className="pr-12"
                />
                <span
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]"
                  aria-hidden
                >
                  €/km
                </span>
              </div>
              <FieldHint>
                Steuerfrei je gefahrenem Routen-Kilometer – zählt nur für deine eigenen Fahrten.
              </FieldHint>
            </div>
          </div>

          {/* Angaben für die Netto-Schätzung. */}
          <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] bg-[var(--color-panel-sunken)] p-3">
            <div>
              <p className="text-[length:var(--text-sm)] font-medium">Netto-Schätzung</p>
              <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                Ohne diese Angaben zeigt der Bericht nur Brutto. Die Berechnung ist eine
                Orientierung, keine Lohnabrechnung und keine Steuerberatung – die genaue
                Lohnsteuer ergibt sich aus den amtlichen Tabellen.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="earnings-employment">Beschäftigungsart</Label>
                <select
                  id="earnings-employment"
                  value={taxEmploymentType}
                  onChange={(event) =>
                    setTaxEmploymentType(event.target.value as TaxEmploymentType | '')
                  }
                  className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 text-[length:var(--text-sm)]"
                >
                  <option value="">Keine Angabe (nur Brutto)</option>
                  <option value="MINIJOB">Minijob (Pauschalabgaben)</option>
                  <option value="EMPLOYED">Angestellt (sozialversicherungspflichtig)</option>
                  <option value="SELF_EMPLOYED">Selbständig</option>
                </select>
                <FieldHint>
                  Beim Minijob bleibt brutto = netto, die Abgaben trägt der Arbeitgeber.
                </FieldHint>
              </div>

              {needsTaxRate ? (
                <div>
                  <Label htmlFor="earnings-tax-rate">
                    {taxEmploymentType === 'SELF_EMPLOYED'
                      ? 'Geschätzte Einkommensteuer'
                      : 'Geschätzte Lohnsteuer'}
                  </Label>
                  <div className="relative">
                    <Input
                      id="earnings-tax-rate"
                      inputMode="decimal"
                      value={incomeTaxRate}
                      onChange={(event) => setIncomeTaxRate(event.target.value)}
                      className="pr-8"
                    />
                    <span
                      className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]"
                      aria-hidden
                    >
                      %
                    </span>
                  </div>
                  <FieldHint>Dein persönlicher Satz, z. B. aus der letzten Abrechnung.</FieldHint>
                </div>
              ) : null}
            </div>

            {taxEmploymentType === 'EMPLOYED' || taxEmploymentType === 'SELF_EMPLOYED' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="earnings-church">Kirchensteuer</Label>
                  <select
                    id="earnings-church"
                    value={churchTaxRate}
                    onChange={(event) => setChurchTaxRate(event.target.value)}
                    className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 text-[length:var(--text-sm)]"
                  >
                    <option value="0">Keine</option>
                    <option value="8">8 % (BW, BY)</option>
                    <option value="9">9 % (übrige Länder)</option>
                  </select>
                </div>
                {taxEmploymentType === 'EMPLOYED' ? (
                  <div>
                    <Label htmlFor="earnings-health-extra">Zusatzbeitrag Krankenkasse</Label>
                    <div className="relative">
                      <Input
                        id="earnings-health-extra"
                        inputMode="decimal"
                        value={healthExtraRate}
                        onChange={(event) => setHealthExtraRate(event.target.value)}
                        className="pr-8"
                      />
                      <span
                        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]"
                        aria-hidden
                      >
                        %
                      </span>
                    </div>
                    <FieldHint>Gesamtsatz der Kasse – getragen wird die Hälfte.</FieldHint>
                  </div>
                ) : null}
              </div>
            ) : null}

            {taxEmploymentType === 'EMPLOYED' || taxEmploymentType === 'SELF_EMPLOYED' ? (
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-[length:var(--text-sm)]">
                  <Checkbox
                    checked={hasChildren}
                    onCheckedChange={(checked) => setHasChildren(Boolean(checked))}
                  />
                  Kinder (kein Pflege-Zuschlag)
                </label>
                <label className="flex items-center gap-2 text-[length:var(--text-sm)]">
                  <Checkbox
                    checked={applySolidarity}
                    onCheckedChange={(checked) => setApplySolidarity(Boolean(checked))}
                  />
                  Solidaritätszuschlag
                </label>
              </div>
            ) : null}
          </div>

          <Button type="submit" variant="primary" loading={pending}>
            Verdienst speichern
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

export function AppearanceSettings({ mapCenter }: { mapCenter: MapPreviewCenter | null }) {
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
    <>
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

      {/* Karten-Vorschau mit „Bearbeiten"-Popup (Einstellungen links, Karte rechts). */}
      <MapAppearanceCard center={mapCenter} />
    </>
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
