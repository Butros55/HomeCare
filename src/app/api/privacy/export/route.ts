import { NextRequest, NextResponse } from 'next/server';

import { AppError } from '@/server/errors';
import { exportCustomerData, exportEmployeeData } from '@/server/services/privacy-service';

/** DSGVO-Datenexport als JSON-Download (Berechtigung: privacy.export). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get('type');
  const id = params.get('id');
  if (!id || (type !== 'customer' && type !== 'employee')) {
    return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
  }

  try {
    const data =
      type === 'customer' ? await exportCustomerData(id) : await exportEmployeeData(id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="export_${type}_${id}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('[privacy/export]', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
