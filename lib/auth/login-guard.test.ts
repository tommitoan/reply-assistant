import { describe, expect, it } from "vitest";
import { createLoginGuard } from "./login-guard";
import { createLoginLimiter } from "./login-limiter";

function guardWithClock(perClientMax: number, overallMax: number) {
  let time = 1_000_000;
  const now = () => time;
  const guard = createLoginGuard({
    perClient: createLoginLimiter({ maxFailures: perClientMax, windowMs: 60_000, now }),
    overall: createLoginLimiter({ maxFailures: overallMax, windowMs: 120_000, now }),
  });
  return { guard, advance: (ms: number) => (time += ms) };
}

describe("createLoginGuard", () => {
  it("allows a client with no failures", () => {
    const { guard } = guardWithClock(3, 10);
    expect(guard.check("a")).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("blocks one client after its own limit without blocking others", () => {
    const { guard } = guardWithClock(2, 10);
    guard.recordFailure("a");
    guard.recordFailure("a");
    expect(guard.check("a").allowed).toBe(false);
    expect(guard.check("b").allowed).toBe(true);
  });

  it("blocks everyone once the overall limit is reached, even with a new client key each time", () => {
    const { guard } = guardWithClock(2, 4);
    for (const key of ["a", "b", "c", "d"]) guard.recordFailure(key);
    expect(guard.check("never-seen")).toEqual({ allowed: false, retryAfterSeconds: 120 });
  });

  it("reports the longer wait when both limits apply", () => {
    const { guard } = guardWithClock(1, 1);
    guard.recordFailure("a");
    expect(guard.check("a")).toEqual({ allowed: false, retryAfterSeconds: 120 });
  });

  it("clears the client's own count on success but not the overall count", () => {
    const { guard } = guardWithClock(2, 3);
    guard.recordFailure("a");
    guard.recordSuccess("a");
    guard.recordFailure("a");
    expect(guard.check("a").allowed).toBe(true);
    guard.recordFailure("b");
    expect(guard.check("c").allowed).toBe(false);
  });

  it("unblocks after the windows pass", () => {
    const { guard, advance } = guardWithClock(1, 1);
    guard.recordFailure("a");
    advance(121_000);
    expect(guard.check("a")).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });
});
