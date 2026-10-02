import type { ReplyUsage } from "./types";

// Hand-maintained: update when Anthropic changes prices or the default models
// change. Costs derived from it are estimates, not invoices.
export const PRICING_LAST_CHECKED = "2026-09-25";

interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
}

// Cache writes (5-minute TTL) are billed at 1.25x the input price.
const CACHE_WRITE_MULTIPLIER = 1.25;

const PRICES: Record<string, ModelPrice> = {
  // Haiku's cache-read price is the standard 0.1x of input; not separately confirmed.
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
};

// Embedding models are billed on input tokens only, per million.
const EMBEDDING_PRICES_PER_MTOK: Record<string, number> = {
  "voyage-3.5-lite": 0.02,
};

function priceFor(model: string): ModelPrice | null {
  if (PRICES[model]) return PRICES[model];
  // Dated snapshot ids ("claude-haiku-4-5-20251001") share the base price.
  const base = Object.keys(PRICES).find((key) => model.startsWith(`${key}-`));
  return base ? PRICES[base] : null;
}

// Returns null for a model without a known price, so an unpriced model shows
// up as "unknown" instead of silently counting as free.
export function computeCostUsd(model: string, usage: ReplyUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const dollars =
    (usage.input_tokens * price.inputPerMTok +
      usage.cache_creation_input_tokens * price.inputPerMTok * CACHE_WRITE_MULTIPLIER +
      usage.cache_read_input_tokens * price.cacheReadPerMTok +
      usage.output_tokens * price.outputPerMTok) /
    1_000_000;
  // Matches the numeric(10, 6) column.
  return Math.round(dollars * 1_000_000) / 1_000_000;
}

// Null for an embedding model without a known price, like computeCostUsd.
export function computeEmbeddingCostUsd(model: string, tokens: number): number | null {
  const perMTok = EMBEDDING_PRICES_PER_MTOK[model];
  if (perMTok === undefined) return null;
  return Math.round(((tokens * perMTok) / 1_000_000) * 1_000_000) / 1_000_000;
}
