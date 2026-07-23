import { db } from '@/server/db';
import { requirePermission } from '@/server/permissions';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { PrivacyControls, RetentionForm } from '@/features/settings/privacy-controls';

/** Datenschutz-Tab: Exporte, Anonymisierung, Aufbewahrungsfristen (docs/privacy.md). */
export async function PrivacySettings() {
  const ctx = await requirePermission('privacy.export');

  const [customers, employees] = await Promise.all([
    db.customer.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, firstName: true, lastName: true, deletedAt: true },
      orderBy: [{ lastName: 'asc' }],
      take: 500,
    }),
    db.employee.findMany({
      where: { organizationId: ctx.organization.id, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: 'asc' }],
    }),
  ]);

  const retention = ((ctx.organization.settings as Record<string, unknown> | null)?.retention ??
    {}) as {
    appointmentRetentionMonths?: number;
    auditRetentionMonths?: number;
    notificationRetentionMonths?: number;
  };

  return (
    <>
      <PrivacyControls
        customers={customers.map((c) => ({
          id: c.id,
          name: `${c.firstName} ${c.lastName}`.trim(),
          archived: c.deletedAt !== null,
        }))}
        employees={employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))}
      />
      <RetentionForm
        initial={{
          appointmentRetentionMonths: retention.appointmentRetentionMonths ?? 0,
          auditRetentionMonths: retention.auditRetentionMonths ?? 24,
          notificationRetentionMonths: retention.notificationRetentionMonths ?? 6,
        }}
      />
      <Panel>
        <PanelHeader>
          <PanelTitle>Grundsätze</PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-2 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
          <p>
            Mitarbeiter sehen nur die Kundendaten, die für ihre Einsätze erforderlich sind; interne
            Notizen sind gesondert berechtigt. Karten-/Routing-Anbieter erhalten ausschließlich
            Koordinaten bzw. die für das Routing nötigen Adressbestandteile.
          </p>
          <p>
            Kunden mit Historie werden archiviert (Soft Delete) und können anschließend
            anonymisiert werden – Auswertungen bleiben konsistent, der Personenbezug entfällt.
            Details: <code className="font-mono text-[length:var(--text-xs)]">docs/privacy.md</code>
          </p>
        </PanelBody>
      </Panel>
    </>
  );
}
