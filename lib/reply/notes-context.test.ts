// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { chooseNotes, labelledFor, planNotes, toPromptNote, type NotesUseDeps } from "./notes-context";
import type { NotesReadFilter, NotesReader } from "./notes-read";
import { NOTES_SIMILARITY_FLOOR, NOTE_SUGGESTIONS_MAX, SMALL_COLLECTION_MAX, type SimilarNote, type UsableNote } from "./notes-select";

const TODAY = new Date("2026-10-01T00:00:00Z");

const note = (id: string, over: Partial<UsableNote> = {}): UsableNote => ({
  id,
  text: `VN ${id}`,
  textEn: `EN ${id}`,
  kind: "fact",
  happenedOn: null,
  pinned: false,
  ...over,
});
const sim = (id: string, similarity: number, over: Partial<UsableNote> = {}): SimilarNote => ({ ...note(id, over), similarity });

function harness(options: { pinned?: UsableNote[]; unpinned?: UsableNote[]; similar?: SimilarNote[]; failList?: boolean; failSearch?: boolean } = {}) {
  const calls = { listPinned: [] as NotesReadFilter[], listUnpinned: [] as Array<[NotesReadFilter, number]>, findSimilar: [] as unknown[][] };
  const reader: NotesReader = {
    listPinned: vi.fn(async (filter) => {
      calls.listPinned.push(filter);
      if (options.failList) throw new Error("db down");
      return options.pinned ?? [];
    }),
    listUnpinned: vi.fn(async (filter, limit) => {
      calls.listUnpinned.push([filter, limit]);
      return (options.unpinned ?? []).slice(0, limit);
    }),
    findSimilar: vi.fn(async (vector, model, filter, limit) => {
      calls.findSimilar.push([vector, model, filter, limit]);
      if (options.failSearch) throw new Error("db down");
      return options.similar ?? [];
    }),
    getUsable: async () => null,
  };
  const deps: NotesUseDeps = { reader, embedder: null, embedModel: "voyage-test", now: () => TODAY };
  return { deps, calls };
}

const many = (n: number) => Array.from({ length: n }, (_, i) => note(`n${i}`));
const base = { context: "casual" as const, excludeIds: [] as string[] };

describe("planNotes", () => {
  it("asks only for what the request may use: its context, the notes switched off left out", async () => {
    const h = harness();
    await planNotes(h.deps, { ...base, mode: "en_reply", input: "x", excludeIds: ["gone"] });
    expect(h.calls.listPinned).toEqual([{ context: "casual", excludeIds: ["gone"] }]);
    expect(h.calls.listUnpinned[0][0]).toEqual({ context: "casual", excludeIds: ["gone"] });
  });

  it("sends a small collection whole to the model, with no search", async () => {
    const h = harness({ unpinned: many(SMALL_COLLECTION_MAX) });
    const plan = await planNotes(h.deps, { ...base, mode: "en_reply", input: "x" });
    expect(plan).toMatchObject({ strategy: "whole", queryText: null, failed: false });
    expect(plan.everything).toHaveLength(SMALL_COLLECTION_MAX);
  });

  it("looks for the nearest notes once the collection is larger, on the newest part of the chat", async () => {
    const h = harness({ unpinned: many(SMALL_COLLECTION_MAX + 1) });
    const chat = `${"older line. ".repeat(200)}Are you free tomorrow?`;
    const plan = await planNotes(h.deps, { ...base, mode: "en_reply", input: chat });
    expect(plan.strategy).toBe("search");
    expect(plan.queryText?.endsWith("Are you free tomorrow?")).toBe(true);
    expect(plan.queryText!.length).toBeLessThan(chat.length);
    expect(h.calls.listUnpinned[0][1]).toBe(SMALL_COLLECTION_MAX + 1);
  });

  it("suggests, and never inserts, notes for a typed idea", async () => {
    const h = harness({ unpinned: many(3) });
    const plan = await planNotes(h.deps, { ...base, mode: "vi_to_en", input: "  Tôi cũng sống ở chung cư  " });
    expect(plan).toMatchObject({ strategy: "chips", queryText: "Tôi cũng sống ở chung cư" });
  });

  it("has nothing to do without notes, but still carries the pinned ones", async () => {
    const pinned = [note("p", { pinned: true })];
    for (const mode of ["en_reply", "vi_to_en"] as const) {
      const plan = await planNotes(harness({ pinned }).deps, { ...base, mode, input: "x" });
      expect(plan).toMatchObject({ strategy: "none", pinned, everything: [] });
    }
  });

  it("goes on without notes, and says so, when they cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const plan = await planNotes(harness({ failList: true, unpinned: many(2) }).deps, { ...base, mode: "en_reply", input: "x" });
    expect(plan).toMatchObject({ strategy: "none", failed: true, pinned: [], everything: [] });
  });
});

