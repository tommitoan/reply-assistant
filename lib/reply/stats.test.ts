import { describe, expect, it } from "vitest";
import { formatPercent, toStatsView, type StatsRaw } from "./stats";

const EMPTY: StatsRaw = {
  weekly: [],
  memory: [],
  notes: [],
  cost: [],
  latency: [],
  counts: { requests: 0, costUsd: 0, edited: 0, liked: 0, memoryAsked: 0, memoryHit: 0, pasted: 0, notesUsed: 0 },
};

describe("toStatsView", () => {
  it("copes with an empty database", () => {
    const view = toStatsView(EMPTY);
    expect(view.weekly).toEqual([]);
    expect(view.costByDay).toEqual([]);
    expect(view.latencyByModel).toEqual([]);
    expect(view.memoryRates.on).toEqual({ good: 0, bad: 0, rate: null });
    expect(view.memoryHitRate).toEqual({ asked: 0, hit: 0, rate: null });
    expect(view.totals).toEqual({ requests: 0, costUsd: 0 });
  });

  it("works out the liked share per week, oldest week first", () => {
    const view = toStatsView({
      ...EMPTY,
      weekly: [
        { week: new Date("2026-09-28T00:00:00Z"), good: 3, bad: 1 },
        { week: new Date("2026-09-14T00:00:00Z"), good: 1, bad: 3 },
        { week: new Date("2026-09-21T00:00:00Z"), good: 0, bad: 0 },
      ],
    });
    expect(view.weekly.map((w) => [w.weekStart, w.rate])).toEqual([
      ["2026-09-14", 0.25],
      ["2026-09-21", null],
      ["2026-09-28", 0.75],
    ]);
  });

  it("compares memory on and off, and treats a missing group as no ratings", () => {
    const view = toStatsView({
      ...EMPTY,
      memory: [{ useMemory: true, good: 6, bad: 2 }],
    });
    expect(view.memoryRates.on).toEqual({ good: 6, bad: 2, rate: 0.75 });
    expect(view.memoryRates.off).toEqual({ good: 0, bad: 0, rate: null });
  });

  it("groups cost by day (newest first) and by model (dearest first)", () => {
    const view = toStatsView({
      ...EMPTY,
      cost: [
        { day: new Date("2026-09-30T00:00:00Z"), model: "claude-haiku-4-5-20251001", requests: 5, usd: 0.01 },
        { day: new Date("2026-10-01T00:00:00Z"), model: "claude-haiku-4-5-20251001", requests: 2, usd: 0.004 },
        { day: new Date("2026-10-01T00:00:00Z"), model: "claude-sonnet-5-5", requests: 1, usd: 0.006 },
      ],
    });
    expect(view.costByDay.map((d) => d.day)).toEqual(["2026-10-01", "2026-09-30"]);
    expect(view.costByDay[0].models.map((m) => m.model)).toEqual(["claude-sonnet-5-5", "claude-haiku-4-5-20251001"]);
    expect(view.costByDay[0].totalUsd).toBeCloseTo(0.01);
    expect(view.costByDay[1].totalUsd).toBeCloseTo(0.01);
  });

  it("lists the busiest model first for speed", () => {
    const view = toStatsView({
      ...EMPTY,
      latency: [
        { model: "claude-sonnet-5-5", requests: 3, avgFirstTokenMs: 1300, avgTotalMs: 2400 },
        { model: "claude-haiku-4-5-20251001", requests: 9, avgFirstTokenMs: 850, avgTotalMs: 1800 },
      ],
    });
    expect(view.latencyByModel.map((l) => l.model)).toEqual(["claude-haiku-4-5-20251001", "claude-sonnet-5-5"]);
  });

  it("compares replies that used a note with those that did not, treating a missing group as no ratings", () => {
    const view = toStatsView({ ...EMPTY, notes: [{ withNotes: true, good: 6, bad: 2 }] });
    expect(view.notesRates.with).toEqual({ good: 6, bad: 2, rate: 0.75 });
    expect(view.notesRates.without).toEqual({ good: 0, bad: 0, rate: null });
    expect(toStatsView(EMPTY).notesUse).toEqual({ pasted: 0, used: 0, rate: null });
  });

  it("reports how often a note was used in a reply to a pasted message", () => {
    const view = toStatsView({ ...EMPTY, counts: { ...EMPTY.counts, pasted: 20, notesUsed: 5 } });
    expect(view.notesUse).toEqual({ pasted: 20, used: 5, rate: 0.25 });
  });

  it("reports the example counts and the memory hit rate", () => {
    const view = toStatsView({
      ...EMPTY,
      counts: { requests: 40, costUsd: 0.5, edited: 7, liked: 12, memoryAsked: 10, memoryHit: 4, pasted: 20, notesUsed: 5 },
    });
    expect([view.goldExamples, view.likedExamples]).toEqual([7, 12]);
    expect(view.memoryHitRate).toEqual({ asked: 10, hit: 4, rate: 0.4 });
    expect(view.totals).toEqual({ requests: 40, costUsd: 0.5 });
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent and shows a dash for no data", () => {
    expect(formatPercent(0.756)).toBe("76%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(null)).toBe("–");
  });
});
