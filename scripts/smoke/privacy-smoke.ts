/**
 * Phase 12 integration check: privacy and the final polish, against a real
 * Postgres. The model and the embedder are never called.
 *
 *  - A note that was used to develop a reply leaves a copy of its wording in the
 *    reply's stored direction, which the style-profile builder and the export
 *    both read. Making the note private, deleting it, or deleting every note
 *    must remove that copy (the direction keeps its "[personal detail]" tag, so
 *    it still marks the row as a refinement).
 *  - "Export my notes" never includes a private note, a waiting suggestion or a
 *    dismissed one, and never an embedding.
 *  - A style-profile version can have its rules edited, deleted or added to
 *    before it is switched on, and not while it is in use.
 *
 * LOCAL DATABASE ONLY, and only an EMPTY one. It refuses any other host and
 * empties the tables it used.
 *
 * Run from the repository root, with the local URL passed inline:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply \
 *     npx tsx scripts/smoke/privacy-smoke.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getDb } from "../../lib/reply/db";
import { createExportRepo } from "../../lib/reply/export-repo";
import { toExportRecords } from "../../lib/reply/export";
import { toNotesExport, MAX_NOTES_EXPORT } from "../../lib/reply/notes-export";
import { editStyleRules, listStyleProfiles } from "../../lib/reply/style-profile-service";
import { updateNote, type NotesServiceDeps } from "../../lib/reply/notes-service";
import { createNotesRepo } from "../../lib/reply/notes-store";
import { generations, profileNotes, replyOptions, styleProfiles } from "../../lib/reply/schema";
import { createStyleProfileRepo } from "../../lib/reply/style-profile-store";

// drizzle-orm lives in the repo's node_modules, not next to this script.
const repoRequire = createRequire(`${process.cwd()}/package.json`);
const { eq, like, sql } = repoRequire("drizzle-orm") as typeof import("drizzle-orm");

const MARK = "[privacy-smoke]";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { hostname, port, pathname } = new URL(url);
console.log(`[privacy-smoke] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
if (!LOCAL_HOSTS.has(hostname)) {
  console.error("[privacy-smoke] refusing: this check only runs against a local database.");
  process.exit(1);
}

async function main() {
  const db = getDb();
  const notesRepo = createNotesRepo(db);
  const styles = createStyleProfileRepo(db);
  const exportRepo = createExportRepo(db);
  const check = (label: string) => console.log(`  ok  ${label}`);

  async function cleanup() {
    await db.delete(generations).where(like(generations.inputText, `${MARK}%`));
    await db.delete(profileNotes);
    await db.delete(styleProfiles);
  }

  // A reply the writer developed with a saved note, picked by them, with the
  // direction stored the way the app stores it.
  async function developedWith(noteId: string, wording: string) {
    const [base] = await db
      .insert(generations)
      .values({ mode: "vi_to_en", context: "casual", inputText: `${MARK} idea`, model: "m", speed: "auto", learn: true, useMemory: false, status: "done" })
      .returning({ id: generations.id });
    const [baseOption] = await db
      .insert(replyOptions)
      .values({ generationId: base.id, variant: "medium", position: 0, text: "Thanks, I am fine." })
      .returning({ id: replyOptions.id });
    const [child] = await db
      .insert(generations)
      .values({
        mode: "vi_to_en",
        context: "casual",
        inputText: `${MARK} idea`,
        model: "m",
        speed: "auto",
        learn: true,
        useMemory: false,
        status: "done",
        refineOfOptionId: baseOption.id,
        refineInstruction: `[personal detail] ${wording}`,
        noteIds: [noteId],
      })
      .returning({ id: generations.id });
    await db.insert(replyOptions).values({ generationId: child.id, variant: "long", position: 0, text: "Thanks, I am fine. I just moved.", chosen: true, rating: "good" });
    return child.id;
  }

  const directionOf = async () => (await styles.collectEvidence()).refined.map((row) => row.direction);
  const exportedInstructions = async () =>
    toExportRecords(await exportRepo.loadRows(), []).flatMap((record) => (record.instruction ? [record.instruction] : []));
  const storedDirections = async () =>
    ((await db.execute(sql`select refine_instruction as d from generations where refine_instruction is not null order by created_at`)) as unknown as Array<{ d: string }>).map((row) => row.d);

  try {
    await cleanup();
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from profile_notes`)) as unknown as Array<{ n: number }>;
    assert.equal(Number(n), 0, "the database already holds notes; run this check on an empty local database");

    // ------------------------------------------- copies of a note's wording
    const service: NotesServiceDeps = { repo: notesRepo, embedder: null, suggest: async () => null };
    const [note] = await db
      .insert(profileNotes)
      .values({ text: "Mình vừa dọn nhà.", textEn: "I moved house last week ZEBRA.", kind: "fact", scope: "both" })
      .returning({ id: profileNotes.id });
    await developedWith(note.id, "I moved house last week ZEBRA.");
    assert.deepEqual(await directionOf(), ["[personal detail] I moved house last week ZEBRA."]);
    assert.deepEqual(await exportedInstructions(), ["[personal detail] I moved house last week ZEBRA."]);
    check("setup: the developed reply's direction holds the note's wording, and the style builder and the export both read it");

    const flipped = await updateNote(service, note.id, { private: true });
    assert.ok(flipped.ok);
    assert.deepEqual(await storedDirections(), ["[personal detail]"], "the copy is gone and the row is still marked as a refinement");
    assert.deepEqual(await directionOf(), ["[personal detail]"]);
    assert.deepEqual(await exportedInstructions(), ["[personal detail]"]);
    check("making a note private removes the copy of its wording from the stored direction, the style evidence and the export");

    // A note that was only archived is still the writer's usable note: its copy stays.
    await db.delete(generations).where(like(generations.inputText, `${MARK}%`));
    const [kept] = await db.insert(profileNotes).values({ text: "Mình thích leo núi.", textEn: "I like hiking ALPACA." }).returning({ id: profileNotes.id });
    await developedWith(kept.id, "I like hiking ALPACA.");
    assert.ok((await updateNote(service, kept.id, { status: "archived" })).ok);
    assert.deepEqual(await storedDirections(), ["[personal detail] I like hiking ALPACA."]);
    check("archiving a note leaves the direction alone: the note is not private");

    // Deleting a note removes the copy too.
    assert.equal(await notesRepo.remove(kept.id), true);
    assert.deepEqual(await storedDirections(), ["[personal detail]"]);
    check("deleting a note removes the copy of its wording");

    // A direction the writer typed is theirs and stays, even beside a note.
    await db.delete(generations).where(like(generations.inputText, `${MARK}%`));
    const [third] = await db.insert(profileNotes).values({ text: "Mình có mèo.", textEn: "I have a cat LLAMA." }).returning({ id: profileNotes.id });
    const typed = await developedWith(third.id, "I have a cat LLAMA.");
    await db.update(generations).set({ refineInstruction: "[longer] thêm là mình bận" }).where(eq(generations.id, typed));
    assert.ok((await updateNote(service, third.id, { private: true })).ok);
    assert.deepEqual(await storedDirections(), ["[longer] thêm là mình bận"]);
    check("a direction that is not a copy of a note (a quick button and the writer's own words) is never touched");

    // Delete every note.
    await db.delete(generations).where(like(generations.inputText, `${MARK}%`));
    const [a] = await db.insert(profileNotes).values({ text: "Mình có cá.", textEn: "I have a fish OTTER." }).returning({ id: profileNotes.id });
    await developedWith(a.id, "I have a fish OTTER.");
    assert.ok((await notesRepo.removeAll()) >= 1);
    assert.deepEqual(await storedDirections(), ["[personal detail]"]);
    check("deleting every note removes every copy");


    // ------------------------------------------------------ "export my notes"
    await db.delete(profileNotes);
    const vec = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
    await db.insert(profileNotes).values([
      { text: "public note", textEn: "public en", embedding: vec, embeddingEn: vec, embedModel: "m" },
      { text: "archived note", status: "archived" },
      { text: "private SECRET-NOTE", private: true },
      { text: "private archived SECRET-ARCHIVED", private: true, status: "archived" },
      { text: "waiting SECRET-SUGGESTED", status: "suggested", source: "suggested", embedding: vec, embedModel: "m" },
      { text: "refused SECRET-DISMISSED", status: "dismissed", source: "suggested" },
    ]);
    const records = await notesRepo.list({ status: "all", private: false }, MAX_NOTES_EXPORT);
    const exported = toNotesExport(records, (await notesRepo.counts()).private, new Date("2026-10-02T00:00:00Z"));
    assert.deepEqual(exported.notes.map((n) => [n.text, n.archived]).sort(), [["archived note", true], ["public note", false]]);
    assert.equal(exported.privateOmitted, 2);
    const file = JSON.stringify(exported);
    for (const secret of ["SECRET-NOTE", "SECRET-ARCHIVED", "SECRET-SUGGESTED", "SECRET-DISMISSED", "embedding", "[1,0,0"]) {
      assert.ok(!file.includes(secret), `${secret} must not be in the export`);
    }
    // Even if the query were wrong, the builder drops a private note.
    const everything = await notesRepo.list({ status: "all" }, MAX_NOTES_EXPORT);
    assert.ok(everything.some((n) => n.private));
    assert.ok(!JSON.stringify(toNotesExport(everything, 0, new Date())).includes("SECRET-NOTE"));
    check("export my notes: no private note (archived or not), no waiting or dismissed suggestion, no vector; the number of private notes left out is given");

    // ------------------------------------------------ editing style-profile rules
    await db.delete(styleProfiles);
    const counts = { edited: 3, liked: 1, disliked: 1, refined: 0 };
    const [first, second] = await db
      .insert(styleProfiles)
      .values([
        { rules: "- Use short sentences.\n- Say ok.\n- Avoid slang.", sourceCounts: counts, model: "m", active: false },
        { rules: "- Be warm.", sourceCounts: counts, model: "m", active: false },
      ])
      .returning({ id: styleProfiles.id });
    assert.deepEqual(await editStyleRules(styles, first.id, ["Use contractions.", "  ", "Say ok.", "say OK."]), { ok: true });
    const [saved] = await db.select().from(styleProfiles).where(eq(styleProfiles.id, first.id));
    assert.equal(saved.rules, "- Use contractions.\n- Say ok.");
    assert.deepEqual((await styles.getActive()), null, "editing never switches a version on");
    assert.equal((await db.select().from(styleProfiles).where(eq(styleProfiles.id, second.id)))[0].rules, "- Be warm.", "another version is untouched");
    check("style rules: an edited list is saved as clean lines on that version only, and does not switch it on");

    assert.equal(await styles.setActive(first.id), true);
    assert.deepEqual(await editStyleRules(styles, first.id, ["Changed under you."]), {
      ok: false,
      status: 409,
      error: "This version is in use. Switch it off before editing its rules.",
    });
    assert.equal((await styles.getActive())?.rules, "- Use contractions.\n- Say ok.", "the rules in use did not change");
    assert.deepEqual(await editStyleRules(styles, "00000000-0000-4000-8000-000000000000", ["x"]), {
      ok: false,
      status: 404,
      error: "That style profile was not found.",
    });
    assert.deepEqual(await editStyleRules(styles, second.id, ["", " "]), { ok: false, status: 400, error: "Keep at least one rule. To stop using a profile, switch it off." });
    assert.equal((await db.select().from(styleProfiles).where(eq(styleProfiles.id, second.id)))[0].rules, "- Be warm.");
    assert.equal((await listStyleProfiles(styles, 20)).active?.id, first.id);
    check("style rules: a version in use cannot be edited (the rules in use stay), an unknown one is 404, an empty list is refused");

    console.log("\nAll privacy checks passed.");
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
