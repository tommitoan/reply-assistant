/**
 * Checks that the app stays inside the embedding account's per-minute limit.
 *
 * Stage A (database only, fake embedder): the background drain against a real
 * Postgres. Waiting requests are embedded together, the oldest first, in one
 * request per batch; Learn-off and unfinished requests are never picked up.
 *
 * Stage B (LIVE, the real Voyage API, a handful of tiny calls): the real
 * limiter in front of the real client, with every HTTP call and every 429
 * counted. Ten waiting requests must cost ONE call, and a burst of lookups must
 * stop at the budget with no call refused by Voyage. Needs VOYAGE_API_KEY (read
 * from the repo's env files, never printed) and an account whose last minute
 * was quiet.
 *
 * LOCAL DATABASE ONLY. It refuses any other host, and removes what it created
 * (requests whose text starts with "[embed-budget-smoke]").
 *
 * Run from the repository root, with the local URL passed inline:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply \
 *     npx tsx scripts/smoke/embed-budget-smoke.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { embedPending } from "../../lib/reply/backfill";
import { getDb } from "../../lib/reply/db";
import { createEmbedLimiter } from "../../lib/reply/embed-limiter";
import {
  createLimitedEmbedder,
  createVoyageEmbedder,
  type Embedder,
} from "../../lib/reply/embeddings";
import { createMemoryRepo } from "../../lib/reply/memory-repo";
import { generations } from "../../lib/reply/schema";

// Packages and env files live in the repo, not next to this script.
const repoRequire = createRequire(`${process.cwd()}/package.json`);
const { like, sql } = repoRequire("drizzle-orm") as typeof import("drizzle-orm");
const { loadEnvConfig } = repoRequire("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd(), true);

const MARKER = "[embed-budget-smoke]";
const MODEL = "voyage-3.5-lite";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { hostname, port, pathname } = new URL(url);
console.log(`[embed-budget-smoke] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
if (!LOCAL_HOSTS.has(hostname)) {
  console.error("[embed-budget-smoke] refusing: this check only runs against a local database.");
  process.exit(1);
}

const vector = (seed: number) => Array.from({ length: 1024 }, (_, i) => ((seed + i) % 100) / 100);

async function main() {
  const db = getDb();
  const repo = createMemoryRepo(db);
  const check = (label: string) => console.log(`  ok  ${label}`);

  async function seed(count: number, over: Partial<typeof generations.$inferInsert> = {}, tag = "row") {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const [row] = await db
        .insert(generations)
        .values({
          mode: "vi_to_en",
          context: "work",
          inputText: `${MARKER} ${tag} ${i}`,
          model: "claude-haiku-4-5",
          speed: "auto",
          learn: true,
          useMemory: false,
          status: "done",
          ...over,
        })
        .returning({ id: generations.id });
      ids.push(row.id);
      // A distinct creation time, so "oldest first" is well defined.
      await db.execute(sql`update generations set created_at = now() - make_interval(secs => ${1000 - ids.length}) where id = ${row.id}`);
    }
    return ids;
  }

  const waiting = async () => (await repo.listNeedingEmbedding(MODEL, 1000, 0)).filter((row) => row.inputText.startsWith(MARKER));
  const dims = async (id: string) =>
    ((await db.execute(sql`select vector_dims(input_embedding) as d, embed_model as m from generations where id = ${id}`)) as unknown as Array<{ d: number | null; m: string | null }>)[0];

  async function cleanup() {
    await db.delete(generations).where(like(generations.inputText, `${MARKER}%`));
  }

  try {
    await cleanup();

    // ------------------------------------------------------------- Stage A
    const learnOff = await seed(2, { learn: false }, "learn-off");
    const failed = await seed(2, { status: "error" }, "failed");
    const ids = await seed(25, {}, "waiting");
    assert.equal((await waiting()).length, 25, "only learnable, finished requests are waiting");
    check("A: Learn-off and unfinished requests are never listed as waiting");

    const calls: string[][] = [];
    const fake: Embedder = {
      model: MODEL,
      embed: async () => null,
      embedMany: async (texts) => {
        calls.push(texts);
        return texts.map((_, i) => vector(i));
      },
    };

    const first = await embedPending(repo, fake);
    assert.deepEqual(first, { embedded: 20, failed: 0 });
    assert.equal(calls.length, 1, "twenty requests, one call");
    assert.deepEqual(calls[0], Array.from({ length: 20 }, (_, i) => `${MARKER} waiting ${i}`), "the oldest are embedded first");
    assert.deepEqual(await dims(ids[0]), { d: 1024, m: MODEL });
    assert.deepEqual(await dims(ids[24]), { d: null, m: null });
    check("A: one batch of 20 waiting requests costs one call, oldest first, with 1024-wide vectors stored");

    assert.deepEqual(await embedPending(repo, fake), { embedded: 5, failed: 0 });
    assert.equal(calls.length, 2);
    assert.deepEqual(await embedPending(repo, fake), { embedded: 0, failed: 0 });
    assert.equal(calls.length, 2, "nothing waiting means no call");
    check("A: the rest follow in the next batch, and an empty queue makes no call");

    for (const id of [...learnOff, ...failed]) assert.deepEqual(await dims(id), { d: null, m: null });
    check("A: Learn-off and failed requests were never embedded");

    // A failed request saves nothing, and the rows stay waiting for next time.
    const retry = await seed(3, {}, "retry");
    const failing: Embedder = { ...fake, embedMany: async () => null };
    assert.deepEqual(await embedPending(repo, failing), { embedded: 0, failed: 3 });
    assert.equal((await waiting()).length, 3);
    assert.deepEqual(await embedPending(repo, fake), { embedded: 3, failed: 0 });
    assert.deepEqual(await dims(retry[0]), { d: 1024, m: MODEL });
    check("A: a failed request leaves the rows waiting, and the next batch picks them up");

    // ------------------------------------------------------------- Stage B
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      console.log("  --  Stage B skipped: VOYAGE_API_KEY is not set");
    } else {
      await cleanup();
      const rows = await seed(10, {}, "live");

      const http: number[] = [];
      const countingFetch: typeof fetch = async (input, init) => {
        const res = await fetch(input, init);
        http.push(res.status);
        return res;
      };
      const voyage = createVoyageEmbedder({ apiKey, model: MODEL, fetchImpl: countingFetch });
      // The same limiter the app builds for an account without a payment method.
      const limiter = createEmbedLimiter({ rpm: 3, tpm: 10_000 });
      const foreground = createLimitedEmbedder(voyage, limiter, "foreground");
      const background = createLimitedEmbedder(voyage, limiter, "background");

      const result = await embedPending(repo, background);
      assert.deepEqual(result, { embedded: 10, failed: 0 });
      assert.deepEqual(http, [200], "ten waiting requests cost exactly one real call");
      assert.deepEqual(await dims(rows[0]), { d: 1024, m: MODEL });
      assert.equal((await waiting()).length, 0);
      check("B (live): ten waiting requests were embedded with ONE real call to Voyage");

      // A burst of lookups. One of the three calls is used; two remain.
      const outcomes: Array<number[] | null> = [];
      for (let i = 0; i < 6; i++) outcomes.push(await foreground.embed(`burst question ${i}`));
      assert.deepEqual(outcomes.map((o) => (o ? o.length : null)), [1024, 1024, null, null, null, null]);
      assert.deepEqual(http, [200, 200, 200], "the burst stopped at the budget: three real calls in all");
      assert.ok(!http.includes(429), "Voyage never had to refuse a call");
      check("B (live): a burst of six lookups made two real calls and four were skipped locally; no 429");

      // The reserved slot is gone for background work, but there is nothing left to waste it on either.
      const more = await seed(2, {}, "live-more");
      assert.deepEqual(await embedPending(repo, background), { embedded: 0, failed: 2 });
      assert.deepEqual(http, [200, 200, 200], "a refused background call is not made");
      assert.equal((await waiting()).length, 2);
      check("B (live): with the budget spent, background indexing waits instead of calling; the rows stay waiting");
      void more;
    }

    console.log("\nAll embed-budget checks passed.");
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
