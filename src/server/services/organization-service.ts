import 'server-only';

import { randomBytes } from 'node:crypto';

import { Prisma } from '@prisma/client';
import type { Organization, User } from '@prisma/client';

import { hashPassword } from '@/server/auth/password';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { requirePermission } from '@/server/permissions';
import { geocodeAddressCached } from '@/server/providers/geocoding';

/** URL-tauglicher, eindeutiger Slug aus dem Organisationsnamen. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'organisation';
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  const existing = await db.organization.findUnique({ where: { slug: base } });
  if (!existing) return base;
  return `${base}-${randomBytes(3).toString('hex')}`;
}

/**
 * Registrierung: legt Benutzer, Organisation, Owner-Mitgliedschaft und das
 * eigene Mitarbeiterprofil (Inhaber kann selbst Stunden übernehmen) in einer
 * Transaktion an.
 */
export async function createOrganizationWithOwner(input: {
  organizationName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  /** 'solo' = startet ohne Mitarbeiter (reduziertes UI); 'team' = volles Leitungs-UI. */
  startMode?: 'solo' | 'team';
}): Promise<{ user: User; organization: Organization }> {
  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(input.organizationName);

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    });

    const organization = await tx.organization.create({
      data: { name: input.organizationName, slug, soloMode: input.startMode !== 'team' },
    });

    await tx.organizationMembership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: 'ORGANIZATION_OWNER',
        status: 'ACTIVE',
      },
    });

    await tx.employee.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        employmentType: 'FULL_TIME',
        canRecruitEmployees: true,
        canReceiveHours: true,
      },
    });

    await writeAuditLog(
      {
        organizationId: organization.id,
        actorUserId: user.id,
        action: 'organization.created',
        entityType: 'Organization',
        entityId: organization.id,
        metadata: { name: organization.name },
      },
      tx,
    );

    return { user, organization };
  });
}

/** Org-Einstellungen (Name, Zeitzone, Standard-Start/-Ziel) aktualisieren. */
export async function updateOrganizationSettings(input: {
  name: string;
  timezone: string;
  startLocation?: {
    label: string;
    street: string;
    houseNumber: string;
    postalCode: string;
    city: string;
  } | null;
}): Promise<{ geocoded: boolean }> {
  const ctx = await requirePermission('settings.manage');

  let locationJson: Record<string, unknown> | null | undefined;
  let geocoded = false;
  if (input.startLocation) {
    const candidates = await geocodeAddressCached({
      street: input.startLocation.street,
      houseNumber: input.startLocation.houseNumber,
      postalCode: input.startLocation.postalCode,
      city: input.startLocation.city,
      countryCode: 'DE',
    });
    const best = candidates[0];
    geocoded = Boolean(best);
    locationJson = {
      ...input.startLocation,
      countryCode: 'DE',
      latitude: best?.latitude ?? null,
      longitude: best?.longitude ?? null,
    };
  } else if (input.startLocation === null) {
    locationJson = null;
  }

  await db.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: ctx.organization.id },
      data: {
        name: input.name,
        timezone: input.timezone,
        ...(locationJson !== undefined
          ? {
              // null = Standort bewusst entfernen (Prisma verlangt dafür DbNull).
              defaultStartLocation:
                locationJson === null ? Prisma.DbNull : (locationJson as Prisma.InputJsonValue),
              defaultEndLocation:
                locationJson === null ? Prisma.DbNull : (locationJson as Prisma.InputJsonValue),
            }
          : {}),
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'organization.updated',
        entityType: 'Organization',
        entityId: ctx.organization.id,
        metadata: { name: input.name, timezone: input.timezone },
      },
      tx,
    );
  });
  return { geocoded };
}
