import { completeTextWithUsage } from "./claude";
import { getDb } from "./db";
import { getEmbedder } from "./embeddings";
import { getReplyEnv } from "./env";
import { embedPendingNotes } from "./notes-backfill";
import { suggestForNote, type NotesAiDeps } from "./notes-ai";
import type { NotesServiceDeps } from "./notes-service";
import { createNotesRepo, type NotesRepo } from "./notes-store";
import { createReplyRepo } from "./repo";
import { embeddingEntry, modelCallEntry, recordQuietly } from "./usage";
import { createUsageRepo } from "./usage-repo";

export interface NotesRuntime {
  repo: NotesRepo;
  service: NotesServiceDeps;
  ai: NotesAiDeps;
  // True when today's spending has reached the daily limit.
  overBudget: () => Promise<boolean>;
  // Gives vectors to notes that are still waiting for them, with one request to
  // the embedding provider, using the background share of its per-minute limit.
  // Never throws: indexing is a convenience, not a reason to fail a page.
  indexPending: () => Promise<void>;
}

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

// Wires the notes features to the real database, model and embedder. Every paid
// call is recorded in the usage table, and the daily budget applies to all of
// them. Throws when the server is not configured, like the other routes.
export function createNotesRuntime(): NotesRuntime {
  const env = getReplyEnv();
  const db = getDb();
  const usage = createUsageRepo(db);
  const repo = createNotesRepo(db);
  const replies = createReplyRepo(db);
  const overBudget = async () => (await replies.spentTodayUsd()) >= env.REPLY_DAILY_BUDGET_USD;

  const ai: NotesAiDeps = {
    model: env.REPLY_MODEL_NOTES,
    complete: completeTextWithUsage,
    report: ({ model, usage: used }) => {
      void recordQuietly(usage, modelCallEntry("notes", model, used));
    },
    today: todayUtc,
  };

  // One English version for a note being saved. Skipped, not failed, once the
  // daily limit is reached: the note is saved without it.
  let limited: boolean | null = null;
  const suggest: NotesServiceDeps["suggest"] = async (text) => {
    limited ??= await overBudget();
    return limited ? null : suggestForNote(ai, text);
  };

  const recordEmbedding = (tokens: number) => {
    void recordQuietly(usage, embeddingEntry(env.REPLY_EMBED_MODEL, tokens));
  };
  const indexer = getEmbedder(recordEmbedding, "background");

  return {
    repo,
    ai,
    overBudget,
    async indexPending() {
      if (!indexer) return;
      try {
        await embedPendingNotes(repo, indexer);
      } catch (err) {
        console.error("[reply/notes] could not index waiting notes", err);
      }
    },
    service: {
      repo,
      suggest,
      embedder: getEmbedder(recordEmbedding),
    },
  };
}
