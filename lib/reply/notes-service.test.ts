// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Embedder } from "./embeddings";
import { MAX_NOTES, MAX_PINNED_NOTES } from "./limits";
import { createNotes, MAX_ENGLISH_FILLS_PER_REQUEST, reviewSuggestion, updateNote, type NotesServiceDeps } from "./notes-service";
import type { NewNote, NoteChanges, NotesRepo } from "./notes-store";
import type { NoteInput, NotePatch } from "./schemas";
import type { NoteCounts, NoteRecord, NoteSuggestion } from "./types";

interface Row extends NewNote {
  id: string;
  status: NoteRecord["status"];
}

// The same rule the database enforces: a private note holds no English version,
// no vectors and no pin.
function assertPrivateRule(row: Row): void {
  if (row.private && (row.textEn !== null || row.embedding || row.embeddingEn || row.pinned)) {
    throw new Error("profile_notes_private_check violated");
  }
}

function fakeRepo(seed: Array<Partial<Row>> = []) {
  const rows = new Map<string, Row>();
  const scrubbed: Array<string[] | "all"> = [];
  let next = 0;
  const add = (note: Partial<Row>): Row => {
    const row: Row = {
      id: `n${++next}`,
      text: "note",
      textEn: null,
      kind: "fact",
      happenedOn: null,
      scope: "both",
      private: false,
      pinned: false,
      source: "manual",
      status: "active",
      embedding: null,
      embeddingEn: null,
      embedModel: null,
      ...note,
    };
    assertPrivateRule(row);
    rows.set(row.id, row);
    return row;
  };
  seed.forEach(add);

  const record = (row: Row): NoteRecord => ({
    id: row.id,
    text: row.text,
    textEn: row.textEn,
    kind: row.kind,
    happenedOn: row.happenedOn,
    scope: row.scope,
    private: row.private,
    pinned: row.pinned,
    status: row.status,
    source: row.source,
    indexed: row.private || (row.embedding !== null && (row.textEn === null || row.embeddingEn !== null)),
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });

  const repo: NotesRepo = {
    list: async () => [...rows.values()].map(record),
    get: async (id) => (rows.has(id) ? record(rows.get(id)!) : null),
    create: async (notes) => notes.map((note) => record(add(note))),
    update: async (id, changes: NoteChanges) => {
      const row = rows.get(id);
      if (!row) return null;
      const updated = { ...row, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) } as Row;
      assertPrivateRule(updated);
      rows.set(id, updated);
      return record(updated);
    },
    remove: async (id) => rows.delete(id),
    scrubDirections: async (ids) => {
      scrubbed.push(ids);
      return 0;
    },
    removeAll: async () => {
      const count = rows.size;
      rows.clear();
      return count;
    },
    counts: async (): Promise<NoteCounts> => {
      const live = [...rows.values()];
      return {
        active: live.filter((row) => row.status === "active").length,
        archived: live.filter((row) => row.status === "archived").length,
        pinned: live.filter((row) => row.status === "active" && row.pinned).length,
        private: live.filter((row) => row.private).length,
        unindexed: 0,
      };
    },
    listNeedingEmbedding: async () => [],
    saveEmbeddings: async () => {},
  };
  return { repo, rows, scrubbed };
}

const VECTOR = (seed: number) => Array.from({ length: 4 }, (_, i) => seed + i / 10);

function harness(options: { embedder?: "ok" | "none" | "fail"; seed?: Array<Partial<Row>>; english?: string | null } = {}) {
  const { repo, rows, scrubbed } = fakeRepo(options.seed);
  const suggestCalls: string[] = [];
  const embedCalls: string[][] = [];
  const embedder: Embedder = {
    model: "voyage-test",
    embed: async () => null,
    embedMany: vi.fn(async (texts: string[]) => {
      embedCalls.push(texts);
      return options.embedder === "fail" ? null : texts.map((_, index) => VECTOR(index + 1));
    }),
  };
  const deps: NotesServiceDeps = {
    repo,
    embedder: options.embedder === "none" ? null : embedder,
    suggest: async (text): Promise<NoteSuggestion | null> => {
      suggestCalls.push(text);
      const english = options.english === undefined ? `EN(${text})` : options.english;
      return english === null ? null : { textEn: english, kind: "fact", scope: "both", happenedOn: null };
    },
  };
  return { deps, rows, scrubbed, suggestCalls, embedCalls, embedder };
}

