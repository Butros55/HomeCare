import 'server-only';

/**
 * In-Memory-Rate-Limiter (Token-Bucket je Schlüssel).
 *
 * Bewusste MVP-Entscheidung (IMPLEMENTATION_PLAN A10): gilt pro Prozess.
 * Für horizontale Skalierung ist ein Redis-Backend als Adapter vorgesehen –
 * die Aufrufstellen ändern sich dabei nicht.
 */
interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

// Speicher begrenzen: alte Buckets gelegentlich aufräumen.
const MAX_BUCKETS = 10_000;

export interface RateLimitOptions {
  /** Maximale Anzahl Aktionen … */
  limit: number;
  /** … pro Zeitfenster in Millisekunden. */
  windowMs: number;
}

/** true = erlaubt; false = Limit erreicht. */
export function consumeRateLimit(key: string, options: RateLimitOptions): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      // Grob aufräumen: verfallene Buckets entfernen.
      for (const [k, b] of buckets) {
        if (now - b.lastRefill > options.windowMs) buckets.delete(k);
      }
    }
    bucket = { tokens: options.limit, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Kontinuierliche Auffüllung proportional zur vergangenen Zeit.
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    const refill = (elapsed / options.windowMs) * options.limit;
    bucket.tokens = Math.min(options.limit, bucket.tokens + refill);
    bucket.lastRefill = now;
  }

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Nur für Tests. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Nur für automatisierte Tests (Playwright): RATE_LIMIT_RELAXED=1 hebt die Limits an. */
const RELAXED = process.env.RATE_LIMIT_RELAXED === '1';

export const LOGIN_RATE_LIMIT: RateLimitOptions = {
  limit: RELAXED ? 1000 : 5,
  windowMs: 15 * 60 * 1000,
};
export const REGISTER_RATE_LIMIT: RateLimitOptions = {
  limit: RELAXED ? 1000 : 3,
  windowMs: 60 * 60 * 1000,
};
export const RESET_RATE_LIMIT: RateLimitOptions = {
  limit: RELAXED ? 1000 : 3,
  windowMs: 15 * 60 * 1000,
};
