'use client';

import { Download, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  anonymizeCustomerAction,
  saveRetentionAction,
  type RetentionInput,
} from '@/server/actions/privacy-actions';

export function PrivacyControls({
  customers,
  employees,
}: {
  customers: { id: string; name: string; archived: boolean }[];
  employees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = React.useState(customers[0]?.id ?? '');
  const [employeeId, setEmployeeId] = React.useState(employees[0]?.id ?? '');
  const [anonymizeId, setAnonymizeId] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const archivedCustomers = customers.filter((c) => c.archived);

  return (
    <>
      <Panel data-tour="privacy-export">
        <PanelHeader>
          <PanelTitle>Datenexport (Art. 15/20 DSGVO)</PanelTitle>
        </PanelHeader>
        <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="pv-customer">Kundendaten exportieren</Label>
            <div className="flex gap-2">
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger id="pv-customer" className="flex-1">
                  <SelectValue placeholder="Kunde wählen" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name || `Kunde ${customer.id.slice(-6)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button asChild variant="secondary" disabled={!customerId}>
                <a href={`/api/privacy/export?type=customer&id=${customerId}`}>
                  <Download aria-hidden /> JSON
                </a>
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="pv-employee">Mitarbeiterdaten exportieren</Label>
            <div className="flex gap-2">
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger id="pv-employee" className="flex-1">
                  <SelectValue placeholder="Mitarbeiter wählen" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button asChild variant="secondary" disabled={!employeeId}>
                <a href={`/api/privacy/export?type=employee&id=${employeeId}`}>
                  <Download aria-hidden /> JSON
                </a>
              </Button>
            </div>
          </div>
        </PanelBody>
      </Panel>

      <Panel data-tour="privacy-anonymize">
        <PanelHeader>
          <PanelTitle>Anonymisierung (Art. 17 DSGVO)</PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-3">
          <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Entfernt unumkehrbar alle personenbezogenen Daten eines <strong>archivierten</strong>{' '}
            Kunden; Termine und Stundenhistorie bleiben anonym erhalten.
          </p>
          {archivedCustomers.length === 0 ? (
            <p className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--color-ink-subtle)]">
              Keine archivierten Kunden vorhanden. Kunden zuerst in der Kundenliste archivieren.
            </p>
          ) : (
            <div className="flex max-w-md gap-2">
              <Select value={anonymizeId} onValueChange={setAnonymizeId}>
                <SelectTrigger className="flex-1" aria-label="Archivierten Kunden wählen">
                  <SelectValue placeholder="Archivierten Kunden wählen" />
                </SelectTrigger>
                <SelectContent>
                  {archivedCustomers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name || `Kunde ${customer.id.slice(-6)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="danger"
                disabled={!anonymizeId}
                onClick={() => setConfirmOpen(true)}
              >
                <ShieldAlert aria-hidden /> Anonymisieren
              </Button>
            </div>
          )}
        </PanelBody>
      </Panel>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Kunden unumkehrbar anonymisieren?"
        description="Name, Kontaktdaten, Adresse und alle Notizen werden dauerhaft entfernt. Diese Aktion kann nicht rückgängig gemacht werden."
        confirmLabel="Endgültig anonymisieren"
        destructive
        loading={pending}
        onConfirm={async () => {
          setPending(true);
          const result = await anonymizeCustomerAction(anonymizeId);
          setPending(false);
          setConfirmOpen(false);
          if (result.ok) {
            toast.success('Kunde anonymisiert.');
            setAnonymizeId('');
            router.refresh();
          } else {
            toast.error(result.message);
          }
        }}
      />
    </>
  );
}

export function RetentionForm({ initial }: { initial: Required<RetentionInput> }) {
  const [values, setValues] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveRetentionAction(values);
      if (result.ok) toast.success('Aufbewahrungsfristen gespeichert.');
      else toast.error(result.message);
    });
  };

  const field = (
    key: keyof RetentionInput,
    label: string,
    hint: string,
  ) => (
    <div>
      <Label htmlFor={`ret-${key}`}>{label}</Label>
      <Input
        id={`ret-${key}`}
        type="number"
        min={0}
        max={120}
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: Number(e.target.value) })}
        className="w-28"
      />
      <FieldHint>{hint}</FieldHint>
    </div>
  );

  return (
    <Panel data-tour="privacy-retention">
      <PanelHeader>
        <PanelTitle>Aufbewahrungsfristen</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <form onSubmit={submit} method="post" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {field(
              'appointmentRetentionMonths',
              'Termine/Zeiten (Monate)',
              '0 = unbegrenzt aufbewahren',
            )}
            {field('auditRetentionMonths', 'Audit-Log (Monate)', 'Empfehlung: 24')}
            {field('notificationRetentionMonths', 'Benachrichtigungen (Monate)', 'Empfehlung: 6')}
          </div>
          <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
            Angewendet durch <code className="font-mono">npm run retention:cleanup</code> (z. B. als
            geplanter Task) – Details in docs/privacy.md.
          </p>
          <Button type="submit" variant="primary" loading={pending}>
            Fristen speichern
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}
