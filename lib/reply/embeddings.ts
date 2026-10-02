import { createEmbedLimiter, estimateTokens, type EmbedLane, type EmbedLimiter } from "./embed-limiter";
import { getReplyEnv } from "./env";
import { EMBEDDING_DIMENSIONS } from "./schema";

// Memory must never make a request slower than this or fail it.
export const EMBED_TIMEOUT_MS = 800;

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

// A batch is never on the path a reply waits for, so it may take longer.
export const EMBED_MANY_TIMEOUT_MS = 10_000;

export interface Embedder {
  model: string;
  // Resolves null on any failure (timeout, network, bad response), so callers
  // can carry on without memory.
  embed(text: string): Promise<number[] | null>;
  // Many texts in one request, because the provider limits requests per minute.
  // All or nothing: null on any failure, otherwise one vector per text, in order.
  // `timeoutMs` shortens the wait for a batch a person is waiting for.
  embedMany(texts: string[], options?: { timeoutMs?: number }): Promise<number[][] | null>;
}

interface VoyageOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  // Told how many tokens Voyage billed for a call, so the cost can be recorded.
  onUsage?: (tokens: number) => void;
}

function isEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EMBEDDING_DIMENSIONS &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

export function createVoyageEmbedder({
  apiKey,
  model,
  timeoutMs = EMBED_TIMEOUT_MS,
  fetchImpl = fetch,
  onUsage,
}: VoyageOptions): Embedder {
  // One request for any number of texts. `input_type` is left out on purpose:
  // stored inputs and new inputs are compared with each other, and Voyage
  // recommends no input type for that kind of symmetric similarity.
  async function request(texts: string[], timeout: number): Promise<number[][] | null> {
    try {
      const res = await fetchImpl(VOYAGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ input: texts, model, output_dimension: EMBEDDING_DIMENSIONS }),
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) {
        // The status is enough to diagnose; the body could echo the input.
        console.error(`[reply/embeddings] Voyage answered ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        data?: Array<{ embedding?: unknown; index?: unknown }>;
        usage?: { total_tokens?: unknown };
      };
      const tokens = body.usage?.total_tokens;
      if (typeof tokens === "number" && Number.isFinite(tokens)) onUsage?.(tokens);

      const data = body.data;
      if (!Array.isArray(data) || data.length !== texts.length) {
        console.error("[reply/embeddings] Voyage returned an unexpected number of embeddings");
        return null;
      }
      // Voyage labels each result with the position of its input; use that
      // rather than trusting the order.
      const ordered = [...data].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
      const vectors: number[][] = [];
      for (const item of ordered) {
        if (!isEmbedding(item.embedding)) {
          console.error("[reply/embeddings] Voyage returned an unexpected embedding");
          return null;
        }
        vectors.push(item.embedding);
      }
      return vectors;
    } catch (err) {
      const reason = err instanceof Error ? err.name : "error";
      console.error(`[reply/embeddings] request failed (${reason})`);
      return null;
    }
  }

  return {
    model,
    async embed(text) {
      return (await request([text], timeoutMs))?.[0] ?? null;
    },
    async embedMany(texts, options) {
      if (texts.length === 0) return [];
      return request(texts, options?.timeoutMs ?? Math.max(timeoutMs, EMBED_MANY_TIMEOUT_MS));
    },
  };
}

// Puts an embedder inside the per-minute budget. A call that does not fit is
// not made: it resolves null at once, like any other failure, and the caller
// carries on without it (no memory for this request; the vector is added later).
export function createLimitedEmbedder(inner: Embedder, limiter: EmbedLimiter, lane: EmbedLane): Embedder {
  const allowed = (texts: string[]): boolean => {
    const tokens = texts.reduce((sum, text) => sum + estimateTokens(text), 0);
    if (limiter.tryAcquire(lane, tokens)) return true;
    // Sizes only; the text itself is never logged.
    console.error(`[reply/embeddings] skipped a ${lane} call (about ${tokens} tokens): over the per-minute budget`);
    return false;
  };
  return {
    model: inner.model,
    async embed(text) {
      return allowed([text]) ? inner.embed(text) : null;
    },
    async embedMany(texts, options) {
      if (texts.length === 0) return [];
      return allowed(texts) ? inner.embedMany(texts, options) : null;
    },
  };
}

// One budget for the whole process, whoever asks: every request shares the
// same account limit. It is rebuilt only when the configured budget changes.
const shared = globalThis as { __replyEmbedLimiter?: { key: string; limiter: EmbedLimiter } };

function sharedLimiter(rpm: number, tpm: number): EmbedLimiter {
  const key = `${rpm}:${tpm}`;
  if (shared.__replyEmbedLimiter?.key !== key) {
    shared.__replyEmbedLimiter = { key, limiter: createEmbedLimiter({ rpm, tpm }) };
  }
  return shared.__replyEmbedLimiter.limiter;
}

// Null when no VOYAGE_API_KEY is configured: memory is then simply unavailable.
// `lane` says whether someone is waiting for the answer ("foreground", the
// default) or this is indexing that can wait ("background").
export function getEmbedder(onUsage?: (tokens: number) => void, lane: EmbedLane = "foreground"): Embedder | null {
  const env = getReplyEnv();
  if (!env.VOYAGE_API_KEY) return null;
  const inner = createVoyageEmbedder({ apiKey: env.VOYAGE_API_KEY, model: env.REPLY_EMBED_MODEL, onUsage });
  return createLimitedEmbedder(inner, sharedLimiter(env.REPLY_EMBED_RPM, env.REPLY_EMBED_TPM), lane);
}
