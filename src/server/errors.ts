import { ZodError } from 'zod';

import { ERROR_MESSAGES, type ErrorCode } from '@/lib/error-codes';

/**
 * Einheitlicher Anwendungsfehler mit stabilem Fehlercode.
 * Services werfen AppError; Server Actions übersetzen ihn in ein
 * ActionResult, Route-Handler in eine JSON-Fehlerantwort.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Zusätzliche, UI-taugliche Details (z. B. Feldfehler, Konfliktliste). */
  readonly details?: unknown;

  constructor(code: ErrorCode, options?: { message?: string; status?: number; details?: unknown }) {
    super(options?.message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = options?.status ?? defaultStatus(code);
    this.details = options?.details;
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 401;
    case 'ACCESS_DENIED':
    case 'ORGANIZATION_SCOPE_VIOLATION':
      return 403;
    case 'NOT_FOUND':
    case 'CUSTOMER_NOT_FOUND':
    case 'EMPLOYEE_NOT_FOUND':
    case 'APPOINTMENT_NOT_FOUND':
    case 'BUDGET_NOT_FOUND':
      return 404;
    case 'RATE_LIMITED':
      return 429;
    case 'VALIDATION_FAILED':
    case 'INVALID_CREDENTIALS':
    case 'TOKEN_INVALID':
    case 'INVITATION_INVALID':
      return 400;
    case 'INTERNAL_ERROR':
      return 500;
    default:
      return 409;
  }
}

/** Ergebnis-Typ für Server Actions – niemals Exceptions über die Wire. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; details?: unknown };

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionError(code: ErrorCode, message?: string, details?: unknown): ActionResult<never> {
  return { ok: false, code, message: message ?? ERROR_MESSAGES[code], details };
}

/**
 * Führt einen Service-Aufruf aus und übersetzt AppError/unerwartete Fehler in
 * ein ActionResult. Redirect-Fehler von Next.js werden durchgereicht.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return actionOk(await fn());
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    if (error instanceof AppError) {
      return actionError(error.code, error.message, error.details);
    }
    if (error instanceof ZodError) {
      return actionError('VALIDATION_FAILED', error.issues[0]?.message);
    }
    console.error('[action] Unerwarteter Fehler:', error);
    return actionError('INTERNAL_ERROR');
  }
}

/** Next.js steuert redirect()/notFound() über geworfene Fehler – nicht schlucken. */
export function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND');
}
