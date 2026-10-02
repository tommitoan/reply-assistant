import type { OptionRating, ReplyMode } from "./types";

// Starting values; tune them from real data once there is some. Distance is
// cosine distance (0 = same meaning, 2 = opposite).
export const MEMORY_MAX_DISTANCE = 0.4;
export const MEMORY_MAX_EXAMPLES = 5;
// How many nearest rows the database returns before they are filtered here.
export const MEMORY_CANDIDATE_LIMIT = 20;

// For a pasted conversation the newest part says what the reply is about, and
// a whole thread would cost more and dilute the match.
export const EMBED_TAIL_CHARS = 1500;

export function embeddingTextFor(mode: ReplyMode, input: string): string {
  return mode === "en_reply" && input.length > EMBED_TAIL_CHARS ? input.slice(-EMBED_TAIL_CHARS) : input;
}

// Keeps examples (and the list of used memories) short whatever was stored.
export function excerpt(text: string, max: number): string {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

export type MemoryKind = "edited" | "chosen" | "good";

// One reply option from an earlier request, with how close that request's
// input is to the new one.
export interface MemoryCandidate {
  optionId: string;
  generationId: string;
  input: string;
  text: string;
  editedText: string | null;
  chosen: boolean;
  rating: OptionRating | null;
  position: number;
  distance: number;
}

export interface MemoryExample {
  optionId: string;
  generationId: string;
  input: string;
  reply: string;
  kind: MemoryKind;
  distance: number;
}

// The user's own rewrite is the strongest signal, then a reply they used,
// then one they liked.
const KIND_ORDER: Record<MemoryKind, number> = { edited: 0, chosen: 1, good: 2 };

function kindOf(candidate: MemoryCandidate): MemoryKind | null {
  if (candidate.editedText !== null) return "edited";
  if (candidate.rating === "bad") return null;
  if (candidate.chosen) return "chosen";
  if (candidate.rating === "good") return "good";
  return null;
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function selectMemories(
  candidates: MemoryCandidate[],
  { maxDistance = MEMORY_MAX_DISTANCE, maxExamples = MEMORY_MAX_EXAMPLES } = {},
): MemoryExample[] {
  // Best option per earlier request, so one request cannot fill every slot.
  const bestPerGeneration = new Map<string, MemoryExample>();
  for (const candidate of candidates) {
    if (candidate.distance > maxDistance) continue;
    const kind = kindOf(candidate);
    if (!kind) continue;
    const example: MemoryExample = {
      optionId: candidate.optionId,
      generationId: candidate.generationId,
      input: candidate.input,
      reply: candidate.editedText ?? candidate.text,
      kind,
      distance: candidate.distance,
    };
    const current = bestPerGeneration.get(candidate.generationId);
    if (!current || KIND_ORDER[kind] < KIND_ORDER[current.kind]) {
      bestPerGeneration.set(candidate.generationId, example);
    }
  }

  const ranked = [...bestPerGeneration.values()].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.distance - b.distance,
  );

  // The same reply saved twice would only waste a slot.
  const seen = new Set<string>();
  const selected: MemoryExample[] = [];
  for (const example of ranked) {
    const key = normalise(example.reply);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(example);
    if (selected.length === maxExamples) break;
  }
  return selected;
}
