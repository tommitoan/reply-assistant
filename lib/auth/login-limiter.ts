export interface LimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface LoginLimiter {
  check(key: string): LimitResult;
  recordFailure(key: string): void;
  reset(key: string): void;
}

interface Options {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
}

const PRUNE_THRESHOLD = 500;

// In-memory and per-process: enough to slow passcode guessing for a single
// instance. A restart clears it, and several replicas would each keep their own.
export function createLoginLimiter({
  maxFailures = 5,
  windowMs = 15 * 60 * 1000,
  now = Date.now,
}: Options = {}): LoginLimiter {
  const failures = new Map<string, { count: number; windowStart: number }>();

  function liveEntry(key: string) {
    const entry = failures.get(key);
    if (!entry) return undefined;
    if (now() - entry.windowStart >= windowMs) {
      failures.delete(key);
      return undefined;
    }
    return entry;
  }

  function prune() {
    if (failures.size < PRUNE_THRESHOLD) return;
    for (const key of failures.keys()) liveEntry(key);
  }

  return {
    check(key) {
      const entry = liveEntry(key);
      if (!entry || entry.count < maxFailures) return { allowed: true, retryAfterSeconds: 0 };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + windowMs - now()) / 1000)),
      };
    },
    recordFailure(key) {
      prune();
      const entry = liveEntry(key);
      if (entry) entry.count += 1;
      else failures.set(key, { count: 1, windowStart: now() });
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