const input = (over: Partial<NoteInput> = {}): NoteInput => ({
  text: "Mình làm backend.",
  kind: "fact",
  scope: "both",
  private: false,
  pinned: false,
  ...over,
});

const ok = <T,>(result: { ok: boolean } & ({ value: T } | { error: string })): T => {
  if (!result.ok) throw new Error(`expected ok: ${(result as { error: string }).error}`);
  return (result as { value: T }).value;
};

describe("createNotes", () => {
  it("writes the English version, embeds both texts in one request and stores the vectors", async () => {
    const h = harness();
    const [note] = ok(await createNotes(h.deps, [input()], "manual"));

    expect(h.suggestCalls).toEqual(["Mình làm backend."]);
    expect(h.embedCalls).toEqual([["Mình làm backend.", "EN(Mình làm backend.)"]]);
    expect(note).toMatchObject({ textEn: "EN(Mình làm backend.)", source: "manual", indexed: true });
    const stored = [...h.rows.values()][0];
    expect(stored.embedding).toEqual(VECTOR(1));
    expect(stored.embeddingEn).toEqual(VECTOR(2));
    expect(stored.embedModel).toBe("voyage-test");
  });

  it("keeps the writer's own English version and does not ask the model", async () => {
    const h = harness();
    const [note] = ok(await createNotes(h.deps, [input({ textEn: "I build backends." })], "manual"));
    expect(h.suggestCalls).toEqual([]);
    expect(note.textEn).toBe("I build backends.");
  });

  it("respects a writer who wants no English version", async () => {
    const h = harness();
    const [note] = ok(await createNotes(h.deps, [input({ textEn: null })], "manual"));
    expect(h.suggestCalls).toEqual([]);
    expect(h.embedCalls).toEqual([["Mình làm backend."]]);
    expect(note.textEn).toBeNull();
  });

  it("embeds a whole batch in a single request, each text once", async () => {
    const h = harness();
    const batch = [
      input({ text: "A", textEn: "same" }),
      input({ text: "B", textEn: "same" }),
      input({ text: "C", textEn: "C" }),
    ];
    ok(await createNotes(h.deps, batch, "imported"));
    expect(h.embedCalls).toHaveLength(1);
    expect(h.embedCalls[0]).toEqual(["A", "same", "B", "C"]);
    const stored = [...h.rows.values()];
    expect(stored[0].embeddingEn).toEqual(stored[1].embeddingEn);
    expect(stored[2].embedding).toEqual(stored[2].embeddingEn);
    expect(stored.every((row) => row.source === "imported")).toBe(true);
  });

  it("splits a large batch into as few requests as the token limit allows", async () => {
    const h = harness();
    // 4 notes of 1,000 characters = 500 tokens each; the 5,000-token budget holds them in one request,
    // but 12 of them need two.
    const big = (i: number) => input({ text: `${i} ${"x".repeat(998)}`, textEn: null });
    ok(await createNotes(h.deps, [0, 1, 2, 3].map(big), "imported"));
    expect(h.embedCalls).toHaveLength(1);

    const more = harness();
    ok(await createNotes(more.deps, Array.from({ length: 12 }, (_, i) => big(i)), "imported"));
    expect(more.embedCalls).toHaveLength(2);
    expect(more.embedCalls.flat()).toHaveLength(12);
  });

  it("keeps the notes of a request that went through and leaves the rest without vectors when a later request fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    let calls = 0;
    h.embedder.embedMany = vi.fn(async (texts: string[]) => {
      calls += 1;
      return calls === 1 ? texts.map(() => VECTOR(1)) : null;
    });
    const big = (i: number) => input({ text: `${i} ${"x".repeat(998)}`, textEn: null });
    const notes = ok(await createNotes(h.deps, Array.from({ length: 12 }, (_, i) => big(i)), "imported"));
    expect(calls).toBe(2);
    const indexed = notes.filter((note) => note.indexed).length;
    expect(indexed).toBeGreaterThan(0);
    expect(indexed).toBeLessThan(12);
  });

  it("limits how many English versions the model writes for one request", async () => {
    const h = harness();
    const many = Array.from({ length: MAX_ENGLISH_FILLS_PER_REQUEST + 3 }, (_, i) => input({ text: `note ${i}` }));
    const notes = ok(await createNotes(h.deps, many, "imported"));
    expect(h.suggestCalls).toHaveLength(MAX_ENGLISH_FILLS_PER_REQUEST);
    expect(notes.filter((note) => note.textEn === null)).toHaveLength(3);
  });

  it("saves a note even when embedding is unavailable or fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const embedder of ["none", "fail"] as const) {
      const h = harness({ embedder });
      const [note] = ok(await createNotes(h.deps, [input()], "manual"));
      expect(note.indexed).toBe(false);
      expect([...h.rows.values()][0].embedding).toBeNull();
    }
  });

  it("saves a note when the model has no English version to offer", async () => {
    const h = harness({ english: null });
    const [note] = ok(await createNotes(h.deps, [input()], "manual"));
    expect(note.textEn).toBeNull();
    expect(h.embedCalls).toEqual([["Mình làm backend."]]);
  });

  it("keeps a date only on an event", async () => {
    const h = harness();
    const notes = ok(
      await createNotes(
        h.deps,
        [input({ kind: "fact", happenedOn: "2026-09-01" }), input({ text: "Dọn nhà", kind: "event", happenedOn: "2026-09-01" })],
        "manual",
      ),
    );
    expect(notes.map((note) => note.happenedOn)).toEqual([null, "2026-09-01"]);
  });

  describe("a private note", () => {
    it("is stored as written and never reaches the model or the embedder", async () => {
      const h = harness();
      const [note] = ok(await createNotes(h.deps, [input({ text: "Chuyện riêng tư", private: true, pinned: true, textEn: "secret" })], "manual"));
      expect(h.suggestCalls).toEqual([]);
      expect(h.embedCalls).toEqual([]);
      expect(h.embedder.embedMany).not.toHaveBeenCalled();
      expect(note).toMatchObject({ text: "Chuyện riêng tư", textEn: null, private: true, pinned: false, indexed: true });
    });

    it("is left out of a batch's calls while the others go through", async () => {
      const h = harness();
      ok(await createNotes(h.deps, [input({ text: "Công khai" }), input({ text: "Riêng tư", private: true })], "imported"));
      expect(h.suggestCalls).toEqual(["Công khai"]);
      expect(h.embedCalls.flat().join(" ")).not.toContain("Riêng tư");
    });
  });

  it("refuses to go past the number of notes it keeps", async () => {
    const seed = Array.from({ length: MAX_NOTES }, () => ({}));
    const h = harness({ seed });
    const result = await createNotes(h.deps, [input()], "manual");
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(h.suggestCalls).toEqual([]);
  });

  it("refuses to go past the number of pinned notes, and does not count a private one", async () => {
    const seed = Array.from({ length: MAX_PINNED_NOTES }, () => ({ pinned: true }));
    const h = harness({ seed });
    expect(await createNotes(h.deps, [input({ pinned: true })], "manual")).toMatchObject({ ok: false, status: 400 });
    expect((await createNotes(h.deps, [input({ private: true, pinned: true })], "manual")).ok).toBe(true);
  });
});

