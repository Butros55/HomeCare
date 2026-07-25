'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FieldHint, Input, Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { registerEmployeeAction } from '@/server/auth/actions';

const WEEKDAYS = [
  { value: 1, label: 'Montag' },
  { value: 2, label: 'Dienstag' },
  { value: 3, label: 'Mittwoch' },
  { value: 4, label: 'Donnerstag' },
  { value: 5, label: 'Freitag' },
  { value: 6, label: 'Samstag' },
  { value: 7, label: 'Sonntag' },
];

interface Slot {
  key: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

/**
 * Erweiterte Mitarbeiter-Selbstregistrierung (nur über den Einladungslink).
 * Neben Konto/Passwort legt der Mitarbeiter direkt Zuhause-Adresse (Routenstart)
 * und wöchentliche Verfügbarkeiten an. Adresse & Zeiten sind optional.
 */
export function EmployeeRegistrationForm({
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
  const router = useRouter();
  const [firstName, setFirstName] = React.useState(initialFirstName);
  const [lastName, setLastName] = React.useState(initialLastName);
  const [password, setPassword] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [street, setStreet] = React.useState('');
  const [houseNumber, setHouseNumber] = React.useState('');
  const [postalCode, setPostalCode] = React.useState('');
  const [city, setCity] = React.useState('');
  const [slots, setSlots] = React.useState<Slot[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const addSlot = () =>
    setSlots((current) => {
      // Nächster Wochentag nach dem höchsten bereits erfassten (bei Voll → Montag)
      // und dieselben Zeiten wie zuletzt – so lassen sich aufeinanderfolgende Tage
      // per Klick anlegen, ohne jedes Mal den Wochentag zu ändern.
      const highest = current.reduce<Slot | null>(
        (best, slot) => (!best || slot.weekday > best.weekday ? slot : best),
        null,
      );
      const weekday = highest ? (highest.weekday % 7) + 1 : 1;
      return [
        ...current,
        {
          key: `slot-${current.length}-${Date.now()}`,
          weekday,
          startTime: highest?.startTime ?? '08:00',
          endTime: highest?.endTime ?? '16:00',
        },
      ];
    });
  const updateSlot = (key: string, patch: Partial<Slot>) =>
    setSlots((current) => current.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)));
  const removeSlot = (key: string) =>
    setSlots((current) => current.filter((slot) => slot.key !== key));

  const submit = () => {
    setError(null);

    if (password.length < 8) {
      setError('Das Passwort braucht mindestens 8 Zeichen.');
      return;
    }
    const addressTouched = street || houseNumber || postalCode || city;
    if (addressTouched && !(street && houseNumber && postalCode && city)) {
      setError('Bitte die Zuhause-Adresse vollständig ausfüllen oder alle Felder leer lassen.');
      return;
    }
    if (slots.some((slot) => slot.startTime >= slot.endTime)) {
      setError('Jedes Zeitfenster braucht ein Ende nach dem Beginn.');
      return;
    }

    startTransition(async () => {
      const result = await registerEmployeeAction({
        token,
        firstName,
        lastName,
        password,
        phone: phone || undefined,
        homeLocation: addressTouched ? { street, houseNumber, postalCode, city } : undefined,
        availabilitySlots: slots.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
      });
      if (result.ok) {
        router.push('/dashboard');
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  const sorted = [...slots].sort(
    (a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[length:var(--text-xl)] font-semibold">Konto einrichten</h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
          Du wurdest zu <strong>{organizationName}</strong> eingeladen ({email}). Lege dein Passwort
          fest und – falls du magst – direkt deine Adresse und Verfügbarkeit.
        </p>
      </div>

      <FormAlert>{error}</FormAlert>

      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="reg-first" required>
              Vorname
            </Label>
            <Input id="reg-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="reg-last" required>
              Nachname
            </Label>
            <Input id="reg-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </div>
        </div>
        <div>
          <Label htmlFor="reg-password" required>
            Passwort festlegen
          </Label>
          <Input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />
          <FieldHint>Mindestens 8 Zeichen, mit Buchstabe und Ziffer.</FieldHint>
        </div>
        <div>
          <Label htmlFor="reg-phone">Telefon (optional)</Label>
          <Input id="reg-phone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-[length:var(--text-sm)] font-semibold">Zuhause-Adresse (optional)</h2>
          <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
            Startpunkt „Zuhause“ für die Routenplanung. Kann später ergänzt werden.
          </p>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <Label htmlFor="reg-street">Straße</Label>
            <Input id="reg-street" value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="address-line1" />
          </div>
          <div>
            <Label htmlFor="reg-house">Nr.</Label>
            <Input id="reg-house" value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} className="w-24" />
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <div>
            <Label htmlFor="reg-zip">PLZ</Label>
            <Input id="reg-zip" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="w-28" autoComplete="postal-code" inputMode="numeric" />
          </div>
          <div>
            <Label htmlFor="reg-city">Ort</Label>
            <Input id="reg-city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-[length:var(--text-sm)] font-semibold">Wöchentliche Verfügbarkeit (optional)</h2>
          <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
            Ohne Angabe giltst du als uneingeschränkt verfügbar. Zeitfenster steuern Planung und
            Terminvorschläge.
          </p>
        </div>

        {sorted.length > 0 ? (
          <ul className="space-y-2">
            {sorted.map((slot) => (
              <li
                key={slot.key}
                className="flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] p-2.5"
              >
                <div className="min-w-36 flex-1">
                  <Label htmlFor={`reg-day-${slot.key}`}>Wochentag</Label>
                  <Select
                    value={String(slot.weekday)}
                    onValueChange={(value) => updateSlot(slot.key, { weekday: Number(value) })}
                  >
                    <SelectTrigger id={`reg-day-${slot.key}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((day) => (
                        <SelectItem key={day.value} value={String(day.value)}>
                          {day.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`reg-start-${slot.key}`}>Von</Label>
                  <Input
                    id={`reg-start-${slot.key}`}
                    type="time"
                    value={slot.startTime}
                    onChange={(e) => updateSlot(slot.key, { startTime: e.target.value })}
                    className="w-28"
                  />
                </div>
                <div>
                  <Label htmlFor={`reg-end-${slot.key}`}>Bis</Label>
                  <Input
                    id={`reg-end-${slot.key}`}
                    type="time"
                    value={slot.endTime}
                    onChange={(e) => updateSlot(slot.key, { endTime: e.target.value })}
                    className="w-28"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSlot(slot.key)}
                  aria-label="Zeitfenster entfernen"
                  className="text-[var(--color-danger)]"
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <Button variant="secondary" size="sm" onClick={addSlot} type="button">
          <Plus aria-hidden /> Zeitfenster hinzufügen
        </Button>
      </section>

      <Button variant="primary" size="lg" className="w-full" loading={pending} onClick={submit}>
        Konto erstellen & anmelden
      </Button>
    </div>
  );
}
