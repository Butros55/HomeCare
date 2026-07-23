import { db } from '@/server/db';
import { formatDateTime } from '@/lib/dates';
import { auditActionLabel } from '@/server/audit';
import { requirePermission } from '@/server/permissions';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';

/** Organisationsweiter Aktivitätsverlauf (Owner/Admin). */
export async function AuditLogView() {
  const ctx = await requirePermission('audit.view');
  const entries = await db.auditLog.findMany({
    where: { organizationId: ctx.organization.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { actor: { select: { firstName: true, lastName: true } } },
  });

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Aktivität (letzte 100 Einträge)</PanelTitle>
      </PanelHeader>
      <PanelBody className="p-0">
        {entries.length === 0 ? (
          <p className="p-4 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Noch keine Einträge.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line-subtle)]">
            {entries.map((entry) => (
              <li key={entry.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3 text-[length:var(--text-sm)]">
                  <span className="min-w-0 truncate font-medium">{auditActionLabel(entry.action)}</span>
                  <time className="shrink-0 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                    {formatDateTime(entry.createdAt, ctx.organization.timezone)}
                  </time>
                </div>
                <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                  {entry.actor ? `${entry.actor.firstName} ${entry.actor.lastName}` : 'System'} ·{' '}
                  {entry.entityType}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
