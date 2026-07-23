import { redirect } from 'next/navigation';

import { requireOrganizationMembership } from '@/server/permissions';

/**
 * Im Alleine-Modus gibt es keine Mitarbeiterverwaltung. Der gesamte
 * /employees-Bereich wird daher gesperrt – nicht nur im Menü ausgeblendet,
 * sondern auch per Direkt-URL nicht erreichbar (Anforderung: im Allein-Modus
 * darf man keine Mitarbeiter anlegen oder auf das UI kommen). Beim Wechsel in
 * den Team-Modus ist der Bereich wieder verfügbar.
 */
export default async function EmployeesLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrganizationMembership();
  if (ctx.organization.soloMode) redirect('/dashboard');
  return <>{children}</>;
}
