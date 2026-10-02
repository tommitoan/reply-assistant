import { chunkByTokens, DEFAULT_REQUEST_TOKENS } from "./embed-limiter";
import type { Embedder } from "./embeddings";
import {
  MAX_SUGGESTIONS_PER_REQUEST,
  MAX_WAITING_SUGGESTIONS,
  MIN_SUGGEST_CHARS,
} from "./limits";
import type { NotesAiDeps } from "./notes-ai";
import { extractFacts, matchKey } from "./suggest-facts";
import type { NewSuggestion, SuggestionsRepo } from "./suggestions-repo";
import type { NoteDraft, ReplyContext } from "./types";

// A proposal this close in meaning to a note the writer already has (kept,
// archived, waiting or dismissed) is a repeat. Cross-language paraphrases of
// the same fact score around this; unrelated sentences score far below.
export const DUPLICATE_SIMILARITY = 0.8;

export interface SuggestDeps {
  ai: NotesAiDeps;
  repo: SuggestionsRepo;
  // For the lookup no one waits for (the background share of the per-minute
  // limit). Null: repeats are then found by their text only.
  embedder: Embedder | null;
  // True once today's spending has reached the daily limit.
  overBudget: () => Promise<boolean>;
}

export interface SuggestInput {
  // The writer's own typed words, and nothing else: never a pasted message.
  text: string;
  context: ReplyContext;
}

// Proposals whose text, or English version, is already known or repeated in the list.
function dropKnownText(drafts: NoteDraft[], known: Array<{ text: string; textEn: string | null }>): NoteDraft[] {
  const seen = new Set(known.flatMap((note) => [matchKey(note.text), note.textEn ? matchKey(note.textEn) : ""]).filter(Boolean));
  const kept: NoteDraft[] = [];
  for (const draft of drafts) {
    const keys = [matchKey(draft.text), draft.textEn ? matchKey(draft.textEn) : ""].filter(Boolean);
    if (keys.length === 0 || keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    kept.push(draft);
  }
  return kept;
}

interface Embedded {
  embedding: number[] | null;
  embeddingEn: number[] | null;
}

// One embedding request for every text of every proposal. Fail-open: a failed
// request means "no vectors", and the proposals are judged by their text alone.
async function embedDrafts(embedder: Embedder | null, drafts: NoteDraft[]): Promise<Embedded[]> {
  const none = drafts.map(() => ({ embedding: null, embeddingEn: null }));
  if (!embedder) return none;
  const texts = [...new Set(drafts.flatMap((draft) => (draft.textEn ? [draft.text, draft.textEn] : [draft.text])))];
  const byText = new Map<string, number[]>();
  for (const chunk of chunkByTokens(texts, DEFAULT_REQUEST_TOKENS)) {
    const vectors = await embedder.embedMany(chunk);
    if (!vectors) return none;
    for (const [index, text] of chunk.entries()) byText.set(text, vectors[index]);
  }
  return drafts.map((draft) => ({
    embedding: byText.get(draft.text) ?? null,
    embeddingEn: draft.textEn ? (byText.get(draft.textEn) ?? null) : null,
  }));
}

// Reads the writer's own typed words for facts about them and saves what is new
// as waiting suggestions. Nothing becomes a note without the writer's approval.
// Every problem ends quietly with 0: this runs after the reply was sent and is
// never a reason for anything to fail.
export async function suggestFacts(deps: SuggestDeps, input: SuggestInput): Promise<number> {
  try {
    const text = input.text.trim();
    if (text.length < MIN_SUGGEST_CHARS) return 0;

    const waiting = await deps.repo.countWaiting();
    const room = Math.min(MAX_SUGGESTIONS_PER_REQUEST, MAX_WAITING_SUGGESTIONS - waiting);
    if (room <= 0) return 0;
    if (await deps.overBudget()) return 0;

    const facts = await extractFacts(deps.ai, text);
    if (!facts || facts.length === 0) return 0;

    const fresh = dropKnownText(facts, await deps.repo.listKnownTexts());
    if (fresh.length === 0) return 0;

    const vectors = await embedDrafts(deps.embedder, fresh);
    const model = deps.embedder?.model ?? null;
    const rows: NewSuggestion[] = [];
    for (const [index, draft] of fresh.entries()) {
      const { embedding, embeddingEn } = vectors[index];
      if (model && (embedding || embeddingEn)) {
        const best = await Promise.all(
          [embedding, embeddingEn].flatMap((vector) => (vector ? [deps.repo.bestSimilarity(vector, model)] : [])),
        );
        if (best.some((similarity) => similarity !== null && similarity >= DUPLICATE_SIMILARITY)) continue;
      }
      rows.push({
        text: draft.text,
        textEn: draft.textEn,
        kind: draft.kind,
        happenedOn: draft.happenedOn,
        // A suggestion is for the kind of message it came from; the writer can widen it.
        scope: input.context,
        embedding,
        embeddingEn,
        embedModel: embedding || embeddingEn ? model : null,
      });
      if (rows.length === room) break;
    }
    return await deps.repo.save(rows);
  } catch (err) {
    console.error("[reply/suggest] could not propose notes", err);
    return 0;
  }
}
