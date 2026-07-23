import { NextResponse } from 'next/server';

import { toCsv } from '@/lib/csv';
import { toDateInputValue } from '@/lib/dates';
import { formatMinutesAsDecimalHours } from '@/lib/duration';
import { AppError } from '@/server/errors';
import { db } from '@/server/db';
import { customerScopeWhere, hasPermission, requirePermission } from '@/server/permissions';
import {
  CUSTOMER_CSV_COLUMNS,
  CUSTOMER_CSV_FILENAME_PREFIX,
} from '@/features/customers/csv-schema';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Aktiv',
  PAUSED: 'Pausiert',
  ARCHIVED: 'Archiviert',
};

/** Dezimal mit deutschem Komma (Re-Import versteht Komma und Punkt). */
const decimal = (value: number | null | undefined) =>
  value == null ? '' : String(value).replace('.', ',');

/**
 * CSV-Export aller Kunden (GET, sessiongebunden; Excel-kompatibel mit
 * BOM + Semikolon). Spalten = Import-Schema → die Datei ist direkt
 * re-importierbar (inkl. Koordinaten, spart erneutes Geocoding).
 */
export async function GET() {
  try {
    const ctx = await requirePermission('customers.read');
    const scopeWhere = await customerScopeWhere(ctx);
    const canPrivateNotes = hasPermission(ctx, 'customers.privateNotes');

    const customers = await db.customer.findMany({
      where: { organizationId: ctx.organization.id, ...scopeWhere },
      include: {
        addresses: { take: 1, orderBy: { label: 'asc' } },
        preferredEmployee: { select: { personnelNumber: true } },
      },
      orderBy: [{ customerNumber: 'asc' }],
    });

    // „Stunden pro Monat" = aktive monatliche Aufladung (Konto-Modell), auf
    // ein Monatsäquivalent normiert – so bleibt die Datei re-importierbar.
    const grants = await db.customerRecurringHourGrant.findMany({
      where: {
        customerId: { in: customers.map((c) => c.id) },
        active: true,
      },
      select: { customerId: true, minutes: true, intervalUnit: true, intervalCount: true },
    });
    const monthlyMinutesByCustomer = new Map<string, number>();
    for (const grant of grants) {
      const count = Math.max(1, grant.intervalCount);
      const perMonth =
        grant.intervalUnit === 'MONTH'
          ? grant.minutes / count
          : (grant.minutes / count) * (52 / 12); // Wochen → Monatsäquivalent
      monthlyMinutesByCustomer.set(
        grant.customerId,
        (monthlyMinutesByCustomer.get(grant.customerId) ?? 0) + perMonth,
      );
    }

    const rows: (string | number | null)[][] = [CUSTOMER_CSV_COLUMNS.map((c) => c.label)];
    for (const customer of customers) {
      const address = customer.addresses[0] ?? null;
      const budgetMinutes = Math.round(monthlyMinutesByCustomer.get(customer.id) ?? 0);
      rows.push(
        CUSTOMER_CSV_COLUMNS.map((column) => {
          switch (column.key) {
            case 'customerNumber':
              return customer.customerNumber;
            case 'salutation':
              return customer.salutation;
            case 'firstName':
              return customer.firstName;
            case 'lastName':
              return customer.lastName;
            case 'companyName':
              return customer.companyName;
            case 'email':
              return customer.email;
            case 'phone':
              return customer.phone;
            case 'secondaryPhone':
              return customer.secondaryPhone;
            case 'status':
              return STATUS_LABEL[customer.status] ?? customer.status;
            case 'street':
              return address?.street ?? '';
            case 'houseNumber':
              return address?.houseNumber ?? '';
            case 'addressAddition':
              return address?.addressAddition ?? '';
            case 'postalCode':
              return address?.postalCode ?? '';
            case 'city':
              return address?.city ?? '';
            case 'countryCode':
              return address?.countryCode ?? 'DE';
            case 'preferredEmployeeNumber':
              return customer.preferredEmployee?.personnelNumber ?? '';
            case 'color':
              return customer.color;
            case 'monthlyHours':
              return budgetMinutes > 0
                ? formatMinutesAsDecimalHours(budgetMinutes).replace(' h', '')
                : '';
            case 'routeNotes':
              return customer.routeNotes;
            case 'accessInstructions':
              return customer.accessInstructions;
            case 'cleaningInstructions':
              return customer.cleaningInstructions;
            case 'privateNotes':
              return canPrivateNotes ? customer.privateNotes : '';
            case 'latitude':
              return decimal(address?.latitude);
            case 'longitude':
              return decimal(address?.longitude);
          }
        }),
      );
    }

    const today = toDateInputValue(new Date(), ctx.organization.timezone);
    return new NextResponse(`﻿${toCsv(rows)}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${CUSTOMER_CSV_FILENAME_PREFIX}_${today}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('[customers/export]', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
