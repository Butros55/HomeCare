import { CircleDollarSign, Clock3, Euro, UsersRound } from 'lucide-react';
import Link from 'next/link';

import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatTile,
} from '@/components/ui/panel';
import {
  Table,
  TableWrapper,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/table';
import { formatMinutesAsHours } from '@/lib/duration';
import { formatEuroCents } from '@/lib/earnings';
import type { PersonalEarningsData } from '@/server/services/earnings-service';

export function PersonalEarningsDashboard({
  data,
}: {
  data: PersonalEarningsData;
}) {
  const missingOwnRate = data.rates.hourlyWageCents === 0;
  const missingCommissionRate =
    data.showCommission &&
    data.rates.employeeCommissionCentsPerHour === 0;

  return (
    <section className="space-y-4" aria-labelledby="personal-earnings-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2
            id="personal-earnings-title"
            className="text-[length:var(--text-lg)] font-semibold"
          >
            Mein Verdienst
          </h2>
          <p className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
            Abgeschlossene Termine vom {data.period.from} bis {data.period.to}
          </p>
        </div>
        {missingOwnRate || missingCommissionRate ? (
          <Link
            href="/settings"
            className="text-[length:var(--text-xs)] font-medium text-[var(--color-brand)] hover:underline"
          >
            Sätze in den Einstellungen ergänzen →
          </Link>
        ) : null}
      </div>

      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        data-tour="personal-earnings-stats"
      >
        <StatTile
          icon={<CircleDollarSign />}
          label="Gesamtverdienst"
          value={formatEuroCents(data.totalEarningsCents)}
          hint={
            data.showCommission
              ? 'eigener Lohn + Provision'
              : 'aus eigenen abgeschlossenen Stunden'
          }
          tone="success"
        />
        <StatTile
          icon={<Clock3 />}
          label="Eigene geleistete Stunden"
          value={formatMinutesAsHours(data.own.completedMinutes)}
          hint={`${data.own.appointmentCount} abgeschlossene${data.own.appointmentCount === 1 ? 'r' : ''} Termin${data.own.appointmentCount === 1 ? '' : 'e'}`}
        />
        <StatTile
          icon={<Euro />}
          label="Eigener Lohn"
          value={formatEuroCents(data.own.earningsCents)}
          hint={`${formatEuroCents(data.rates.hourlyWageCents)} / Std.`}
          tone={missingOwnRate ? 'warning' : 'default'}
        />
        {data.showCommission ? (
          <StatTile
            icon={<UsersRound />}
            label="Mitarbeiter-Provision"
            value={formatEuroCents(data.commission.earningsCents)}
            hint={`${formatMinutesAsHours(data.commission.completedMinutes)} × ${formatEuroCents(data.rates.employeeCommissionCentsPerHour)} / Std.`}
            tone={missingCommissionRate ? 'warning' : 'default'}
          />
        ) : null}
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitle>Aufschlüsselung</PanelTitle>
          <Link
            href="/settings"
            className="text-[length:var(--text-xs)] text-[var(--color-brand)] hover:underline"
          >
            Verdienst-Sätze bearbeiten
          </Link>
        </PanelHeader>
        <PanelBody>
          <dl className="divide-y divide-[var(--color-line-subtle)]">
            <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-3 first:pt-0">
              <dt className="text-[length:var(--text-sm)] font-medium">
                Eigene abgeschlossene Arbeit
              </dt>
              <dd className="tabular text-right text-[length:var(--text-sm)] font-semibold">
                {formatEuroCents(data.own.earningsCents)}
              </dd>
              <dd className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                {formatMinutesAsHours(data.own.completedMinutes)} zu{' '}
                {formatEuroCents(data.rates.hourlyWageCents)} je Stunde
              </dd>
            </div>
            {data.showCommission ? (
              <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-3">
                <dt className="text-[length:var(--text-sm)] font-medium">
                  Provision aus Mitarbeiterstunden
                </dt>
                <dd className="tabular text-right text-[length:var(--text-sm)] font-semibold">
                  {formatEuroCents(data.commission.earningsCents)}
                </dd>
                <dd className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                  {formatMinutesAsHours(data.commission.completedMinutes)} von{' '}
                  {data.commission.employeeCount} Mitarbeiter
                  {data.commission.employeeCount === 1 ? '' : 'n'} zu{' '}
                  {formatEuroCents(
                    data.rates.employeeCommissionCentsPerHour,
                  )}{' '}
                  je Stunde
                </dd>
              </div>
            ) : null}
            <div className="grid grid-cols-[1fr_auto] gap-4 pt-3">
              <dt className="text-[length:var(--text-base)] font-semibold">
                Gesamt
              </dt>
              <dd className="tabular text-right text-[length:var(--text-lg)] font-semibold text-[var(--color-success)]">
                {formatEuroCents(data.totalEarningsCents)}
              </dd>
            </div>
          </dl>
        </PanelBody>
      </Panel>

      {data.showCommission && data.commission.employeeRows.length > 0 ? (
        <Panel>
          <PanelHeader>
            <PanelTitle>Mitarbeiterstunden für deine Provision</PanelTitle>
          </PanelHeader>
          <TableWrapper className="rounded-t-none border-0 shadow-none">
            <Table>
              <THead>
                <Tr>
                  <Th>Mitarbeiter</Th>
                  <Th className="text-right">Termine</Th>
                  <Th className="text-right">Geleistet</Th>
                  <Th className="text-right">Provision</Th>
                </Tr>
              </THead>
              <TBody>
                {data.commission.employeeRows.map((row) => (
                  <Tr key={row.id}>
                    <Td className="font-medium">{row.name}</Td>
                    <Td className="tabular text-right">
                      {row.appointmentCount}
                    </Td>
                    <Td className="tabular text-right">
                      {formatMinutesAsHours(row.completedMinutes)}
                    </Td>
                    <Td className="tabular text-right font-medium">
                      {formatEuroCents(row.commissionCents)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        </Panel>
      ) : null}
    </section>
  );
}
