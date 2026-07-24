import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';
import {
  hasPermission,
  isLeadershipRole,
  requireOrganizationMembership,
} from '@/server/permissions';
import {
  AppearanceSettings,
  EarningsSettings,
  HomeAddressSettings,
  NotificationPrefsSettings,
  OrganizationSettings,
  PasswordSettings,
  ProfileSettings,
} from '@/features/settings/settings-forms';
import { LeadershipSettings } from '@/features/settings/leadership-settings';
import { MembersSettings } from '@/features/settings/members-settings';
import { PrivacySettings } from '@/features/settings/privacy-settings';
import { AuditLogView } from '@/features/settings/audit-log-view';
import { db } from '@/server/db';

export const metadata: Metadata = { title: 'Einstellungen' };

const BASE_TABS = [
  { key: 'profil', label: 'Profil' },
  { key: 'darstellung', label: 'Darstellung' },
  { key: 'benachrichtigungen', label: 'Benachrichtigungen' },
] as const;
const ADMIN_TABS = [
  { key: 'leitung', label: 'Leitung' },
  { key: 'mitglieder', label: 'Mitglieder' },
  { key: 'datenschutz', label: 'Datenschutz' },
  { key: 'aktivitaet', label: 'Aktivität' },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireOrganizationMembership();
  const canManageSettings = hasPermission(ctx, 'settings.manage');
  const canManageMembers = hasPermission(ctx, 'members.manage');
  const canViewAudit = hasPermission(ctx, 'audit.view');
  const canExport = hasPermission(ctx, 'privacy.export');

  const tabs = [
    ...BASE_TABS,
    ...(canManageSettings || canManageMembers
      ? ADMIN_TABS.filter((t) => t.key === 'leitung')
      : []),
    ...(canManageMembers ? ADMIN_TABS.filter((t) => t.key === 'mitglieder') : []),
    ...(canExport ? ADMIN_TABS.filter((t) => t.key === 'datenschutz') : []),
    ...(canViewAudit ? ADMIN_TABS.filter((t) => t.key === 'aktivitaet') : []),
  ];

  const { tab: rawTab } = await searchParams;
  // Alte Links auf ?tab=organisation weiterhin unterstützen.
  const normalizedTab = rawTab === 'organisation' ? 'leitung' : rawTab;
  const tab = tabs.some((t) => t.key === normalizedTab) ? normalizedTab! : 'profil';

  const preference = await db.userPreference.findUnique({
    where: { userId: ctx.user.id },
    select: { notificationPrefs: true },
  });

  const startLocation = (ctx.organization.defaultStartLocation ?? null) as {
    label?: string;
    street?: string;
    houseNumber?: string;
    postalCode?: string;
    city?: string;
  } | null;

  const ownHomeRaw = (ctx.employee?.startLocation ?? null) as {
    street?: string;
    houseNumber?: string;
    postalCode?: string;
    city?: string;
  } | null;
  const ownHome = ownHomeRaw?.street
    ? {
        street: ownHomeRaw.street ?? '',
        houseNumber: ownHomeRaw.houseNumber ?? '',
        postalCode: ownHomeRaw.postalCode ?? '',
        city: ownHomeRaw.city ?? '',
      }
    : null;

  // Ort für die Karten-Vorschau (Darstellung): Zuhause, ersatzweise das Büro.
  const homeCoords = (ctx.employee?.startLocation ?? null) as {
    latitude?: number;
    longitude?: number;
    label?: string;
  } | null;
  const officeCoords = (ctx.organization.defaultStartLocation ?? null) as {
    latitude?: number;
    longitude?: number;
    label?: string;
  } | null;
  const mapCenter =
    homeCoords?.latitude != null && homeCoords.longitude != null
      ? {
          latitude: homeCoords.latitude,
          longitude: homeCoords.longitude,
          label: homeCoords.label ?? 'Zuhause',
        }
      : officeCoords?.latitude != null && officeCoords.longitude != null
        ? {
            latitude: officeCoords.latitude,
            longitude: officeCoords.longitude,
            label: officeCoords.label ?? 'Büro',
          }
        : null;

  return (
    <>
      <PageHeader title="Einstellungen" description={ctx.organization.name}>
        <nav
          className="mt-4 flex max-w-full gap-1 overflow-x-auto scrollbar-none rounded-full bg-[var(--color-panel-sunken)] p-1"
          aria-label="Einstellungs-Tabs"
          data-tour="settings-tabs"
        >
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.key === 'profil' ? '/settings' : `/settings?tab=${t.key}`}
              aria-current={tab === t.key ? 'page' : undefined}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-[length:var(--text-sm)] whitespace-nowrap transition-colors pointer-coarse:px-4 pointer-coarse:py-2.5',
                tab === t.key
                  ? 'bg-[var(--color-panel)] font-medium text-[var(--color-ink)] shadow-[var(--shadow-panel)]'
                  : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </PageHeader>

      <div className="mx-auto w-full max-w-[var(--page-max)] space-y-4 p-4 sm:p-5">
        {tab === 'profil' ? (
          <>
            <ProfileSettings
              initial={{
                firstName: ctx.user.firstName,
                lastName: ctx.user.lastName,
                phone: ctx.user.phone ?? '',
                email: ctx.user.email,
              }}
            />
            <EarningsSettings
              initial={{
                hourlyWageCents: ctx.membership.hourlyWageCents,
                employeeCommissionCentsPerHour:
                  ctx.membership.employeeCommissionCentsPerHour,
                taxEmploymentType: ctx.membership.taxEmploymentType,
                incomeTaxRatePercent: ctx.membership.incomeTaxRatePercent,
                churchTaxRatePercent: ctx.membership.churchTaxRatePercent,
                healthInsuranceExtraRatePercent:
                  ctx.membership.healthInsuranceExtraRatePercent,
                hasChildren: ctx.membership.hasChildren,
                applySolidarity: ctx.membership.applySolidarity,
                taxFreeBonusCentsPerHour: ctx.membership.taxFreeBonusCentsPerHour,
                taxFreeBonusLabel: ctx.membership.taxFreeBonusLabel,
                mileageRatePerKmCents: ctx.membership.mileageRatePerKmCents ?? 0,
              }}
              showCommission={
                isLeadershipRole(ctx.membership.role) &&
                !ctx.organization.soloMode
              }
            />
            {ctx.employee ? <HomeAddressSettings initial={ownHome} /> : null}
            <PasswordSettings />
          </>
        ) : null}
        {tab === 'darstellung' ? <AppearanceSettings mapCenter={mapCenter} /> : null}
        {tab === 'benachrichtigungen' ? (
          <NotificationPrefsSettings
            initial={(preference?.notificationPrefs as Record<string, boolean> | null) ?? {}}
          />
        ) : null}
        {tab === 'leitung' ? (
          <>
            {canManageMembers ? <LeadershipSettings /> : null}
            {canManageSettings ? (
              <OrganizationSettings
                initial={{
                  name: ctx.organization.name,
                  timezone: ctx.organization.timezone,
                  startLocation: startLocation?.street
                    ? {
                        label: startLocation.label ?? 'Büro',
                        street: startLocation.street ?? '',
                        houseNumber: startLocation.houseNumber ?? '',
                        postalCode: startLocation.postalCode ?? '',
                        city: startLocation.city ?? '',
                      }
                    : null,
                }}
              />
            ) : null}
          </>
        ) : null}
        {tab === 'mitglieder' && canManageMembers ? <MembersSettings /> : null}
        {tab === 'datenschutz' && canExport ? <PrivacySettings /> : null}
        {tab === 'aktivitaet' && canViewAudit ? <AuditLogView /> : null}
      </div>
    </>
  );
}
