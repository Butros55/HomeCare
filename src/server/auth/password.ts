import 'server-only';

import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id mit OWASP-empfohlenen Parametern (19 MiB, t=2, p=1).
 * Die native Bibliothek läuft außerhalb des Bundles (serverExternalPackages).
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    // Ungültiges Hash-Format o. Ä. – niemals Details nach außen geben.
    return false;
  }
}

/** Minimale Passwortrichtlinie; ausführliche Prüfung im zod-Schema. */
export const PASSWORD_MIN_LENGTH = 8;
