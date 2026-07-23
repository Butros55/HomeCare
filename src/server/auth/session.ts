import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import type { Session, User } from '@prisma/client';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { db } from '@/server/db';

/**
 * Sessionverwaltung nach dem Lucia-Muster:
 *  - Zufallstoken nur im HttpOnly-Cookie, in der DB liegt ausschließlich der SHA-256-Hash.
 *  - Sessions sind serverseitig widerrufbar (Logout, Passwortwechsel).
 *  - Gleitende Verlängerung ab halber Laufzeit.
 */
export const SESSION_COOKIE_NAME = 'hcp_session';
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
const SESSION_RENEW_THRESHOLD_MS = SESSION_LIFETIME_MS / 2;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function createSession(userId: string): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
    },
  });
  return { token, session };
}

export interface SessionWithUser {
  session: Session;
  user: User;
}

export async function validateSessionToken(token: string): Promise<SessionWithUser | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (session.user.status !== 'ACTIVE') return null;

  // Gleitende Verlängerung + lastUsedAt, gedrosselt auf 1×/Minute.
  if (now - session.lastUsedAt.getTime() > 60_000) {
    const expiresAt =
      session.expiresAt.getTime() - now < SESSION_RENEW_THRESHOLD_MS
        ? new Date(now + SESSION_LIFETIME_MS)
        : session.expiresAt;
    await db.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date(now), expiresAt } })
      .catch(() => undefined);
  }

  const { user, ...rest } = session;
  return { session: rest as Session, user };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await db.session.delete({ where: { id: sessionId } }).catch(() => undefined);
}

export async function invalidateAllUserSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}

// ---------------------------------------------------------------------------
// Cookie-Handling (Set/Delete nur aus Server Actions / Route Handlern!)
// ---------------------------------------------------------------------------

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_LIFETIME_MS / 1000,
  });
}

export async function deleteSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Aktuelle Session des Requests (React-cache: eine DB-Abfrage pro Request,
 * egal wie viele Komponenten sie brauchen).
 */
export const getCurrentSession = cache(async (): Promise<SessionWithUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return validateSessionToken(token);
});
