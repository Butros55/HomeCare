'use server';

/**
 * Auth-Formular-Actions mit Progressive Enhancement (useActionState):
 * Die Formulare funktionieren auch VOR bzw. OHNE JavaScript-Hydration korrekt –
 * der Browser sendet dann ein reguläres POST an die Server Action, niemals
 * ein GET mit Zugangsdaten in der URL. Fehler werden inline im Formular
 * angezeigt (kein reines Toast-Feedback).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  consumeRateLimit,
  LOGIN_RATE_LIMIT,
  REGISTER_RATE_LIMIT,
} from '@/server/auth/rate-limit';
import { verifyPassword, hashPassword } from '@/server/auth/password';
import { createSession, setSessionCookie } from '@/server/auth/session';
import { db } from '@/server/db';
import { isNextControlFlowError } from '@/server/errors';
import { acceptInvitation } from '@/server/services/employee-service';
import { createOrganizationWithOwner } from '@/server/services/organization-service';
import {
  acceptInvitationSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@/server/validation/auth';

export interface AuthFormState {
  error?: string;
  /** Feldwerte zum Wiederbefüllen (nie Passwörter). */
  values?: Record<string, string>;
}

async function clientIp(): Promise<string> {
  const headerStore = await headers();
  return headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? '');

// ---------------------------------------------------------------------------

export async function loginFormAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = { email: field(formData, 'email'), password: field(formData, 'password') };
  const keepValues = { email: raw.email };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Bitte Eingaben prüfen.', values: keepValues };
  }

  const ip = await clientIp();
  if (
    !consumeRateLimit(`login:ip:${ip}`, LOGIN_RATE_LIMIT) ||
    !consumeRateLimit(`login:email:${parsed.data.email}`, LOGIN_RATE_LIMIT)
  ) {
    return { error: 'Zu viele Versuche. Bitte ein paar Minuten warten.', values: keepValues };
  }

  try {
    const user = await db.user.findUnique({ where: { email: parsed.data.email } });
    // Konstante Zeit: auch bei unbekanntem Konto einen Hash prüfen.
    const valid = user
      ? await verifyPassword(user.passwordHash, parsed.data.password)
      : (await verifyPassword(
          '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          parsed.data.password,
        ),
        false);

    if (!user || !valid || user.status !== 'ACTIVE') {
      return {
        error:
          'Anmeldung fehlgeschlagen – E-Mail-Adresse oder Passwort ist nicht korrekt. Noch kein Konto? Unten registrieren.',
        values: keepValues,
      };
    }

    const { token } = await createSession(user.id);
    await setSessionCookie(token);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    console.error('[login]', error);
    return { error: 'Unerwarteter Fehler bei der Anmeldung. Bitte erneut versuchen.', values: keepValues };
  }

  redirect('/dashboard');
}

// ---------------------------------------------------------------------------

export async function registerFormAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    organizationName: field(formData, 'organizationName'),
    firstName: field(formData, 'firstName'),
    lastName: field(formData, 'lastName'),
    email: field(formData, 'email'),
    password: field(formData, 'password'),
    startMode: field(formData, 'startMode') || 'solo',
  };
  const keepValues = {
    organizationName: raw.organizationName,
    firstName: raw.firstName,
    lastName: raw.lastName,
    email: raw.email,
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Bitte Eingaben prüfen.', values: keepValues };
  }

  const ip = await clientIp();
  if (!consumeRateLimit(`register:ip:${ip}`, REGISTER_RATE_LIMIT)) {
    return { error: 'Zu viele Registrierungen. Bitte später erneut versuchen.', values: keepValues };
  }

  try {
    const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      return {
        error:
          'Mit dieser E-Mail-Adresse existiert bereits ein Konto. Bitte anmelden oder das Passwort zurücksetzen.',
        values: keepValues,
      };
    }
    const { user } = await createOrganizationWithOwner(parsed.data);
    const { token } = await createSession(user.id);
    await setSessionCookie(token);
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    console.error('[register]', error);
    return { error: 'Unerwarteter Fehler bei der Registrierung. Bitte erneut versuchen.', values: keepValues };
  }

  redirect('/dashboard');
}

// ---------------------------------------------------------------------------

export async function resetPasswordFormAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = { token: field(formData, 'token'), password: field(formData, 'password') };
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Bitte Eingaben prüfen.' };
  }

  try {
    const { hashToken, invalidateAllUserSessions } = await import('@/server/auth/session');
    const record = await db.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return { error: 'Der Link ist ungültig oder abgelaufen. Bitte einen neuen anfordern.' };
    }
    const passwordHash = await hashPassword(parsed.data.password);
    await db.$transaction([
      db.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    await invalidateAllUserSessions(record.userId);
    const { token } = await createSession(record.userId);
    await setSessionCookie(token);
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    console.error('[reset-password]', error);
    return { error: 'Unerwarteter Fehler. Bitte erneut versuchen.' };
  }

  redirect('/dashboard');
}

// ---------------------------------------------------------------------------

export interface ForgotFormState {
  done?: boolean;
  error?: string;
}

export async function forgotPasswordFormAction(
  _prev: ForgotFormState,
  formData: FormData,
): Promise<ForgotFormState> {
  const email = field(formData, 'email').trim().toLowerCase();
  if (!email) return { error: 'Bitte die E-Mail-Adresse eingeben.' };

  try {
    const { forgotPasswordAction } = await import('@/server/auth/actions');
    await forgotPasswordAction({ email });
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    // Bewusst generisch – keine Konto-Enumeration.
  }
  return { done: true };
}

// ---------------------------------------------------------------------------

export async function acceptInvitationFormAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    token: field(formData, 'token'),
    firstName: field(formData, 'firstName'),
    lastName: field(formData, 'lastName'),
    password: field(formData, 'password'),
  };
  const keepValues = { firstName: raw.firstName, lastName: raw.lastName };

  const parsed = acceptInvitationSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Bitte Eingaben prüfen.', values: keepValues };
  }

  let userId: string;
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const result = await acceptInvitation({
      token: parsed.data.token,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      passwordHash,
    });
    userId = result.userId;
    const { token } = await createSession(userId);
    await setSessionCookie(token);
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    console.error('[invite]', error);
    return {
      error: 'Die Einladung konnte nicht angenommen werden (ungültig oder abgelaufen).',
      values: keepValues,
    };
  }

  redirect('/dashboard');
}
