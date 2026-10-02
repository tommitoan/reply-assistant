import { afterEach, describe, expect, it, vi } from "vitest";
import { embeddingEntry, modelCallEntry, recordQuietly, USAGE_KIND_LABELS, USAGE_KINDS, type UsageEntry, type UsageRecorder } from "./usage";

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

afterEach(() => vi.restoreAllMocks());

describe("modelCallEntry", () => {
  it("prices the call and keeps the links", () => {
    const entry = modelCallEntry("summary", "claude-haiku-4-5", USAGE, { conversationId: "c1", generationId: "g1" });
    // 1000 x $1/M + 200 x $5/M
    expect(entry).toEqual({
      kind: "summary",
      model: "claude-haiku-4-5",
      usage: USAGE,
      costUsd: 0.002,
      conversationId: "c1",
      generationId: "g1",
    });
  });

  it("leaves the cost empty for a model without a known price", () => {
    expect(modelCallEntry("explain", "some-new-model", USAGE).costUsd).toBeNull();
  });
});

describe("embeddingEntry", () => {
  it("prices tokens at the embedding rate and records them as input", () => {
    const entry = embeddingEntry("voyage-3.5-lite", 500_000);
    expect(entry.kind).toBe("embedding");
    expect(entry.costUsd).toBe(0.01);
    expect(entry.usage.input_tokens).toBe(500_000);
    expect(entry.usage.output_tokens).toBe(0);
  });

  it("leaves the cost empty for an unknown embedding model", () => {
    expect(embeddingEntry("voyage-9", 100).costUsd).toBeNull();
  });
});

describe("recordQuietly", () => {
  const entry: UsageEntry = modelCallEntry("warm", "claude-haiku-4-5", USAGE);

  it("hands the entry to the recorder", async () => {
    const record = vi.fn(async () => {});
    await recordQuietly({ record } satisfies UsageRecorder, entry);
    expect(record).toHaveBeenCalledWith(entry);
  });

  it("swallows a failure, so paid work is never undone by bookkeeping", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const recorder: UsageRecorder = {
      record: async () => {
        throw new Error("db down");
      },
    };
    await expect(recordQuietly(recorder, entry)).resolves.toBeUndefined();
  });

  it("does nothing without a recorder", async () => {
    await expect(recordQuietly(undefined, entry)).resolves.toBeUndefined();
  });
});

describe("usage kinds", () => {
  it("labels every kind, including developing a reply", () => {
    for (const kind of USAGE_KINDS) expect(USAGE_KIND_LABELS[kind]).toBeTruthy();
    expect(USAGE_KINDS).toContain("refine");
    expect(USAGE_KIND_LABELS.refine).toBe("Developing replies");
  });

  it("says that embeddings serve notes as well as memory, and that the notes kind covers suggestions", () => {
    expect(USAGE_KIND_LABELS.embedding).toBe("Embeddings (memory and notes)");
    expect(USAGE_KIND_LABELS.notes).toBe("Personal notes");
  });
});
