'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DurationInput } from '@/components/ui/duration-input';
import { FieldError, FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createEmployeeAction,
  updateEmployeeAction,
} from '@/server/actions/employee-actions';
import { employeeFormSchema, type EmployeeFormInput } from '@/server/validation/employee';

export function EmployeeForm({
  initial,
  managerOptions,
}: {
  initial: { employeeId?: string; values?: Partial<EmployeeFormInput> };
  /** Mögliche Vorgesetzte (bereits serverseitig gefiltert, ohne den Mitarbeiter selbst). */
  managerOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const isEdit = Boolean(initial.employeeId);
  const [pending, startTransition] = React.useTransition();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
  } = useForm<EmployeeFormInput>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      personnelNumber: '',
      status: 'ACTIVE',
      employmentType: 'PART_TIME',
      managerEmployeeId: '',
      targetMinutesPerWeek: null,
      targetMinutesPerMonth: null,
      maximumMinutesPerDay: null,
      canRecruitEmployees: false,
      canReceiveHours: true,
      notes: '',
      ...initial.values,
    },
  });

  React.useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = initial.employeeId
        ? await updateEmployeeAction(initial.employeeId, values)
        : await createEmployeeAction(values);
      if (result.ok) {
        toast.success(isEdit ? 'Mitarbeiter gespeichert.' : 'Mitarbeiter angelegt.');
        const id = initial.employeeId ?? (result.data as { employeeId: string }).employeeId;
        router.push(`/employees/${id}`);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} method="post" noValidate className="space-y-4">
      <Panel data-tour="employee-form-master">
        <PanelHeader>
          <PanelTitle>Stammdaten</PanelTitle>
        </PanelHeader>
        <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ef-first" required>
              Vorname
            </Label>
            <Input id="ef-first" invalid={Boolean(errors.firstName)} {...register('firstName')} />
            <FieldError>{errors.firstName?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="ef-last" required>
              Nachname
            </Label>
            <Input id="ef-last" invalid={Boolean(errors.lastName)} {...register('lastName')} />
            <FieldError>{errors.lastName?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="ef-email">E-Mail</Label>
            <Input id="ef-email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
            <FieldError>{errors.email?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="ef-phone">Telefon</Label>
            <Input id="ef-phone" type="tel" {...register('phone')} />
          </div>
          <div>
            <Label htmlFor="ef-personnel">Personalnummer</Label>
            <Input id="ef-personnel" {...register('personnelNumber')} />
          </div>
          <div>
            <Label htmlFor="ef-type">Beschäftigungsart</Label>
            <Controller
              control={control}
              name="employmentType"
              render={({ field }) => (
                <Select value={field.value ?? 'PART_TIME'} onValueChange={field.onChange}>
                  <SelectTrigger id="ef-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FULL_TIME">Vollzeit</SelectItem>
                    <SelectItem value="PART_TIME">Teilzeit</SelectItem>
                    <SelectItem value="MINI_JOB">Minijob</SelectItem>
                    <SelectItem value="FREELANCE">Freiberuflich</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div>
            <Label htmlFor="ef-manager">Vorgesetzter</Label>
            <Controller
              control={control}
              name="managerEmployeeId"
              render={({ field }) => (
                <Select
                  value={field.value || 'NONE'}
                  onValueChange={(v) => field.onChange(v === 'NONE' ? '' : v)}
                >
                  <SelectTrigger id="ef-manager">
                    <SelectValue placeholder="Keiner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Keiner</SelectItem>
                    {managerOptions.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldHint>Zyklen werden serverseitig verhindert.</FieldHint>
          </div>
          <div>
            <Label htmlFor="ef-status">Status</Label>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value ?? 'ACTIVE'} onValueChange={field.onChange}>
                  <SelectTrigger id="ef-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Aktiv</SelectItem>
                    <SelectItem value="INACTIVE">Inaktiv</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </PanelBody>
      </Panel>

      <Panel data-tour="employee-form-hours">
        <PanelHeader>
          <PanelTitle>Arbeitszeit & Stunden</PanelTitle>
        </PanelHeader>
        <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="ef-target-week">Zielstunden pro Woche</Label>
            <Controller
              control={control}
              name="targetMinutesPerWeek"
              render={({ field }) => (
                <DurationInput
                  id="ef-target-week"
                  value={field.value ?? null}
                  onChange={field.onChange}
                  placeholder="z. B. „20“"
                />
              )}
            />
          </div>
          <div>
            <Label htmlFor="ef-target-month">Zielstunden pro Monat</Label>
            <Controller
              control={control}
              name="targetMinutesPerMonth"
              render={({ field }) => (
                <DurationInput
                  id="ef-target-month"
                  value={field.value ?? null}
                  onChange={field.onChange}
                  placeholder="z. B. „86,7“"
                />
              )}
            />
          </div>
          <div>
            <Label htmlFor="ef-daymax">Max. Stunden pro Tag</Label>
            <Controller
              control={control}
              name="maximumMinutesPerDay"
              render={({ field }) => (
                <DurationInput
                  id="ef-daymax"
                  value={field.value ?? null}
                  onChange={field.onChange}
                  placeholder="z. B. „8“"
                />
              )}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2.5 sm:col-span-3">
            <span>
              <span className="block text-[length:var(--text-sm)] font-medium">Kann Stunden erhalten</span>
              <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                Erscheint als Empfänger bei der Stundenzuweisung.
              </span>
            </span>
            <Controller
              control={control}
              name="canReceiveHours"
              render={({ field }) => <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2.5 sm:col-span-3">
            <span>
              <span className="block text-[length:var(--text-sm)] font-medium">Darf Mitarbeiter anwerben</span>
              <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                Team-Manager mit dieser Option dürfen in ihrem Bereich Mitarbeiter einladen.
              </span>
            </span>
            <Controller
              control={control}
              name="canRecruitEmployees"
              render={({ field }) => <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />}
            />
          </label>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Notizen</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <Textarea rows={3} {...register('notes')} aria-label="Notizen" />
        </PanelBody>
      </Panel>

      <div className="flex items-center justify-end gap-2" data-tour="employee-form-actions">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {isEdit ? 'Änderungen speichern' : 'Mitarbeiter anlegen'}
        </Button>
      </div>
    </form>
  );
}
