'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Input, Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function ReportFilterBar({
  defaultFrom,
  defaultTo,
  employees,
  customers,
  teamManagers,
}: {
  defaultFrom: string;
  defaultTo: string;
  employees: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  teamManagers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="rf-from">Von</Label>
        <Input
          id="rf-from"
          type="date"
          defaultValue={searchParams.get('from') ?? defaultFrom}
          onChange={(event) => setParam('from', event.target.value || null)}
          className="w-36"
        />
      </div>
      <div>
        <Label htmlFor="rf-to">Bis</Label>
        <Input
          id="rf-to"
          type="date"
          defaultValue={searchParams.get('to') ?? defaultTo}
          onChange={(event) => setParam('to', event.target.value || null)}
          className="w-36"
        />
      </div>
      <div>
        <Label>Mitarbeiter</Label>
        <Select
          value={searchParams.get('employeeId') ?? 'ALL'}
          onValueChange={(value) => setParam('employeeId', value === 'ALL' ? null : value)}
        >
          <SelectTrigger className="w-44" aria-label="Mitarbeiter filtern">
            <SelectValue placeholder="Alle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Mitarbeiter</SelectItem>
            {employees.map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {teamManagers.length > 0 ? (
        <div>
          <Label>Team</Label>
          <Select
            value={searchParams.get('teamId') ?? 'ALL'}
            onValueChange={(value) => setParam('teamId', value === 'ALL' ? null : value)}
          >
            <SelectTrigger className="w-40" aria-label="Team filtern">
              <SelectValue placeholder="Alle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Alle Teams</SelectItem>
              {teamManagers.map((manager) => (
                <SelectItem key={manager.id} value={manager.id}>
                  Team {manager.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div>
        <Label>Kunde</Label>
        <Select
          value={searchParams.get('customerId') ?? 'ALL'}
          onValueChange={(value) => setParam('customerId', value === 'ALL' ? null : value)}
        >
          <SelectTrigger className="w-44" aria-label="Kunde filtern">
            <SelectValue placeholder="Alle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Kunden</SelectItem>
            {customers.map((customer) => (
              <SelectItem key={customer.id} value={customer.id}>
                {customer.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Status</Label>
        <Select
          value={searchParams.get('status') ?? 'ALL'}
          onValueChange={(value) => setParam('status', value === 'ALL' ? null : value)}
        >
          <SelectTrigger className="w-40" aria-label="Status filtern">
            <SelectValue placeholder="Alle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Status</SelectItem>
            <SelectItem value="PLANNED">Geplant</SelectItem>
            <SelectItem value="CONFIRMED">Bestätigt</SelectItem>
            <SelectItem value="COMPLETED">Abgeschlossen</SelectItem>
            <SelectItem value="CANCELLED">Abgesagt</SelectItem>
            <SelectItem value="NO_SHOW">Nicht angetroffen</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
