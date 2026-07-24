import { Clock3, Euro, Sparkles, TrendingUp, UsersRound, Wallet } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Table, TableWrapper, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatMinutesAsHours } from '@/lib/duration';
import { formatEuroCents } from '@/lib/earnings';
import { cn } from '@/lib/utils';
import type { PersonalEarningsData } from '@/server/services/earnings-service';

/**
 * Persönliches Verdienst-Dashboard – bewusst modern: eine Verlaufs-Herokarte
 * mit dem Gesamtverdienst, darunter kompakte Kennzahlen-Karten mit Akzenten
 * und eine ruhige Aufschlüsselung. Funktioniert im Solo- wie im Leitungsmodus.
 */
export function PersonalEarningsDashboard({ data }: { data: PersonalEarningsData }) {
  const missingOwnRate = data.rates.hourlyWageCents === 0;
  const missingCommissionRate =
    data.showCommission && data.rates.employeeCommissionCentsPerHour === 0;
  const needsRates = missingOwnRate || missingCommissionRate;

  return (
    <section className="space-y-4" aria-labelledby="personal-earnings-title">
      {/* Herokarte: Gesamtverdienst im Markenverlauf. */}
      <div
        className="relative overflow-hidden rounded-[var(--radius-xl)] p-5 text-white shadow-[var(--shadow-panel)] sm:p-6"
        style={{ backgroundImage: 'var(--gradient-brand)' }}
      >
        {/* Dekorative Kreise – rein visuell. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-10 size-52 rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-8 size-48 rounded-full bg-black/10 blur-2xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-medium tracking-wide text-white/80 uppercase">
              <Sparkles className="size-3.5" aria-hidden />
              Mein Verdienst
            </div>
            <div
              id="personal-earnings-title"
              className="tabular mt-1 text-[2.5rem] leading-none font-bold tracking-tight sm:text-[3rem]"
            >
              {formatEuroCents(data.totalEarningsCents)}
            </div>
            <p className="mt-2 text-[length:var(--text-xs)] text-white/75">
              Abgeschlossene Termine · {data.period.from} bis {data.period.to}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <HeroChip
              label="Geleistet"
              value={formatMinutesAsHours(data.own.completedMinutes)}
            />
            <HeroChip
              label={data.own.appointmentCount === 1 ? 'Termin' : 'Termine'}
              value={String(data.own.appointmentCount)}
            />
            {data.showCommission ? (
              <HeroChip label="Provision" value={formatEuroCents(data.commission.earningsCents)} />
            ) : null}
          </div>
        </div>
      </div>

      {needsRates ? (
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-2.5 text-[length:var(--text-sm)] font-medium text-[var(--color-warning)] hover:brightness-95"
        >
          <TrendingUp className="size-4 shrink-0" aria-hidden />
          {missingOwnRate
            ? 'Hinterlege deinen Stundenlohn in den Einstellungen, damit der Verdienst berechnet wird.'
            : 'Hinterlege deine Provision je Mitarbeiterstunde in den Einstellungen.'}
          <span className="ml-auto shrink-0">→</span>
        </Link>
      ) : null}

      {/* Kennzahlen-Karten mit Akzentleiste. */}
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        data-tour="personal-earnings-stats"
      >
        <MetricCard
          icon={<Euro />}
          accent="var(--color-brand)"
          label="Eigener Lohn"
          value={formatEuroCents(data.own.earningsCents)}
          hint={`${formatMinutesAsHours(data.own.completedMinutes)} × ${formatEuroCents(data.rates.hourlyWageCents)} / Std.`}
          warn={missingOwnRate}
        />
        <MetricCard
          icon={<Clock3 />}
          accent="var(--color-info)"
          label="Geleistete Stunden"
          value={formatMinutesAsHours(data.own.completedMinutes)}
          hint={`${data.own.appointmentCount} abgeschlossene${data.own.appointmentCount === 1 ? 'r' : ''} Termin${data.own.appointmentCount === 1 ? '' : 'e'}`}
        />
        {data.showCommission ? (
          <MetricCard
            icon={<UsersRound />}
            accent="var(--color-success)"
            label="Mitarbeiter-Provision"
            value={formatEuroCents(data.commission.earningsCents)}
            hint={`${formatMinutesAsHours(data.commission.completedMinutes)} × ${formatEuroCents(data.rates.employeeCommissionCentsPerHour)} / Std.`}
            warn={missingCommissionRate}
          />
        ) : (
          <MetricCard
            icon={<Wallet />}
            accent="var(--color-success)"
            label="Gesamtverdienst"
            value={formatEuroCents(data.totalEarningsCents)}
            hint="aus eigenen abgeschlossenen Stunden"
          />
        )}
      </div>

      {/* Aufschlüsselung. */}
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
          <dl className="space-y-2">
            <BreakdownRow
              label="Eigene abgeschlossene Arbeit"
              detail={`${formatMinutesAsHours(data.own.completedMinutes)} zu ${formatEuroCents(data.rates.hourlyWageCents)} je Stunde`}
              value={formatEuroCents(data.own.earningsCents)}
            />
            {data.showCommission ? (
              <BreakdownRow
                label="Provision aus Mitarbeiterstunden"
                detail={`${formatMinutesAsHours(data.commission.completedMinutes)} von ${data.commission.employeeCount} Mitarbeiter${data.commission.employeeCount === 1 ? '' : 'n'} zu ${formatEuroCents(data.rates.employeeCommissionCentsPerHour)} je Stunde`}
                value={formatEuroCents(data.commission.earningsCents)}
              />
            ) : null}
            {data.taxFreeBonusCents > 0 ? (
              <BreakdownRow
                label={`${data.rates.taxFreeBonusLabel} (steuerfrei)`}
                detail={`${formatMinutesAsHours(data.own.completedMinutes)} zu ${formatEuroCents(data.rates.taxFreeBonusCentsPerHour)} je Stunde`}
                value={formatEuroCents(data.taxFreeBonusCents)}
              />
            ) : null}
            <div className="flex items-center justify-between gap-4 rounded-[var(--radius-lg)] bg-[var(--color-brand-subtle)] px-3 py-2.5">
              <dt className="text-[length:var(--text-base)] font-semibold">
                {data.netPay ? 'Brutto gesamt' : 'Gesamt'}
              </dt>
              <dd className="tabular text-right text-[length:var(--text-xl)] font-bold text-[var(--color-brand)]">
                {formatEuroCents(data.netPay?.grossCents ?? data.totalEarningsCents + data.taxFreeBonusCents)}
              </dd>
            </div>
          </dl>
        </PanelBody>
      </Panel>

      {/* Netto – nur mit vollständigen Angaben, sonst ein Hinweis darauf. */}
      {data.netPay ? (
        <Panel>
          <PanelHeader>
            <PanelTitle>Netto (Schätzung)</PanelTitle>
            <Link
              href="/settings"
              className="text-[length:var(--text-xs)] text-[var(--color-brand)] hover:underline"
            >
              Angaben bearbeiten
            </Link>
          </PanelHeader>
          <PanelBody>
            <dl className="space-y-2">
              <BreakdownRow
                label="Steuerpflichtiges Brutto"
                detail="Stundenlohn und Provision"
                value={formatEuroCents(data.netPay.taxableGrossCents)}
              />
              {data.netPay.incomeTaxCents > 0 ? (
                <BreakdownRow
                  label={data.employmentType === 'SELF_EMPLOYED' ? 'Einkommensteuer' : 'Lohnsteuer'}
                  detail="geschätzt nach deinem Satz"
                  value={`− ${formatEuroCents(data.netPay.incomeTaxCents)}`}
                />
              ) : null}
              {data.netPay.solidarityCents > 0 ? (
                <BreakdownRow
                  label="Solidaritätszuschlag"
                  detail="5,5 % der Steuer"
                  value={`− ${formatEuroCents(data.netPay.solidarityCents)}`}
                />
              ) : null}
              {data.netPay.churchTaxCents > 0 ? (
                <BreakdownRow
                  label="Kirchensteuer"
                  detail="Anteil der Steuer"
                  value={`− ${formatEuroCents(data.netPay.churchTaxCents)}`}
                />
              ) : null}
              {data.netPay.pensionCents > 0 ? (
                <BreakdownRow
                  label="Rentenversicherung"
                  detail="Arbeitnehmeranteil 9,3 %"
                  value={`− ${formatEuroCents(data.netPay.pensionCents)}`}
                />
              ) : null}
              {data.netPay.healthCents > 0 ? (
                <BreakdownRow
                  label="Krankenversicherung"
                  detail="Arbeitnehmeranteil inkl. halbem Zusatzbeitrag"
                  value={`− ${formatEuroCents(data.netPay.healthCents)}`}
                />
              ) : null}
              {data.netPay.careCents > 0 ? (
                <BreakdownRow
                  label="Pflegeversicherung"
                  detail="Arbeitnehmeranteil"
                  value={`− ${formatEuroCents(data.netPay.careCents)}`}
                />
              ) : null}
              {data.netPay.unemploymentCents > 0 ? (
                <BreakdownRow
                  label="Arbeitslosenversicherung"
                  detail="Arbeitnehmeranteil 1,3 %"
                  value={`− ${formatEuroCents(data.netPay.unemploymentCents)}`}
                />
              ) : null}
              {data.netPay.taxFreeCents > 0 ? (
                <BreakdownRow
                  label={`${data.rates.taxFreeBonusLabel} (ungekürzt)`}
                  detail="steuerfrei, keine Abzüge"
                  value={formatEuroCents(data.netPay.taxFreeCents)}
                />
              ) : null}
              <div className="flex items-center justify-between gap-4 rounded-[var(--radius-lg)] bg-[var(--color-success-soft)] px-3 py-2.5">
                <dt className="text-[length:var(--text-base)] font-semibold">Netto gesamt</dt>
                <dd className="tabular text-right text-[length:var(--text-xl)] font-bold text-[var(--color-success)]">
                  {formatEuroCents(data.netPay.netCents)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
              Orientierungswert auf Basis deiner Angaben – keine Lohnabrechnung und keine
              Steuerberatung. Die genaue Lohnsteuer ergibt sich aus den amtlichen Tabellen.
            </p>
          </PanelBody>
        </Panel>
      ) : (
        <Panel>
          <PanelBody className="flex flex-wrap items-center gap-2">
            <span className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              Für eine Netto-Schätzung fehlen noch Angaben zu Beschäftigungsart und Steuersatz.
            </span>
            <Link
              href="/settings"
              className="text-[length:var(--text-sm)] font-medium text-[var(--color-brand)] hover:underline"
            >
              Jetzt eintragen →
            </Link>
          </PanelBody>
        </Panel>
      )}

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
                    <Td className="tabular text-right">{row.appointmentCount}</Td>
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

function HeroChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-white/15 px-3 py-2 backdrop-blur-sm">
      <div className="text-[length:var(--text-2xs)] tracking-wide text-white/75 uppercase">
        {label}
      </div>
      <div className="tabular text-[length:var(--text-base)] font-semibold">{value}</div>
    </div>
  );
}

function MetricCard({
  icon,
  accent,
  label,
  value,
  hint,
  warn = false,
}: {
  icon: ReactNode;
  accent: string;
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-4 shadow-[var(--shadow-panel)]">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: accent }}
      />
      <div className="flex items-center gap-2 text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">
        <span
          className="grid size-7 place-items-center rounded-full [&_svg]:size-4"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
        >
          {icon}
        </span>
        {label}
      </div>
      <div
        className={cn(
          'tabular mt-2 text-[length:var(--text-2xl)] leading-tight font-bold',
          warn ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink)]',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">{hint}</div>
    </div>
  );
}

function BreakdownRow({
  label,
  detail,
  value,
}: {
  label: string;
  detail: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-[var(--radius-md)] px-3 py-2 hover:bg-[var(--color-panel-sunken)]">
      <div className="min-w-0">
        <div className="text-[length:var(--text-sm)] font-medium">{label}</div>
        <div className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">{detail}</div>
      </div>
      <div className="tabular shrink-0 text-right text-[length:var(--text-sm)] font-semibold">
        {value}
      </div>
    </div>
  );
}
