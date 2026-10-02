/**
 * Phase 10 integration check: using the writer's notes in replies, against a
 * real Postgres.
 *
 * The promises that matter are proven here with real SQL, not with fakes:
 *  - a private note, an archived or unconfirmed one, a note of the other scope
 *    and a note the writer switched off NEVER reach a prompt;
 *  - the pinned notes are the ones in the cached prefix, in a fixed order;
 *  - similarity is the better of a note's two vectors, only for notes embedded
 *    with the current model, with exact figures;
 *  - a whole `startGeneration` over the real database offers the right notes,
 *    reads the model's "@@used" line, saves the used ids in `note_ids`, and
 *    suggests (never inserts) notes for a typed idea;
 *  - the "Do notes help?" statistic counts the right requests.
 * The model and the embedder are fakes that record everything they are sent.
 *
 * LOCAL DATABASE ONLY, and only an EMPTY one for notes. It refuses any other
 * host and removes what it created.
 *
 * Run from the repository root, with the local URL passed inline:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply \
 *     npx tsx scripts/smoke/notes-use-smoke.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { StreamPart, StreamReplyParams } from "../../lib/reply/claude";
import { getDb } from "../../lib/reply/db";
import type { Embedder } from "../../lib/reply/embeddings";
import { startGeneration } from "../../lib/reply/generate";
import { createNotesReader } from "../../lib/reply/notes-read";
import { createReplyRepo } from "../../lib/reply/repo";
import { conversations, generations, profileNotes, replyOptions, replyUsage } from "../../lib/reply/schema";
import type { GenerateBody } from "../../lib/reply/schemas";
import { createStatsRepo } from "../../lib/reply/stats-repo";
import { toStatsView } from "../../lib/reply/stats";
import { createThreadRepo } from "../../lib/reply/thread-store";
import type { ReplyStreamEvent } from "../../lib/reply/types";

// drizzle-orm lives in the repo's node_modules, not next to this script.
const repoRequire = createRequire(`${process.cwd()}/package.json`);
const { eq, like, sql } = repoRequire("drizzle-orm") as typeof import("drizzle-orm");

const MARK = "[notes-use-smoke]";
const MODEL = "voyage-use-smoke";
const FAKE_LLM = "notes-use-smoke-model";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { hostname, port, pathname } = new URL(url);
console.log(`[notes-use-smoke] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
if (!LOCAL_HOSTS.has(hostname)) {
  console.error("[notes-use-smoke] refusing: this check only runs against a local database.");
  process.exit(1);
}

// A unit vector along one axis, and one at a known angle to it.
const axis = (i: number): number[] => Array.from({ length: 1024 }, (_, k) => (k === i ? 1 : 0));
// cos(angle between axis(0) and this) = c
const at = (c: number): number[] => Array.from({ length: 1024 }, (_, k) => (k === 0 ? c : k === 1 ? Math.sqrt(1 - c * c) : 0));
const QUERY = axis(0);

type Seed = Partial<typeof profileNotes.$inferInsert> & { text: string };

async function main() {
  const db = getDb();
  const reader = createNotesReader(db);
  const replies = createReplyRepo(db);
  const threads = createThreadRepo(db);
  const check = (label: string) => console.log(`  ok  ${label}`);
  const conversationIds: string[] = [];

  async function cleanup() {
    await db.delete(generations).where(like(generations.inputText, `${MARK}%`));
    await db.delete(replyUsage).where(eq(replyUsage.model, FAKE_LLM));
    if (conversationIds.length > 0) {
      for (const id of conversationIds) await db.delete(conversations).where(eq(conversations.id, id));
    }
    await db.delete(profileNotes).where(like(profileNotes.text, `${MARK}%`));
  }

  async function note(seed: Seed): Promise<string> {
    const [row] = await db
      .insert(profileNotes)
      .values({ ...seed, text: `${MARK} ${seed.text}` })
      .returning({ id: profileNotes.id });
    // A fixed order: the oldest first, one second apart.
    await db.execute(sql`update profile_notes set created_at = now() - make_interval(secs => ${1000 - order++}) where id = ${row.id}`);
    return row.id;
  }
  let order = 0;

  try {
    await cleanup();
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from profile_notes`)) as unknown as Array<{ n: number }>;
    assert.equal(Number(n), 0, "the database already holds notes; run this check on an empty local database");

    // ------------------------------------------------------------ the reader
    const A = await note({ text: "public, both scopes", textEn: "EN A", embedding: at(0.9), embeddingEn: at(0.2), embedModel: MODEL });
    const W = await note({ text: "public, work only", textEn: "EN W", scope: "work", embedding: at(0.3), embeddingEn: at(0.8), embedModel: MODEL });
    const C = await note({ text: "public, casual only", textEn: "EN C", scope: "casual", embedding: at(0.95), embedModel: MODEL });
    const P = await note({ text: "private SECRET-P", private: true });
    const R = await note({ text: "archived SECRET-R", status: "archived", embedding: at(0.99), embedModel: MODEL });
    const D = await note({ text: "dismissed SECRET-D", status: "dismissed", embedding: at(0.99), embedModel: MODEL });
    const S = await note({ text: "suggested SECRET-S", status: "suggested", embedding: at(0.99), embedModel: MODEL });
    const PB = await note({ text: "pinned, both", textEn: "EN PB", pinned: true, embedding: at(0.99), embedModel: MODEL });
    const PW = await note({ text: "pinned, work", textEn: "EN PW", pinned: true, scope: "work" });
    const PC = await note({ text: "pinned, casual", textEn: "EN PC", pinned: true, scope: "casual" });
    const OLD = await note({ text: "other model", textEn: "EN OLD", embedding: at(0.97), embedModel: "some-other-model" });
    const NOVEC = await note({ text: "no vector yet", textEn: "EN NOVEC" });
    const EV = await note({ text: "an event", textEn: "EN EV", kind: "event", happenedOn: "2026-09-14", embedding: at(0.6), embedModel: MODEL });

    const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

    assert.deepEqual(ids(await reader.listPinned({ context: "work" })), [PB, PW]);
    assert.deepEqual(ids(await reader.listPinned({ context: "casual" })), [PB, PC]);
    check("pinned notes: only active, public ones of the request's scope, in a fixed order");

    assert.deepEqual(ids(await reader.listUnpinned({ context: "work" }, 100)), [A, W, OLD, NOVEC, EV]);
    assert.deepEqual(ids(await reader.listUnpinned({ context: "casual" }, 100)), [A, C, OLD, NOVEC, EV]);
    for (const id of [P, R, D, S]) {
      for (const context of ["work", "casual"] as const) {
        assert.ok(!ids(await reader.listUnpinned({ context }, 100)).includes(id));
        assert.ok(!ids(await reader.listPinned({ context })).includes(id));
        assert.equal(await reader.getUsable(id, { context }), null);
      }
    }
    check("private, archived, suggested and dismissed notes are never listed or fetched, in either scope");

    assert.deepEqual(ids(await reader.listUnpinned({ context: "work", excludeIds: [A, PB] }, 100)), [W, OLD, NOVEC, EV]);
    assert.deepEqual(ids(await reader.listPinned({ context: "work", excludeIds: [PB] })), [PW]);
    assert.equal((await reader.listUnpinned({ context: "work" }, 2)).length, 2);
    check("a note switched off for the request is left out, pinned or not; the limit is honoured");

    assert.equal((await reader.getUsable(W, { context: "work" }))?.id, W);
    assert.equal(await reader.getUsable(W, { context: "casual" }), null);
    assert.equal((await reader.getUsable(PB, { context: "casual" }))?.pinned, true);
    check("getUsable: a note of the other scope is refused; a pinned one of this scope is allowed");

    const near = await reader.findSimilar(QUERY, MODEL, { context: "work" }, 20);
    // Work: A and EV and W (C is casual-only; PB pinned; OLD another model; R/D/S not active; NOVEC no vector).
    assert.deepEqual(ids(near), [A, W, EV]);
    const byId = new Map(near.map((row) => [row.id, row.similarity]));
    assert.ok(Math.abs(byId.get(A)! - 0.9) < 1e-5, "A is judged by its better vector (0.9, not 0.2)");
    assert.ok(Math.abs(byId.get(W)! - 0.8) < 1e-5, "W is judged by its better vector (the English one, 0.8, not 0.3)");
    assert.ok(Math.abs(byId.get(EV)! - 0.6) < 1e-5);
    assert.deepEqual(ids(await reader.findSimilar(QUERY, MODEL, { context: "casual" }, 20)), [C, A, EV]);
    assert.deepEqual(ids(await reader.findSimilar(QUERY, MODEL, { context: "work", excludeIds: [A] }, 20)), [W, EV]);
    assert.deepEqual(ids(await reader.findSimilar(QUERY, MODEL, { context: "work" }, 1)), [A]);
    assert.deepEqual(ids(await reader.findSimilar(QUERY, "some-other-model", { context: "work" }, 20)), [OLD]);
    check("similarity: the better of the two vectors, exact; only this model's notes, this scope, never pinned, private or archived ones");

    // ------------------------------------------------- a whole request, real database
    const [conv] = await db.insert(conversations).values({ title: `${MARK} thread`, context: "work" }).returning({ id: conversations.id });
    conversationIds.push(conv.id);

    const prompts: StreamReplyParams[] = [];
    const modelText = (extra: string) => `@@short\nMoving is tough.\n@@medium\nMoving is exhausting. I just moved too.\n@@long\nA longer one.\n@@alt\nAnother way.${extra}`;
    let nextText = modelText("\n@@used 1");
    const stream = async function* (params: StreamReplyParams): AsyncGenerator<StreamPart> {
      prompts.push(params);
      yield {
        type: "final",
        text: nextText,
        stopReason: "end_turn",
        model: FAKE_LLM,
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      };
    };
    const embedCalls: string[][] = [];
    const embedder: Embedder = {
      model: MODEL,
      embed: async (text) => {
        embedCalls.push([text]);
        return QUERY;
      },
      embedMany: async (texts) => {
        embedCalls.push(texts);
        return texts.map(() => QUERY);
      },
    };
    const body = (over: Partial<GenerateBody>): GenerateBody => ({
      mode: "en_reply",
      input: `${MARK} Alice: It's exhausting when moving to a new place.`,
      context: "work",
      speed: "fast",
      learn: true,
      useMemory: false,
      better: false,
      explain: false,
      useNotes: true,
      excludeNoteIds: [],
      conversationId: conv.id,
      ...over,
    });
    const run = async (over: Partial<GenerateBody>) => {
      prompts.length = 0;
      embedCalls.length = 0;
      const result = await startGeneration(body(over), {
        repo: replies,
        stream,
        models: { fast: FAKE_LLM, smart: FAKE_LLM },
        dailyBudgetUsd: 1000,
        threads: { repo: threads, selfNames: [], summarize: async () => "", afterResponse: () => {} },
        notes: { reader, embedder, embedModel: MODEL, now: () => new Date("2026-10-01T00:00:00Z") },
      });
      if (!result.ok) throw new Error(`expected a stream, got ${result.error}`);
      const text = await new Response(result.stream).text();
      const evs = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as ReplyStreamEvent);
      return {
        meta: evs[0] as Extract<ReplyStreamEvent, { t: "meta" }>,
        done: evs.at(-1) as Extract<ReplyStreamEvent, { t: "done" }>,
        everything: JSON.stringify(prompts),
      };
    };
    // Text that must never reach a work prompt: private, archived, unconfirmed and dismissed notes, and the casual-only ones.
    const SECRETS = ["SECRET-P", "SECRET-R", "SECRET-D", "SECRET-S", "EN C", "public, casual only", "EN PC", "pinned, casual"];
    const noSecrets = (everything: string) => {
      for (const word of SECRETS) assert.ok(!everything.includes(word), `"${word}" must never reach a prompt`);
    };

    // A small collection (5 unpinned work notes) is sent whole.
    const small = await run({});
    assert.equal(small.meta.notes?.status, "ready");
    assert.deepEqual(embedCalls, [], "a small collection needs no embedding at all");
    noSecrets(small.everything);
    const prefix = prompts[0].system.map((block) => block.text).join("\n");
    assert.ok(prefix.includes("[1] EN PB") && prefix.includes("[2] EN PW"), "the pinned notes of this scope are in the cached prefix");
    const offered = prompts[0].messages[0].content;
    for (const text of ["EN A", "EN W", "EN NOVEC"]) assert.ok(offered.includes(text), `${text} is offered`);
    assert.ok(offered.includes("(2026-09) EN EV"), "an event shows its month");
    assert.ok(offered.indexOf("EN A") > offered.indexOf("<thread>"));
    check("a pasted message with a small collection: every allowed note, none other; pinned ones in the cached prefix; no embedding");

    // The model said it used note 1 (the first pinned note).
    assert.deepEqual(small.done.notesUsed?.map((ref) => ref.id), [PB]);
    const [saved] = await db.select({ ids: generations.noteIds }).from(generations).where(eq(generations.id, small.meta.generationId));
    assert.deepEqual(saved.ids, [PB]);
    check("the notes the model reported are shown and saved in note_ids");

    // Notes switched off for the request.
    const without = await run({ excludeNoteIds: [PB, A] });
    assert.ok(!without.everything.includes("EN PB"), "a left-out pinned note is not in the prompt");
    assert.ok(!prompts[0].messages[0].content.includes("] EN A"), "a left-out note is not offered");
    assert.ok(prompts[0].system.map((b) => b.text).join("\n").includes("[1] EN PW"), "labels renumber without the pinned note that was left out");
    check("a note switched off is gone from the prefix and from the request");

    // No report from the model: no note counts as used.
    nextText = modelText("");
    const silent = await run({});
    assert.deepEqual(silent.done.notesUsed, []);
    const [none] = await db.select({ ids: generations.noteIds }).from(generations).where(eq(generations.id, silent.meta.generationId));
    assert.deepEqual(none.ids, []);
    nextText = modelText("\n@@used 99");
    assert.deepEqual((await run({})).done.notesUsed, [], "a number that was never offered is ignored");
    check("no report, or an unknown number, means no note used");

    // The other scope: the casual request sees the casual notes and none of the work-only ones.
    nextText = modelText("\n@@used none");
    const casual = await run({ context: "casual" });
    const casualAll = JSON.stringify(prompts);
    assert.ok(casualAll.includes("EN C") && casualAll.includes("EN PC"));
    for (const word of ["EN W", "EN PW", "SECRET-P", "SECRET-R"]) assert.ok(!casualAll.includes(word), `"${word}" must not reach a casual prompt`);
    assert.equal(casual.meta.notes?.status, "ready");
    check("a casual request gets the casual and shared notes, never the work-only ones");

    // A larger collection: searched, with ONE embedding request on the newest part of the paste.
    const extras: string[] = [];
    for (let i = 0; i < 28; i++) extras.push(await note({ text: `filler ${i}`, textEn: `EN filler ${i}`, embedding: axis(5 + i), embedModel: MODEL }));
    nextText = modelText("\n@@used 3");
    const big = await run({});
    assert.equal(embedCalls.length, 1, "one embedding request");
    assert.equal((embedCalls as string[][])[0].length, 1, "the notes query only (memory is off)");
    assert.equal(big.meta.notes?.status, "ready");
    const bigPrompt = prompts[0].messages[0].content;
    // Work, near the query: A (0.9), W (0.8), EV (0.6); the fillers are orthogonal.
    assert.ok(bigPrompt.includes("] EN A") && bigPrompt.includes("] EN W") && bigPrompt.includes("EN EV"));
    assert.ok(!bigPrompt.includes("EN filler") && !bigPrompt.includes("EN NOVEC") && !bigPrompt.includes("EN OLD"), "notes that do not match, have no vector or were embedded with another model are not offered");
    noSecrets(JSON.stringify(prompts));
    assert.ok(bigPrompt.indexOf("EN A") < bigPrompt.indexOf("EN W"), "the better match comes first");
    check("a larger collection is searched: the matching notes only, best first, one embedding request");

    // A typed idea gets suggestions, and no note in the replies.
    nextText = modelText("");
    const typed = await run({ mode: "vi_to_en", input: `${MARK} Tôi cũng sống ở chung cư`, conversationId: undefined });
    const typedPrompt = prompts[0].messages[0].content;
    for (const text of ["EN A", "EN W", "EN EV", "EN filler"]) assert.ok(!typedPrompt.includes(text), `${text} is not put in the replies for a typed idea`);
    assert.deepEqual(typed.meta.notes?.suggestions.map((s) => s.id), [A, W, EV]);
    assert.equal(typed.meta.notes?.offered, 0);
    assert.equal(typed.done.notesUsed, undefined);
    noSecrets(JSON.stringify(prompts));
    check("a typed idea: the nearest notes are suggested as chips and are not in the replies");

    // ------------------------------------------------------------ statistics
    await db.delete(generations).where(like(generations.inputText, `${MARK}%`));
    const mk = async (over: Partial<typeof generations.$inferInsert>, ratings: Array<"good" | "bad" | null>) => {
      const [g] = await db
        .insert(generations)
        .values({ mode: "en_reply", context: "work", inputText: `${MARK} stat`, model: FAKE_LLM, speed: "auto", learn: true, useMemory: false, status: "done", ...over })
        .returning({ id: generations.id });
      for (const [i, rating] of ratings.entries()) {
        await db.insert(replyOptions).values({ generationId: g.id, variant: "short", position: i, text: "t", rating, ratedAt: rating ? new Date() : null });
      }
      return g.id;
    };
    const before = toStatsView(await createStatsRepo(db).load());
    await mk({ noteIds: [A] }, ["good", "good", "bad"]);
    await mk({ noteIds: [] }, ["good", "bad", "bad"]);
    await mk({ noteIds: [] }, [null]);
    await mk({ mode: "vi_to_en", noteIds: [] }, ["good"]);
    await mk({ noteIds: [A], refineInstruction: "[longer]" }, ["good", "good"]);
    await mk({ noteIds: [A], status: "error" }, ["good"]);
    const after = toStatsView(await createStatsRepo(db).load());
    const diff = (a: { good: number; bad: number }, b: { good: number; bad: number }) => [a.good - b.good, a.bad - b.bad];
    assert.deepEqual(diff(after.notesRates.with, before.notesRates.with), [2, 1]);
    assert.deepEqual(diff(after.notesRates.without, before.notesRates.without), [1, 2]);
    assert.equal(after.notesUse.pasted - before.notesUse.pasted, 3, "three finished pasted-message requests; a typed idea, a developed reply and a failed one are not counted");
    assert.equal(after.notesUse.used - before.notesUse.used, 1);
    check("Do notes help?: only finished pasted-message replies, split by whether a note was used");

    console.log("\nAll notes-use checks passed.");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