describe("chooseNotes", () => {
  const choose = (h: ReturnType<typeof harness>, plan: Awaited<ReturnType<typeof planNotes>>, vector: number[] | null = [0.1]) =>
    chooseNotes(h.deps, plan, vector, "casual", []);

  it("offers the whole small collection without any search", async () => {
    const h = harness({ unpinned: many(4) });
    const plan = await planNotes(h.deps, { ...base, mode: "en_reply", input: "x" });
    const choice = await choose(h, plan, null);
    expect(choice.status).toBe("ready");
    expect(choice.offered.map((n) => n.id)).toEqual(["n0", "n1", "n2", "n3"]);
    expect(h.calls.findSimilar).toEqual([]);
  });

  it("offers the nearest notes over the floor for a larger collection, with the model's embedding model", async () => {
    const h = harness({
      unpinned: many(SMALL_COLLECTION_MAX + 5),
      similar: [sim("close", 0.7), sim("near", NOTES_SIMILARITY_FLOOR), sim("far", NOTES_SIMILARITY_FLOOR - 0.1)],
    });
    const plan = await planNotes(h.deps, { ...base, mode: "en_reply", input: "x" });
    const choice = await choose(h, plan, [0.5, 0.5]);
    expect(choice.offered.map((n) => n.id)).toEqual(["close", "near"]);
    expect(h.calls.findSimilar[0].slice(0, 2)).toEqual([[0.5, 0.5], "voyage-test"]);
  });

  it("reports 'empty' when nothing is close enough, and 'ready' when only pinned notes apply", async () => {
    const lonely = harness({ unpinned: many(SMALL_COLLECTION_MAX + 1), similar: [sim("far", 0.05)] });
    const plan = await planNotes(lonely.deps, { ...base, mode: "en_reply", input: "x" });
    expect((await choose(lonely, plan)).status).toBe("empty");

    const withPinned = harness({ pinned: [note("p", { pinned: true })], unpinned: many(SMALL_COLLECTION_MAX + 1), similar: [] });
    const plan2 = await planNotes(withPinned.deps, { ...base, mode: "en_reply", input: "x" });
    expect(await choose(withPinned, plan2)).toMatchObject({ status: "ready", offered: [] });
  });

  it("skips the search, and keeps the pinned notes, when no vector could be made", async () => {
    const h = harness({ pinned: [note("p", { pinned: true })], unpinned: many(SMALL_COLLECTION_MAX + 1) });
    const plan = await planNotes(h.deps, { ...base, mode: "en_reply", input: "x" });
    const choice = await choose(h, plan, null);
    expect(choice).toMatchObject({ status: "skipped", offered: [] });
    expect(choice.pinned.map((n) => n.id)).toEqual(["p"]);
    expect(h.calls.findSimilar).toEqual([]);
  });

  it("skips the search, without failing, when it throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ unpinned: many(SMALL_COLLECTION_MAX + 1), failSearch: true });
    const plan = await planNotes(h.deps, { ...base, mode: "en_reply", input: "x" });
    expect(await choose(h, plan)).toMatchObject({ status: "skipped", offered: [] });
  });

  it("only suggests notes for a typed idea: a few, over the floor, none offered", async () => {
    const similar = [sim("a", 0.9), sim("b", 0.8), sim("c", 0.7), sim("d", 0.6), sim("e", 0.1)];
    const h = harness({ unpinned: many(3), similar });
    const plan = await planNotes(h.deps, { ...base, mode: "vi_to_en", input: "Tôi cũng sống ở chung cư" });
    const choice = await choose(h, plan);
    expect(choice.offered).toEqual([]);
    expect(choice.suggestions.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(choice.suggestions).toHaveLength(NOTE_SUGGESTIONS_MAX);
    expect(choice.status).toBe("ready");
  });

  it("makes no suggestion without a vector, and says the search was skipped", async () => {
    const h = harness({ unpinned: many(3) });
    const plan = await planNotes(h.deps, { ...base, mode: "vi_to_en", input: "x" });
    expect(await choose(h, plan, null)).toMatchObject({ status: "skipped", suggestions: [] });
  });

  it("reports 'empty' for no notes at all, and 'skipped' when the notes could not be read", async () => {
    const none = harness();
    expect((await choose(none, await planNotes(none.deps, { ...base, mode: "en_reply", input: "x" }))).status).toBe("empty");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = harness({ failList: true });
    expect((await choose(failing, await planNotes(failing.deps, { ...base, mode: "en_reply", input: "x" }))).status).toBe("skipped");
  });

  it("lets an old event rank lower than a recent one of nearly the same match", async () => {
    const h = harness({
      unpinned: many(SMALL_COLLECTION_MAX + 1),
      similar: [
        sim("old", 0.62, { kind: "event", happenedOn: "2024-01-01" }),
        sim("recent", 0.58, { kind: "event", happenedOn: "2026-09-25" }),
      ],
    });
    const choice = await choose(h, await planNotes(h.deps, { ...base, mode: "en_reply", input: "x" }));
    expect(choice.offered.map((n) => n.id)).toEqual(["recent", "old"]);
  });
});

describe("labels for the prompt", () => {
  it("numbers the pinned notes first, shows the English wording, and the month of an event", () => {
    const choice = {
      status: "ready" as const,
      pinned: [note("p1", { pinned: true })],
      offered: [note("o1", { kind: "event", happenedOn: "2026-09-14" }), note("o2", { textEn: null })],
      suggestions: [],
    };
    expect(labelledFor(choice).map(toPromptNote)).toEqual([
      { label: 1, text: "EN p1", kind: "fact", when: null },
      { label: 2, text: "EN o1", kind: "event", when: "2026-09" },
      { label: 3, text: "VN o2", kind: "fact", when: null },
    ]);
  });
});
