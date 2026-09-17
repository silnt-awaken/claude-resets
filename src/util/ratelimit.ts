// Inexpensive per-isolate sliding-window rate limiter. Workers isolates are not shared
// globally, so this is a best-effort abuse brake, not a strict global quota (documented).

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (now - lastSweep > windowMs) {
    lastSweep = now;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  const allowed = b.count <= limit;
  return { allowed, retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000), remaining: Math.max(0, limit - b.count) };
}

export function __resetRateLimits(): void {
  buckets.clear();
}
