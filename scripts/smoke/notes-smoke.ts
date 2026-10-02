/**
 * Phase 9 integration check: the notes store against a real Postgres.
 *
 * Covers what the unit tests cannot: migration 0003 (table, constraints, the
 * `note_ids` column, the new usage kind), the database's own refusal to hold an
 * English version or a vector for a private note, vectors stored and cleared in
 * real `vector` columns, list order and filters, counts, the backfill, and that
 * deleting a note removes its vectors. The embedder and the model are fakes
 * that record every call, so the check also proves what was (and was never)
 * sent out.
 *
 * LOCAL DATABASE ONLY. It refuses any other host, and removes what it created
 * (notes whose text starts with "[notes-smoke]", requests marked the same way).
 *
 * Run from the repository root, with the local URL passed inline:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply \
 *     npx tsx scripts/smoke/notes-smoke.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getDb } from "../../lib/reply/db";
import type { Embedder } from "../../lib/reply/embeddings";
import { MAX_NOTES, MAX_PINNED_NOTES } from "../../lib/reply/limits";
import { backfillNoteEmbeddings } from "../../lib/reply/notes-backfill";
import { createNotes, updateNote, type NotesServiceDeps } from "../../lib/reply/notes-service";
import { createNotesRepo } from "../../lib/reply/notes-store";
import { createReplyRepo } from "../../lib/reply/repo";
import { generations, profileNotes, replyUsage } from "../../lib/reply/schema";
import type { NoteInput } from "../../lib/reply/schemas";

// drizzle-orm lives in the repo's node_modules, not next to this script.
const repoRequire = createRequire(`${process.cwd()}/package.json`);
const { eq, like, sql } = repoRequire("drizzle-orm") as typeof import("drizzle-orm");

const MARKER = "[notes-smoke]";
const MODEL = "voyage-smoke-model";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { hostname, port, pathname } = new URL(url);
console.log(`[notes-smoke] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
if (!LOCAL_HOSTS.has(hostname)) {
  console.error("[notes-smoke] refusing: this check only runs against a local database.");
  process.exit(1);
}

// A deterministic 1024-wide vector for a text, so the same text always embeds the same way.
function vectorFor(text: string): number[] {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return Array.from({ length: 1024 }, (_, i) => ((hash + i) % 100) / 100);
}

// drizzle wraps the driver's error; Postgres reports a failed CHECK as 23514 on the cause.
const isCheckViolation = (err: unknown): boolean => (err as { cause?: { code?: string } }).cause?.code === "23514";

const note = (text: string, over: Partial<NoteInput> = {}): NoteInput => ({
  text: `${MARKER} ${text}`,
  kind: "fact",
  scope: "both",
  private: false,
  pinned: false,
  ...over,
});

async function main() {
  const db = getDb();
  const repo = createNotesRepo(db);
  const replies = createReplyRepo(db);
  const check = (label: string) => console.log(`  ok  ${label}`);

  let embedMode: "ok" | "fail" = "ok";
  const embedCalls: string[][] = [];
  const suggestCalls: string[] = [];
  const embedder: Embedder = {
    model: MODEL,
    embed: async () => null,
    embedMany: async (texts) => {
      embedCalls.push(texts);
      return embedMode === "fail" ? null : texts.map(vectorFor);
    },
  };
  const deps: NotesServiceDeps = {
    repo,
    embedder,
    suggest: async (text) => {
      suggestCalls.push(text);
      return { textEn: `EN ${text.replace(MARKER, "").trim()}`, kind: "fact", scope: "both", happenedOn: null };
    },
  };
  const resetCalls = () => {
    embedCalls.length = 0;
    suggestCalls.length = 0;
  };
  const ok = <T>(result: { ok: boolean } & ({ value: T } | { error: string })): T => {
    assert.ok(result.ok, `expected ok, got ${JSON.stringify(result)}`);
    return (result as { value: T }).value;
  };

  async function cleanup() {
    await db.delete(profileNotes).where(like(profileNotes.text, `${MARKER}%`));
    await db.delete(generations).where(like(generations.inputText, `${MARKER}%`));
    await db.delete(replyUsage).where(eq(replyUsage.model, MODEL));
  }

  const dims = async (id: string) =>
    ((await db.execute(
      sql`select vector_dims(embedding) as a, vector_dims(embedding_en) as b, embed_model as model from profile_notes where id = ${id}`,
    )) as unknown as Array<{ a: number | null; b: number | null; model: string | null }>)[0];

  const rawCount = async () =>
    Number(((await db.execute(sql`select count(*)::int as n from profile_notes where text like ${MARKER + "%"}`)) as unknown as Array<{ n: number }>)[0].n);

  try {
    await cleanup();
    const [{ n: existing }] = (await db.execute(sql`select count(*)::int as n from profile_notes where text not like ${MARKER + "%"}`)) as unknown as Array<{ n: number }>;
    assert.equal(Number(existing), 0, "the database already holds other notes; run this check on an empty local database");

    // ------------------------------------------------------------ migration
    const cols = (await db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'profile_notes' order by column_name`)) as unknown as Array<{ column_name: string }>;
    assert.deepEqual(
      cols.map((c) => c.column_name),
      ["created_at", "embed_model", "embedding", "embedding_en", "happened_on", "id", "kind", "pinned", "private", "scope", "source", "status", "text", "text_en", "updated_at"],
    );
    check("migration 0003: profile_notes has the expected columns");

    const noteIds = (await db.execute(sql`
      select column_default from information_schema.columns where table_name = 'generations' and column_name = 'note_ids'`)) as unknown as Array<{ column_default: string }>;
    assert.match(noteIds[0]?.column_default ?? "", /'\{\}'::uuid\[\]/);
    check("migration 0003: generations.note_ids exists and defaults to an empty list");

    await db.insert(replyUsage).values({ kind: "notes", model: MODEL });
    await assert.rejects(db.insert(replyUsage).values({ kind: "bogus", model: MODEL }), (err: unknown) => {
      return (err as { cause?: { constraint_name?: string } }).cause?.constraint_name === "reply_usage_kind_check";
    });
    check("migration 0003: usage kind 'notes' is accepted and an unknown kind is still refused");

    // -------------------------------------- the database's own privacy rule
    const refused = async (values: Partial<typeof profileNotes.$inferInsert>) =>
      assert.rejects(db.insert(profileNotes).values({ text: `${MARKER} x`, private: true, ...values }), (err: unknown) => {
        return (err as { cause?: { constraint_name?: string } }).cause?.constraint_name === "profile_notes_private_check";
      });
    await refused({ textEn: "an English version" });
    await refused({ embedding: vectorFor("a") });
    await refused({ embeddingEn: vectorFor("a") });
    await refused({ pinned: true });
    await db.insert(profileNotes).values({ text: `${MARKER} plain private`, private: true });
    await db.insert(profileNotes).values({ text: `${MARKER} public with everything`, textEn: "EN", embedding: vectorFor("a"), embeddingEn: vectorFor("b"), pinned: true });
    check("a private note cannot hold an English version, a vector or a pin: the database refuses it");

    const [loose] = (await db.execute(
      sql`select id from profile_notes where text = ${MARKER + " public with everything"}`,
    )) as unknown as Array<{ id: string }>;
    await assert.rejects(db.execute(sql`update profile_notes set private = true where id = ${loose.id}`), isCheckViolation);
    await db.delete(profileNotes).where(like(profileNotes.text, `${MARKER}%`));
    check("flipping a note with derived data to private is refused unless that data is cleared in the same statement");

    for (const bad of [{ kind: "memory" }, { scope: "family" }, { status: "gone" }, { source: "robot" }]) {
      await assert.rejects(db.insert(profileNotes).values({ text: `${MARKER} bad`, ...bad }), isCheckViolation);
    }
    check("kind, scope, status and source are limited by the database");

    // ------------------------------------------------------- create + vectors
    const [first] = ok(await createNotes(deps, [note("Mình làm backend.")], "manual"));
    assert.deepEqual(embedCalls, [[`${MARKER} Mình làm backend.`, "EN Mình làm backend."]]);
    assert.deepEqual(await dims(first.id), { a: 1024, b: 1024, model: MODEL });
    assert.equal(first.indexed, true);
    assert.deepEqual(Object.keys(first).sort(), [
      "createdAt", "happenedOn", "id", "indexed", "kind", "pinned", "private", "scope", "source", "status", "text", "textEn", "updatedAt",
    ]);
    check("create: English version written, both texts embedded in one request, 1024-wide vectors stored; no vector leaves the store");

    resetCalls();
    const batch = ok(
      await createNotes(
        deps,
        [note("Hai", { textEn: "Two" }), note("Ba", { textEn: "Two" }), note("Bốn", { textEn: null }), note("Bí mật riêng", { private: true })],
        "imported",
      ),
    );
    assert.equal(embedCalls.length, 1, "one request for the whole batch");
    assert.deepEqual(embedCalls[0], [`${MARKER} Hai`, "Two", `${MARKER} Ba`, `${MARKER} Bốn`]);
    assert.deepEqual(suggestCalls, [], "the writer's own English (or none) means no model call, and none for a private note");
    assert.ok(!embedCalls.flat().join(" ").includes("Bí mật riêng"));
    const privateRow = batch[3];
    assert.deepEqual(await dims(privateRow.id), { a: null, b: null, model: null });
    assert.deepEqual([privateRow.textEn, privateRow.pinned, privateRow.indexed], [null, false, true]);
    assert.equal(batch.every((n) => n.source === "imported"), true);
    check("batch: one embedding request for all texts (each once); the private note is stored as written and nothing else");

    // -------------------------------------------------- fail-open + backfill
    resetCalls();
    embedMode = "fail";
    const [late] = ok(await createNotes(deps, [note("Lưu khi dịch vụ lỗi")], "manual"));
    assert.equal(late.indexed, false);
    assert.deepEqual(await dims(late.id), { a: null, b: null, model: null });
    assert.equal((await repo.counts()).unindexed, 1);
    check("fail-open: a note is saved without vectors when embedding fails, and counted as not searchable");

    embedMode = "ok";
    resetCalls();
    const result = await backfillNoteEmbeddings(repo, embedder);
    assert.deepEqual(result, { embedded: 1, failed: 0 });
    assert.deepEqual(await dims(late.id), { a: 1024, b: 1024, model: MODEL });
    assert.equal((await repo.counts()).unindexed, 0);
    assert.ok(!embedCalls.flat().join(" ").includes("Bí mật riêng"), "the backfill never lists a private note");
    assert.deepEqual(await backfillNoteEmbeddings(repo, embedder), { embedded: 0, failed: 0 });
    check("backfill: embeds what is missing in one request, skips private notes, and is safe to rerun");

    // ------------------------------------------------------ list and filters
    const pinned = ok(await createNotes(deps, [note("Ghim", { pinned: true, scope: "work" })], "manual"))[0];
    const event = ok(await createNotes(deps, [note("Dọn nhà", { kind: "event", happenedOn: "2026-09-01", scope: "casual" })], "manual"))[0];
    assert.equal(event.happenedOn, "2026-09-01");
    const all = await repo.list({ status: "active" }, 100);
    assert.equal(all[0].id, pinned.id, "pinned notes come first");
    assert.deepEqual((await repo.list({ status: "active", scope: "work" }, 100)).map((n) => n.id), [pinned.id]);
    assert.deepEqual((await repo.list({ status: "active", kind: "event" }, 100)).map((n) => n.id), [event.id]);
    assert.deepEqual((await repo.list({ status: "active", pinned: true }, 100)).map((n) => n.id), [pinned.id]);
    assert.deepEqual((await repo.list({ status: "active", private: true }, 100)).map((n) => n.id), [privateRow.id]);
    check("list: pinned first, and the scope, kind, pinned and private filters narrow it");

    // ----------------------------------------------------------------- update
    const before = await dims(first.id);
    resetCalls();
    ok(await updateNote(deps, first.id, { scope: "work", kind: "event", happenedOn: "2026-01-02" }));
    assert.deepEqual(embedCalls.concat([suggestCalls]), [[]], "no call for a change of scope, kind or date");
    assert.deepEqual(await dims(first.id), before);
    check("update: a change of scope, kind or date makes no model or embedding call and keeps the vectors");

    const kindBack = ok(await updateNote(deps, first.id, { kind: "fact" }));
    assert.equal(kindBack.happenedOn, null);
    check("update: a note that becomes a fact loses its date");

    const edited = ok(await updateNote(deps, first.id, { text: `${MARKER} Mình làm fullstack.` }));
    assert.equal(edited.textEn, "EN Mình làm fullstack.");
    assert.deepEqual(embedCalls.at(-1), [`${MARKER} Mình làm fullstack.`, "EN Mình làm fullstack."]);
    check("update: new text gets a new English version and new vectors");

    // Private round trip
    resetCalls();
    const locked = ok(await updateNote(deps, first.id, { private: true }));
    assert.deepEqual([locked.private, locked.textEn, locked.pinned], [true, null, false]);
    assert.deepEqual(await dims(first.id), { a: null, b: null, model: null });
    assert.deepEqual(embedCalls.concat([suggestCalls]), [[]]);
    ok(await updateNote(deps, first.id, { text: `${MARKER} sửa khi còn riêng tư` }));
    assert.deepEqual(embedCalls.concat([suggestCalls]), [[]], "editing a private note sends nothing");
    const unlocked = ok(await updateNote(deps, first.id, { private: false }));
    assert.equal(unlocked.indexed, true);
    assert.deepEqual(suggestCalls, [`${MARKER} sửa khi còn riêng tư`]);
    assert.deepEqual(await dims(first.id), { a: 1024, b: 1024, model: MODEL });
    check("privacy: private erases the derived data with no call, edits send nothing, making it usable again sends the text once");

    // Archive + pin cap
    ok(await updateNote(deps, pinned.id, { status: "archived" }));
    assert.equal((await repo.list({ status: "archived" }, 10))[0].pinned, false);
    assert.equal((await repo.list({ status: "active", pinned: true }, 10)).length, 0);
    ok(await updateNote(deps, pinned.id, { status: "active" }));
    check("update: archiving unpins, and archived notes leave the active list");

    // Restoring does not pin again, so nothing is pinned here.
    assert.equal((await repo.counts()).pinned, 0);
    const tooMany = Array.from({ length: MAX_PINNED_NOTES + 1 }, (_, i) => note(`pin ${i}`, { pinned: true, textEn: null }));
    assert.equal((await createNotes(deps, tooMany, "imported")).ok, false, "one more than the limit is refused as a whole");
    assert.equal(await rawCount(), (await repo.counts()).active + (await repo.counts()).archived, "and nothing of it was saved");
    ok(await createNotes(deps, tooMany.slice(0, MAX_PINNED_NOTES), "imported"));
    assert.equal((await repo.counts()).pinned, MAX_PINNED_NOTES);
    assert.equal((await createNotes(deps, [note("one too many", { pinned: true })], "manual")).ok, false);
    assert.equal((await createNotes(deps, [note("private is fine", { pinned: true, private: true })], "manual")).ok, true);
    check("the pinned limit counts real rows and refuses a batch as a whole; a private note does not count against it");

    const counts = await repo.counts();
    assert.equal(counts.pinned, MAX_PINNED_NOTES);
    assert.equal(counts.unindexed, 0);
    assert.ok(counts.private >= 2);
    assert.ok(MAX_NOTES >= counts.active + counts.archived);
    check("counts: active, archived, pinned, private and not-searchable agree with the rows");

    // -------------------------------------------------- note_ids on requests
    const genId = await replies.createGeneration({
      mode: "vi_to_en",
      context: "work",
      inputText: `${MARKER} request`,
      model: MODEL,
      tier: "fast",
      speed: "auto",
      learn: true,
      useMemory: false,
    });
    const [gen] = await db.select({ ids: generations.noteIds }).from(generations).where(eq(generations.id, genId));
    assert.deepEqual(gen.ids, []);
    await db.update(generations).set({ noteIds: [first.id, event.id] }).where(eq(generations.id, genId));
    const [gen2] = await db.select({ ids: generations.noteIds }).from(generations).where(eq(generations.id, genId));
    assert.deepEqual(gen2.ids, [first.id, event.id]);
    check("generations.note_ids: empty by default, and can hold note ids");

    // ----------------------------------------------------------------- delete
    assert.equal(await repo.remove(event.id), true);
    assert.equal(await repo.remove(event.id), false);
    assert.equal(await repo.get(event.id), null);
    const [gone] = (await db.execute(sql`select count(*)::int as n from profile_notes where id = ${event.id}`)) as unknown as Array<{ n: number }>;
    assert.equal(Number(gone.n), 0, "the row, and its vectors with it, are gone");
    check("delete: the note and its vectors are removed");

    const beforeAll = await rawCount();
    assert.ok(beforeAll > 5);
    assert.equal(await repo.removeAll(), beforeAll);
    assert.equal(await rawCount(), 0);
    assert.deepEqual(await repo.counts(), { active: 0, archived: 0, pinned: 0, private: 0, unindexed: 0 });
    check("delete everything: every note is removed, private and archived ones included");

    console.log("\nAll notes checks passed.");
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
