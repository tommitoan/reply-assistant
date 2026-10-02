import { describe, expect, it } from "vitest";
import { WARM_MIN_INTERVAL_MS, shouldWarm } from "./warm-throttle";

describe("shouldWarm", () => {
  it("warms when it has never run", () => {
    expect(shouldWarm(1_000, null)).toBe(true);
  });

  it("waits until the minimum interval has passed", () => {
    const last = 1_000_000;
    expect(shouldWarm(last + WARM_MIN_INTERVAL_MS - 1, last)).toBe(false);
    expect(shouldWarm(last + WARM_MIN_INTERVAL_MS, last)).toBe(true);
  });

  it("stays under the five-minute cache lifetime", () => {
    expect(WARM_MIN_INTERVAL_MS).toBeLessThan(5 * 60 * 1000);
  });
});
