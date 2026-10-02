import { describe, expect, it } from "vitest";
import { chunkByTokens, createEmbedLimiter, estimateTokens, requestTokenBudget, WINDOW_MS } from "./embed-limiter";

function clock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => void (time += ms) };
}

const FREE = { rpm: 3, tpm: 10_000 };

describe("createEmbedLimiter: requests", () => {
  it("lets a foreground call use the whole request budget, then refuses the next", () => {
    const { now } = clock();
    const limiter = createEmbedLimiter(FREE, now);
    expect([1, 2, 3, 4].map(() => limiter.tryAcquire("foreground", 10))).toEqual([true, true, true, false]);
  });

  it("makes room again as the window moves on", () => {
    const clk = clock();
    const limiter = createEmbedLimiter(FREE, clk.now);
    for (let i = 0; i < 3; i++) limiter.tryAcquire("foreground", 10);
    clk.advance(WINDOW_MS - 1);
    expect(limiter.tryAcquire("foreground", 10)).toBe(false);
    clk.advance(2);
    expect(limiter.tryAcquire("foreground", 10)).toBe(true);
  });

  it("does not record a call it refuses", () => {
    const clk = clock();
    const limiter = createEmbedLimiter(FREE, clk.now);
    for (let i = 0; i < 3; i++) limiter.tryAcquire("foreground", 10);
    for (let i = 0; i < 5; i++) expect(limiter.tryAcquire("foreground", 10)).toBe(false);
    clk.advance(WINDOW_MS + 1);
    // All three slots come back at once; refused attempts did not take any.
    expect([1, 2, 3].map(() => limiter.tryAcquire("foreground", 10))).toEqual([true, true, true]);
  });
});

describe("createEmbedLimiter: lanes", () => {
  it("keeps the last request for the foreground", () => {
    const { now } = clock();
    const limiter = createEmbedLimiter(FREE, now);
    expect(limiter.tryAcquire("background", 10)).toBe(true);
    expect(limiter.tryAcquire("background", 10)).toBe(true);
    expect(limiter.tryAcquire("background", 10)).toBe(false);
    // A reply that needs a memory lookup right now still gets through.
    expect(limiter.tryAcquire("foreground", 10)).toBe(true);
  });

  it("lets a background call go on once the budget is large enough to share", () => {
    const { now } = clock();
    const limiter = createEmbedLimiter({ rpm: 2000, tpm: 1_000_000 }, now);
    const results = Array.from({ length: 1999 }, () => limiter.tryAcquire("background", 10));
    expect(results.every(Boolean)).toBe(true);
    expect(limiter.tryAcquire("background", 10)).toBe(false);
    expect(limiter.tryAcquire("foreground", 10)).toBe(true);
  });

  it("does not hold anything back when only one request is allowed in total", () => {
    const { now } = clock();
    const limiter = createEmbedLimiter({ rpm: 1, tpm: 10_000 }, now);
    expect(limiter.tryAcquire("background", 10)).toBe(true);
  });

  it("keeps a share of the tokens for the foreground", () => {
    const { now } = clock();
    const limiter = createEmbedLimiter(FREE, now);
    expect(limiter.tryAcquire("background", 6000)).toBe(true);
    // 1000 more would pass the background share (70% of 10,000) but not the foreground one.
    expect(limiter.tryAcquire("background", 1500)).toBe(false);
    expect(limiter.tryAcquire("foreground", 1500)).toBe(true);
  });
});

describe("createEmbedLimiter: tokens", () => {
  it("refuses a call that would pass the token budget even with requests to spare", () => {
    const { now } = clock();
    const limiter = createEmbedLimiter(FREE, now);
    expect(limiter.tryAcquire("foreground", 6000)).toBe(true);
    expect(limiter.tryAcquire("foreground", 4001)).toBe(false);
    expect(limiter.tryAcquire("foreground", 4000)).toBe(true);
  });

  it("never allows a call larger than the whole budget", () => {
    const { now } = clock();
    const limiter = createEmbedLimiter(FREE, now);
    expect(limiter.waitMs("foreground", 10_001)).toBe(Infinity);
    expect(limiter.tryAcquire("foreground", 10_001)).toBe(false);
  });
});

describe("createEmbedLimiter: waitMs", () => {
  it("is zero when the call fits and says how long to wait when it does not", () => {
    const clk = clock();
    const limiter = createEmbedLimiter(FREE, clk.now);
    expect(limiter.waitMs("foreground", 10)).toBe(0);
    limiter.tryAcquire("foreground", 10);
    clk.advance(10_000);
    limiter.tryAcquire("foreground", 10);
    limiter.tryAcquire("foreground", 10);
    // The oldest call leaves the window 50 s from now.
    expect(limiter.waitMs("foreground", 10)).toBe(50_001);
    clk.advance(50_001);
    expect(limiter.waitMs("foreground", 10)).toBe(0);
  });

  it("waits for tokens as well as requests", () => {
    const clk = clock();
    const limiter = createEmbedLimiter(FREE, clk.now);
    limiter.tryAcquire("foreground", 9000);
    clk.advance(20_000);
    expect(limiter.waitMs("foreground", 2000)).toBe(40_001);
  });
});

describe("estimateTokens and chunkByTokens", () => {
  it("counts a token for every two characters, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abc")).toBe(2);
    expect(estimateTokens("x".repeat(100))).toBe(50);
  });

  it("keeps order and starts a new group when the budget would be passed", () => {
    const texts = ["a".repeat(20), "b".repeat(20), "c".repeat(20), "d".repeat(4)];
    // 10 + 10 fits in 20; the third starts a group; the fourth fits beside it.
    expect(chunkByTokens(texts, 20)).toEqual([[texts[0], texts[1]], [texts[2], texts[3]]]);
  });

  it("gives a text larger than the budget a group of its own", () => {
    const big = "x".repeat(100);
    expect(chunkByTokens(["a", big, "b"], 10)).toEqual([["a"], [big], ["b"]]);
  });

  it("returns nothing for nothing", () => {
    expect(chunkByTokens([], 10)).toEqual([]);
  });
});

describe("requestTokenBudget", () => {
  it("leaves room for a second request in the same minute", () => {
    expect(requestTokenBudget(10_000)).toBe(5000);
    expect(requestTokenBudget(100)).toBe(500);
  });
});
