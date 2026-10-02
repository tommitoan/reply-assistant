import { describe, expect, it } from "vitest";
import { formatMetaLine, shortModelName } from "./format";

describe("shortModelName", () => {
  it("keeps the family name", () => {
    expect(shortModelName("claude-haiku-4-5")).toBe("haiku");
    expect(shortModelName("claude-sonnet-5-5")).toBe("sonnet");
  });

  it("returns an unrecognised id unchanged", () => {
    expect(shortModelName("custom-model")).toBe("custom-model");
  });
});

describe("formatMetaLine", () => {
  it("shows model, first-token time, total time and cost", () => {
    expect(
      formatMetaLine({ model: "claude-haiku-4-5", firstTokenMs: 820, totalMs: 2900, costUsd: 0.0031 }),
    ).toBe("haiku · first 0.8s · total 2.9s · $0.003");
  });

  it("omits the first-token time when it is unknown", () => {
    expect(formatMetaLine({ model: "claude-haiku-4-5", firstTokenMs: null, totalMs: 1000, costUsd: 0.5 })).toBe(
      "haiku · total 1.0s · $0.500",
    );
  });

  it("marks tiny and unknown costs", () => {
    expect(formatMetaLine({ model: "claude-haiku-4-5", firstTokenMs: 1, totalMs: 1, costUsd: 0.0002 })).toContain(
      "<$0.001",
    );
    expect(formatMetaLine({ model: "x", firstTokenMs: 1, totalMs: 1, costUsd: null })).toContain("cost n/a");
  });
});
