import { chunkByTokens, DEFAULT_REQUEST_TOKENS } from "./embed-limiter";
import type { Embedder } from "./embeddings";
import { embeddingTextFor } from "./memory";
import type { MemoryRepo, UnembeddedGeneration } from "./memory-repo";

export interface BackfillResult {
  embedded: number;
  // Requests in the group that could not be embedded; the pass stops there.
  failed: number;
}

export const BACKFILL_BATCH_SIZE = 20;

export interface EmbedPendingOptions {
  batchSize?: number;
  maxTokens?: number;
}

// Splits rows into groups that each fit one embedding request.
function groupsOf(rows: UnembeddedGeneration[], maxTokens: number): UnembeddedGeneration[][] {
  const groups: UnembeddedGeneration[][] = [];
  let offset = 0;
  for (const chunk of chunkByTokens(rows.map((row) => embeddingTextFor(row.mode, row.inputText)), maxTokens)) {
    groups.push(rows.slice(offset, offset + chunk.length));
    offset += chunk.length;
  }
  return groups;
}

// One request for one group: all of its texts at once. Null means the whole
// group failed (all or nothing), so nothing is saved for it.
async function embedGroup(repo: MemoryRepo, embedder: Embedder, group: UnembeddedGeneration[]): Promise<boolean> {
  const vectors = await embedder.embedMany(group.map((row) => embeddingTextFor(row.mode, row.inputText)));
  if (!vectors) return false;
  for (const [index, row] of group.entries()) await repo.saveEmbedding(row.id, vectors[index], embedder.model);
  return true;
}

// Embeds some of the requests that are still waiting for a vector, with ONE
// request to the provider. The app runs this in the background after a reply,
// so a request whose own embedding was skipped (over the per-minute budget, or
// Learn on but memory off) is picked up with the next one, and several waiting
// requests share a single call.
export async function embedPending(
  repo: MemoryRepo,
  embedder: Embedder,
  { batchSize = BACKFILL_BATCH_SIZE, maxTokens = DEFAULT_REQUEST_TOKENS }: EmbedPendingOptions = {},
): Promise<BackfillResult> {
  const rows = await repo.listNeedingEmbedding(embedder.model, batchSize, 0);
  const [group] = groupsOf(rows, maxTokens);
  if (!group) return { embedded: 0, failed: 0 };
  return (await embedGroup(repo, embedder, group)) ? { embedded: group.length, failed: 0 } : { embedded: 0, failed: group.length };
}

export interface BackfillOptions extends EmbedPendingOptions {
  onProgress?: (done: number) => void;
  // Wait this long between requests, so a run stays inside a per-minute limit.
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Embeds every learnable request that has no embedding from the current model
// yet. Used for rows saved while memory was unavailable, and again after
// switching the embedding model. Each group is one request; the first failed
// request ends the pass, because it means the service is unavailable.
export async function backfillEmbeddings(
  repo: MemoryRepo,
  embedder: Embedder,
  {
    batchSize = BACKFILL_BATCH_SIZE,
    maxTokens = DEFAULT_REQUEST_TOKENS,
    onProgress,
    pauseMs = 0,
    sleep = realSleep,
  }: BackfillOptions = {},
): Promise<BackfillResult> {
  let embedded = 0;
  let requests = 0;

  for (;;) {
    // Rows that were saved drop out of the list, so the next listing is new work.
    const rows = await repo.listNeedingEmbedding(embedder.model, batchSize, 0);
    if (rows.length === 0) return { embedded, failed: 0 };

    for (const group of groupsOf(rows, maxTokens)) {
      if (requests > 0 && pauseMs > 0) await sleep(pauseMs);
      requests += 1;
      if (!(await embedGroup(repo, embedder, group))) return { embedded, failed: group.length };
      embedded += group.length;
      onProgress?.(embedded);
    }
  }
}
