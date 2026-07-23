import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';
import { hasPermission, requireOrganizationMembership } from '@/server/permissions';
import {
  AppearanceSettings,
  NotificationPrefsSettings,
  OrganizationSettings,
  PasswordSettings,
  ProfileSettings,
} from '@/features/settings/settings-forms';
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
  { key: 'organisation', label: 'Organisation' },
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
    ...(canManageSettings ? ADMIN_TABS.filter((t) => t.key === 'organisation') : []),
    ...(canManageMembers ? ADMIN_TABS.filter((t) => t.key === 'mitglieder') : []),
    ...(canExport ? ADMIN_TABS.filter((t) => t.key === 'datenschutz') : []),
    ...(canViewAudit ? ADMIN_TABS.filter((t) => t.key === 'aktivitaet') : []),
  ];

  const { tab: rawTab } = await searchParams;
  const tab = tabs.some((t) => t.key === rawTab) ? rawTab! : 'profil';

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

  return (
    <>
      <PageHeader title="Einstellungen" description={ctx.organization.name}>
        <nav
          className="mt-4 flex max-w-full gap-1 overflow-x-auto scrollbar-none rounded-full bg-[var(--color-panel-sunken)] p-1"
          aria-label="Einstellungs-Tabs"
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

      <div className="max-w-4xl space-y-4 p-4 sm:p-5">
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
            <PasswordSettings />
          </>
        ) : null}
        {tab === 'darstellung' ? <AppearanceSettings /> : null}
        {tab === 'benachrichtigungen' ? (
          <NotificationPrefsSettings
            initial={(preference?.notificationPrefs as Record<string, boolean> | null) ?? {}}
          />
        ) : null}
        {tab === 'organisation' && canManageSettings ? (
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
        {tab === 'mitglieder' && canManageMembers ? <MembersSettings /> : null}
        {tab === 'datenschutz' && canExport ? <PrivacySettings /> : null}
        {tab === 'aktivitaet' && canViewAudit ? <AuditLogView /> : null}
      </div>
    </>
  );
}
