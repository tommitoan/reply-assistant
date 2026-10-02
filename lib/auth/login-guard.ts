import { createLoginLimiter, type LimitResult, type LoginLimiter } from "./login-limiter";

// One shared key for the process-wide counter.
const OVERALL_KEY = "all";

export interface LoginGuard {
  check(clientKey: string): LimitResult;
  recordFailure(clientKey: string): void;
  recordSuccess(clientKey: string): void;
}

interface Options {
  perClient?: LoginLimiter;
  overall?: LoginLimiter;
}

// Combines a per-client limit with a limit on failures from anyone. The client
// key comes from a request header the sender can change, so the per-client
// limit alone does not stop a guesser who sends a new value each time; the
// overall limit bounds the total number of guesses regardless of the header.
// The cost is that a flood of wrong guesses also blocks the owner until the
// window ends.
export function createLoginGuard({
  perClient = createLoginLimiter(),
  overall = createLoginLimiter({ maxFailures: 20 }),
}: Options = {}): LoginGuard {
  return {
    check(clientKey) {
      const results = [overall.check(OVERALL_KEY), perClient.check(clientKey)];
      const blocked = results.filter((result) => !result.allowed);
      if (blocked.length === 0) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: Math.max(...blocked.map((r) => r.retryAfterSeconds)) };
    },
    recordFailure(clientKey) {
      perClient.recordFailure(clientKey);
      overall.recordFailure(OVERALL_KEY);
    },
    // A correct passcode clears only this client's count. The overall count
    // keeps running, so one success cannot erase a guessing run.
    recordSuccess(clientKey) {
      perClient.reset(clientKey);
    },
  };
}

export const loginGuard = createLoginGuard();
