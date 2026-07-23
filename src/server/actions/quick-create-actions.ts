'use server';

import { employeeDisplayName } from '@/lib/utils';
import { db } from '@/server/db';
import { runAction, type ActionResult } from '@/server/errors';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
} from '@/server/permissions';

/**
 * Kontextdaten für das Schnell-Anlegen-Menü der Topbar (Kunde/Mitarbeiter/
 * Termin als Popup). Wird erst beim ersten Öffnen eines Dialogs geladen, damit
 * die Listen (Kunden/Mitarbeiter) nicht auf jeder Seite mitgeschleppt werden.
 */
export interface QuickCreateContext {
  /** Alleine-Modus: Termine werden automatisch dem eigenen Profil zugewiesen. */
  soloMode: boolean;
  ownEmployeeId: string | null;
  /** Auswahllisten für die Formulare (bereits gescoped + benannt). */
  customers: { id: string; name: string }[];
  employees: { id: string; name: string }[];
  managerOptions: { id: string; name: string }[];
  canManageCustomers: boolean;
  canManageEmployees: boolean;
  canEditPrivateNotes: boolean;
}

export async function getQuickCreateContextAction(): Promise<ActionResult<QuickCreateContext>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    const scope = await getManagedEmployeeIds(ctx);

    const [employees, customers] = await Promise.all([
      db.employee.findMany({
        where: {
          organizationId: ctx.organization.id,
          deletedAt: null,
          status: 'ACTIVE',
          ...employeeScopeFilter(scope),
        },
        select: { id: true, firstName: true, lastName: true, userId: true },
        orderBy: [{ lastName: 'asc' }],
      }),
      hasPermission(ctx, 'customers.read')
        ? db.customer.findMany({
            where: {
              organizationId: ctx.organization.id,
              deletedAt: null,
              status: { not: 'ARCHIVED' },
            },
            select: { id: true, firstName: true, lastName: true },
            orderBy: [{ lastName: 'asc' }],
            take: 500,
          })
        : Promise.resolve([]),
    ]);

    return {
      soloMode: ctx.organization.soloMode,
      ownEmployeeId: ctx.employee?.id ?? null,
      customers: customers.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` })),
      employees: employees.map((e) => ({ id: e.id, name: employeeDisplayName(e, ctx.user.id) })),
      managerOptions: employees.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` })),
      canManageCustomers: hasPermission(ctx, 'customers.manage'),
      canManageEmployees: hasPermission(ctx, 'employees.manage'),
      canEditPrivateNotes: hasPermission(ctx, 'customers.privateNotes'),
    };
  });
}
