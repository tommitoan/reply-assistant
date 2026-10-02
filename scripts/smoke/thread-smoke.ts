/**
 * Phase 4 integration check: conversation threads against a real Postgres.
 *
 * Covers what the unit tests cannot: the atomic paste merge (including two
 * pastes at once), the plan's acceptance cases against stored rows, "Use this"
 * keeping the thread's own messages in sync, thread-scoped history, summary
 * storage, and the cascade when a thread is deleted.
 *
 * LOCAL DATABASE ONLY. It refuses any other host, and removes what it created
 * (threads by id, requests marked "[thread-smoke]") when it finishes.
 *
 * Run from the repository root, with the local URL passed inline:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply \
 *     npx tsx scripts/smoke/thread-smoke.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getDb } from "../../lib/reply/db";
import { createReplyRepo } from "../../lib/reply/repo";
import { generations, replyOptions } from "../../lib/reply/schema";
import { createThreadRepo } from "../../lib/reply/thread-store";

// drizzle-orm lives in the repo's node_modules, not next to this script.
const repoRequire = createRequire(`${process.cwd()}/package.json`);
const { eq, inArray, like } = repoRequire("drizzle-orm") as typeof import("drizzle-orm");

const MARKER = "[thread-smoke]";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { hostname, port, pathname } = new URL(url);
console.log(`[thread-smoke] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
if (!LOCAL_HOSTS.has(hostname)) {
  console.error("[thread-smoke] refusing: this check only runs against a local database.");
  process.exit(1);
}

const SLACK = `Alice  10:32 AM
Hey, are you free to review my PR?

Sam  10:35 AM
Sure, which one?

Alice  10:36 AM
The one for the login page.`;
const SELF = ["Sam"];

async function main() {
  const db = getDb();
  const threads = createThreadRepo(db);
  const replies = createReplyRepo(db);
  const conversationIds: string[] = [];
  const check = (label: string) => console.log(`  ok  ${label}`);

  async function cleanup() {
    await db.delete(generations).where(like(generations.inputText, `${MARKER}%`));
    if (conversationIds.length > 0) {
      const { conversations } = await import("../../lib/reply/schema");
      await db.delete(conversations).where(inArray(conversations.id, conversationIds));
    }
  }

  async function seedGeneration(conversationId: string | null, label: string, texts: string[], input?: string) {
    const [gen] = await db
      .insert(generations)
      .values({
        conversationId,
        mode: "vi_to_en",
        context: "work",
        inputText: input ?? `${MARKER} ${label}`,
        model: "smoke",
        speed: "auto",
        learn: true,
        useMemory: false,
        status: "done",
      })
      .returning({ id: generations.id });
    const options = await db
      .insert(replyOptions)
      .values(texts.map((text, position) => ({ generationId: gen.id, variant: "short", position, text })))
      .returning({ id: replyOptions.id, position: replyOptions.position });
    return { id: gen.id, options: options.sort((a, b) => a.position - b.position).map((o) => o.id) };
  }

  const texts = async (id: string) => (await threads.getMessages(id)).map((m) => m.text);

  await cleanup();
  try {
    // 1. A new thread, listed with no messages.
    const conversation = await threads.createConversation({ title: "", context: "work" });
    conversationIds.push(conversation.id);
    const id = conversation.id;
    const listed = (await threads.listConversations({ archived: false, limit: 50 })).find((c) => c.id === id);
    assert.equal(listed?.messageCount, 0);
    check("a new thread is listed with 0 messages");

    // 2. The first paste fills the thread, sets authors and names the thread.
    const first = await threads.mergePaste(id, SLACK, SELF);
    assert.ok(first);
    assert.deepEqual([first.added, first.skipped], [3, 0]);
    // The list's count must follow the messages (a query that compared the wrong
    // columns once showed 0 for every thread).
    const afterPaste = (await threads.listConversations({ archived: false, limit: 50 })).find((c) => c.id === id);
    assert.equal(afterPaste?.messageCount, 3);
    check("the thread list counts the thread's messages");
    const stored = await threads.getMessages(id);
    assert.deepEqual(
      stored.map((m) => [m.seq, m.author, m.source]),
      [[1, "them", "pasted"], [2, "me", "pasted"], [3, "them", "pasted"]],
    );
    assert.equal(first.conversation.title, "Hey, are you free to review my PR?");
    check("first paste: 3 messages, authors and title set");

    // 3. Acceptance: the same chat again adds nothing.
    const again = await threads.mergePaste(id, SLACK, SELF);
    assert.deepEqual([again?.added, again?.skipped], [0, 3]);
    assert.equal((await threads.getMessages(id)).length, 3);
    check("pasting the same chat again adds nothing");

    // 4. Acceptance: the full chat plus one new message adds exactly one.
    const plusOne = await threads.mergePaste(id, `${SLACK}\n\nAlice  10:40 AM\nGot it, looking now.`, SELF);
    assert.deepEqual([plusOne?.added, plusOne?.skipped], [1, 3]);
    assert.equal((await threads.getMessages(id)).length, 4);
    check("full chat + 1 new message adds exactly 1");

    // 5. Acceptance: only the new message is also fine.
    const onlyNew = await threads.mergePaste(id, "Alice  10:50 AM\nCan you also check the tests?", SELF);
    assert.deepEqual([onlyNew?.added, onlyNew?.skipped], [1, 0]);
    check("pasting only a new message adds it");

    // 6. Two pastes at once get distinct, gap-free numbers.
    const [a, b] = await Promise.all([
      threads.mergePaste(id, "Alice  11:00 AM\nFirst parallel message", SELF),
      threads.mergePaste(id, "Alice  11:00 AM\nSecond parallel message", SELF),
    ]);
    assert.equal((a?.added ?? 0) + (b?.added ?? 0), 2);
    const seqs = (await threads.getMessages(id)).map((m) => m.seq);
    assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7]);
    check("two simultaneous pastes: 7 messages, seq 1..7, no clash");

    // 7. "Use this" keeps the thread's own messages in sync.
    const gen = await seedGeneration(id, "in thread", ["I can review it this afternoon.", "Sure, send it over.", "Happy to."]);
    const [optA, optB] = gen.options;

    await replies.updateOption(optA, { chosen: true });
    let thread = await threads.getMessages(id);
    assert.equal(thread.length, 8);
    assert.deepEqual([thread[7].author, thread[7].source, thread[7].text], ["me", "chosen_reply", "I can review it this afternoon."]);
    check("Use this adds the reply as the writer's own message");

    await replies.updateOption(optA, { chosen: true });
    assert.equal((await threads.getMessages(id)).length, 8);
    check("Use this twice on the same reply adds it once");

    await replies.updateOption(optB, { chosen: true });
    thread = await threads.getMessages(id);
    assert.equal(thread.length, 8);
    assert.equal(thread[7].text, "Sure, send it over.");
    check("choosing another reply replaces the first one");

    await replies.updateOption(optB, { editedText: "Sure, send it over please." });
    assert.equal((await threads.getMessages(id)).at(-1)?.text, "Sure, send it over please.");
    check("editing a used reply updates its message");

    await replies.updateOption(optB, { chosen: false });
    assert.equal((await threads.getMessages(id)).length, 7);
    check("un-choosing removes the message");

    // 8. Acceptance: a chosen reply in the next paste is not duplicated.
    await replies.updateOption(optB, { chosen: true });
    const afterChoice = (await threads.getMessages(id)).length;
    const withOwn = await threads.mergePaste(
      id,
      "Alice  1:00 PM\nCan you also check the tests?\n\nSam  1:02 PM\nSure, send it over please.\n\nAlice  1:05 PM\nGreat, thanks!",
      SELF,
    );
    assert.equal(withOwn?.added, 1);
    assert.equal((await threads.getMessages(id)).length, afterChoice + 1);
    assert.equal((await texts(id)).filter((t) => t === "Sure, send it over please.").length, 1);
    check("a picked reply inside the next paste is not duplicated");

    // 9. A request made outside any thread leaves threads alone.
    const quick = await seedGeneration(null, "quick", ["Quick reply."]);
    const before = (await threads.getMessages(id)).length;
    await replies.updateOption(quick.options[0], { chosen: true });
    assert.equal((await threads.getMessages(id)).length, before);
    check("Use this outside a thread does not touch any thread");

    // 10. History is scoped, and long pasted inputs are shortened.
    const long = await seedGeneration(id, "long", ["x"], `${MARKER} ${"y".repeat(5000)}`);
    const inThread = await replies.listRecentGenerations(50, { conversationId: id });
    assert.ok(inThread.length >= 2 && inThread.every((g) => g.inputText.startsWith(MARKER)));
    assert.ok(inThread.every((g) => g.inputText.length <= 300));
    assert.ok(inThread.some((g) => g.id === long.id));
    const outside = await replies.listRecentGenerations(50, { conversationId: null });
    assert.ok(outside.some((g) => g.id === quick.id));
    assert.ok(!outside.some((g) => g.id === gen.id));
    const all = await replies.listRecentGenerations(50);
    assert.ok(all.some((g) => g.id === gen.id) && all.some((g) => g.id === quick.id));
    check("history is scoped to a thread / outside threads / all, with short previews");

    // 11. Rename, context, archive, summary.
    const renamed = await threads.updateConversation(id, { title: "Sprint chat", context: "casual" });
    assert.deepEqual([renamed?.title, renamed?.context], ["Sprint chat", "casual"]);
    await threads.saveSummary(id, "They plan a review.", 5);
    const withSummary = await threads.getConversation(id);
    assert.deepEqual([withSummary?.summary, withSummary?.summaryUptoSeq], ["They plan a review.", 5]);
    await threads.updateConversation(id, { archived: true });
    assert.ok(!(await threads.listConversations({ archived: false, limit: 50 })).some((c) => c.id === id));
    assert.ok((await threads.listConversations({ archived: true, limit: 50 })).some((c) => c.id === id));
    await threads.updateConversation(id, { archived: false });
    check("rename, context, summary and archive");

    // 12. Pasting into a thread that does not exist.
    assert.equal(await threads.mergePaste("00000000-0000-4000-8000-000000000000", SLACK, SELF), null);
    assert.equal(await threads.updateConversation("00000000-0000-4000-8000-000000000000", { title: "x" }), null);
    check("a missing thread gives null");

    // 13. Deleting a thread removes its messages and its requests, nothing else.
    assert.equal(await threads.deleteConversation(id), true);
    assert.equal((await threads.getMessages(id)).length, 0);
    const gone = await db.select({ id: generations.id }).from(generations).where(eq(generations.id, gen.id));
    const kept = await db.select({ id: generations.id }).from(generations).where(eq(generations.id, quick.id));
    assert.equal(gone.length, 0);
    assert.equal(kept.length, 1);
    const orphanOptions = await db.select({ id: replyOptions.id }).from(replyOptions).where(inArray(replyOptions.id, gen.options));
    assert.equal(orphanOptions.length, 0);
    assert.equal(await threads.deleteConversation(id), false);
    check("deleting a thread removes its messages and requests, and keeps other requests");

    console.log("[thread-smoke] all checks passed");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[thread-smoke] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
