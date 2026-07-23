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
    const lines: string[] = [];
    lines.push(['Bereich', 'Name', 'Budget (h)', 'Zugewiesen (h)', 'Geplant (h)', 'Geleistet (h)', 'Offen (h)'].map(esc).join(';'));
    for (const row of data.customerRows) {
      lines.push(
        [
          'Kunde',
          row.name,
          formatMinutesAsDecimalHours(row.budgetMinutes).replace(' h', ''),
          formatMinutesAsDecimalHours(row.allocatedMinutes).replace(' h', ''),
          formatMinutesAsDecimalHours(row.plannedMinutes).replace(' h', ''),
          formatMinutesAsDecimalHours(row.completedMinutes).replace(' h', ''),
          formatMinutesAsDecimalHours(row.openMinutes).replace(' h', ''),
        ]
          .map(esc)
          .join(';'),
      );
    }
    for (const row of data.employeeRows) {
      lines.push(
        [
          'Mitarbeiter',
          row.name,
          '',
          formatMinutesAsDecimalHours(row.allocatedMinutes).replace(' h', ''),
          formatMinutesAsDecimalHours(row.plannedMinutes).replace(' h', ''),
          formatMinutesAsDecimalHours(row.completedMinutes).replace(' h', ''),
          formatMinutesAsDecimalHours(row.selfObligationMinutes).replace(' h', ''),
        ]
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
