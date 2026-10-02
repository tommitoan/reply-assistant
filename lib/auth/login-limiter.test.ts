import { describe, expect, it } from "vitest";
import { createLoginLimiter } from "./login-limiter";

function limiterWithClock(options: { maxFailures?: number; windowMs?: number } = {}) {
  let time = 1_000_000;
  const limiter = createLoginLimiter({ ...options, now: () => time });
  return { limiter, advance: (ms: number) => (time += ms) };
}

describe("createLoginLimiter", () => {
  it("allows a key with no failures", () => {
    const { limiter } = limiterWithClock();
    expect(limiter.check("1.2.3.4")).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("blocks after the maximum number of failures and reports the wait", () => {
    const { limiter } = limiterWithClock({ maxFailures: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) limiter.recordFailure("a");
    expect(limiter.check("a")).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("stays allowed one failure short of the limit", () => {
    const { limiter } = limiterWithClock({ maxFailures: 3 });
    limiter.recordFailure("a");
    limiter.recordFailure("a");
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const { limiter } = limiterWithClock({ maxFailures: 1 });
    limiter.recordFailure("a");
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("unblocks once the window has passed", () => {
    const { limiter, advance } = limiterWithClock({ maxFailures: 1, windowMs: 60_000 });
    limiter.recordFailure("a");
    advance(59_000);
    expect(limiter.check("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    advance(1_000);
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("clears the count on reset", () => {
    const { limiter } = limiterWithClock({ maxFailures: 1 });
    limiter.recordFailure("a");
    limiter.reset("a");
    expect(limiter.check("a").allowed).toBe(true);
  });
});