describe("updateNote", () => {
  const patch = (over: NotePatch): NotePatch => over;
  const seeded = () =>
    harness({
      seed: [
        { text: "Mình làm backend.", textEn: "I work on backends.", embedding: VECTOR(9), embeddingEn: VECTOR(8), embedModel: "voyage-test" },
      ],
    });

  it("is a 404 for a note that does not exist", async () => {
    const h = harness();
    expect(await updateNote(h.deps, "missing", patch({ pinned: true }))).toMatchObject({ ok: false, status: 404 });
  });

  it("makes no model or embedding call for a change of scope, pin, kind or status", async () => {
    const h = seeded();
    ok(await updateNote(h.deps, "n1", patch({ scope: "work", pinned: true, kind: "event", happenedOn: "2026-09-01" })));
    ok(await updateNote(h.deps, "n1", patch({ status: "archived" })));
    expect(h.suggestCalls).toEqual([]);
    expect(h.embedCalls).toEqual([]);
    expect(h.rows.get("n1")).toMatchObject({ scope: "work", status: "archived", pinned: false, happenedOn: "2026-09-01" });
    expect(h.rows.get("n1")?.embedding).toEqual(VECTOR(9));
  });

  it("refreshes the English version and the vectors when the text changes", async () => {
    const h = seeded();
    const note = ok(await updateNote(h.deps, "n1", patch({ text: "Mình làm fullstack." })));
    expect(h.suggestCalls).toEqual(["Mình làm fullstack."]);
    expect(h.embedCalls).toEqual([["Mình làm fullstack.", "EN(Mình làm fullstack.)"]]);
    expect(note.textEn).toBe("EN(Mình làm fullstack.)");
    expect(h.rows.get("n1")?.embedding).toEqual(VECTOR(1));
  });

  it("uses the English version the writer typed instead of asking the model", async () => {
    const h = seeded();
    ok(await updateNote(h.deps, "n1", patch({ text: "Mình làm fullstack.", textEn: "I do fullstack." })));
    expect(h.suggestCalls).toEqual([]);
    expect(h.embedCalls).toEqual([["Mình làm fullstack.", "I do fullstack."]]);
  });

  it("re-embeds when only the English version is corrected", async () => {
    const h = seeded();
    ok(await updateNote(h.deps, "n1", patch({ textEn: "I build backend services." })));
    expect(h.suggestCalls).toEqual([]);
    expect(h.embedCalls).toEqual([["Mình làm backend.", "I build backend services."]]);
  });

  it("drops the English vector when the English version is removed", async () => {
    const h = seeded();
    ok(await updateNote(h.deps, "n1", patch({ textEn: null })));
    expect(h.embedCalls).toEqual([["Mình làm backend."]]);
    expect(h.rows.get("n1")).toMatchObject({ textEn: null, embeddingEn: null });
  });

  it("clears stale vectors, and still saves, when embedding fails after an edit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({
      embedder: "fail",
      seed: [{ text: "cũ", textEn: "old", embedding: VECTOR(9), embeddingEn: VECTOR(8), embedModel: "voyage-test" }],
    });
    const note = ok(await updateNote(h.deps, "n1", patch({ text: "mới", textEn: "new" })));
    expect(note).toMatchObject({ text: "mới", textEn: "new", indexed: false });
    expect(h.rows.get("n1")?.embedding).toBeNull();
  });

  it("unpins a note that is archived", async () => {
    const h = harness({ seed: [{ pinned: true }] });
    ok(await updateNote(h.deps, "n1", patch({ status: "archived" })));
    expect(h.rows.get("n1")?.pinned).toBe(false);
  });

  it("refuses to pin past the limit, or to pin a private note", async () => {
    const seed = [...Array.from({ length: MAX_PINNED_NOTES }, () => ({ pinned: true })), {}, { private: true }];
    const h = harness({ seed });
    expect(await updateNote(h.deps, `n${MAX_PINNED_NOTES + 1}`, patch({ pinned: true }))).toMatchObject({ ok: false, status: 400 });
    expect(await updateNote(h.deps, `n${MAX_PINNED_NOTES + 2}`, patch({ pinned: true }))).toMatchObject({ ok: false, status: 400 });
  });

  it("removes the date when a note becomes a fact", async () => {
    const h = harness({ seed: [{ kind: "event", happenedOn: "2026-09-01" }] });
    ok(await updateNote(h.deps, "n1", patch({ kind: "fact" })));
    expect(h.rows.get("n1")?.happenedOn).toBeNull();
  });

  describe("privacy", () => {
    it("making a note private erases its English version and vectors without any call", async () => {
      const h = harness({
        seed: [{ text: "Bí mật", textEn: "Secret", pinned: true, embedding: VECTOR(1), embeddingEn: VECTOR(2), embedModel: "voyage-test" }],
      });
      const note = ok(await updateNote(h.deps, "n1", patch({ private: true })));
      expect(note).toMatchObject({ private: true, textEn: null, pinned: false });
      expect(h.rows.get("n1")).toMatchObject({ textEn: null, embedding: null, embeddingEn: null, embedModel: null });
      expect(h.suggestCalls).toEqual([]);
      expect(h.embedCalls).toEqual([]);
    });

    it("editing a private note makes no call", async () => {
      const h = harness({ seed: [{ text: "Bí mật", private: true }] });
      ok(await updateNote(h.deps, "n1", patch({ text: "Bí mật hơn", textEn: "smuggled" })));
      expect(h.suggestCalls).toEqual([]);
      expect(h.embedCalls).toEqual([]);
      expect(h.rows.get("n1")).toMatchObject({ text: "Bí mật hơn", textEn: null });
    });

    it("making a note public again is the moment its text goes out, once", async () => {
      const h = harness({ seed: [{ text: "Từng bí mật", private: true }] });
      const note = ok(await updateNote(h.deps, "n1", patch({ private: false })));
      expect(h.suggestCalls).toEqual(["Từng bí mật"]);
      expect(h.embedCalls).toEqual([["Từng bí mật", "EN(Từng bí mật)"]]);
      expect(note).toMatchObject({ private: false, indexed: true });
    });

    it("never lets a private note's text reach a model or the embedder during its whole life", async () => {
      const h = harness();
      const SECRET = "chuyện-không-ai-được-biết";
      const [created] = ok(await createNotes(h.deps, [input({ text: SECRET, private: true })], "manual"));
      ok(await updateNote(h.deps, created.id, patch({ text: `${SECRET} 2`, scope: "work", kind: "event", happenedOn: "2026-09-01" })));
      ok(await updateNote(h.deps, created.id, patch({ status: "archived" })));
      ok(await updateNote(h.deps, created.id, patch({ status: "active" })));

      const everythingSent = [...h.suggestCalls, ...h.embedCalls.flat()].join("\n");
      expect(everythingSent).not.toContain("chuyện-không-ai-được-biết");
    });
  });
});

