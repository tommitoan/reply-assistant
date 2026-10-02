/**
 * Embeds Reply Assistant notes that have no up-to-date vectors yet: notes saved
 * while embedding was unavailable (for example a Voyage rate limit), or after
 * changing REPLY_EMBED_MODEL. Private notes are never touched.
 *
 * Local database:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply \
 *     npx tsx scripts/reply-backfill-note-embeddings.ts
 * Hosted database (writes to it, so it must be asked for explicitly):
 *   ALLOW_REMOTE_BACKFILL=1 npx tsx scripts/reply-backfill-note-embeddings.ts
 *
 * Needs VOYAGE_API_KEY. It goes one request at a time, paced by REPLY_EMBED_RPM (3 by
 * default, so about 30 seconds apart). Safe to re-run. The cost is recorded in the usage table
 * only by the app; this script does not write usage rows (a few tokens per note).
 */
import { loadEnvConfig } from "@next/env";
import { getDb } from "../lib/reply/db";
import { getEmbedder } from "../lib/reply/embeddings";
import { getReplyEnv } from "../lib/reply/env";
import { backfillNoteEmbeddings } from "../lib/reply/notes-backfill";
import { createNotesRepo } from "../lib/reply/notes-store";

// Same files and precedence as the dev server (.env.local over .env).
loadEnvConfig(process.cwd(), true);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Spaced so that a run uses at most all but one of the allowed requests per minute.
function pauseBetweenRequestsMs(): number {
  const { REPLY_EMBED_RPM } = getReplyEnv();
  return REPLY_EMBED_RPM > 1 ? Math.ceil(60_000 / (REPLY_EMBED_RPM - 1)) + 1000 : 61_000;
}

function fail(message: string): never {
  console.error(`[note-backfill] ${message}`);
  process.exit(1);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set.");

  // Host, port and database name only; never credentials.
  const { hostname, port, pathname } = new URL(url);
  console.log(`[note-backfill] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
  if (!LOCAL_HOSTS.has(hostname) && process.env.ALLOW_REMOTE_BACKFILL !== "1") {
    fail("that is not a local database. Run again with ALLOW_REMOTE_BACKFILL=1 if it is the one you mean.");
  }

  const embedder = getEmbedder();
  if (!embedder) fail("VOYAGE_API_KEY is not set, so nothing can be embedded.");

  const result = await backfillNoteEmbeddings(createNotesRepo(getDb()), embedder, {
    // The embedding account allows few requests a minute, so the run goes one
    // request at a time and leaves room for the app's own.
    pauseMs: pauseBetweenRequestsMs(),
    onProgress: (done) => console.log(`[note-backfill] embedded ${done} so far`),
  });
  console.log(`[note-backfill] done: ${result.embedded} embedded, ${result.failed} failed (model ${embedder.model})`);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[note-backfill] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
