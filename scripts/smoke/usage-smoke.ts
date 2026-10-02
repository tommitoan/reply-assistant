/**
 * Phase 7 integration check against a real Postgres: the usage table, the
 * report figures, the migration's backfill statement, and the ledger rows the
 * reply repo writes.
 *
 * Seeds rows at known instants around the day, week, month and year
 * boundaries, then checks the exact numbers the usage page shows. The report
 * is cut in UTC, so run it against a database whose session time zone is NOT
 * UTC to prove that holds:
 *   docker exec <db container> psql -U reply -d reply \
 *     -c "ALTER DATABASE reply SET timezone TO 'Asia/Ho_Chi_Minh'"
 *
 * LOCAL DATABASE ONLY, and only an EMPTY one (the totals cover the whole
 * table). It deletes everything it created when it finishes.
 *
 * Run from the repository root:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply \
 *     npx tsx scripts/smoke/usage-smoke.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getDb } from "../../lib/reply/db";
import { createReplyRepo, saveExplanation } from "../../lib/reply/repo";
import {
  conversations,
  generations,
  replyUsage,
} from "../../lib/reply/schema";
import { embeddingEntry, modelCallEntry } from "../../lib/reply/usage";
import { toUsageView } from "../../lib/reply/usage-report";
import { createUsageRepo } from "../../lib/reply/usage-repo";

const repoRequire = createRequire(`${process.cwd()}/package.json`);
const { eq, sql } = repoRequire("drizzle-orm") as typeof import("drizzle-orm");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { hostname, port, pathname } = new URL(url);
console.log(`[usage-smoke] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
if (!LOCAL_HOSTS.has(hostname)) {
  console.error("[usage-smoke] refusing: this check only runs against a local database.");
  process.exit(1);
}

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

async function main() {
  const db = getDb();
  const check = (label: string) => console.log(`  ok  ${label}`);

  const [{ tz }] = (await db.execute(sql`select current_setting('TimeZone') as tz`)) as unknown as Array<{ tz: string }>;
  console.log(`[usage-smoke] session time zone: ${tz}`);

  async function wipe() {
    await db.delete(replyUsage);
    await db.delete(generations);
    await db.delete(conversations);
  }
  const [{ count }] = (await db.execute(sql`select (select count(*) from reply_usage) + (select count(*) from generations) + (select count(*) from conversations) as count`)) as unknown as Array<{ count: string }>;
  assert.equal(Number(count), 0, "the database already has data; run this check on an empty local database");

  try {
    // ---------------------------------------------------------------- report
    const [conv1] = await db.insert(conversations).values({ title: "Sprint planning", context: "work" }).returning({ id: conversations.id });
    const [conv2] = await db.insert(conversations).values({ title: "Dinner plans", context: "casual" }).returning({ id: conversations.id });

    // Thursday 2026-10-15 12:00 UTC. The week began Monday the 12th.
    const NOW = new Date("2026-10-15T12:00:00Z");
    const rows: Array<[string, string, number | null, string | null]> = [
      ["2026-10-15T09:00:00Z", "generate", 0.01, conv1.id], // today
      ["2026-10-15T10:00:00Z", "explain", 0.001, conv1.id], // today
      ["2026-10-14T23:59:59Z", "generate", 0.02, conv2.id], // yesterday, one second before midnight
      ["2026-10-12T00:00:00Z", "summary", 0.003, conv1.id], // Monday 00:00, first instant of this week
      ["2026-10-11T23:59:59Z", "generate", 0.04, null], // Sunday, last week, this month
      ["2026-09-30T23:59:59Z", "embedding", 0.0005, conv2.id], // last month
      ["2026-10-15T11:00:00Z", "warm", null, null], // a model without a price
      ["2025-09-01T00:00:00Z", "generate", 0.5, null], // older than the 12-month table
    ];
    for (const [at, kind, cost, conversationId] of rows) {
      await db.execute(sql`
        insert into reply_usage (created_at, kind, model, conversation_id, cost_usd)
        values (${at}::timestamptz, ${kind}, 'claude-haiku-4-5', ${conversationId}::uuid, ${cost === null ? null : cost.toFixed(6)}::numeric)`);
    }

    const usage = createUsageRepo(db);
    const raw = await usage.load(NOW);
    const close = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} vs ${b}`);

    close(raw.totals.today, 0.011, "today");
    close(raw.totals.week, 0.034, "this week");
    close(raw.totals.month, 0.074, "this month");
    close(raw.totals.allTime, 0.5745, "all time");
    assert.equal(raw.totals.calls, 8);
    assert.equal(raw.totals.unpriced, 1);
    check("totals: today, week (Monday 00:00 counted), month, all time, call count, unpriced");

    const view = toUsageView(raw, NOW);
    const dayRow = (key: string) => view.days.find((d) => d.key === key);
    assert.deepEqual([dayRow("2026-10-15")?.calls, dayRow("2026-10-14")?.calls, dayRow("2026-10-12")?.calls, dayRow("2026-10-11")?.calls, dayRow("2026-09-30")?.calls], [3, 1, 1, 1, 1]);
    close(dayRow("2026-10-15")?.costUsd ?? -1, 0.011, "day 15th");
    close(dayRow("2026-10-14")?.costUsd ?? -1, 0.02, "day 14th (23:59:59 UTC stays on the 14th)");
    assert.equal(dayRow("2026-10-13")?.calls, 0);
    check("days: boundary seconds land on the right UTC day, quiet days are zero");

    const weekRow = (key: string) => view.weeks.find((w) => w.key === key);
    assert.deepEqual([weekRow("2026-10-12")?.calls, weekRow("2026-10-05")?.calls, weekRow("2026-09-28")?.calls], [5, 1, 1]);
    close(weekRow("2026-10-12")?.costUsd ?? -1, 0.034, "week of the 12th");
    close(weekRow("2026-10-05")?.costUsd ?? -1, 0.04, "week of the 5th (Sunday evening belongs to it)");
    check("weeks: Monday-based, Sunday night stays in the week that is ending");

    const monthRow = (key: string) => view.months.find((m) => m.key === key);
    assert.equal(monthRow("2026-10")?.calls, 6);
    close(monthRow("2026-10")?.costUsd ?? -1, 0.074, "October");
    close(monthRow("2026-09")?.costUsd ?? -1, 0.0005, "September");
    assert.ok(!view.months.some((m) => m.costUsd >= 0.5), "a row older than 12 months is not in the table");
    check("months: 23:59:59 on the 30th is September, rows older than the window are left out");

    const generate = raw.kinds.find((k) => k.kind === "generate");
    close(generate?.allTimeUsd ?? -1, 0.57, "generate all time");
    close(generate?.monthUsd ?? -1, 0.07, "generate this month");
    assert.equal(generate?.monthCalls, 3);
    check("kinds: month and all-time figures");

    assert.deepEqual(
      view.conversations.map((c) => [c.label, Math.round(c.costUsd * 10000) / 10000, c.calls]),
      [
        ["No thread (quick translate, style profile, warm-up, or a deleted thread)", 0.54, 3],
        ["Dinner plans", 0.0205, 2],
        ["Sprint planning", 0.014, 3],
      ],
    );
    check("conversations: grouped, ordered by cost, requests without a thread kept together");

    // Deleting a conversation keeps what it cost.
    await db.delete(conversations).where(eq(conversations.id, conv1.id));
    const afterDelete = await usage.load(NOW);
    close(afterDelete.totals.allTime, 0.5745, "all time after deleting a conversation");
    assert.equal(afterDelete.totals.calls, 8);
    const orphaned = toUsageView(afterDelete, NOW).conversations.find((c) => c.label.startsWith("No thread"));
    assert.equal(orphaned?.calls, 6);
    check("deleting a conversation keeps its cost (it moves to the no-thread row)");

    // ---------------------------------------------------------------- record()
    await wipe();
    const [conv3] = await db.insert(conversations).values({ title: "Recorded", context: "work" }).returning({ id: conversations.id });
    await usage.record(modelCallEntry("summary", "claude-haiku-4-5", USAGE, { conversationId: conv3.id }));
    await usage.record(embeddingEntry("voyage-3.5-lite", 250_000, { conversationId: conv3.id }));
    await usage.record(modelCallEntry("explain", "unpriced-model", USAGE));
    const recorded = (await db.select().from(replyUsage)) as Array<typeof replyUsage.$inferSelect>;
    assert.equal(recorded.length, 3);
    const summary = recorded.find((r) => r.kind === "summary");
    assert.deepEqual([summary?.inputTokens, summary?.outputTokens, summary?.conversationId], [1000, 200, conv3.id]);
    close(Number(summary?.costUsd), 0.002, "summary cost");
    close(Number(recorded.find((r) => r.kind === "embedding")?.costUsd), 0.005, "embedding cost");
    assert.equal(recorded.find((r) => r.kind === "explain")?.costUsd, null);
    check("record(): tokens, links and cost stored; an unpriced model keeps a null cost");

    // ---------------------------------------- the reply repo writes the ledger
    await wipe();
    const [conv4] = await db.insert(conversations).values({ title: "Thread", context: "work" }).returning({ id: conversations.id });
    const replyRepo = createReplyRepo(db);
    const newGen = { mode: "en_reply" as const, context: "work" as const, inputText: "x", model: "claude-haiku-4-5", tier: "fast" as const, speed: "auto" as const, learn: true, useMemory: false, conversationId: conv4.id };

    const finished = await replyRepo.createGeneration(newGen);
    await replyRepo.finishGeneration(finished, {
      model: "claude-haiku-4-5-20251001",
      options: [{ variant: "short", text: "ok" }],
      usage: USAGE,
      costUsd: 0.002,
      firstTokenMs: 500,
      totalMs: 900,
    });
    const refused = await replyRepo.createGeneration(newGen);
    await replyRepo.failGeneration(refused, { status: "refused", model: "claude-haiku-4-5", usage: USAGE, costUsd: 0.002 });
    const crashed = await replyRepo.createGeneration(newGen);
    await replyRepo.failGeneration(crashed, { status: "error", firstTokenMs: null, totalMs: 10 });

    const ledger = (await db.select().from(replyUsage)) as Array<typeof replyUsage.$inferSelect>;
    assert.equal(ledger.length, 2, "a finished and a refused request were paid for; a crash before any answer was not");
    assert.ok(ledger.every((row) => row.kind === "generate" && row.conversationId === conv4.id));
    assert.deepEqual(new Set(ledger.map((r) => r.generationId)), new Set([finished, refused]));
    assert.equal(ledger.find((r) => r.generationId === finished)?.model, "claude-haiku-4-5-20251001");
    check("finishGeneration / failGeneration: one ledger row per paid request, linked to the thread");

    await usage.record(modelCallEntry("explain", "claude-haiku-4-5", USAGE, { conversationId: conv4.id }));
    close(await replyRepo.spentTodayUsd(), 0.006, "spent today (two replies + one explanation)");
    check("the daily budget counts replies and side calls together");

    // The explanation stays with the request.
    await saveExplanation(db, finished, "Dịch: xin chào");
    const [saved] = await db.select({ explanation: generations.explanation }).from(generations).where(eq(generations.id, finished));
    assert.equal(saved.explanation, "Dịch: xin chào");
    check("saveExplanation keeps the Vietnamese explanation with the request");

    // ----------------------------------------------- the migration's backfill
    await wipe();
    const [conv5] = await db.insert(conversations).values({ title: "Old", context: "work" }).returning({ id: conversations.id });
    const base = { mode: "vi_to_en", context: "work", inputText: "old", model: "claude-haiku-4-5", speed: "auto", learn: true, useMemory: false, status: "done" } as const;
    await db.insert(generations).values([
      { ...base, conversationId: conv5.id, usage: { input_tokens: 700, output_tokens: 90, cache_creation_input_tokens: 5, cache_read_input_tokens: 300 }, costUsd: "0.004000", createdAt: new Date("2026-09-01T10:00:00Z") },
      { ...base, usage: USAGE, costUsd: null, createdAt: new Date("2026-09-02T10:00:00Z") }, // unpriced model
      { ...base, status: "streaming", usage: null, costUsd: null }, // never finished: nothing to carry over
    ]);
    const migration = readFileSync("drizzle/0001_reply_usage_and_explanation.sql", "utf8");
    const backfill = migration.split("--> statement-breakpoint").pop() ?? "";
    assert.match(backfill, /INSERT INTO "reply_usage"/);
    await db.execute(sql.raw(backfill));
    const copied = (await db.select().from(replyUsage)) as Array<typeof replyUsage.$inferSelect>;
    assert.equal(copied.length, 2);
    const priced = copied.find((r) => r.costUsd !== null);
    assert.deepEqual(
      [priced?.kind, priced?.conversationId, priced?.inputTokens, priced?.outputTokens, priced?.cacheCreationTokens, priced?.cacheReadTokens, priced?.createdAt.toISOString()],
      ["generate", conv5.id, 700, 90, 5, 300, "2026-09-01T10:00:00.000Z"],
    );
    assert.ok(priced?.generationId, "linked to its request");
    assert.equal(copied.filter((r) => r.costUsd === null).length, 1);
    check("backfill: finished requests copied with tokens, thread link and original time; unfinished ones skipped");

    console.log("[usage-smoke] all checks passed");
  } finally {
    await wipe();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[usage-smoke] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
