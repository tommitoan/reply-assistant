import { after } from "next/server";
import { completeTextWithUsage, streamReply } from "@/lib/reply/claude";
import { getDb } from "@/lib/reply/db";
import { getEmbedder } from "@/lib/reply/embeddings";
import { runExplain } from "@/lib/reply/explain";
import { getReplyEnv } from "@/lib/reply/env";
import { startGeneration } from "@/lib/reply/generate";
import { startRefinement } from "@/lib/reply/refine";
import { createMemoryRepo } from "@/lib/reply/memory-repo";
import { createNotesReader } from "@/lib/reply/notes-read";
import { createReplyRepo, saveExplanation } from "@/lib/reply/repo";
import { createSuggestHook } from "@/lib/reply/suggest-runtime";
import { embeddingEntry, modelCallEntry, recordQuietly } from "@/lib/reply/usage";
import { createUsageRepo } from "@/lib/reply/usage-repo";
import { summarizeThread } from "@/lib/reply/summary";
import { createStyleProfileRepo } from "@/lib/reply/style-profile-store";
import { createThreadRepo } from "@/lib/reply/thread-store";
import { firstIssueMessage, generateBodySchema, refineBodySchema } from "@/lib/reply/schemas";

export const dynamic = "force-dynamic";
// The smart model can think for a while before the first token.
export const maxDuration = 60;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function streamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Stops proxies from buffering or rewriting the stream.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  // A body with a `refine` part develops an existing reply; anything else is a new request.
  const refining = typeof payload === "object" && payload !== null && "refine" in payload;
  const parsedRefine = refining ? refineBodySchema.safeParse(payload) : null;
  if (parsedRefine && !parsedRefine.success) return jsonError(firstIssueMessage(parsedRefine.error), 400);
  const parsed = refining ? null : generateBodySchema.safeParse(payload);
  if (parsed && !parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  let env;
  try {
    env = getReplyEnv();
  } catch (err) {
    console.error("[/api/reply/generate]", err);
    return jsonError("The reply assistant is not configured on this server.", 503);
  }

  // Work queued while the response streams runs once it has been sent.
  const afterTasks: Array<() => Promise<void>> = [];
  after(async () => {
    for (const task of afterTasks) {
      try {
        await task();
      } catch (err) {
        console.error("[/api/reply/generate] background task failed", err);
      }
    }
  });

  // Facts about the writer, proposed from what they typed. Without the
  // configuration it needs, the request simply goes without it.
  const queue = (task: () => Promise<void>) => {
    afterTasks.push(task);
  };
  let suggest: ReturnType<typeof createSuggestHook> | undefined;
  try {
    suggest = createSuggestHook(queue);
  } catch (err) {
    console.error("[/api/reply/generate] note suggestions are off", err);
  }

  if (parsedRefine?.success) {
    try {
      const db = getDb();
      const result = await startRefinement(
        parsedRefine.data,
        {
          repo: createReplyRepo(db),
          stream: streamReply,
          models: { fast: env.REPLY_MODEL_FAST, smart: env.REPLY_MODEL_SMART },
          dailyBudgetUsd: env.REPLY_DAILY_BUDGET_USD,
          styles: createStyleProfileRepo(db),
          threads: { repo: createThreadRepo(db) },
          notes: { reader: createNotesReader(db) },
          suggest,
        },
        req.signal,
      );
      if (!result.ok) return jsonError(result.error, result.status);
      return streamResponse(result.stream);
    } catch (err) {
      console.error("[/api/reply/generate]", err);
      return jsonError("Could not start the request. Try again.", 500);
    }
  }
  if (!parsed?.success) return jsonError("Invalid request.", 400);

  try {
    const db = getDb();
    const usage = createUsageRepo(db);
    const conversationId = parsed.data.conversationId;
    const result = await startGeneration(
      parsed.data,
      {
        repo: createReplyRepo(db),
        stream: streamReply,
        models: { fast: env.REPLY_MODEL_FAST, smart: env.REPLY_MODEL_SMART },
        dailyBudgetUsd: env.REPLY_DAILY_BUDGET_USD,
        memory: {
          embedder: getEmbedder((tokens) => {
            void recordQuietly(usage, embeddingEntry(env.REPLY_EMBED_MODEL, tokens, { conversationId }));
          }),
          // Indexing after the reply uses its own lane of the per-minute budget.
          indexer: getEmbedder((tokens) => {
            void recordQuietly(usage, embeddingEntry(env.REPLY_EMBED_MODEL, tokens));
          }, "background"),
          repo: createMemoryRepo(db),
          afterResponse: (task) => {
            afterTasks.push(task);
          },
        },
        styles: createStyleProfileRepo(db),
        suggest,
        notes: {
          reader: createNotesReader(db),
          embedModel: env.REPLY_EMBED_MODEL,
          embedder: getEmbedder((tokens) => {
            void recordQuietly(usage, embeddingEntry(env.REPLY_EMBED_MODEL, tokens, { conversationId }));
          }),
        },
        explain: {
          run: (input) =>
            runExplain(input, {
              model: env.REPLY_MODEL_EXPLAIN,
              complete: completeTextWithUsage,
              report: ({ conversationId: id, model, usage: used }) => {
                void recordQuietly(usage, modelCallEntry("explain", model, used, { conversationId: id }));
              },
            }),
          save: (generationId, text) => saveExplanation(db, generationId, text),
        },
        threads: {
          repo: createThreadRepo(db),
          selfNames: env.REPLY_SELF_NAMES,
          summarize: (input) =>
            summarizeThread(input, ({ model, usage: used }) => {
              void recordQuietly(usage, modelCallEntry("summary", model, used, { conversationId: input.conversationId }));
            }),
          afterResponse: (task) => {
            afterTasks.push(task);
          },
        },
      },
      req.signal,
    );
    if (!result.ok) return jsonError(result.error, result.status);

    return streamResponse(result.stream);
  } catch (err) {
    console.error("[/api/reply/generate]", err);
    return jsonError("Could not start the request. Try again.", 500);
  }
}
