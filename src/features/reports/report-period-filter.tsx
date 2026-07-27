import { ReportPeriodNavigator } from '@/features/reports/report-period-navigator';

/** Zeitraumwahl für die persönliche Auswertung. */
export function ReportPeriodFilter(props: { defaultFrom: string; defaultTo: string }) {
  return <ReportPeriodNavigator {...props} compact />;
}
