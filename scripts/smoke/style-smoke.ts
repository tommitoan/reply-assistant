/**
 * Phase 5 integration check: style profile store, stats queries and the
 * export filter against a real Postgres.
 *
 * Seeds a small, known set of requests and replies, then checks the exact
 * numbers the stats page would show, which replies the style-profile builder
 * is allowed to see, which replies are exported, and that only one profile is
 * ever switched on.
 *
 * LOCAL DATABASE ONLY, and only an EMPTY one: the stats are totals over the
 * whole database, so the check stops if it finds anything it did not create.
 * It removes its own rows (marked "[style-smoke]") when it finishes.
 *
 * Run from the repository root, with the local URL passed inline:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply \
 *     npx tsx scripts/smoke/style-smoke.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { getDb } from "../../lib/reply/db";
import { toExportRecords } from "../../lib/reply/export";
import { createExportRepo } from "../../lib/reply/export-repo";
import {
  conversations,
  generations,
  messages,
  replyOptions,
  styleProfiles,
} from "../../lib/reply/schema";
import { toStatsView } from "../../lib/reply/stats";
import { createStatsRepo } from "../../lib/reply/stats-repo";
import { EVIDENCE_LIMITS, checkEvidence } from "../../lib/reply/style-profile";
import { createStyleProfileRepo } from "../../lib/reply/style-profile-store";

// drizzle-orm lives in the repo's node_modules, not next to this script.
const repoRequire = createRequire(`${process.cwd()}/package.json`);
const { inArray, like, sql } = repoRequire("drizzle-orm") as typeof import("drizzle-orm");

const MARKER = "[style-smoke]";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const VARIANTS = ["short", "medium", "long", "alt"] as const;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { hostname, port, pathname } = new URL(url);
console.log(`[style-smoke] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
if (!LOCAL_HOSTS.has(hostname)) {
  console.error("[style-smoke] refusing: this check only runs against a local database.");
  process.exit(1);
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

interface SeedOption {
  text: string;
  rating?: "good" | "bad";
  edited?: string;
}

interface Seed {
  label: string;
  mode?: "vi_to_en" | "en_reply";
  learn?: boolean;
  status?: "done" | "error";
  useMemory?: boolean;
  memoryIds?: string[];
  model?: string;
  cost?: number | null;
  firstTokenMs?: number | null;
  totalMs?: number | null;
  createdAt: Date;
  conversationId?: string;
  input?: string;
  options: SeedOption[];
}

async function main() {
  const db = getDb();
  const profiles = createStyleProfileRepo(db);
  const check = (label: string) => console.log(`  ok  ${label}`);
  const profileIds: string[] = [];
  const conversationIds: string[] = [];

  async function cleanup() {
    await db.delete(generations).where(like(generations.inputText, `${MARKER}%`));
    if (conversationIds.length > 0) await db.delete(conversations).where(inArray(conversations.id, conversationIds));
    await db.delete(styleProfiles).where(like(styleProfiles.rules, `${MARKER}%`));
  }

  async function seed(spec: Seed): Promise<string> {
    const [gen] = await db
      .insert(generations)
      .values({
        conversationId: spec.conversationId ?? null,
        mode: spec.mode ?? "vi_to_en",
        context: "work",
        inputText: spec.input ?? `${MARKER} ${spec.label}`,
        model: spec.model ?? "claude-haiku-4-5",
        speed: "auto",
        learn: spec.learn ?? true,
        useMemory: spec.useMemory ?? false,
        memoryExampleIds: spec.memoryIds ?? [],
        status: spec.status ?? "done",
        costUsd: spec.cost === null || spec.cost === undefined ? null : spec.cost.toFixed(6),
        firstTokenMs: spec.firstTokenMs ?? null,
        totalMs: spec.totalMs ?? null,
        createdAt: spec.createdAt,
      })
      .returning({ id: generations.id });
    await db.insert(replyOptions).values(
      spec.options.map((option, position) => ({
        generationId: gen.id,
        variant: VARIANTS[position],
        position,
        text: option.text,
        rating: option.rating ?? null,
        ratedAt: option.rating ? new Date() : null,
        editedText: option.edited ?? null,
      })),
    );
    return gen.id;
  }

  // The stats are totals over the whole database, so it must be empty.
  async function assertEmpty() {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(generations);
    assert.equal(Number(count), 0, "the database already has requests; run this check on an empty local database");
  }

  await cleanup();
  await assertEmpty();
  try {
    // A thread whose messages the export excerpt is built from.
    const [thread] = await db.insert(conversations).values({ title: `${MARKER} thread`, context: "work" }).returning({ id: conversations.id });
    conversationIds.push(thread.id);
    await db.insert(messages).values([
      { conversationId: thread.id, seq: 1, author: "them", text: "Alice: can you review my PR?", normHash: "h1", source: "pasted", createdAt: minutesAgo(90) },
      { conversationId: thread.id, seq: 2, author: "me", text: "Yes, this afternoon.", normHash: "h2", source: "chosen_reply", createdAt: minutesAgo(80) },
      { conversationId: thread.id, seq: 3, author: "them", text: "Written after the request.", normHash: "h3", source: "pasted", createdAt: minutesAgo(10) },
    ]);

    const g1 = await seed({
      label: "g1",
      model: "claude-haiku-4-5",
      cost: 0.002,
      firstTokenMs: 800,
      totalMs: 1800,
      createdAt: minutesAgo(240),
      options: [{ text: "A1 liked", rating: "good" }, { text: "A2 disliked", rating: "bad" }, { text: "A3 original", edited: "A3 edited by me" }],
    });
    await seed({
      label: "g2",
      useMemory: true,
      memoryIds: [randomUUID()],
      cost: 0.003,
      firstTokenMs: 1000,
      totalMs: 2000,
      createdAt: minutesAgo(180),
      options: [{ text: "B1 liked", rating: "good" }, { text: "B2 liked", rating: "good" }],
    });
    await seed({
      label: "g3 learn off",
      learn: false,
      useMemory: true,
      model: "claude-sonnet-5-5",
      cost: 0.006,
      firstTokenMs: 1300,
      totalMs: 2500,
      createdAt: minutesAgo(120),
      options: [{ text: "C1 disliked", rating: "bad" }, { text: "C2 original", edited: "C2 edited by me" }],
    });
    await seed({
      label: "g4 pasted chat",
      mode: "en_reply",
      conversationId: thread.id,
      input: `${MARKER} Alice: can you review my PR?\nSam: yes`,
      cost: 0.001,
      firstTokenMs: 700,
      totalMs: 1500,
      createdAt: minutesAgo(60),
      options: [{ text: "D1 original", edited: "D1 edited by me" }],
    });
    await seed({
      label: "g5 failed",
      status: "error",
      cost: null,
      createdAt: minutesAgo(50),
      options: [{ text: "E1 liked but failed", rating: "good" }],
    });
    await seed({
      label: "g6",
      cost: 0.001,
      firstTokenMs: 900,
      totalMs: 1700,
      createdAt: minutesAgo(40),
      options: [{ text: "F1 disliked", rating: "bad" }, { text: "F2 untouched" }],
    });
    void g1;

    // 1. What the style-profile builder may see.
    const evidence = await profiles.collectEvidence();
    assert.deepEqual(
      evidence.edited.map((e) => [e.original, e.edited, e.idea]).sort(),
      [
        ["A3 original", "A3 edited by me", `${MARKER} g1`],
        ["D1 original", "D1 edited by me", null],
      ],
      "edited examples: Learn-off excluded, and a pasted chat never offered as context",
    );
    assert.deepEqual(evidence.liked.map((l) => l.reply).sort(), ["A1 liked", "B1 liked", "B2 liked"]);
    assert.deepEqual(evidence.disliked.map((d) => d.reply).sort(), ["A2 disliked", "F1 disliked"]);
    assert.ok(!JSON.stringify(evidence).includes("E1"), "a failed request must not be learned from");
    assert.ok(!JSON.stringify(evidence).includes("Alice"), "pasted conversations never reach the builder");
    assert.equal(checkEvidence(evidence).ok, true);
    check("evidence: right examples, Learn-off and failed requests excluded, pasted chats kept out");

    // 2. The evidence limits hold when there is a lot of feedback.
    for (let i = 0; i < EVIDENCE_LIMITS.edited + 5; i++) {
      await seed({ label: `bulk ${i}`, createdAt: minutesAgo(30), options: [{ text: `bulk original ${i}`, edited: `bulk edited ${i}` }] });
    }
    const capped = await profiles.collectEvidence();
    assert.equal(capped.edited.length, EVIDENCE_LIMITS.edited);
    await db.delete(generations).where(like(generations.inputText, `${MARKER} bulk%`));
    check("evidence is capped at the limit");

    // 3. Profiles: versions, and only ever one switched on.
    assert.equal(await profiles.getActive(), null);
    for (const n of [1, 2, 3]) {
      const created = await profiles.create({
        rules: `${MARKER} - rule ${n}`,
        model: "claude-sonnet-5-5",
        sourceCounts: { edited: n, liked: 0, disliked: 0 },
      });
      profileIds.push(created.id);
      assert.equal(created.active, false);
    }
    const listed = (await profiles.list(10)).filter((p) => profileIds.includes(p.id));
    assert.deepEqual(listed.map((p) => p.version), [3, 2, 1]);
    assert.equal(await profiles.getActive(), null);
    check("new profiles are saved switched off, numbered, newest first");

    assert.equal(await profiles.setActive(profileIds[1]), true);
    assert.equal((await profiles.getActive())?.id, profileIds[1]);
    assert.equal(await profiles.setActive(profileIds[2]), true);
    const active = (await profiles.list(10)).filter((p) => p.active);
    assert.deepEqual(active.map((p) => p.id), [profileIds[2]]);
    assert.equal(await profiles.setActive(null), true);
    assert.equal(await profiles.getActive(), null);
    assert.equal(await profiles.setActive(randomUUID()), false);
    check("only one profile is ever on; off works; an unknown id is refused");

    const latest = await profiles.latestCreatedAt();
    assert.ok(latest && Date.now() - latest.getTime() < 60_000);
    check("the newest profile's time is available for the rebuild cooldown");

    // 4. The stats figures, against the seeded numbers.
    const view = toStatsView(await createStatsRepo(db).load());
    assert.equal(view.weekly.length, 1);
    assert.deepEqual([view.weekly[0].good, view.weekly[0].bad], [4, 3]);
    assert.deepEqual([view.memoryRates.on.good, view.memoryRates.on.bad], [2, 1]);
    assert.deepEqual([view.memoryRates.off.good, view.memoryRates.off.bad], [2, 2]);
    assert.equal(view.goldExamples, 2);
    assert.equal(view.likedExamples, 3);
    assert.deepEqual(view.memoryHitRate, { asked: 2, hit: 1, rate: 0.5 });
    assert.equal(view.totals.requests, 5);
    assert.ok(Math.abs(view.totals.costUsd - 0.013) < 1e-9);
    check("stats: weekly ratings, memory on/off, gold and liked counts, hit rate, totals");

    const costByModel = new Map<string, { usd: number; requests: number }>();
    for (const day of view.costByDay) {
      for (const m of day.models) {
        const entry = costByModel.get(m.model) ?? { usd: 0, requests: 0 };
        costByModel.set(m.model, { usd: entry.usd + m.usd, requests: entry.requests + m.requests });
      }
    }
    assert.ok(Math.abs((costByModel.get("claude-haiku-4-5")?.usd ?? 0) - 0.007) < 1e-9);
    assert.equal(costByModel.get("claude-haiku-4-5")?.requests, 5);
    assert.ok(Math.abs((costByModel.get("claude-sonnet-5-5")?.usd ?? 0) - 0.006) < 1e-9);
    const haiku = view.latencyByModel.find((l) => l.model === "claude-haiku-4-5");
    assert.deepEqual([haiku?.requests, haiku?.avgFirstTokenMs, haiku?.avgTotalMs], [4, 850, 1750]);
    const sonnet = view.latencyByModel.find((l) => l.model === "claude-sonnet-5-5");
    assert.deepEqual([sonnet?.requests, sonnet?.avgFirstTokenMs, sonnet?.avgTotalMs], [1, 1300, 2500]);
    check("stats: cost by model and speed by model");

    // 5. The export: only Learn-on, finished, edited-or-liked replies, with their context.
    const exportRepo = createExportRepo(db);
    const rows = await exportRepo.loadRows();
    assert.deepEqual(
      rows.map((r) => r.editedText ?? r.text),
      ["A1 liked", "A3 edited by me", "B1 liked", "B2 liked", "D1 edited by me"],
      "export rows and their order",
    );
    const records = toExportRecords(rows, await exportRepo.loadMessages([thread.id]));
    const pasted = records.find((r) => r.reply === "D1 edited by me");
    assert.equal(pasted?.is_edited, true);
    assert.equal(pasted?.mode, "en_reply");
    assert.equal(pasted?.thread_excerpt, "Them: Alice: can you review my PR?\nMe: Yes, this afternoon.");
    assert.equal(records.find((r) => r.reply === "A1 liked")?.is_edited, false);
    assert.equal(records.find((r) => r.reply === "A1 liked")?.thread_excerpt, null);
    check("export: right rows, in order, with the thread as it was when the request was made");

    console.log("[style-smoke] all checks passed");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[style-smoke] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
