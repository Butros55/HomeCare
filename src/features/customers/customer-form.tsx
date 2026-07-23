'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, MapPin } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { AddressAutocomplete } from '@/features/geo/address-autocomplete';
import type { AddressSuggestion } from '@/server/providers/types';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { DurationInput } from '@/components/ui/duration-input';
import { FieldError, FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { WeeklyWindowsEditor } from '@/components/ui/weekly-windows-editor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ENTITY_COLOR_CHOICES, cn } from '@/lib/utils';
import {
  createCustomerAction,
  updateCustomerAction,
} from '@/server/actions/customer-actions';
import { customerFormSchema, type CustomerFormInput } from '@/server/validation/customer';

interface GeocodingCandidate {
  latitude: number;
  longitude: number;
  displayName: string;
  quality: string;
}

export interface CustomerFormInitial {
  customerId?: string;
  values?: Partial<CustomerFormInput>;
}

export function CustomerForm({
  initial,
  employees,
  canEditPrivateNotes,
  onSuccess,
}: {
  initial: CustomerFormInitial;
  employees: { id: string; name: string }[];
  canEditPrivateNotes: boolean;
  /**
   * Wird nach erfolgreichem Anlegen/Speichern aufgerufen (z. B. im Schnell-
   * Anlegen-Popup). Ist er gesetzt, entfällt die sonst übliche Navigation zum
   * Datensatz – der Aufrufer entscheidet selbst (Popup schließen + refresh).
   */
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial.customerId);
  const [pending, startTransition] = React.useTransition();
  const [candidates, setCandidates] = React.useState<GeocodingCandidate[] | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isDirty },
  } = useForm<CustomerFormInput>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      salutation: '',
      firstName: '',
      lastName: '',
      companyName: '',
      customerNumber: '',
      email: '',
      phone: '',
      secondaryPhone: '',
      status: 'ACTIVE',
      preferredEmployeeId: '',
      color: '#6c5ce7',
      accessInstructions: '',
      cleaningInstructions: '',
      privateNotes: '',
      routeNotes: '',
      defaultAppointmentDurationMinutes: 120,
      availability: [],
      address: {
        street: '',
        houseNumber: '',
        addressAddition: '',
        postalCode: '',
        city: '',
        countryCode: 'DE',
      },
      ...initial.values,
    },
  });

  // Warnung bei ungespeicherten Änderungen (Tab schließen/neu laden).
  React.useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Aus dem Autocomplete übernommene Koordinate. Wird beim Speichern als
  // bestätigte Koordinate mitgeschickt (kein erneutes Geocoding nötig).
  const [pickedCoordinate, setPickedCoordinate] = React.useState<{
    latitude: number;
    longitude: number;
    quality: string;
  } | null>(null);

  const applySuggestion = React.useCallback(
    (suggestion: AddressSuggestion) => {
      const options = { shouldDirty: true, shouldValidate: true } as const;
      setValue('address.street', suggestion.street, options);
      setValue('address.houseNumber', suggestion.houseNumber, options);
      setValue('address.postalCode', suggestion.postalCode, options);
      setValue('address.city', suggestion.city, options);
      setValue('address.countryCode', suggestion.countryCode || 'DE', options);
      setPickedCoordinate({
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
        quality: suggestion.houseNumber ? 'exact' : 'approximate',
      });
    },
    [setValue],
  );

  // Manuelles Tippen in einem Adressfeld verwirft die übernommene Koordinate –
  // dann greift beim Speichern wieder das normale Server-Geocoding.
  // (setValue aus applySuggestion löst kein DOM-onChange aus → bleibt erhalten.)
  const clearPickedOnManualEdit = React.useCallback(() => {
    setPickedCoordinate(null);
  }, []);

  const submit = React.useCallback(
    (values: CustomerFormInput, confirmed?: GeocodingCandidate) => {
      startTransition(async () => {
        const payload: CustomerFormInput = confirmed
          ? {
              ...values,
              confirmedCoordinate: {
                latitude: confirmed.latitude,
                longitude: confirmed.longitude,
                quality: confirmed.quality,
              },
            }
          : pickedCoordinate
            ? { ...values, confirmedCoordinate: pickedCoordinate }
            : values;
        const result = initial.customerId
          ? await updateCustomerAction(initial.customerId, payload)
          : await createCustomerAction(payload);

        if (result.ok) {
          toast.success(isEdit ? 'Kunde gespeichert.' : 'Kunde angelegt.');
          if (onSuccess) {
            onSuccess();
            return;
          }
          const id = initial.customerId ?? (result.data as { customerId: string }).customerId;
          router.push(`/customers/${id}`);
          router.refresh();
          return;
        }
        if (result.code === 'GEOCODING_AMBIGUOUS') {
          const details = result.details as { candidates?: GeocodingCandidate[] } | undefined;
          setCandidates(details?.candidates ?? []);
          return;
        }
        toast.error(result.message);
      });
    },
    [initial.customerId, isEdit, router, pickedCoordinate, onSuccess],
  );

  const onSubmit = handleSubmit((values) => submit(values));

  return (
    <form onSubmit={onSubmit} method="post" noValidate className="space-y-4">
      <Panel data-tour="customer-form-master">
        <PanelHeader>
          <PanelTitle>Stammdaten</PanelTitle>
        </PanelHeader>
        <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cf-salutation">Anrede</Label>
            <Controller
              control={control}
              name="salutation"
              render={({ field }) => (
                <Select value={field.value || 'NONE'} onValueChange={(v) => field.onChange(v === 'NONE' ? '' : v)}>
                  <SelectTrigger id="cf-salutation">
                    <SelectValue placeholder="Keine" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Keine</SelectItem>
                    <SelectItem value="Frau">Frau</SelectItem>
                    <SelectItem value="Herr">Herr</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div>
            <Label htmlFor="cf-number">Kundennummer</Label>
            <Input
              id="cf-number"
              placeholder="automatisch"
              invalid={Boolean(errors.customerNumber)}
              {...register('customerNumber')}
            />
            <FieldHint>Leer lassen für automatische Vergabe.</FieldHint>
          </div>
          <div>
            <Label htmlFor="cf-first" required>
              Vorname
            </Label>
            <Input id="cf-first" invalid={Boolean(errors.firstName)} {...register('firstName')} />
            <FieldError>{errors.firstName?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="cf-last" required>
              Nachname
            </Label>
            <Input id="cf-last" invalid={Boolean(errors.lastName)} {...register('lastName')} />
            <FieldError>{errors.lastName?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="cf-company">Firma (optional)</Label>
            <Input id="cf-company" {...register('companyName')} />
          </div>
          <div>
            <Label htmlFor="cf-status">Status</Label>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value ?? 'ACTIVE'} onValueChange={field.onChange}>
                  <SelectTrigger id="cf-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Aktiv</SelectItem>
                    <SelectItem value="PAUSED">Pausiert</SelectItem>
                    <SelectItem value="ARCHIVED">Archiviert</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div>
            <Label htmlFor="cf-email">E-Mail</Label>
            <Input id="cf-email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
            <FieldError>{errors.email?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="cf-employee">Bevorzugter Mitarbeiter</Label>
            <Controller
              control={control}
              name="preferredEmployeeId"
              render={({ field }) => (
                <Select
                  value={field.value || 'NONE'}
                  onValueChange={(v) => field.onChange(v === 'NONE' ? '' : v)}
                >
                  <SelectTrigger id="cf-employee">
                    <SelectValue placeholder="Keiner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Keiner</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div>
            <Label htmlFor="cf-phone">Telefon</Label>
            <Input id="cf-phone" type="tel" {...register('phone')} />
          </div>
          <div>
            <Label htmlFor="cf-phone2">Telefon (weitere)</Label>
            <Input id="cf-phone2" type="tel" {...register('secondaryPhone')} />
          </div>
          <div className="sm:col-span-2">
            <Label>Farbe (Kalender & Karte)</Label>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kundenfarbe">
                  {ENTITY_COLOR_CHOICES.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={field.value === color}
                      aria-label={`Farbe ${color}`}
                      onClick={() => field.onChange(color)}
                      className={cn(
                        'size-7 rounded-full border-2 transition-transform hover:scale-110',
                        field.value === color
                          ? 'border-[var(--color-ink)]'
                          : 'border-transparent',
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              )}
            />
          </div>
        </PanelBody>
      </Panel>

      <Panel data-tour="customer-form-address">
        <PanelHeader>
          <PanelTitle>Adresse</PanelTitle>
        </PanelHeader>
        <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="sm:col-span-6">
            <Label htmlFor="cf-address-search">Adresse suchen</Label>
            <AddressAutocomplete id="cf-address-search" onSelect={applySuggestion} />
            <FieldHint>
              Vorschläge füllen die Felder automatisch – alles bleibt anschließend anpassbar.
            </FieldHint>
          </div>
          {pickedCoordinate ? (
            <p className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--color-success)] sm:col-span-6">
              <Check className="size-3.5 shrink-0" aria-hidden />
              Koordinaten aus dem Vorschlag übernommen ({pickedCoordinate.latitude.toFixed(5)},{' '}
              {pickedCoordinate.longitude.toFixed(5)}).
            </p>
          ) : null}
          <div className="sm:col-span-4">
            <Label htmlFor="cf-street" required>
              Straße
            </Label>
            <Input id="cf-street" invalid={Boolean(errors.address?.street)} {...register('address.street', { onChange: clearPickedOnManualEdit })} />
            <FieldError>{errors.address?.street?.message}</FieldError>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="cf-houseno" required>
              Hausnummer
            </Label>
            <Input
              id="cf-houseno"
              invalid={Boolean(errors.address?.houseNumber)}
              {...register('address.houseNumber', { onChange: clearPickedOnManualEdit })}
            />
            <FieldError>{errors.address?.houseNumber?.message}</FieldError>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="cf-addition">Adresszusatz</Label>
            <Input id="cf-addition" {...register('address.addressAddition')} />
          </div>
          <div className="sm:col-span-1">
            <Label htmlFor="cf-plz" required>
              PLZ
            </Label>
            <Input
              id="cf-plz"
              inputMode="numeric"
              invalid={Boolean(errors.address?.postalCode)}
              {...register('address.postalCode', { onChange: clearPickedOnManualEdit })}
            />
            <FieldError>{errors.address?.postalCode?.message}</FieldError>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="cf-city" required>
              Ort
            </Label>
            <Input id="cf-city" invalid={Boolean(errors.address?.city)} {...register('address.city', { onChange: clearPickedOnManualEdit })} />
            <FieldError>{errors.address?.city?.message}</FieldError>
          </div>
          <div className="sm:col-span-1">
            <Label htmlFor="cf-country">Land</Label>
            <Input id="cf-country" maxLength={2} {...register('address.countryCode', { onChange: clearPickedOnManualEdit })} />
          </div>
          <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)] sm:col-span-6">
            Die Adresse wird beim Speichern automatisch geokodiert und auf der Karte angezeigt.
          </p>
        </PanelBody>
      </Panel>

      <Panel data-tour="customer-form-availability">
        <PanelHeader>
          <PanelTitle>Termine & Verfügbarkeit</PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-4">
          <div className="max-w-xs">
            <Label htmlFor="cf-duration">Standarddauer pro Einsatz</Label>
            <Controller
              control={control}
              name="defaultAppointmentDurationMinutes"
              render={({ field }) => (
                <DurationInput
                  id="cf-duration"
                  value={field.value ?? 120}
                  onChange={(minutes) => field.onChange(minutes ?? 120)}
                  allowEmpty={false}
                  invalid={Boolean(errors.defaultAppointmentDurationMinutes)}
                />
              )}
            />
            <FieldError>{errors.defaultAppointmentDurationMinutes?.message}</FieldError>
            <FieldHint>Wird für automatische Terminvorschläge in der Routenplanung genutzt.</FieldHint>
          </div>
          <div>
            <Label>Verfügbarkeit (Zeitfenster für Termine)</Label>
            <Controller
              control={control}
              name="availability"
              render={({ field }) => (
                <WeeklyWindowsEditor
                  idPrefix="cf-avail"
                  value={(field.value ?? []) as { weekday: number; startTime: string; endTime: string }[]}
                  onChange={field.onChange}
                  emptyHint="Keine Zeitfenster hinterlegt – der Kunde gilt als an allen Tagen und Zeiten verfügbar."
                />
              )}
            />
            <FieldError>{errors.availability?.message as string | undefined}</FieldError>
          </div>
        </PanelBody>
      </Panel>

      <Panel data-tour="customer-form-notes">
        <PanelHeader>
          <PanelTitle>Hinweise</PanelTitle>
        </PanelHeader>
        <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cf-access">Zugang (Schlüssel, Klingel …)</Label>
            <Textarea id="cf-access" rows={3} {...register('accessInstructions')} />
          </div>
          <div>
            <Label htmlFor="cf-cleaning">Reinigungsanweisungen</Label>
            <Textarea id="cf-cleaning" rows={3} {...register('cleaningInstructions')} />
          </div>
          <div>
            <Label htmlFor="cf-route">Routen-Hinweise (Parken …)</Label>
            <Textarea id="cf-route" rows={2} {...register('routeNotes')} />
          </div>
          {canEditPrivateNotes ? (
            <div>
              <Label htmlFor="cf-private">Interne Notizen (nur Leitung)</Label>
              <Textarea id="cf-private" rows={2} {...register('privateNotes')} />
              <FieldHint>Nur für Inhaber und Administratoren sichtbar.</FieldHint>
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      <div className="flex items-center justify-end gap-2" data-tour="customer-form-actions">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {isEdit ? 'Änderungen speichern' : 'Kunde anlegen'}
        </Button>
      </div>

      <Dialog open={candidates !== null} onOpenChange={(open) => !open && setCandidates(null)}>
        <DialogContent
          title="Adresse ist mehrdeutig"
          description="Bitte wähle den passenden Treffer aus – die Koordinate wird für Karte und Routenplanung verwendet."
        >
          <ul className="space-y-2">
            {(candidates ?? []).map((candidate, index) => (
              <li key={`${candidate.latitude}-${candidate.longitude}-${index}`}>
                <button
                  type="button"
                  onClick={() => {
                    setCandidates(null);
                    void handleSubmit((values) => submit(values, candidate))();
                  }}
                  className="flex w-full items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-panel-sunken)] px-3 py-2.5 text-left transition-colors hover:border-[var(--color-brand)]"
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-[var(--color-brand)]" aria-hidden />
                  <span>
                    <span className="block text-[length:var(--text-sm)]">{candidate.displayName}</span>
                    <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                      {candidate.latitude.toFixed(5)}, {candidate.longitude.toFixed(5)} ·{' '}
                      {candidate.quality === 'exact' ? 'exakter Treffer' : 'ungefährer Treffer'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCandidates(null)}>
              Abbrechen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
