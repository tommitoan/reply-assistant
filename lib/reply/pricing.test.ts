import { describe, expect, it } from "vitest";
import { computeCostUsd, computeEmbeddingCostUsd } from "./pricing";
import type { ReplyUsage } from "./types";

function usage(overrides: Partial<ReplyUsage> = {}): ReplyUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    ...overrides,
  };
}

describe("computeCostUsd", () => {
  it("prices plain input and output tokens", () => {
    // 1000 * $1/M + 500 * $5/M
    expect(computeCostUsd("claude-haiku-4-5", usage({ input_tokens: 1000, output_tokens: 500 }))).toBe(0.0035);
  });

  it("bills cache writes at 1.25x input and cache reads at the read price", () => {
    // 2000 * 1.25 * $2/M + 4000 * $0.20/M
    const cost = computeCostUsd(
      "claude-sonnet-5-5",
      usage({ cache_creation_input_tokens: 2000, cache_read_input_tokens: 4000 }),
    );
    expect(cost).toBe(0.0058);
  });

  it("combines all four token types", () => {
    const cost = computeCostUsd(
      "claude-sonnet-5-5",
      usage({
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 400,
        cache_read_input_tokens: 800,
      }),
    );
    // (100*2 + 400*2*1.25 + 800*0.2 + 200*10) / 1e6
    expect(cost).toBe(0.00336);
  });

  it("prices a dated snapshot id like its base model", () => {
    const tokens = usage({ input_tokens: 1000 });
    expect(computeCostUsd("claude-haiku-4-5-20251001", tokens)).toBe(computeCostUsd("claude-haiku-4-5", tokens));
  });

  it("returns null for a model with no known price", () => {
    expect(computeCostUsd("some-other-model", usage({ input_tokens: 1000 }))).toBeNull();
  });

  it("returns zero for no usage", () => {
    expect(computeCostUsd("claude-haiku-4-5", usage())).toBe(0);
  });

  it("rounds to six decimal places to match the database column", () => {
    const cost = computeCostUsd("claude-haiku-4-5", usage({ input_tokens: 1 }));
    expect(cost).toBe(0.000001);
  });
});

describe("computeEmbeddingCostUsd", () => {
  it("prices embedding tokens per million", () => {
    expect(computeEmbeddingCostUsd("voyage-3.5-lite", 1_000_000)).toBe(0.02);
    expect(computeEmbeddingCostUsd("voyage-3.5-lite", 50)).toBe(0.000001);
  });

  it("returns null for an embedding model with no known price", () => {
    expect(computeEmbeddingCostUsd("voyage-9", 1000)).toBeNull();
  });
});
