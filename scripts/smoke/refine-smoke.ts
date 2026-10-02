/**
 * Phase 8 integration check: developing a reply, against a real Postgres.
 *
 * Covers what the unit tests cannot: migration 0002 (columns, foreign key,
 * usage-kind check), the base lookup, the ledger kind of a developed request,
 * "Use this" across a reply and its developed versions (including the thread's
 * own messages), the recent list with developed versions nested under their
 * reply, the cascade rules, and what the style-profile builder and the export
 * see.
 *
 * LOCAL DATABASE ONLY. It refuses any other host, and removes what it created
 * (requests marked "[refine-smoke]", their threads and usage rows) when it
 * finishes.
 *
 * Run from the repository root, with the local URL passed inline:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply \
 *     npx tsx scripts/smoke/refine-smoke.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getDb } from "../../lib/reply/db";
import { toExportRecords } from "../../lib/reply/export";
import { createExportRepo } from "../../lib/reply/export-repo";
import { createReplyRepo, type ReplyRepo } from "../../lib/reply/repo";
import {
  conversations,
  generations,
  messages,
  replyOptions,
  replyUsage,
} from "../../lib/reply/schema";
import { createStyleProfileRepo } from "../../lib/reply/style-profile-store";
import { createThreadRepo } from "../../lib/reply/thread-store";
import { storedDirection } from "../../lib/reply/refine-directions";

// drizzle-orm lives in the repo's node_modules, not next to this script.
const repoRequire = createRequire(`${process.cwd()}/package.json`);
const { and, eq, inArray, like, sql } = repoRequire("drizzle-orm") as typeof import("drizzle-orm");

const MARKER = "[refine-smoke]";
// Every request and usage row of this script carries it, so cleanup finds them
// even after the links to their request and thread were cleared.
const MODEL = "refine-smoke-model";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { hostname, port, pathname } = new URL(url);
console.log(`[refine-smoke] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
if (!LOCAL_HOSTS.has(hostname)) {
  console.error("[refine-smoke] refusing: this check only runs against a local database.");
  process.exit(1);
}

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

async function main() {
  const db = getDb();
  const replies: ReplyRepo = createReplyRepo(db);
  const threads = createThreadRepo(db);
  const styles = createStyleProfileRepo(db);
  const exportRepo = createExportRepo(db);
  const conversationIds: string[] = [];
  const generationIds: string[] = [];
  const check = (label: string) => console.log(`  ok  ${label}`);

  async function cleanup() {
    const rows = await db.select({ id: generations.id }).from(generations).where(like(generations.inputText, `${MARKER}%`));
    const ids = [...new Set([...generationIds, ...rows.map((row) => row.id)])];
    if (ids.length > 0) await db.delete(replyUsage).where(inArray(replyUsage.generationId, ids));
    await db.delete(replyUsage).where(eq(replyUsage.model, MODEL));
    await db.delete(generations).where(like(generations.inputText, `${MARKER}%`));
    if (conversationIds.length > 0) await db.delete(conversations).where(inArray(conversations.id, conversationIds));
  }

  // A finished request with the given reply texts. Returns the option ids.
  async function request(opts: {
    input: string;
    conversationId?: string;
    texts?: Array<[ "short" | "medium" | "long" | "alt", string ]>;
    learn?: boolean;
    refineOf?: string;
    instruction?: string;
  }): Promise<{ id: string; options: string[] }> {
    const id = await replies.createGeneration({
      mode: "vi_to_en",
      context: "work",
      inputText: `${MARKER} ${opts.input}`,
      model: MODEL,
      tier: "fast",
      speed: "auto",
      learn: opts.learn ?? true,
      useMemory: false,
      conversationId: opts.conversationId,
      refineOfOptionId: opts.refineOf,
      refineInstruction: opts.instruction,
    });
    generationIds.push(id);
    const saved = await replies.finishGeneration(id, {
      model: MODEL,
      usage: USAGE,
      costUsd: 0.002,
      firstTokenMs: 100,
      totalMs: 200,
      options: (
        opts.texts ?? [
          ["short", "I'll be late."],
          ["medium", "I'm running late. See you soon."],
        ]
      ).map(([variant, text]) => ({ variant, text })),
    });
    return { id, options: saved.map((option) => option.id) };
  }

  const chosenThreadTexts = async (conversationId: string): Promise<string[]> =>
    (
      await db
        .select({ text: messages.text })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.source, "chosen_reply")))
        .orderBy(messages.seq)
    ).map((row) => row.text);

  const chosenIn = async (optionIds: string[]): Promise<string[]> =>
    (
      await db
        .select({ id: replyOptions.id })
        .from(replyOptions)
        .where(and(inArray(replyOptions.id, optionIds), eq(replyOptions.chosen, true)))
    ).map((row) => row.id);

  try {
    await cleanup();

    // ------------------------------------------------------------ migration
    const columns = (await db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'generations' and column_name in ('refine_of_option_id','refine_instruction')
      order by column_name`)) as unknown as Array<{ column_name: string }>;
    assert.deepEqual(columns.map((row) => row.column_name), ["refine_instruction", "refine_of_option_id"]);
    check("migration 0002: both columns exist on generations");

    const fk = (await db.execute(sql`
      select rc.delete_rule from information_schema.referential_constraints rc
      where rc.constraint_name = 'generations_refine_of_option_id_reply_options_id_fk'`)) as unknown as Array<{ delete_rule: string }>;
    assert.equal(fk[0]?.delete_rule, "SET NULL");
    check("migration 0002: deleting the base reply clears the link (SET NULL)");

    const [conv] = await db.insert(conversations).values({ title: `${MARKER} thread`, context: "work" }).returning({ id: conversations.id });
    conversationIds.push(conv.id);
    await db.insert(replyUsage).values({ kind: "refine", model: MODEL, conversationId: conv.id });
    await assert.rejects(
      db.insert(replyUsage).values({ kind: "bogus", model: MODEL, conversationId: conv.id }),
      (err: unknown) => {
        // drizzle wraps the driver's error; the constraint name is on the cause.
        const cause = (err as { cause?: { constraint_name?: string } }).cause;
        return cause?.constraint_name === "reply_usage_kind_check";
      },
    );
    check("migration 0002: usage kind 'refine' is accepted and an unknown kind is refused");

    // -------------------------------------------------------- base lookup
    const root = await request({ input: "base", conversationId: conv.id });
    const [a, b] = root.options;
    const base = await replies.getRefineBase(a);
    assert.deepEqual(base, {
      optionId: a,
      generationId: root.id,
      text: "I'll be late.",
      mode: "vi_to_en",
      context: "work",
      inputText: `${MARKER} base`,
      conversationId: conv.id,
      learn: true,
      developed: false,
    });
    assert.equal(await replies.getRefineBase("00000000-0000-4000-8000-000000000000"), null);
    check("getRefineBase: the stored request's own mode, context, thread and wording; unknown id is null");

    await replies.updateOption(a, { editedText: "I'll be a bit late." });
    assert.equal((await replies.getRefineBase(a))?.text, "I'll be a bit late.");
    await replies.updateOption(a, { editedText: null });
    check("getRefineBase: develops the writer's own edit when there is one");

    // ------------------------------------------------ developed requests
    const direction = storedDirection("longer", "thêm là xe buýt chậm");
    const run1 = await request({
      input: "base",
      conversationId: conv.id,
      refineOf: a,
      instruction: direction,
      texts: [
        ["long", "I'll be late. The bus is slow today."],
        ["alt", "Sorry, my bus is slow. I'll be late."],
      ],
    });
    const [d1, d2] = run1.options;
    assert.equal((await replies.getRefineBase(d1))?.developed, true);
    check("getRefineBase: a developed version is recognised as one");

    const run2 = await request({
      input: "base",
      conversationId: conv.id,
      refineOf: a,
      instruction: storedDirection("casual", undefined),
      texts: [
        ["long", "Hey, I'll be late. Bus again!"],
        ["alt", "Running late, bus is slow."],
      ],
    });
    const [d3] = run2.options;

    const kinds = (await db
      .select({ generationId: replyUsage.generationId, kind: replyUsage.kind })
      .from(replyUsage)
      .where(inArray(replyUsage.generationId, [root.id, run1.id, run2.id]))) as Array<{ generationId: string; kind: string }>;
    const kindOf = (id: string) => kinds.filter((row) => row.generationId === id).map((row) => row.kind);
    assert.deepEqual(kindOf(root.id), ["generate"]);
    assert.deepEqual(kindOf(run1.id), ["refine"]);
    assert.deepEqual(kindOf(run2.id), ["refine"]);
    check("ledger: an original request is 'generate', a developed one is 'refine'");

    // A refused/empty developed answer was paid for too.
    const failedId = await replies.createGeneration({
      mode: "vi_to_en",
      context: "work",
      inputText: `${MARKER} failed`,
      model: MODEL,
      tier: "fast",
      speed: "auto",
      learn: true,
      useMemory: false,
      refineOfOptionId: a,
      refineInstruction: "[longer]",
    });
    generationIds.push(failedId);
    await replies.failGeneration(failedId, { status: "refused", usage: USAGE, costUsd: 0.002, model: MODEL });
    const failedKinds = await db.select({ kind: replyUsage.kind }).from(replyUsage).where(eq(replyUsage.generationId, failedId));
    assert.deepEqual(failedKinds.map((row) => row.kind), ["refine"]);
    check("ledger: a refused developed request is recorded as 'refine' as well");

    // ------------------------------------------- Use this across a lineage
    const family = [a, b, d1, d2, d3];
    const other = await request({
      input: "unrelated",
      conversationId: conv.id,
      texts: [
        ["short", "Different turn reply."],
        ["medium", "Another one."],
      ],
    });
    await replies.updateOption(other.options[0], { chosen: true });
    assert.deepEqual(await chosenThreadTexts(conv.id), ["Different turn reply."]);

    await replies.updateOption(a, { chosen: true });
    assert.deepEqual(await chosenIn(family), [a]);
    check("choose the original: it is the only chosen reply of its turn");

    await replies.updateOption(d1, { chosen: true });
    assert.deepEqual(await chosenIn(family), [d1]);
    assert.deepEqual(await chosenIn(other.options), [other.options[0]]);
    check("choose a developed version: the original is un-chosen; another turn is untouched");

    let thread = await chosenThreadTexts(conv.id);
    assert.deepEqual(thread, ["Different turn reply.", "I'll be late. The bus is slow today."]);
    check("thread: the developed text replaced the original as the writer's message for that turn");

    await replies.updateOption(d3, { chosen: true });
    assert.deepEqual(await chosenIn(family), [d3]);
    thread = await chosenThreadTexts(conv.id);
    assert.deepEqual(thread, ["Different turn reply.", "Hey, I'll be late. Bus again!"]);
    check("choose a developed version of another run: the first run's choice is cleared, thread follows");

    await replies.updateOption(d3, { editedText: "Hey, I'll be late. The bus again!" });
    thread = await chosenThreadTexts(conv.id);
    assert.deepEqual(thread, ["Different turn reply.", "Hey, I'll be late. The bus again!"]);
    check("editing a chosen developed version updates the thread message");

    await replies.updateOption(b, { chosen: true });
    assert.deepEqual(await chosenIn(family), [b]);
    thread = await chosenThreadTexts(conv.id);
    assert.deepEqual(thread, ["Different turn reply.", "I'm running late. See you soon."]);
    check("choose the original again: every developed choice is cleared and the thread follows");

    await replies.updateOption(b, { chosen: false });
    assert.deepEqual(await chosenIn(family), []);
    assert.deepEqual(await chosenThreadTexts(conv.id), ["Different turn reply."]);
    check("un-choosing removes the turn's message from the thread");

    // ------------------------------------------------------ recent list
    const recent = await replies.listRecentGenerations(20, { conversationId: conv.id });
    const ids = recent.map((entry) => entry.id);
    assert.ok(ids.includes(root.id) && ids.includes(other.id));
    assert.ok(!ids.includes(run1.id) && !ids.includes(run2.id), "developed requests are not listed on their own");
    const rootEntry = recent.find((entry) => entry.id === root.id)!;
    assert.deepEqual(
      rootEntry.developed.map((group) => [group.generationId, group.ofOptionId, group.instruction, group.options.length]),
      [
        [run1.id, a, direction, 2],
        [run2.id, a, "[casual]", 2],
      ],
    );
    assert.deepEqual(rootEntry.developed[0].options.map((option) => option.variant), ["long", "alt"]);
    assert.ok(!rootEntry.developed.some((group) => group.generationId === failedId), "a failed developed request is not listed");
    assert.deepEqual(recent.find((entry) => entry.id === other.id)!.developed, []);
    check("recent list: developed versions nested under their reply, oldest first; failed ones and other turns excluded");

    // ------------------------------------------ what the learning sees
    // d1 liked; d2 untouched; d3 edited (from the test above). d1's direction is typed.
    await replies.updateOption(d1, { rating: "good" });
    await replies.updateOption(a, { editedText: "I will be late." });
    const evidence = await styles.collectEvidence();
    const refinedTexts = evidence.refined.map((example) => [example.before, example.direction, example.after]);
    assert.deepEqual(
      refinedTexts.sort(),
      [
        ["I will be late.", direction, "I'll be late. The bus is slow today."],
        ["I will be late.", "[casual]", "Hey, I'll be late. The bus again!"],
      ].sort(),
    );
    assert.ok(!evidence.edited.some((example) => example.edited.includes("bus")), "a developed edit is not an ordinary edit");
    assert.ok(!evidence.liked.some((example) => example.reply.includes("bus")), "a developed like is not an ordinary like");
    assert.ok(evidence.edited.some((example) => example.edited === "I will be late."), "an original edit still counts");
    check("style evidence: developed versions arrive as (before, direction, after); untouched ones are left out");

    const hidden = await request({
      input: "private",
      conversationId: conv.id,
      learn: false,
      refineOf: a,
      instruction: "[longer] học riêng tư",
      texts: [["long", "Private developed reply."]],
    });
    await replies.updateOption(hidden.options[0], { rating: "good" });
    const after = await styles.collectEvidence();
    assert.ok(!after.refined.some((example) => example.after === "Private developed reply."), "Learn-off developed versions are never learned from");
    check("style evidence: a Learn-off developed version is excluded");

    const exported = toExportRecords(await exportRepo.loadRows(), []);
    const mine = exported.filter((record) => record.input.startsWith(MARKER));
    const developedRecord = mine.find((record) => record.reply === "I'll be late. The bus is slow today.");
    assert.equal(developedRecord?.instruction, direction);
    assert.equal(Object.keys(developedRecord ?? {}).at(-1), "instruction");
    const plainRecord = mine.find((record) => record.reply === "I will be late.");
    assert.ok(plainRecord && !("instruction" in plainRecord));
    assert.ok(!mine.some((record) => record.reply === "Private developed reply."));
    check("export: a developed reply carries its instruction last; originals are unchanged; Learn-off is left out");

    // ------------------------------------------------------------ cascade
    const loose = await request({ input: "loose" });
    const looseChild = await request({
      input: "loose",
      refineOf: loose.options[0],
      instruction: "[longer]",
      texts: [["long", "Loose developed."]],
    });
    await db.delete(generations).where(eq(generations.id, loose.id));
    const [orphan] = await db
      .select({ refineOf: generations.refineOfOptionId, instruction: generations.refineInstruction })
      .from(generations)
      .where(eq(generations.id, looseChild.id));
    assert.equal(orphan.refineOf, null);
    assert.equal(orphan.instruction, "[longer]");
    assert.equal((await replies.getRefineBase(looseChild.options[0]))?.developed, true);
    check("deleting a reply's request clears the link but the developed one still knows it is developed");

    const usageBefore = Number(
      ((await db.execute(sql`select count(*)::int as n from reply_usage where generation_id = ${run1.id}`)) as unknown as Array<{ n: number }>)[0].n,
    );
    assert.equal(usageBefore, 1);
    await threads.deleteConversation(conv.id);
    const survivors = await db.select({ id: generations.id }).from(generations).where(inArray(generations.id, [root.id, run1.id, run2.id, other.id]));
    assert.deepEqual(survivors, []);
    const kept = (await db.execute(
      sql`select count(*)::int as n from reply_usage where kind = 'refine' and model = ${MODEL} and generation_id is null and conversation_id is null`,
    )) as unknown as Array<{ n: number }>;
    assert.ok(kept[0].n >= 2, "the cost rows of developed requests outlive the thread");
    check("deleting a thread deletes its developed versions and keeps what they cost");

    console.log("\nAll refine checks passed.");
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