describe("reviewSuggestion", () => {
  const waiting = (over: Partial<Row> = {}): Partial<Row> => ({
    text: "Tuần trước mình vừa dọn nhà.",
    textEn: "I moved house last week.",
    status: "suggested",
    source: "suggested",
    scope: "casual",
    embedding: VECTOR(1),
    embeddingEn: VECTOR(2),
    embedModel: "voyage-test",
    ...over,
  });

  it("turns an approved suggestion into an active note without asking a model for anything", async () => {
    const h = harness({ seed: [waiting()] });
    const note = ok(await reviewSuggestion(h.deps, "n1", { decision: "approve" }));
    expect(note).toMatchObject({ status: "active", source: "suggested", scope: "casual", pinned: false });
    expect(h.suggestCalls).toEqual([]);
    expect(h.embedCalls).toEqual([]);
    // It keeps the vectors made when it was proposed, so it can be found at once.
    expect(h.rows.get("n1")).toMatchObject({ embedding: VECTOR(1), embeddingEn: VECTOR(2) });
  });

  it("applies the writer's edits: new wording is re-translated and re-embedded, scope and pin are saved", async () => {
    const h = harness({ seed: [waiting()] });
    const note = ok(
      await reviewSuggestion(h.deps, "n1", {
        decision: "approve",
        changes: { text: "Mình vừa dọn nhà sang quận 7.", scope: "both", pinned: true },
      }),
    );
    expect(note).toMatchObject({ status: "active", scope: "both", pinned: true, text: "Mình vừa dọn nhà sang quận 7." });
    expect(h.suggestCalls).toEqual(["Mình vừa dọn nhà sang quận 7."]);
    expect(h.embedCalls).toHaveLength(1);
  });

  it("writes an English version on approval when the proposal had none, but not for a private note", async () => {
    const plain = harness({ seed: [waiting({ textEn: null, embeddingEn: null })] });
    const note = ok(await reviewSuggestion(plain.deps, "n1", { decision: "approve" }));
    expect(note.textEn).toBe("EN(Tuần trước mình vừa dọn nhà.)");

    const hidden = harness({ seed: [waiting({ textEn: null, embeddingEn: null })] });
    const kept = ok(await reviewSuggestion(hidden.deps, "n1", { decision: "approve", changes: { private: true } }));
    expect(kept).toMatchObject({ status: "active", private: true, textEn: null });
    expect(hidden.suggestCalls).toEqual([]);
    expect(hidden.rows.get("n1")).toMatchObject({ embedding: null, embeddingEn: null, pinned: false });
  });

  it("remembers a dismissed suggestion by its text, unpinned and never active", async () => {
    const h = harness({ seed: [waiting()] });
    const note = ok(await reviewSuggestion(h.deps, "n1", { decision: "dismiss" }));
    expect(note.status).toBe("dismissed");
    expect(h.rows.get("n1")).toMatchObject({ text: "Tuần trước mình vừa dọn nhà.", status: "dismissed" });
  });

  it("finds only suggestions: a note that is active, archived or already decided is not found", async () => {
    for (const status of ["active", "archived", "dismissed"] as const) {
      const h = harness({ seed: [waiting({ status })] });
      for (const decision of ["approve", "dismiss"] as const) {
        const result = await reviewSuggestion(h.deps, "n1", { decision });
        expect(result).toEqual({ ok: false, status: 404, error: "Không tìm thấy ghi chú gợi ý này." });
      }
      expect(h.rows.get("n1")?.status).toBe(status);
    }
    const none = harness();
    expect((await reviewSuggestion(none.deps, "missing", { decision: "dismiss" })).ok).toBe(false);
  });

  it("refuses to approve past the note limit, and past the pin limit", async () => {
    const full = harness({ seed: [waiting()] });
    const counts = full.deps.repo.counts;
    full.deps.repo.counts = async () => ({ ...(await counts()), active: MAX_NOTES });
    const result = await reviewSuggestion(full.deps, "n1", { decision: "approve" });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(full.rows.get("n1")?.status).toBe("suggested");

    const pins = Array.from({ length: MAX_PINNED_NOTES }, (_, i) => ({ text: `pinned ${i}`, pinned: true }));
    const pinned = harness({ seed: [...pins, waiting()] });
    const refused = await reviewSuggestion(pinned.deps, `n${MAX_PINNED_NOTES + 1}`, { decision: "approve", changes: { pinned: true } });
    expect(refused).toMatchObject({ ok: false, status: 400 });
    expect(pinned.rows.get(`n${MAX_PINNED_NOTES + 1}`)?.status).toBe("suggested");
  });
});

describe("updateNote and the copies of a note's wording", () => {
  it("removes the copies kept in stored directions when a note becomes private", async () => {
    const h = harness({ seed: [{ text: "Mình có mèo.", textEn: "I have a cat." }] });
    ok(await updateNote(h.deps, "n1", { private: true }));
    expect(h.scrubbed).toEqual([["n1"]]);
  });

  it("leaves them alone for any other change, and for a note that was already private", async () => {
    const h = harness({ seed: [{ text: "a", textEn: "b" }, { text: "p", private: true }] });
    ok(await updateNote(h.deps, "n1", { scope: "work", pinned: true, status: "archived" }));
    ok(await updateNote(h.deps, "n2", { private: true }));
    expect(h.scrubbed).toEqual([]);
  });

  it("does not remove anything when the note is not found", async () => {
    const h = harness();
    expect((await updateNote(h.deps, "missing", { private: true })).ok).toBe(false);
    expect(h.scrubbed).toEqual([]);
  });
});
