// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Embedder } from "./embeddings";
import { backfillNoteEmbeddings, embedPendingNotes } from "./notes-backfill";
import type { NoteNeedingEmbedding, NotesRepo } from "./notes-store";

function fakeRepo(initial: NoteNeedingEmbedding[]) {
  let waiting = [...initial];
  const saved: Array<{ id: string; embedding: number[]; embeddingEn: number[] | null; model: string }> = [];
  const repo = {
    listNeedingEmbedding: vi.fn(async (_model: string, limit: number) => waiting.slice(0, limit)),
    saveEmbeddings: vi.fn(async (id: string, vectors: { embedding: number[]; embeddingEn: number[] | null }, model: string) => {
      saved.push({ id, ...vectors, model });
      waiting = waiting.filter((note) => note.id !== id);
    }),
  } as unknown as NotesRepo;
  return { repo, saved };
}

function embedderOf(outcome: "ok" | "fail") {
  const calls: string[][] = [];
  const embedder: Embedder = {
    model: "voyage-test",
    embed: async () => null,
    embedMany: async (texts) => {
      calls.push(texts);
      return outcome === "fail" ? null : texts.map((text) => [text.length]);
    },
  };
  return { embedder, calls };
}

const notes = (n: number): NoteNeedingEmbedding[] =>
  Array.from({ length: n }, (_, i) => ({ id: `n${i}`, text: `note ${i}`, textEn: i % 2 === 0 ? `english ${i}` : null }));

describe("backfillNoteEmbeddings", () => {
  it("embeds every waiting note, one request per batch", async () => {
    const { repo, saved } = fakeRepo(notes(5));
    const { embedder, calls } = embedderOf("ok");
    const result = await backfillNoteEmbeddings(repo, embedder, { batchSize: 2 });

    expect(result).toEqual({ embedded: 5, failed: 0 });
    expect(calls).toHaveLength(3);
    expect(saved).toHaveLength(5);
    expect(saved.every((row) => row.model === "voyage-test")).toBe(true);
  });

  it("keeps the English vector only for a note that has an English version", async () => {
    const { repo, saved } = fakeRepo(notes(2));
    const { embedder } = embedderOf("ok");
    await backfillNoteEmbeddings(repo, embedder);
    expect(saved.find((row) => row.id === "n0")?.embeddingEn).toEqual(["english 0".length]);
    expect(saved.find((row) => row.id === "n1")?.embeddingEn).toBeNull();
  });

  it("stops at the first failed batch instead of retrying", async () => {
    const { repo, saved } = fakeRepo(notes(5));
    const { embedder, calls } = embedderOf("fail");
    const result = await backfillNoteEmbeddings(repo, embedder, { batchSize: 2 });
    expect(result).toEqual({ embedded: 0, failed: 2 });
    expect(calls).toHaveLength(1);
    expect(saved).toEqual([]);
  });

  it("does nothing, and makes no request, when no note is waiting", async () => {
    const { repo } = fakeRepo([]);
    const { embedder, calls } = embedderOf("ok");
    expect(await backfillNoteEmbeddings(repo, embedder)).toEqual({ embedded: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it("reports progress after each batch", async () => {
    const { repo } = fakeRepo(notes(4));
    const { embedder } = embedderOf("ok");
    const progress: number[] = [];
    await backfillNoteEmbeddings(repo, embedder, { batchSize: 2, onProgress: (done) => progress.push(done) });
    expect(progress).toEqual([2, 4]);
  });
});

describe("embedPendingNotes", () => {
  it("embeds the waiting notes with one request and leaves the rest for next time", async () => {
    const { repo, saved } = fakeRepo(notes(5));
    const { embedder, calls } = embedderOf("ok");
    expect(await embedPendingNotes(repo, embedder, { batchSize: 3 })).toEqual({ embedded: 3, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(saved).toHaveLength(3);
  });

  it("sends only as many notes as fit one request's token budget", async () => {
    const big = (i: number): NoteNeedingEmbedding => ({ id: `n${i}`, text: `${i} ${"x".repeat(1998)}`, textEn: null });
    const { repo, saved } = fakeRepo([big(0), big(1), big(2)]);
    const { embedder, calls } = embedderOf("ok");
    // 2000 characters count as 1000 tokens; two fit a budget of 2500.
    expect(await embedPendingNotes(repo, embedder, { maxTokens: 2500 })).toEqual({ embedded: 2, failed: 0 });
    expect(calls[0]).toHaveLength(2);
    expect(saved.map((row) => row.id)).toEqual(["n0", "n1"]);
  });

  it("makes no request when nothing is waiting, and saves nothing when the request fails", async () => {
    const empty = fakeRepo([]);
    const ok = embedderOf("ok");
    expect(await embedPendingNotes(empty.repo, ok.embedder)).toEqual({ embedded: 0, failed: 0 });
    expect(ok.calls).toEqual([]);

    const waiting = fakeRepo(notes(4));
    const failing = embedderOf("fail");
    expect(await embedPendingNotes(waiting.repo, failing.embedder)).toEqual({ embedded: 0, failed: 4 });
    expect(waiting.saved).toEqual([]);
  });
});

describe("backfillNoteEmbeddings pacing", () => {
  it("waits between requests when a pause is asked for, and not before the first", async () => {
    const big = (i: number): NoteNeedingEmbedding => ({ id: `n${i}`, text: `${i} ${"x".repeat(1998)}`, textEn: null });
    const { repo } = fakeRepo([big(0), big(1), big(2)]);
    const { embedder, calls } = embedderOf("ok");
    const sleep = vi.fn(async () => {});
    const result = await backfillNoteEmbeddings(repo, embedder, { maxTokens: 1500, pauseMs: 21_000, sleep });
    expect(result).toEqual({ embedded: 3, failed: 0 });
    expect(calls.map((texts) => texts.length)).toEqual([1, 1, 1]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(21_000);
  });
});
