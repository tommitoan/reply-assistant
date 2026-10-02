// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Embedder } from "./embeddings";
import { MAX_SUGGESTIONS_PER_REQUEST, MAX_WAITING_SUGGESTIONS, MIN_SUGGEST_CHARS } from "./limits";
import type { CompletedText } from "./claude";
import { DUPLICATE_SIMILARITY, suggestFacts, type SuggestDeps } from "./suggest-run";
import type { KnownText, NewSuggestion, SuggestionsRepo } from "./suggestions-repo";

afterEach(() => vi.restoreAllMocks());

const USAGE = { input_tokens: 200, output_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const fact = (text: string, english: string | null = `EN ${text}`) => ({
  text,
  english,
  kind: "fact",
  scope: "both",
  happened_on: null,
});
const TEXT = "Hôm nay mình kể chuyện: tuần trước mình vừa dọn nhà.";

function harness(
  options: {
    facts?: unknown[] | Error;
    waiting?: number;
    known?: KnownText[];
    similarity?: number | null;
    embedder?: "ok" | "none" | "fail";
    overBudget?: boolean;
    repoFails?: boolean;
  } = {},
) {
  const saved: NewSuggestion[] = [];
  const similarityCalls: number[][] = [];
  const repo: SuggestionsRepo = {
    countWaiting: async () => {
      if (options.repoFails) throw new Error("db down");
      return options.waiting ?? 0;
    },
    listKnownTexts: async () => options.known ?? [],
    bestSimilarity: async (vector) => {
      similarityCalls.push(vector);
      return options.similarity ?? null;
    },
    save: async (rows) => {
      saved.push(...rows);
      return rows.length;
    },
  };
  const complete = vi.fn(async (): Promise<CompletedText> => {
    if (options.facts instanceof Error) throw options.facts;
    return { text: JSON.stringify(options.facts ?? [fact("Mình vừa dọn nhà.")]), model: "m", usage: USAGE, stopReason: "end_turn" } as CompletedText;
  });
  const embedCalls: string[][] = [];
  const embedder: Embedder = {
    model: "voyage-test",
    embed: async () => null,
    embedMany: vi.fn(async (texts: string[]) => {
      embedCalls.push(texts);
      return options.embedder === "fail" ? null : texts.map((_, i) => [i + 1, 0.5]);
    }),
  };
  const deps: SuggestDeps = {
    ai: { model: "m", complete, today: () => "2026-10-01" },
    repo,
    embedder: options.embedder === "none" ? null : embedder,
    overBudget: async () => options.overBudget ?? false,
  };
  return { deps, saved, complete, embedCalls, similarityCalls };
}

describe("suggestFacts", () => {
  it("saves a new fact as a suggestion for the request's context, with its vectors", async () => {
    const h = harness();
    expect(await suggestFacts(h.deps, { text: TEXT, context: "casual" })).toBe(1);
    expect(h.saved).toEqual([
      {
        text: "Mình vừa dọn nhà.",
        textEn: "EN Mình vừa dọn nhà.",
        kind: "fact",
        happenedOn: null,
        scope: "casual",
        embedding: [1, 0.5],
        embeddingEn: [2, 0.5],
        embedModel: "voyage-test",
      },
    ]);
    // Both texts of every proposal go out in one embedding request.
    expect(h.embedCalls).toHaveLength(1);
  });

  it("does nothing for a text too short to hold a fact, without calling the model", async () => {
    const h = harness();
    expect(await suggestFacts(h.deps, { text: "a".repeat(MIN_SUGGEST_CHARS - 1), context: "work" })).toBe(0);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("does nothing when the waiting list is full, without calling the model", async () => {
    const h = harness({ waiting: MAX_WAITING_SUGGESTIONS });
    expect(await suggestFacts(h.deps, { text: TEXT, context: "work" })).toBe(0);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("saves only as many as fit in the waiting list", async () => {
    const h = harness({
      waiting: MAX_WAITING_SUGGESTIONS - 2,
      facts: ["alpha one", "beta two", "gamma three"].map((t) => fact(t)),
    });
    expect(await suggestFacts(h.deps, { text: TEXT, context: "work" })).toBe(2);
    expect(h.saved.map((row) => row.text)).toEqual(["alpha one", "beta two"]);
  });

  it("never saves more than the per-request maximum", async () => {
    const h = harness({ facts: Array.from({ length: 6 }, (_, i) => fact(`fact ${i} unique${i}`)) });
    expect(await suggestFacts(h.deps, { text: TEXT, context: "work" })).toBe(MAX_SUGGESTIONS_PER_REQUEST);
  });

  it("does nothing once the daily limit is reached", async () => {
    const h = harness({ overBudget: true });
    expect(await suggestFacts(h.deps, { text: TEXT, context: "work" })).toBe(0);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("drops a fact already known by its text, ignoring accents and case, in any language version", async () => {
    const h = harness({
      facts: [fact("MÌNH VỪA DỌN NHÀ"), fact("Mình làm Go", "I write Go."), fact("Mình thích leo núi", "I like hiking.")],
      known: [
        { text: "Mình vừa dọn nhà.", textEn: null },
        { text: "Tôi lập trình bằng Go", textEn: "I write go" },
      ],
    });
    expect(await suggestFacts(h.deps, { text: TEXT, context: "work" })).toBe(1);
    expect(h.saved.map((row) => row.text)).toEqual(["Mình thích leo núi"]);
  });

  it("does not let repeats hide a new fact behind the per-request limit", async () => {
    const h = harness({
      facts: [fact("Known one"), fact("Known two"), fact("Known three"), fact("Brand new fact")],
      known: [{ text: "Known one", textEn: null }, { text: "Known two", textEn: null }, { text: "Known three", textEn: null }],
    });
    expect(await suggestFacts(h.deps, { text: TEXT, context: "work" })).toBe(1);
    expect(h.saved.map((row) => row.text)).toEqual(["Brand new fact"]);
  });

  it("drops a repeat within the same answer", async () => {
    const h = harness({ facts: [fact("Mình thích leo núi"), fact("mình thích leo núi!")] });
    expect(await suggestFacts(h.deps, { text: TEXT, context: "work" })).toBe(1);
  });

  it("drops a fact whose meaning is close to a note the writer has, whatever its status", async () => {
    const near = harness({ similarity: DUPLICATE_SIMILARITY });
    expect(await suggestFacts(near.deps, { text: TEXT, context: "work" })).toBe(0);
    expect(near.similarityCalls.length).toBeGreaterThan(0);

    const far = harness({ similarity: DUPLICATE_SIMILARITY - 0.01 });
    expect(await suggestFacts(far.deps, { text: TEXT, context: "work" })).toBe(1);

    const nothingToCompare = harness({ similarity: null });
    expect(await suggestFacts(nothingToCompare.deps, { text: TEXT, context: "work" })).toBe(1);
  });

  it("still proposes by text alone when the embedding is unavailable, saving it without vectors", async () => {
    for (const embedder of ["fail", "none"] as const) {
      const h = harness({ embedder });
      expect(await suggestFacts(h.deps, { text: TEXT, context: "work" })).toBe(1);
      expect(h.saved[0]).toMatchObject({ embedding: null, embeddingEn: null, embedModel: null });
      expect(h.similarityCalls).toEqual([]);
    }
  });

  it("proposes nothing when the model finds nothing or fails, and never throws", async () => {
    expect(await suggestFacts(harness({ facts: [] }).deps, { text: TEXT, context: "work" })).toBe(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await suggestFacts(harness({ facts: new Error("model down") }).deps, { text: TEXT, context: "work" })).toBe(0);
    expect(await suggestFacts(harness({ repoFails: true }).deps, { text: TEXT, context: "work" })).toBe(0);
  });
});
