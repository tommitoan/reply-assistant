import { describe, expect, it, vi } from "vitest";
import { backfillEmbeddings, embedPending } from "./backfill";
import type { Embedder } from "./embeddings";
import type { MemoryRepo, UnembeddedGeneration } from "./memory-repo";

const VECTOR = [0.1, 0.2];

// An in-memory stand-in that behaves like the real list: rows that were saved
// drop out of it, rows that were not stay.
function fakeRepo(rows: UnembeddedGeneration[]) {
  const saved: Array<{ id: string; model: string }> = [];
  const repo: MemoryRepo = {
    findCandidates: async () => [],
    saveEmbedding: async (id, _vector, model) => {
      saved.push({ id, model });
    },
    listNeedingEmbedding: async (_model, limit, offset) =>
      rows.filter((row) => !saved.some((entry) => entry.id === row.id)).slice(offset, offset + limit),
  };
  return { repo, saved };
}

// `failCalls` lists the (1-based) requests that fail.
function embedder(failCalls: number[] = []) {
  const calls: string[][] = [];
  const emb: Embedder = {
    model: "m1",
    embed: vi.fn(async () => null),
    embedMany: vi.fn(async (texts: string[]) => {
      calls.push(texts);
      return failCalls.includes(calls.length) ? null : texts.map(() => VECTOR);
    }),
  };
  return { emb, calls };
}

const rows = (n: number): UnembeddedGeneration[] =>
  Array.from({ length: n }, (_, i) => ({ id: `g${i}`, mode: "vi_to_en", inputText: `text ${i}` }));

describe("embedPending", () => {
  it("embeds the waiting requests with one request to the provider", async () => {
    const { repo, saved } = fakeRepo(rows(5));
    const { emb, calls } = embedder();
    expect(await embedPending(repo, emb)).toEqual({ embedded: 5, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(5);
    expect(saved.map((entry) => entry.id)).toEqual(["g0", "g1", "g2", "g3", "g4"]);
    expect(saved.every((entry) => entry.model === "m1")).toBe(true);
  });

  it("does at most one batch, leaving the rest for next time", async () => {
    const { repo, saved } = fakeRepo(rows(7));
    const { emb, calls } = embedder();
    expect(await embedPending(repo, emb, { batchSize: 3 })).toEqual({ embedded: 3, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(saved).toHaveLength(3);
  });

  it("sends only as many as fit one request's token budget", async () => {
    const long = (id: string) => ({ id, mode: "vi_to_en" as const, inputText: "x".repeat(2000) });
    const { repo, saved } = fakeRepo([long("a"), long("b"), long("c")]);
    const { emb, calls } = embedder();
    // 2000 characters count as 1000 tokens; two fit a budget of 2500, the third waits.
    expect(await embedPending(repo, emb, { maxTokens: 2500 })).toEqual({ embedded: 2, failed: 0 });
    expect(calls[0]).toHaveLength(2);
    expect(saved.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("makes no request when nothing is waiting", async () => {
    const { repo } = fakeRepo([]);
    const { emb, calls } = embedder();
    expect(await embedPending(repo, emb)).toEqual({ embedded: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it("saves nothing and reports the group as failed when the request fails", async () => {
    const { repo, saved } = fakeRepo(rows(4));
    const { emb } = embedder([1]);
    expect(await embedPending(repo, emb)).toEqual({ embedded: 0, failed: 4 });
    expect(saved).toEqual([]);
  });
});

describe("backfillEmbeddings", () => {
  it("embeds every row, one request per batch", async () => {
    const { repo, saved } = fakeRepo(rows(7));
    const { emb, calls } = embedder();
    expect(await backfillEmbeddings(repo, emb, { batchSize: 3 })).toEqual({ embedded: 7, failed: 0 });
    expect(saved).toHaveLength(7);
    expect(calls.map((texts) => texts.length)).toEqual([3, 3, 1]);
  });

  it("does nothing, and makes no request, when there is nothing to embed", async () => {
    const { repo } = fakeRepo([]);
    const { emb, calls } = embedder();
    expect(await backfillEmbeddings(repo, emb)).toEqual({ embedded: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it("stops at the first failed request instead of retrying", async () => {
    const { repo, saved } = fakeRepo(rows(7));
    const { emb, calls } = embedder([2]);
    const result = await backfillEmbeddings(repo, emb, { batchSize: 3 });
    expect(result).toEqual({ embedded: 3, failed: 3 });
    expect(calls).toHaveLength(2);
    expect(saved).toHaveLength(3);
  });

  it("splits a batch that is too large for one request, and waits between requests", async () => {
    const long = (id: string) => ({ id, mode: "vi_to_en" as const, inputText: "x".repeat(2000) });
    const { repo } = fakeRepo([long("a"), long("b"), long("c")]);
    const { emb, calls } = embedder();
    const sleep = vi.fn(async () => {});
    const result = await backfillEmbeddings(repo, emb, { maxTokens: 1500, pauseMs: 21_000, sleep });
    expect(result).toEqual({ embedded: 3, failed: 0 });
    expect(calls.map((texts) => texts.length)).toEqual([1, 1, 1]);
    // Between requests, not before the first.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(21_000);
  });

  it("does not wait at all when no pause is asked for", async () => {
    const { repo } = fakeRepo(rows(6));
    const { emb } = embedder();
    const sleep = vi.fn(async () => {});
    await backfillEmbeddings(repo, emb, { batchSize: 2, sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reports progress after each request", async () => {
    const { repo } = fakeRepo(rows(5));
    const { emb } = embedder();
    const progress: number[] = [];
    await backfillEmbeddings(repo, emb, { batchSize: 2, onProgress: (done) => progress.push(done) });
    expect(progress).toEqual([2, 4, 5]);
  });
});

describe("pasted conversations", () => {
  it("embeds only the newest part of a long pasted conversation", async () => {
    const long = `${"old ".repeat(1000)}NEWEST`;
    const { repo, saved } = fakeRepo([{ id: "g1", mode: "en_reply", inputText: long }]);
    const { emb, calls } = embedder();
    await backfillEmbeddings(repo, emb);
    const sent = calls[0][0];
    expect(sent.length).toBeLessThan(long.length);
    expect(sent.endsWith("NEWEST")).toBe(true);
    expect(saved.map((entry) => entry.id)).toEqual(["g1"]);
  });
});
