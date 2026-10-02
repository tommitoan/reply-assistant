import { completeTextWithUsage } from "./claude";
import { getDb } from "./db";
import { getEmbedder } from "./embeddings";
import { getReplyEnv } from "./env";
import type { SuggestHook } from "./generate";
import { createReplyRepo } from "./repo";
import { suggestFacts, type SuggestDeps } from "./suggest-run";
import { createSuggestionsRepo } from "./suggestions-repo";
import { embeddingEntry, modelCallEntry, recordQuietly } from "./usage";
import { createUsageRepo } from "./usage-repo";

// Wires "propose notes from what the writer typed" to the real database, model
// and embedder. The model call and the embedding are recorded in the usage table
// and count against the daily limit. Throws when the server is not configured,
// like the other runtimes.
export function createSuggestHook(afterResponse: SuggestHook["afterResponse"]): SuggestHook {
  const env = getReplyEnv();
  const db = getDb();
  const usage = createUsageRepo(db);
  const replies = createReplyRepo(db);

  const deps: SuggestDeps = {
    ai: {
      model: env.REPLY_MODEL_NOTES,
      complete: completeTextWithUsage,
      report: ({ model, usage: used }) => {
        void recordQuietly(usage, modelCallEntry("notes", model, used));
      },
      today: () => new Date().toISOString().slice(0, 10),
    },
    repo: createSuggestionsRepo(db),
    // Nobody waits for this lookup, so it uses the background share of the embedding limit.
    embedder: getEmbedder((tokens) => {
      void recordQuietly(usage, embeddingEntry(env.REPLY_EMBED_MODEL, tokens));
    }, "background"),
    overBudget: async () => (await replies.spentTodayUsd()) >= env.REPLY_DAILY_BUDGET_USD,
  };

  return { run: (input) => suggestFacts(deps, input), afterResponse };
}
