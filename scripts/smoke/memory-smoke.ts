/**
 * Phase 3 integration check: memory retrieval against a real Postgres + pgvector.
 *
 * Seeds generations with hand-made 1024-dim vectors at known cosine distances
 * from a query vector, then checks that the SQL filters (learn, context, status,
 * signal, embedding present), the distance ordering, and the selection logic
 * (threshold, one reply per request, edited > used > liked) behave as designed.
 * It also checks saving an embedding and the backfill listing.
 *
 * LOCAL DATABASE ONLY. It refuses any other host, and removes its own rows
 * (marked with "[memory-smoke]") when it finishes.
 *
 * Run from the repository root, with the local URL passed inline:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply \
 *     npx tsx scripts/smoke/memory-smoke.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getDb } from "../../lib/reply/db";
import { selectMemories } from "../../lib/reply/memory";
import { createMemoryRepo } from "../../lib/reply/memory-repo";
import {
  EMBEDDING_DIMENSIONS,
  generations,
  replyOptions,
} from "../../lib/reply/schema";

// drizzle-orm lives in the repo's node_modules, not next to this script.
const repoRequire = createRequire(`${process.cwd()}/package.json`);
const { like, eq } = repoRequire("drizzle-orm") as typeof import("drizzle-orm");

const MARKER = "[memory-smoke]";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { hostname, port, pathname } = new URL(url);
console.log(`[memory-smoke] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
if (!LOCAL_HOSTS.has(hostname)) {
  console.error("[memory-smoke] refusing: this check only runs against a local database.");
  process.exit(1);
}

// A unit vector at the given cosine distance from the query vector (1, 0, 0, ...).
function vectorAtDistance(distance: number): number[] {
  const cos = 1 - distance;
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = cos;
  vector[1] = Math.sqrt(1 - cos * cos);
  return vector;
}
const QUERY = vectorAtDistance(0);

interface Seed {
  key: string;
  distance: number | null; // null = no embedding stored
  context?: "work" | "casual";
  learn?: boolean;
  status?: "done" | "error";
  options: Array<{ rating?: "good" | "bad"; edited?: string; chosen?: boolean }>;
}

const SEEDS: Seed[] = [
  { key: "A liked", distance: 0.05, options: [{ rating: "good" }] },
  { key: "B edited", distance: 0.1, options: [{ edited: "My own wording B." }] },
  { key: "C used", distance: 0.12, options: [{ chosen: true }] },
  { key: "D learn off", distance: 0.15, learn: false, options: [{ rating: "good" }] },
  { key: "E other context", distance: 0.15, context: "casual", options: [{ rating: "good" }] },
  { key: "F failed request", distance: 0.15, status: "error", options: [{ rating: "good" }] },
  { key: "G bad and used", distance: 0.2, options: [{ rating: "bad", chosen: true }] },
  { key: "H no signal", distance: 0.25, options: [{}] },
  { key: "I no embedding", distance: null, options: [{ rating: "good" }] },
  { key: "J too far", distance: 0.6, options: [{ rating: "good" }] },
  { key: "K two options", distance: 0.3, options: [{ rating: "good" }, { edited: "My own wording K." }] },
];

async function main() {
  const db = getDb();
  const repo = createMemoryRepo(db);
  const ids = new Map<string, string>(); // seed key -> generation id

  async function cleanup() {
    await db.delete(generations).where(like(generations.inputText, `${MARKER}%`));
  }

  await cleanup();
  try {
    for (const seed of SEEDS) {
      const [row] = await db
        .insert(generations)
        .values({
          mode: "vi_to_en",
          context: seed.context ?? "work",
          inputText: `${MARKER} ${seed.key}`,
          inputEmbedding: seed.distance === null ? null : vectorAtDistance(seed.distance),
          embedModel: seed.distance === null ? null : "smoke-model",
          model: "smoke",
          speed: "auto",
          learn: seed.learn ?? true,
          useMemory: false,
          status: seed.status ?? "done",
        })
        .returning({ id: generations.id });
      ids.set(seed.key, row.id);
      await db.insert(replyOptions).values(
        seed.options.map((option, position) => ({
          generationId: row.id,
          variant: "short",
          position,
          text: `Model reply for ${seed.key} #${position}`,
          rating: option.rating ?? null,
          editedText: option.edited ?? null,
          chosen: option.chosen ?? false,
        })),
      );
    }
    const keyOf = (generationId: string) => [...ids].find(([, id]) => id === generationId)?.[0];

    // 1. The database returns only requests with a usable signal, nearest first.
    const candidates = await repo.findCandidates(QUERY, { mode: "vi_to_en", context: "work" }, 20);
    const seen = candidates.map((c) => `${keyOf(c.generationId)} @ ${c.distance.toFixed(2)}`);
    console.log("candidates:", seen);
    assert.deepEqual(
      [...new Set(candidates.map((c) => keyOf(c.generationId)))],
      ["A liked", "B edited", "C used", "K two options", "J too far"],
      "filters or ordering are wrong",
    );
    for (let i = 1; i < candidates.length; i++) {
      assert.ok(candidates[i].distance >= candidates[i - 1].distance, "not sorted by distance");
    }
    assert.ok(Math.abs(candidates[0].distance - 0.05) < 1e-6, "cosine distance is not what was seeded");

    // 2. The limit applies to rows, nearest first.
    const limited = await repo.findCandidates(QUERY, { mode: "vi_to_en", context: "work" }, 2);
    assert.deepEqual(limited.map((c) => keyOf(c.generationId)), ["A liked", "B edited"]);

    // 3. Another context sees only its own requests.
    const casual = await repo.findCandidates(QUERY, { mode: "vi_to_en", context: "casual" }, 20);
    assert.deepEqual(casual.map((c) => keyOf(c.generationId)), ["E other context"]);

    // 4. Selection: threshold, one reply per request, edited > used > liked.
    const examples = selectMemories(candidates);
    console.log("examples:", examples.map((e) => `${keyOf(e.generationId)} (${e.kind})`));
    assert.deepEqual(
      examples.map((e) => [keyOf(e.generationId), e.kind]),
      [
        ["B edited", "edited"],
        ["K two options", "edited"],
        ["C used", "chosen"],
        ["A liked", "good"],
      ],
    );
    assert.equal(examples[1].reply, "My own wording K.", "the edit should replace the model's text");

    // 5. Saving an embedding, then the backfill listing.
    const missing = ids.get("I no embedding")!;
    const before = await repo.listNeedingEmbedding("smoke-model", 50, 0);
    assert.ok(before.some((row) => row.id === missing), "an unembedded request should be listed");
    assert.ok(!before.some((row) => row.id === ids.get("A liked")), "an embedded request should not be listed");
    assert.ok(!before.some((row) => row.id === ids.get("D learn off")), "Learn-off requests are never embedded");

    await repo.saveEmbedding(missing, vectorAtDistance(0.5), "smoke-model");
    const [stored] = await db.select().from(generations).where(eq(generations.id, missing));
    assert.equal(stored.embedModel, "smoke-model");
    assert.equal(stored.inputEmbedding?.length, EMBEDDING_DIMENSIONS);
    const after = await repo.listNeedingEmbedding("smoke-model", 50, 0);
    assert.ok(!after.some((row) => row.id === missing), "a saved request should drop out of the list");

    // 6. Switching the embedding model lists everything for re-embedding.
    const switched = await repo.listNeedingEmbedding("another-model", 50, 0);
    assert.ok(switched.some((row) => row.id === ids.get("A liked")), "a model switch should re-list embedded requests");

    console.log("[memory-smoke] all checks passed");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[memory-smoke] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
