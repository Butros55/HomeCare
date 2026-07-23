import { NextResponse } from 'next/server';

import { dayPeriodInZone } from '@/lib/dates';
import { db } from '@/server/db';
import { getOrgContext } from '@/server/permissions';

/**
 * Heutige eigene Termine + gespeicherte Tagesroute (Anforderung 21):
 * wird vom Service Worker zwischengespeichert und ist offline lesbar.
 * Enthält bewusst nur die für den Einsatz nötigen Kundendaten.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

  const day = dayPeriodInZone(new Date(), ctx.organization.timezone);
  const employeeId = ctx.employee?.id ?? null;

  const [appointments, routePlan] = await Promise.all([
    employeeId
      ? db.appointment.findMany({
          where: {
            organizationId: ctx.organization.id,
            assignedEmployeeId: employeeId,
            deletedAt: null,
            startAt: { gte: day.start, lt: day.end },
            status: { notIn: ['CANCELLED', 'DRAFT'] },
          },
          orderBy: { startAt: 'asc' },
          select: {
            id: true,
            title: true,
            startAt: true,
            endAt: true,
            durationMinutes: true,
            status: true,
            customer: {
              select: {
                firstName: true,
                lastName: true,
                phone: true,
                accessInstructions: true,
                color: true,
              },
            },
            locationAddress: {
              select: {
                street: true,
                houseNumber: true,
                postalCode: true,
                city: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    employeeId
      ? db.routePlan.findFirst({
          where: {
            organizationId: ctx.organization.id,
            employeeId,
            routeDate: { gte: day.start, lt: day.end },
            status: 'PUBLISHED',
          },
          include: { stops: { orderBy: { sequence: 'asc' } } },
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      timezone: ctx.organization.timezone,
      employeeName: ctx.employee ? `${ctx.employee.firstName} ${ctx.employee.lastName}` : null,
      appointments,
      routePlan,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
