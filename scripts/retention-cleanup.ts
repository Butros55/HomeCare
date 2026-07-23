/**
 * Aufbewahrungsfristen anwenden (Anforderung 22, konfiguriert unter
 * Einstellungen → Datenschutz; gespeichert in Organization.settings.retention).
 *
 * Aufruf:  npm run retention:cleanup   (z. B. täglich als geplanter Task)
 *
 * Entfernt je Organisation:
 *  - Benachrichtigungen älter als notificationRetentionMonths
 *  - Audit-Einträge älter als auditRetentionMonths
 *  - abgeschlossene/abgesagte Termine (inkl. Zeiteinträgen via Cascade)
 *    älter als appointmentRetentionMonths (0 = unbegrenzt aufbewahren)
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

function monthsAgo(months: number): Date {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

async function main() {
  const organizations = await db.organization.findMany({
    select: { id: true, name: true, settings: true },
  });

  for (const organization of organizations) {
    const retention = ((organization.settings as Record<string, unknown> | null)?.retention ??
      {}) as {
      appointmentRetentionMonths?: number;
      auditRetentionMonths?: number;
      notificationRetentionMonths?: number;
    };

    const notificationMonths = retention.notificationRetentionMonths ?? 6;
    const auditMonths = retention.auditRetentionMonths ?? 24;
    const appointmentMonths = retention.appointmentRetentionMonths ?? 0;

    const summary: string[] = [];

    if (notificationMonths > 0) {
      const result = await db.notification.deleteMany({
        where: { organizationId: organization.id, createdAt: { lt: monthsAgo(notificationMonths) } },
      });
      if (result.count > 0) summary.push(`${result.count} Benachrichtigungen`);
    }

    if (auditMonths > 0) {
      const result = await db.auditLog.deleteMany({
        where: { organizationId: organization.id, createdAt: { lt: monthsAgo(auditMonths) } },
      });
      if (result.count > 0) summary.push(`${result.count} Audit-Einträge`);
    }

    if (appointmentMonths > 0) {
      const result = await db.appointment.deleteMany({
        where: {
          organizationId: organization.id,
          status: { in: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
          endAt: { lt: monthsAgo(appointmentMonths) },
        },
      });
      if (result.count > 0) summary.push(`${result.count} Termine`);
    }

    console.info(
      `Retention "${organization.name}": ${summary.length > 0 ? summary.join(', ') : 'nichts zu löschen'}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
