import { NextRequest, NextResponse } from 'next/server';

import { formatMinutesAsDecimalHours } from '@/lib/duration';
import { AppError } from '@/server/errors';
import { getReportData } from '@/server/services/report-service';

/** CSV-Export der Auswertung (GET, sessiongebunden; Excel-kompatibel mit BOM+Semikolon). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const data = await getReportData({
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      employeeId: params.get('employeeId') ?? undefined,
      teamId: params.get('teamId') ?? undefined,
      customerId: params.get('customerId') ?? undefined,
      status: params.get('status') ?? undefined,
    });

    const esc = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const h = (minutes: number) => formatMinutesAsDecimalHours(minutes).replace(' h', '');
    // Ohne Stundenbudgets entfallen die budget-/zuweisungsbezogenen Spalten
    // (Budget/Zugewiesen/Offen) – sie wären ohne Kundenkonten irreführend. Es
    // bleiben Geplant und Geleistet (immer aussagekräftig).
    const withBudget = data.hourBudgetsEnabled;
    const lines: string[] = [];
    lines.push(
      (withBudget
        ? ['Bereich', 'Name', 'Budget (h)', 'Zugewiesen (h)', 'Geplant (h)', 'Geleistet (h)', 'Offen (h)']
        : ['Bereich', 'Name', 'Geplant (h)', 'Geleistet (h)']
      )
        .map(esc)
        .join(';'),
    );
    for (const row of data.customerRows) {
      lines.push(
        (withBudget
          ? ['Kunde', row.name, h(row.budgetMinutes), h(row.allocatedMinutes), h(row.plannedMinutes), h(row.completedMinutes), h(row.openMinutes)]
          : ['Kunde', row.name, h(row.plannedMinutes), h(row.completedMinutes)]
        )
          .map(esc)
          .join(';'),
      );
    }
    for (const row of data.employeeRows) {
      lines.push(
        (withBudget
          ? ['Mitarbeiter', row.name, '', h(row.allocatedMinutes), h(row.plannedMinutes), h(row.completedMinutes), h(row.selfObligationMinutes)]
          : ['Mitarbeiter', row.name, h(row.plannedMinutes), h(row.completedMinutes)]
        )
          .map(esc)
          .join(';'),
      );
    }

    const csv = `﻿${lines.join('\r\n')}`;
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="auswertung_${data.period.from}_${data.period.to}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('[reports/export]', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
