import { computeCostUsd, computeEmbeddingCostUsd } from "./pricing";
import type { ReplyUsage } from "./types";

// Every kind of paid model call the assistant makes.
export const USAGE_KINDS = ["generate", "refine", "explain", "summary", "style_profile", "embedding", "warm", "notes"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export const USAGE_KIND_LABELS: Record<UsageKind, string> = {
  generate: "Writing replies",
  refine: "Developing replies",
  explain: "Explaining their message",
  summary: "Thread summaries",
  style_profile: "Style profile",
  embedding: "Embeddings (memory and notes)",
  warm: "Cache warm-up",
  notes: "Personal notes",
};

export interface UsageEntry {
  kind: UsageKind;
  model: string;
  conversationId?: string | null;
  generationId?: string | null;
  usage: ReplyUsage;
  // Null when the model has no known price.
  costUsd: number | null;
}

interface Links {
  conversationId?: string | null;
  generationId?: string | null;
}

export function modelCallEntry(kind: UsageKind, model: string, usage: ReplyUsage, links: Links = {}): UsageEntry {
  return { kind, model, usage, costUsd: computeCostUsd(model, usage), ...links };
}

export function embeddingEntry(model: string, tokens: number, links: Links = {}): UsageEntry {
  return {
    kind: "embedding",
    model,
    usage: { input_tokens: tokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    costUsd: computeEmbeddingCostUsd(model, tokens),
    ...links,
  };
}

export interface UsageRecorder {
  record(entry: UsageEntry): Promise<void>;
}

// Recording is bookkeeping: a failure to write a row must never fail or delay
// the work that was just paid for.
export async function recordQuietly(recorder: UsageRecorder | undefined, entry: UsageEntry): Promise<void> {
  if (!recorder) return;
  try {
    await recorder.record(entry);
  } catch (err) {
    console.error(`[reply/usage] could not record a ${entry.kind} call`, err);
  }
}
