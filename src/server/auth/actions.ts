'use server';

import { randomBytes } from 'node:crypto';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { APP_NAME, APP_URL } from '@/lib/app-config';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { consumeRateLimit, RESET_RATE_LIMIT } from '@/server/auth/rate-limit';
import {
  createSession,
  deleteSessionCookie,
  getCurrentSession,
  hashToken,
  invalidateAllUserSessions,
  invalidateSession,
  setSessionCookie,
} from '@/server/auth/session';
import { db } from '@/server/db';
import { AppError, runAction, type ActionResult } from '@/server/errors';
import { sendMail } from '@/server/mail';
import { ACTIVE_ORG_COOKIE, requireAuthenticatedUser } from '@/server/permissions';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type UpdateProfileInput,
} from '@/server/validation/auth';

async function clientIp(): Promise<string> {
  const headerStore = await headers();
  const forwarded = headerStore.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logoutAction(): Promise<void> {
  const session = await getCurrentSession();
  if (session) {
    await invalidateSession(session.session.id);
  }
  await deleteSessionCookie();
  redirect('/login');
}

// ---------------------------------------------------------------------------
// Passwort zurücksetzen
// ---------------------------------------------------------------------------

const RESET_TOKEN_LIFETIME_MS = 60 * 60 * 1000; // 1 Stunde

export async function forgotPasswordAction(
  input: ForgotPasswordInput,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const parsed = forgotPasswordSchema.safeParse(input);
    // Immer dieselbe generische Antwort – keine Konto-Enumeration.
    if (!parsed.success) return { done: true as const };

    const ip = await clientIp();
    if (
      !consumeRateLimit(`reset:ip:${ip}`, RESET_RATE_LIMIT) ||
      !consumeRateLimit(`reset:email:${parsed.data.email}`, RESET_RATE_LIMIT)
    ) {
      return { done: true as const };
    }

    const user = await db.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || user.status !== 'ACTIVE') return { done: true as const };

    const token = randomBytes(24).toString('base64url');
    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_LIFETIME_MS),
      },
    });

    const link = `${APP_URL}/reset-password/${token}`;
    await sendMail({
      to: user.email,
      subject: `${APP_NAME}: Passwort zurücksetzen`,
      text: [
        `Hallo ${user.firstName},`,
        '',
        'für dein Konto wurde das Zurücksetzen des Passworts angefordert.',
        'Der folgende Link ist 60 Minuten gültig:',
        '',
        link,
        '',
        'Wenn du das nicht warst, kannst du diese E-Mail ignorieren.',
      ].join('\n'),
    });

    return { done: true as const };
  });
}

// ---------------------------------------------------------------------------
// Profil & Passwort (angemeldet)
// ---------------------------------------------------------------------------

export async function updateProfileAction(
  input: UpdateProfileInput,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const user = await requireAuthenticatedUser();
    const parsed = updateProfileSchema.parse(input);
    await db.user.update({
      where: { id: user.id },
      data: {
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        phone: parsed.phone || null,
      },
    });
    return { done: true as const };
  });
}

export async function changePasswordAction(
  input: ChangePasswordInput,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const user = await requireAuthenticatedUser();
    const parsed = changePasswordSchema.parse(input);

    const valid = await verifyPassword(user.passwordHash, parsed.currentPassword);
    if (!valid) {
      throw new AppError('INVALID_CREDENTIALS', {
        message: 'Das aktuelle Passwort ist nicht korrekt.',
      });
    }

    const passwordHash = await hashPassword(parsed.newPassword);
    await db.user.update({ where: { id: user.id }, data: { passwordHash } });

    const current = await getCurrentSession();
    await invalidateAllUserSessions(user.id);
    if (current) {
      const { token } = await createSession(user.id);
      await setSessionCookie(token);
    }
    return { done: true as const };
  });
}

// ---------------------------------------------------------------------------
// Organisation wechseln
// ---------------------------------------------------------------------------

export async function switchOrganizationAction(organizationId: string): Promise<void> {
  const user = await requireAuthenticatedUser();
  const membership = await db.organizationMembership.findFirst({
    where: { userId: user.id, organizationId, status: 'ACTIVE' },
  });
  if (!membership) redirect('/dashboard');

  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  await db.userPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, lastActiveOrganizationId: organizationId },
    update: { lastActiveOrganizationId: organizationId },
  });
  redirect('/dashboard');
}
