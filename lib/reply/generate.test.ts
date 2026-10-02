// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StreamPart, StreamReplyParams } from "./claude";
import { startGeneration, type ExplainDeps, type GenerateDeps, type MemoryDeps, type StyleDeps, type ThreadDeps } from "./generate";
import type { Embedder } from "./embeddings";
import type { NotesUseDeps } from "./notes-context";
import type { NotesReadFilter, NotesReader } from "./notes-read";
import type { SimilarNote, UsableNote } from "./notes-select";
import type { MemoryCandidate } from "./memory";
import type { FailedGeneration, FinishedGeneration, NewGeneration, ReplyRepo } from "./repo";
import type { GenerateBody } from "./schemas";
import { hashText, mergePaste } from "./thread-merge";
import type { ThreadRepo } from "./thread-store";
import type { ConversationRecord, ReplyStreamEvent, ReplyUsage, StoredMessage } from "./types";

const BODY: GenerateBody = {
  mode: "vi_to_en",
  input: "Mình sẽ đến muộn.",
  context: "work",
  speed: "auto",
  learn: true,
  useMemory: false,
  better: false,
  explain: true,
  useNotes: false,
  excludeNoteIds: [],
};

const USAGE: ReplyUsage = {
  input_tokens: 1000,
  output_tokens: 500,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const REPLY_TEXT = "@@short\nI'll be late.\n@@medium\nI'm running late. See you soon.\n@@alt\nSorry, I'll be a bit late.";

function fakeRepo(spent = 0, existingGenerations: string[] = []) {
  const calls = {
    created: [] as NewGeneration[],
    finished: [] as Array<{ id: string; result: FinishedGeneration }>,
    failed: [] as Array<{ id: string; update: FailedGeneration }>,
  };
  const repo: ReplyRepo = {
    spentTodayUsd: async () => spent,
    createGeneration: async (input) => {
      calls.created.push(input);
      return "gen-1";
    },
    finishGeneration: async (id, result) => {
      calls.finished.push({ id, result });
      return result.options.map((option, index) => ({ id: `opt-${index}`, ...option }));
    },
    failGeneration: async (id, update) => {
      calls.failed.push({ id, update });
    },
    generationExists: async (id) => existingGenerations.includes(id),
    getRefineBase: async () => null,
    updateOption: async () => null,
    listRecentGenerations: async () => [],
  };
  return { repo, calls };
}

function fakeStream(parts: StreamPart[]) {
  const seen: StreamReplyParams[] = [];
  async function* stream(params: StreamReplyParams): AsyncGenerator<StreamPart> {
    seen.push(params);
    for (const part of parts) yield part;
  }
  return { stream, seen };
}

function finalPart(overrides: Partial<Extract<StreamPart, { type: "final" }>> = {}): StreamPart {
  return {
    type: "final",
    text: REPLY_TEXT,
    stopReason: "end_turn",
    usage: USAGE,
    model: "claude-haiku-4-5",
    ...overrides,
  };
}

function deps(overrides: Partial<GenerateDeps> & Pick<GenerateDeps, "repo" | "stream">): GenerateDeps {
  let time = 0;
  return {
    models: { fast: "claude-haiku-4-5", smart: "claude-sonnet-5-5" },
    dailyBudgetUsd: 2,
    now: () => (time += 100),
    ...overrides,
  };
}

async function readEvents(stream: ReadableStream<Uint8Array>): Promise<ReplyStreamEvent[]> {
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReplyStreamEvent);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startGeneration", () => {
  it("streams meta, deltas and a done event, and saves the parsed options", async () => {
    const { repo, calls } = fakeRepo();
    const { stream, seen } = fakeStream([
      { type: "delta", text: "@@short\nI'll be" },
      { type: "delta", text: " late." },
      finalPart(),
    ]);

    const result = await startGeneration(BODY, deps({ repo, stream }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events = await readEvents(result.stream);

    expect(events.map((e) => e.t)).toEqual(["meta", "delta", "delta", "done"]);
    expect(events[0]).toMatchObject({ t: "meta", generationId: "gen-1", model: "claude-haiku-4-5", tier: "fast" });

    const done = events[3] as Extract<ReplyStreamEvent, { t: "done" }>;
    expect(done.options.map((o) => o.variant)).toEqual(["short", "medium", "alt"]);
    expect(done.options[0]).toMatchObject({ id: "opt-0", text: "I'll be late." });
    // 1000 * $1/M + 500 * $5/M
    expect(done.costUsd).toBe(0.0035);
    // Clock ticks 100ms per call: start at 200, first delta at 300, end at 400.
    expect(done.firstTokenMs).toBe(100);
    expect(done.totalMs).toBe(200);
    expect(done.stopReason).toBe("end_turn");

    expect(calls.created[0]).toMatchObject({
      mode: "vi_to_en",
      context: "work",
      inputText: BODY.input,
      model: "claude-haiku-4-5",
      learn: true,
    });
    expect(calls.finished).toHaveLength(1);
    expect(calls.finished[0].result.options).toHaveLength(3);
    expect(calls.failed).toHaveLength(0);

    // The prompt reaches the model with the cached prefix and the input in the user message.
    expect(seen[0].system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(seen[0].messages[0].content).toContain(BODY.input);
  });

  it("routes by the chosen speed", async () => {
    for (const [speed, tier, model] of [
      ["auto", "fast", "claude-haiku-4-5"],
      ["fast", "fast", "claude-haiku-4-5"],
      ["smart", "smart", "claude-sonnet-5-5"],
    ] as const) {
      const { repo } = fakeRepo();
      const { stream, seen } = fakeStream([finalPart({ model })]);
      const result = await startGeneration({ ...BODY, speed }, deps({ repo, stream }));
      if (!result.ok) throw new Error("expected a stream");
      await readEvents(result.stream);
      expect(seen[0]).toMatchObject({ tier, model });
    }
  });

  it("refuses to start once today's spend reaches the budget", async () => {
    const { repo, calls } = fakeRepo(2);
    const { stream, seen } = fakeStream([finalPart()]);
    const result = await startGeneration(BODY, deps({ repo, stream, dailyBudgetUsd: 2 }));
    expect(result).toMatchObject({ ok: false, status: 429 });
    expect(calls.created).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it("still starts when spend is just under the budget", async () => {
    const { repo } = fakeRepo(1.999999);
    const { stream } = fakeStream([finalPart()]);
    const result = await startGeneration(BODY, deps({ repo, stream, dailyBudgetUsd: 2 }));
    expect(result.ok).toBe(true);
    if (result.ok) await readEvents(result.stream);
  });

  it("reports a refusal as a retryable error and records it as refused", async () => {
    const { repo, calls } = fakeRepo();
    const { stream } = fakeStream([finalPart({ text: "", stopReason: "refusal" })]);
    const result = await startGeneration(BODY, deps({ repo, stream }));
    if (!result.ok) throw new Error("expected a stream");
    const events = await readEvents(result.stream);

    expect(events.at(-1)).toMatchObject({ t: "error", retryable: true });
    expect(calls.failed[0].update.status).toBe("refused");
    expect(calls.finished).toHaveLength(0);
  });

  it("retries a refusal from the smart model once with the fast model", async () => {
    const { repo, calls } = fakeRepo();
    const seen: StreamReplyParams[] = [];
    async function* stream(params: StreamReplyParams): AsyncGenerator<StreamPart> {
      seen.push(params);
      yield params.tier === "smart"
        ? finalPart({ text: "", stopReason: "refusal", model: "claude-sonnet-5-5" })
        : finalPart();
    }
    const result = await startGeneration({ ...BODY, speed: "smart" }, deps({ repo, stream }));
    if (!result.ok) throw new Error("expected a stream");
    const events = await readEvents(result.stream);

    expect(seen.map((call) => call.model)).toEqual(["claude-sonnet-5-5", "claude-haiku-4-5"]);
    expect(events.at(-1)).toMatchObject({ t: "done" });
    expect(calls.failed).toHaveLength(0);
    expect(calls.finished).toHaveLength(1);
  });

  it("does not retry a fast-model refusal", async () => {
    const { repo, calls } = fakeRepo();
    const { stream, seen } = fakeStream([finalPart({ text: "", stopReason: "refusal" })]);
    const result = await startGeneration({ ...BODY, speed: "fast" }, deps({ repo, stream }));
    if (!result.ok) throw new Error("expected a stream");
    await readEvents(result.stream);
    expect(seen).toHaveLength(1);
    expect(calls.failed[0].update.status).toBe("refused");
  });

  it("reports an empty reply as an error", async () => {
    const { repo, calls } = fakeRepo();
    const { stream } = fakeStream([finalPart({ text: "   " })]);
    const result = await startGeneration(BODY, deps({ repo, stream }));
    if (!result.ok) throw new Error("expected a stream");
    const events = await readEvents(result.stream);

    expect(events.at(-1)).toMatchObject({ t: "error", retryable: true });
    expect(calls.failed[0].update.status).toBe("error");
  });

  it("keeps a reply that ignored the marker format as a single option", async () => {
    const { repo } = fakeRepo();
    const { stream } = fakeStream([finalPart({ text: "Sorry, I will be late." })]);
    const result = await startGeneration(BODY, deps({ repo, stream }));
    if (!result.ok) throw new Error("expected a stream");
    const done = (await readEvents(result.stream)).at(-1) as Extract<ReplyStreamEvent, { t: "done" }>;
    expect(done.options).toEqual([expect.objectContaining({ variant: "medium", text: "Sorry, I will be late." })]);
  });

  it("turns a model failure into an error event and records it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { repo, calls } = fakeRepo();
    async function* failing(): AsyncGenerator<StreamPart> {
      throw new Error("boom");
    }
    const result = await startGeneration(BODY, deps({ repo, stream: failing }));
    if (!result.ok) throw new Error("expected a stream");
    const events = await readEvents(result.stream);

    expect(events.map((e) => e.t)).toEqual(["meta", "error"]);
    expect(JSON.stringify(events.at(-1))).not.toContain("boom");
    expect(calls.failed[0].update.status).toBe("error");
  });

  it("still reports the error when recording the failure also fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { repo } = fakeRepo();
    repo.failGeneration = async () => {
      throw new Error("db down");
    };
    async function* failing(): AsyncGenerator<StreamPart> {
      throw new Error("boom");
    }
    const result = await startGeneration(BODY, deps({ repo, stream: failing }));
    if (!result.ok) throw new Error("expected a stream");
    expect((await readEvents(result.stream)).at(-1)).toMatchObject({ t: "error" });
  });

  it("stops without an error when the client cancels, and leaves a warning that says so", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { repo, calls } = fakeRepo();
    const controller = new AbortController();
    async function* waiting(params: StreamReplyParams): AsyncGenerator<StreamPart> {
      yield { type: "delta", text: "@@short\nHi" };
      await new Promise((_, reject) =>
        params.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    }
    const result = await startGeneration(BODY, deps({ repo, stream: waiting }), controller.signal);
    if (!result.ok) throw new Error("expected a stream");

    const reader = result.stream.getReader();
    await reader.read(); // meta
    await reader.read(); // first delta
    controller.abort();
    while (!(await reader.read()).done) {
      // drain until the stream closes
    }

    expect(calls.failed).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls[0][0]).toMatch(/the client disconnected \(request gen-1, \d+ ms in, after the first token\)/);
  });

  it("says when the client disconnected before the first token", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { repo } = fakeRepo();
    const controller = new AbortController();
    async function* silent(params: StreamReplyParams): AsyncGenerator<StreamPart> {
      await new Promise((_, reject) =>
        params.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
      yield { type: "delta", text: "never sent" };
    }
    const result = await startGeneration(BODY, deps({ repo, stream: silent }), controller.signal);
    if (!result.ok) throw new Error("expected a stream");
    const reader = result.stream.getReader();
    await reader.read(); // meta
    controller.abort();
    while (!(await reader.read()).done) {
      // drain until the stream closes
    }
    expect(consoleWarn.mock.calls[0][0]).toContain("before the first token");
  });

  describe("better regenerate", () => {
    const PARENT = "0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10";

    it("uses the smart model even when the speed was fast, and links to the parent", async () => {
      const { repo, calls } = fakeRepo(0, [PARENT]);
      const { stream, seen } = fakeStream([finalPart({ model: "claude-sonnet-5-5" })]);
      const result = await startGeneration(
        { ...BODY, speed: "fast", better: true, parentGenerationId: PARENT },
        deps({ repo, stream }),
      );
      if (!result.ok) throw new Error("expected a stream");
      await readEvents(result.stream);

      expect(seen[0]).toMatchObject({ tier: "smart", model: "claude-sonnet-5-5" });
      expect(calls.created[0]).toMatchObject({
        model: "claude-sonnet-5-5",
        speed: "smart",
        parentGenerationId: PARENT,
      });
    });

    it("records the speed the user chose when it is not a better request", async () => {
      const { repo, calls } = fakeRepo();
      const { stream } = fakeStream([finalPart()]);
      const result = await startGeneration({ ...BODY, speed: "fast" }, deps({ repo, stream }));
      if (!result.ok) throw new Error("expected a stream");
      await readEvents(result.stream);
      expect(calls.created[0]).toMatchObject({ speed: "fast", parentGenerationId: undefined });
    });

    it("rejects a request whose parent does not exist, before creating or calling anything", async () => {
      const { repo, calls } = fakeRepo(0, []);
      const { stream, seen } = fakeStream([finalPart()]);
      const result = await startGeneration(
        { ...BODY, better: true, parentGenerationId: PARENT },
        deps({ repo, stream }),
      );
      expect(result).toMatchObject({ ok: false, status: 400 });
      expect(calls.created).toHaveLength(0);
      expect(seen).toHaveLength(0);
    });
  });
});

describe("memory", () => {
  const VECTOR = [0.1, 0.2, 0.3];

  function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
    return {
      optionId: "opt-1",
      generationId: "gen-old",
      input: "Mình đến muộn nhé.",
      text: "I'll be late.",
      editedText: null,
      chosen: false,
      rating: "good",
      position: 0,
      distance: 0.1,
      ...overrides,
    };
  }

  function memoryFakes(
    options: {
      candidates?: MemoryCandidate[];
      embedding?: number[] | null;
      hasEmbedder?: boolean;
      // Requests the database still lists as waiting for a vector.
      pending?: Array<{ id: string; mode: "vi_to_en" | "en_reply"; inputText: string }>;
      // Whether the batch request to the provider works.
      batchWorks?: boolean;
      withIndexer?: boolean;
    } = {},
  ) {
    const { candidates = [], embedding = VECTOR, hasEmbedder = true, pending = [], batchWorks = true, withIndexer = false } = options;
    const tasks: Array<() => Promise<void>> = [];
    const saved: Array<{ id: string; vector: number[]; model: string }> = [];
    const embed = vi.fn(async () => embedding);
    const embedMany = vi.fn(async (texts: string[]) => (batchWorks ? texts.map(() => VECTOR) : null));
    const indexEmbedMany = vi.fn(async (texts: string[]) => (batchWorks ? texts.map(() => VECTOR) : null));
    const findCandidates = vi.fn(async () => candidates);
    const memory: MemoryDeps = {
      embedder: hasEmbedder ? { model: "voyage-test", embed, embedMany } : null,
      indexer: withIndexer ? { model: "voyage-test", embed: async () => null, embedMany: indexEmbedMany } : undefined,
      repo: {
        findCandidates,
        saveEmbedding: async (id, vector, model) => {
          saved.push({ id, vector, model });
        },
        listNeedingEmbedding: async () => pending.filter((row) => !saved.some((entry) => entry.id === row.id)),
      },
      afterResponse: (task) => {
        tasks.push(task);
      },
    };
    const runAfter = async () => {
      for (const task of tasks) await task();
    };
    return { memory, tasks, saved, embed, embedMany, indexEmbedMany, findCandidates, runAfter };
  }

  async function run(body: Partial<GenerateBody>, fakes: ReturnType<typeof memoryFakes>, repoSetup = fakeRepo()) {
    const { stream, seen } = fakeStream([finalPart()]);
    const result = await startGeneration({ ...BODY, ...body }, deps({ repo: repoSetup.repo, stream, memory: fakes.memory }));
    if (!result.ok) throw new Error("expected a stream");
    const events = await readEvents(result.stream);
    return { events, seen, calls: repoSetup.calls, meta: events[0] as Extract<ReplyStreamEvent, { t: "meta" }> };
  }

  it("adds nothing and skips the lookup when memory is off", async () => {
    const fakes = memoryFakes();
    const { meta, seen } = await run({ useMemory: false }, fakes);
    expect(meta.memoryStatus).toBe("off");
    expect(meta.memories).toEqual([]);
    expect(fakes.findCandidates).not.toHaveBeenCalled();
    expect(seen[0].messages[0].content).not.toContain("<memory_examples>");
  });

  it("puts close, well-rated earlier replies into the prompt and records which ones", async () => {
    const fakes = memoryFakes({ candidates: [candidate()] });
    const repoSetup = fakeRepo();
    const { meta, seen, calls } = await run({ useMemory: true }, fakes, repoSetup);

    expect(meta.memoryStatus).toBe("used");
    expect(meta.memories).toEqual([{ id: "opt-1", input: "Mình đến muộn nhé." }]);
    const prompt = seen[0].messages[0].content;
    expect(prompt).toContain("<example_input>Mình đến muộn nhé.</example_input>");
    expect(prompt).toContain("<example_reply>I'll be late.</example_reply>");
    expect(calls.created[0].memoryExampleIds).toEqual(["opt-1"]);
    expect(fakes.findCandidates).toHaveBeenCalledWith(VECTOR, { mode: "vi_to_en", context: "work" }, 20);
  });

  it("starts the embedding before the database checks so the two overlap", async () => {
    const order: string[] = [];
    const fakes = memoryFakes();
    fakes.embed.mockImplementation(async () => {
      order.push("embed");
      return VECTOR;
    });
    const repoSetup = fakeRepo();
    const original = repoSetup.repo.spentTodayUsd;
    repoSetup.repo.spentTodayUsd = async (now) => {
      order.push("budget");
      return original(now);
    };
    await run({ useMemory: true }, fakes, repoSetup);
    expect(order.slice(0, 2)).toEqual(["embed", "budget"]);
  });

  it("reports when nothing close enough was found", async () => {
    const fakes = memoryFakes({ candidates: [candidate({ distance: 0.9 })] });
    const { meta, seen, calls } = await run({ useMemory: true }, fakes);
    expect(meta.memoryStatus).toBe("none");
    expect(seen[0].messages[0].content).not.toContain("<memory_examples>");
    expect(calls.created[0].memoryExampleIds).toEqual([]);
  });

  it("says memory is unavailable, and still answers, when the server has no embedding key", async () => {
    const fakes = memoryFakes({ hasEmbedder: false });
    const { meta, events } = await run({ useMemory: true }, fakes);
    expect(meta.memoryStatus).toBe("unavailable");
    expect(events.at(-1)?.t).toBe("done");
    expect(fakes.tasks).toHaveLength(0);
  });

  it("skips memory, and still answers, when the embedding fails", async () => {
    const fakes = memoryFakes({ embedding: null });
    const { meta, events } = await run({ useMemory: true }, fakes);
    expect(meta.memoryStatus).toBe("skipped");
    expect(fakes.findCandidates).not.toHaveBeenCalled();
    expect(events.at(-1)?.t).toBe("done");
  });

  it("skips memory, and still answers, when the lookup throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fakes = memoryFakes();
    fakes.findCandidates.mockRejectedValue(new Error("db down"));
    const { meta, events } = await run({ useMemory: true }, fakes);
    expect(meta.memoryStatus).toBe("skipped");
    expect(events.at(-1)?.t).toBe("done");
  });

  describe("storing the embedding for later", () => {
    const waiting = (id = "gen-1") => ({ id, mode: "vi_to_en" as const, inputText: BODY.input });

    it("reuses the embedding computed for the lookup, after the response, with no further call", async () => {
      const fakes = memoryFakes({ candidates: [candidate()] });
      await run({ useMemory: true, learn: true }, fakes);
      expect(fakes.saved).toEqual([]); // nothing happens until the response is over
      await fakes.runAfter();
      expect(fakes.saved).toEqual([{ id: "gen-1", vector: VECTOR, model: "voyage-test" }]);
      expect(fakes.embed).toHaveBeenCalledTimes(1);
      expect(fakes.embedMany).not.toHaveBeenCalled();
    });

    it("embeds the request in the background when memory was off but Learn is on", async () => {
      const fakes = memoryFakes({ pending: [waiting()] });
      await run({ useMemory: false, learn: true }, fakes);
      expect(fakes.embed).not.toHaveBeenCalled();
      await fakes.runAfter();
      expect(fakes.embed).not.toHaveBeenCalled();
      expect(fakes.embedMany).toHaveBeenCalledTimes(1);
      expect(fakes.embedMany).toHaveBeenCalledWith([BODY.input]);
      expect(fakes.saved).toEqual([{ id: "gen-1", vector: VECTOR, model: "voyage-test" }]);
    });

    it("picks the request up in the background when the lookup embedding was skipped", async () => {
      const fakes = memoryFakes({ embedding: null, pending: [waiting()] });
      await run({ useMemory: true, learn: true }, fakes);
      await fakes.runAfter();
      expect(fakes.embed).toHaveBeenCalledTimes(1); // the lookup, which came back empty
      expect(fakes.embedMany).toHaveBeenCalledTimes(1);
      expect(fakes.saved).toEqual([{ id: "gen-1", vector: VECTOR, model: "voyage-test" }]);
    });

    it("embeds every waiting request with one request to the provider", async () => {
      const fakes = memoryFakes({ pending: [waiting("gen-1"), waiting("older-1"), waiting("older-2")] });
      await run({ useMemory: false, learn: true }, fakes);
      await fakes.runAfter();
      expect(fakes.embedMany).toHaveBeenCalledTimes(1);
      expect(fakes.embedMany.mock.calls[0][0]).toHaveLength(3);
      expect(fakes.saved.map((entry) => entry.id).sort()).toEqual(["gen-1", "older-1", "older-2"]);
    });

    it("keeps the lookup's own vector even when the batch request fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fakes = memoryFakes({ candidates: [candidate()], pending: [waiting("older-1")], batchWorks: false });
      await run({ useMemory: true, learn: true }, fakes);
      await fakes.runAfter();
      expect(fakes.saved).toEqual([{ id: "gen-1", vector: VECTOR, model: "voyage-test" }]);
    });

    it("stores nothing, and does not fail, when the batch request fails", async () => {
      const fakes = memoryFakes({ pending: [waiting()], batchWorks: false });
      await run({ useMemory: false, learn: true }, fakes);
      await expect(fakes.runAfter()).resolves.toBeUndefined();
      expect(fakes.saved).toEqual([]);
    });

    it("indexes with the background embedder, so the lookups keep their share of the limit", async () => {
      const fakes = memoryFakes({ pending: [waiting()], withIndexer: true });
      await run({ useMemory: false, learn: true }, fakes);
      await fakes.runAfter();
      expect(fakes.indexEmbedMany).toHaveBeenCalledTimes(1);
      expect(fakes.embedMany).not.toHaveBeenCalled();
      expect(fakes.saved).toHaveLength(1);
    });

    it("never stores an embedding for a request with Learn off", async () => {
      const fakes = memoryFakes({ candidates: [candidate()] });
      await run({ useMemory: true, learn: false }, fakes);
      expect(fakes.tasks).toHaveLength(0);
      expect(fakes.saved).toEqual([]);
    });

    it("stores nothing for a request that did not finish", async () => {
      const fakes = memoryFakes();
      const { stream } = fakeStream([finalPart({ text: "", stopReason: "refusal" })]);
      const result = await startGeneration(
        { ...BODY, learn: true },
        deps({ repo: fakeRepo().repo, stream, memory: fakes.memory }),
      );
      if (!result.ok) throw new Error("expected a stream");
      await readEvents(result.stream);
      expect(fakes.tasks).toHaveLength(0);
    });
  });
});

describe("conversation threads", () => {
  const CONV = "0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10";
  const SLACK = `Alice  10:32 AM
Hey, are you free to review my PR?

Sam  10:35 AM
Sure, which one?

Alice  10:36 AM
The one for the login page.`;

  interface SeedMessage {
    author: StoredMessage["author"];
    text: string;
    source?: StoredMessage["source"];
  }

  // An in-memory thread that merges pastes with the real merge function.
  function fakeThreads(options: { messages?: SeedMessage[]; summary?: string | null; summaryUptoSeq?: number | null; exists?: boolean } = {}) {
    const { messages = [], summary = null, summaryUptoSeq = null, exists = true } = options;
    const store: StoredMessage[] = messages.map((m, i) => ({
      id: `m${i + 1}`,
      seq: i + 1,
      author: m.author,
      text: m.text,
      source: m.source ?? "pasted",
      createdAt: "",
    }));
    const conversation: ConversationRecord = {
      id: CONV,
      title: "",
      context: "work",
      summary,
      summaryUptoSeq,
      archived: false,
      createdAt: "",
      updatedAt: "",
    };
    const saved: Array<{ summary: string; uptoSeq: number }> = [];
    const merges: string[] = [];
    const tasks: Array<() => Promise<void>> = [];
    const summarize = vi.fn<ThreadDeps["summarize"]>(async () => "Short summary.");
    const known = (id: string) => exists && id === CONV;
    const repo: ThreadRepo = {
      listConversations: async () => [],
      createConversation: async () => conversation,
      getConversation: async (id) => (known(id) ? conversation : null),
      getMessages: async () => [...store],
      updateConversation: async () => null,
      deleteConversation: async () => false,
      mergePaste: async (id, paste, selfNames) => {
        if (!known(id)) return null;
        merges.push(paste);
        const result = mergePaste(
          store.map((m) => ({ author: m.author, source: m.source, text: m.text, normHash: hashText(m.text) })),
          paste,
          selfNames,
        );
        for (const block of result.appended) {
          store.push({ id: `m${store.length + 1}`, seq: store.length + 1, author: block.author, text: block.text, source: "pasted", createdAt: "" });
        }
        return { conversation, messages: [...store], added: result.appended.length, skipped: result.skippedDuplicates };
      },
      saveSummary: async (_id, text, uptoSeq) => {
        saved.push({ summary: text, uptoSeq });
      },
    };
    const threads: ThreadDeps = {
      repo,
      selfNames: ["Sam"],
      summarize,
      afterResponse: (task) => {
        tasks.push(task);
      },
    };
    const runAfter = async () => {
      for (const task of tasks) await task();
    };
    return { threads, store, saved, merges, tasks, summarize, runAfter };
  }

  async function run(
    body: Partial<GenerateBody>,
    fakes: ReturnType<typeof fakeThreads>,
    options: { repoSetup?: ReturnType<typeof fakeRepo>; parts?: StreamPart[]; memory?: MemoryDeps; explain?: ExplainDeps } = {},
  ) {
    const repoSetup = options.repoSetup ?? fakeRepo();
    const { stream, seen } = fakeStream(options.parts ?? [finalPart()]);
    const result = await startGeneration(
      { ...BODY, conversationId: CONV, ...body },
      deps({ repo: repoSetup.repo, stream, threads: fakes.threads, memory: options.memory, explain: options.explain }),
    );
    return { result, seen, calls: repoSetup.calls };
  }

  async function events(result: Awaited<ReturnType<typeof run>>["result"]) {
    if (!result.ok) throw new Error("expected a stream");
    return readEvents(result.stream);
  }

  const paste = (input: string): Partial<GenerateBody> => ({ mode: "en_reply", input });

  describe("pasting a conversation", () => {
    it("adds it to the thread and writes replies from the thread", async () => {
      const fakes = fakeThreads();
      const { result, seen, calls } = await run(paste(SLACK), fakes);
      const evs = await events(result);
      const meta = evs[0] as Extract<ReplyStreamEvent, { t: "meta" }>;

      expect(meta.thread).toEqual({ added: 3, skipped: 0 });
      expect(fakes.store.map((m) => [m.author, m.text])).toEqual([
        ["them", "Hey, are you free to review my PR?"],
        ["me", "Sure, which one?"],
        ["them", "The one for the login page."],
      ]);

      const prompt = seen[0].messages[0].content;
      expect(prompt).toContain("<thread>\nThem: Hey, are you free to review my PR?\nMe: Sure, which one?\nThem: The one for the login page.\n</thread>");
      // The thread holds the text; the input only says what to do with it.
      expect(prompt).toContain("<task>en_reply</task>");
      expect(prompt).toContain("<input>\nWrite replies to the newest message in the thread.\n</input>");
      expect(prompt).not.toContain("Alice  10:32 AM");

      // The raw paste is what gets stored on the request.
      expect(calls.created[0]).toMatchObject({ mode: "en_reply", conversationId: CONV, inputText: SLACK });
      expect(evs.at(-1)?.t).toBe("done");
    });

    it("adds exactly one message when the whole chat is pasted again with one new message", async () => {
      const fakes = fakeThreads();
      await events((await run(paste(SLACK), fakes)).result);

      const again = `${SLACK}\n\nAlice  10:40 AM\nGot it, looking now.`;
      const second = await events((await run(paste(again), fakes)).result);

      expect((second[0] as Extract<ReplyStreamEvent, { t: "meta" }>).thread).toEqual({ added: 1, skipped: 3 });
      expect(fakes.store).toHaveLength(4);
      expect(fakes.store.at(-1)?.text).toBe("Got it, looking now.");
    });

    it("adds nothing but still writes replies when the same chat is pasted twice", async () => {
      const fakes = fakeThreads();
      await events((await run(paste(SLACK), fakes)).result);
      const { result, seen } = await run(paste(SLACK), fakes);
      const evs = await events(result);
      expect((evs[0] as Extract<ReplyStreamEvent, { t: "meta" }>).thread).toEqual({ added: 0, skipped: 3 });
      expect(fakes.store).toHaveLength(3);
      expect(evs.at(-1)?.t).toBe("done");
      expect(seen[0].messages[0].content).toContain("<thread>");
    });

    it("adds a pasted message that has no overlap with the thread", async () => {
      const fakes = fakeThreads({ messages: [{ author: "them", text: "Hey, are you free to review my PR?" }] });
      const evs = await events((await run(paste("Alice  11:00 AM\nAlso, the tests are failing."), fakes)).result);
      expect((evs[0] as Extract<ReplyStreamEvent, { t: "meta" }>).thread).toEqual({ added: 1, skipped: 0 });
      expect(fakes.store.map((m) => m.text)).toEqual(["Hey, are you free to review my PR?", "Also, the tests are failing."]);
    });

    it("does not add a reply picked in the app again when the next paste contains it", async () => {
      const fakes = fakeThreads({
        messages: [
          { author: "them", text: "Can you review my PR today?" },
          { author: "me", text: "I can review it this afternoon.", source: "chosen_reply" },
        ],
      });
      const next = "Alice: Can you review my PR today?\nSam: I can review it this afternoon.\nAlice: Great, thanks!";
      const evs = await events((await run(paste(next), fakes)).result);
      expect((evs[0] as Extract<ReplyStreamEvent, { t: "meta" }>).thread).toEqual({ added: 1, skipped: 2 });
      expect(fakes.store.filter((m) => m.text.startsWith("I can review"))).toHaveLength(1);
    });

    it("starts the thread's replies from its summary when one exists", async () => {
      const fakes = fakeThreads({ messages: [{ author: "them", text: "Latest question?" }], summary: "They planned a launch." });
      const { seen, result } = await run(paste("Another question?"), fakes);
      await events(result);
      const prompt = seen[0].messages[0].content;
      expect(prompt).toContain("<thread_summary>They planned a launch.</thread_summary>");
      expect(prompt.indexOf("<thread_summary>")).toBeLessThan(prompt.indexOf("<thread>"));
    });
  });

  describe("a typed idea inside a thread", () => {
    it("uses the thread as context without changing it", async () => {
      const fakes = fakeThreads({
        messages: [
          { author: "them", text: "Can you join at 3?" },
          { author: "me", text: "Let me check." },
        ],
      });
      const { result, seen } = await run({ mode: "vi_to_en", input: "Mình tham gia được nhé." }, fakes);
      const evs = await events(result);
      const prompt = seen[0].messages[0].content;
      expect(fakes.merges).toEqual([]);
      expect(fakes.store).toHaveLength(2);
      expect((evs[0] as Extract<ReplyStreamEvent, { t: "meta" }>).thread).toBeUndefined();
      expect(prompt).toContain("<thread>\nThem: Can you join at 3?\nMe: Let me check.\n</thread>");
      expect(prompt).toContain("<input>\nMình tham gia được nhé.\n</input>");
    });

    it("leaves out the thread block when the thread is still empty", async () => {
      const fakes = fakeThreads();
      const { result, seen } = await run({ mode: "vi_to_en", input: "Xin chào" }, fakes);
      await events(result);
      expect(seen[0].messages[0].content).not.toContain("<thread>");
    });
  });

  describe("problems before the first word", () => {
    it("answers 404 for a conversation that does not exist, in either mode, and creates nothing", async () => {
      for (const mode of ["en_reply", "vi_to_en"] as const) {
        const fakes = fakeThreads({ exists: false });
        const { result, calls } = await run({ mode, input: "Hello there" }, fakes);
        expect(result).toMatchObject({ ok: false, status: 404 });
        expect(calls.created).toHaveLength(0);
      }
    });

    it("does not touch the thread when the daily budget is already used", async () => {
      const fakes = fakeThreads();
      const { result } = await run(paste(SLACK), fakes, { repoSetup: fakeRepo(2) });
      expect(result).toMatchObject({ ok: false, status: 429 });
      expect(fakes.merges).toEqual([]);
      expect(fakes.store).toHaveLength(0);
    });

    it("keeps a pasted conversation in the thread even when the model fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fakes = fakeThreads();
      const repoSetup = fakeRepo();
      async function* failing(): AsyncGenerator<StreamPart> {
        throw new Error("boom");
      }
      const result = await startGeneration(
        { ...BODY, conversationId: CONV, ...paste(SLACK) },
        deps({ repo: repoSetup.repo, stream: failing, threads: fakes.threads }),
      );
      const evs = await events(result);
      expect(evs.at(-1)?.t).toBe("error");
      expect(fakes.store).toHaveLength(3);
    });
  });

  describe("choosing the model", () => {
    it("uses the fast model for a short pasted exchange and the smart model for a longer one", async () => {
      const short = fakeThreads();
      const shortRun = await run(paste("Alice: hi\nSam: hello\nAlice: how are you?"), short);
      await events(shortRun.result);
      expect(shortRun.seen[0]).toMatchObject({ tier: "fast" });

      const long = fakeThreads();
      const lines = Array.from({ length: 6 }, (_, i) => `Alice: message number ${i}\nSam: reply number ${i}`).join("\n");
      const longRun = await run(paste(lines), long);
      await events(longRun.result);
      expect(longRun.seen[0]).toMatchObject({ tier: "smart", model: "claude-sonnet-5-5" });
    });

    it("uses the smart model for a typed idea once the thread is large", async () => {
      const big = fakeThreads({ messages: Array.from({ length: 12 }, (_, i) => ({ author: "them" as const, text: `${"long message ".repeat(60)}${i}` })) });
      const { result, seen } = await run({ mode: "vi_to_en", input: "Ok nhé" }, big);
      await events(result);
      expect(seen[0]).toMatchObject({ tier: "smart" });
    });

    it("keeps a typed idea on the fast model for a small thread", async () => {
      const small = fakeThreads({ messages: [{ author: "them", text: "short" }] });
      const { result, seen } = await run({ mode: "vi_to_en", input: "Ok nhé" }, small);
      await events(result);
      expect(seen[0]).toMatchObject({ tier: "fast" });
    });
  });

  describe("proposing notes from what the writer typed", () => {
    function hook() {
      const queued: Array<() => Promise<void>> = [];
      const run = vi.fn(async () => 1);
      return {
        queued,
        run,
        hook: { run, afterResponse: (task: () => Promise<void>) => void queued.push(task) },
        flush: async () => {
          for (const task of queued) await task();
        },
      };
    }

    async function go(body: Partial<GenerateBody>, h: ReturnType<typeof hook>, threaded = false) {
      const { repo } = fakeRepo();
      const { stream } = fakeStream([finalPart()]);
      const result = await startGeneration(
        { ...BODY, ...body },
        deps({ repo, stream, suggest: h.hook, ...(threaded ? { threads: fakeThreads().threads } : {}) }),
      );
      if (!result.ok) throw new Error(`expected a stream, got ${result.error}`);
      await readEvents(result.stream);
    }

    it("hands the typed idea to the proposer after the response, with the request's context", async () => {
      const h = hook();
      await go({ input: "Mình vừa dọn nhà tuần trước", context: "casual" }, h);
      expect(h.run).not.toHaveBeenCalled();
      expect(h.queued).toHaveLength(1);
      await h.flush();
      expect(h.run).toHaveBeenCalledWith({ text: "Mình vừa dọn nhà tuần trước", context: "casual" });
    });

    it("never reads a pasted message, only what the writer typed", async () => {
      const h = hook();
      await go({ ...paste(SLACK), conversationId: CONV }, h, true);
      expect(h.queued).toHaveLength(0);
      expect(h.run).not.toHaveBeenCalled();
    });

    it("learns nothing when Learn is off", async () => {
      const h = hook();
      await go({ learn: false }, h);
      expect(h.queued).toHaveLength(0);
    });

    it("learns nothing from a request that failed", async () => {
      const h = hook();
      const { repo } = fakeRepo();
      const { stream } = fakeStream([finalPart({ text: "   " })]);
      const result = await startGeneration(BODY, deps({ repo, stream, suggest: h.hook }));
      if (result.ok) await readEvents(result.stream);
      expect(h.queued).toHaveLength(0);
    });

    it("works without the proposer", async () => {
      const { repo } = fakeRepo();
      const { stream } = fakeStream([finalPart()]);
      const result = await startGeneration(BODY, deps({ repo, stream }));
      expect(result.ok).toBe(true);
    });
  });

  describe("the rolling summary", () => {
    const longThread = Array.from({ length: 30 }, (_, i) => ({ author: "them" as const, text: `message ${i + 1}` }));

    it("is refreshed after the response for the messages that left the window", async () => {
      const fakes = fakeThreads({ messages: longThread });
      const { result } = await run({ mode: "vi_to_en", input: "Ok nhé" }, fakes);
      await events(result);
      expect(fakes.summarize).not.toHaveBeenCalled(); // nothing happens until the response is over

      await fakes.runAfter();
      const input = fakes.summarize.mock.calls[0][0];
      expect(input.previous).toBeNull();
      expect(input.transcript.startsWith("Them: message 1\n")).toBe(true);
      expect(input.transcript.endsWith("Them: message 10")).toBe(true);
      expect(fakes.saved).toEqual([{ summary: "Short summary.", uptoSeq: 10 }]);
    });

    it("only covers what the earlier summary does not, and builds on it", async () => {
      const fakes = fakeThreads({ messages: longThread, summary: "Earlier: planning.", summaryUptoSeq: 6 });
      await events((await run({ mode: "vi_to_en", input: "Ok nhé" }, fakes)).result);
      await fakes.runAfter();
      const input = fakes.summarize.mock.calls[0][0];
      expect(input.previous).toBe("Earlier: planning.");
      expect(input.transcript.startsWith("Them: message 7\n")).toBe(true);
      expect(fakes.saved[0].uptoSeq).toBe(10);
    });

    it("keeps the prompt inside the window however long the thread is", async () => {
      const fakes = fakeThreads({ messages: longThread });
      const { result, seen } = await run({ mode: "vi_to_en", input: "Ok nhé" }, fakes);
      await events(result);
      const prompt = seen[0].messages[0].content;
      expect(prompt).toContain("Them: message 30");
      expect(prompt).toContain("Them: message 11");
      expect(prompt).not.toContain("Them: message 10\n");
    });

    it("is not needed while the whole thread fits the window", async () => {
      const fakes = fakeThreads({ messages: longThread.slice(0, 5) });
      await events((await run({ mode: "vi_to_en", input: "Ok nhé" }, fakes)).result);
      expect(fakes.tasks).toHaveLength(0);
    });

    it("is not refreshed for a request that did not finish", async () => {
      const fakes = fakeThreads({ messages: longThread });
      const { result } = await run({ mode: "vi_to_en", input: "Ok nhé" }, fakes, {
        parts: [finalPart({ text: "", stopReason: "refusal" })],
      });
      await events(result);
      expect(fakes.tasks).toHaveLength(0);
    });
  });

  describe("explaining the pasted message", () => {
    const RESULT = { text: "Dịch: Bạn rảnh không?\n\nÝ và giọng: lịch sự.", model: "claude-haiku-4-5", usage: USAGE };

    function fakeExplain(run: ExplainDeps["run"] = async () => RESULT) {
      const saved: Array<{ id: string; text: string }> = [];
      const runSpy = vi.fn(run);
      const explain: ExplainDeps = {
        run: runSpy,
        save: async (id, text) => {
          saved.push({ id, text });
        },
      };
      return { explain, saved, runSpy };
    }

    it("sends the explanation as its own event and keeps it with the request", async () => {
      const { explain, saved } = fakeExplain();
      const evs = await events((await run(paste(SLACK), fakeThreads(), { explain })).result);
      expect(evs.filter((e) => e.t === "explain")).toEqual([{ t: "explain", text: RESULT.text }]);
      expect(evs.at(-1)?.t === "done" || evs.some((e) => e.t === "done")).toBe(true);
      expect(saved).toEqual([{ id: "gen-1", text: RESULT.text }]);
    });

    it("explains the newest run of their messages, with the thread as context", async () => {
      const { explain, runSpy } = fakeExplain();
      await events((await run(paste(SLACK), fakeThreads(), { explain })).result);
      const input = runSpy.mock.calls[0][0];
      expect(input.conversationId).toBe(CONV);
      expect(input.context).toBe("work");
      expect(input.transcript).toContain("Them: The one for the login page.");
      expect(input.messages.map((m) => m.text)).toContain("The one for the login page.");
    });

    it("still delivers a late explanation after the replies are done", async () => {
      let release: (value: typeof RESULT) => void = () => {};
      const late = new Promise<typeof RESULT>((resolve) => {
        release = resolve;
      });
      const { explain } = fakeExplain(() => late);
      const { result } = await run(paste(SLACK), fakeThreads(), { explain });
      if (!result.ok) throw new Error("expected a stream");
      const pending = readEvents(result.stream);
      setTimeout(() => release(RESULT), 10);
      const evs = await pending;
      const types = evs.map((e) => e.t);
      expect(types.indexOf("done")).toBeLessThan(types.indexOf("explain"));
    });

    it("does not run when the user switched it off", async () => {
      const { explain, runSpy } = fakeExplain();
      const evs = await events((await run({ ...paste(SLACK), explain: false }, fakeThreads(), { explain })).result);
      expect(runSpy).not.toHaveBeenCalled();
      expect(evs.some((e) => e.t === "explain")).toBe(false);
    });

    it("does not run for a typed idea", async () => {
      const { explain, runSpy } = fakeExplain();
      await events((await run({ mode: "vi_to_en", input: "Ok nhé" }, fakeThreads({ messages: [{ author: "them", text: "Hi" }] }), { explain })).result);
      expect(runSpy).not.toHaveBeenCalled();
    });

    it("leaves the replies alone when the explanation fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { explain } = fakeExplain(async () => {
        throw new Error("boom");
      });
      const evs = await events((await run(paste(SLACK), fakeThreads(), { explain })).result);
      expect(evs.some((e) => e.t === "explain")).toBe(false);
      expect(evs.some((e) => e.t === "done")).toBe(true);
      expect(evs.some((e) => e.t === "error")).toBe(false);
    });

    it("sends nothing when there is nothing to explain", async () => {
      const { explain, saved } = fakeExplain(async () => null);
      const evs = await events((await run(paste(SLACK), fakeThreads(), { explain })).result);
      expect(evs.some((e) => e.t === "explain")).toBe(false);
      expect(saved).toEqual([]);
    });

    it("still shows the explanation when saving it fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const explain: ExplainDeps = {
        run: async () => RESULT,
        save: async () => {
          throw new Error("db down");
        },
      };
      const evs = await events((await run(paste(SLACK), fakeThreads(), { explain })).result);
      expect(evs.some((e) => e.t === "explain")).toBe(true);
      expect(evs.some((e) => e.t === "done")).toBe(true);
    });
  });

  describe("memory for pasted conversations", () => {
    const VECTOR = [0.1, 0.2];

    function memoryDeps(candidates: MemoryCandidate[] = []) {
      const embed = vi.fn<Embedder["embed"]>(async () => VECTOR);
      const memory: MemoryDeps = {
        embedder: { model: "voyage-test", embed, embedMany: async () => null },
        repo: {
          findCandidates: async () => candidates,
          saveEmbedding: async () => {},
          listNeedingEmbedding: async () => [],
        },
        afterResponse: () => {},
      };
      return { memory, embed };
    }

    it("embeds only the newest part of a long pasted conversation", async () => {
      const fakes = fakeThreads();
      const { memory, embed } = memoryDeps();
      const long = `${"old line\n\n".repeat(400)}NEWEST MESSAGE`;
      const { result } = await run({ ...paste(long), useMemory: true }, fakes, { memory });
      await events(result);
      const sent = embed.mock.calls[0][0];
      expect(sent.length).toBeLessThanOrEqual(1500);
      expect(sent.endsWith("NEWEST MESSAGE")).toBe(true);
    });

    it("shortens a long stored input before it goes into the prompt and the used-memories list", async () => {
      const fakes = fakeThreads();
      const longInput = `${"x".repeat(2000)} THE END`;
      const { memory } = memoryDeps([
        {
          optionId: "opt-1",
          generationId: "gen-old",
          input: longInput,
          text: "A stored reply.",
          editedText: null,
          chosen: false,
          rating: "good",
          position: 0,
          distance: 0.1,
        },
      ]);
      const { result, seen } = await run({ ...paste("Alice: hello?\nSam: hi\nAlice: ping"), useMemory: true }, fakes, { memory });
      const evs = await events(result);
      const meta = evs[0] as Extract<ReplyStreamEvent, { t: "meta" }>;
      expect(meta.memories[0].input.length).toBeLessThanOrEqual(162);
      expect(meta.memories[0].input.endsWith("THE END")).toBe(true);
      const example = /<example_input>([\s\S]*?)<\/example_input>/.exec(seen[0].messages[0].content)?.[1] ?? "";
      expect(example.length).toBeLessThanOrEqual(602);
      expect(example.endsWith("THE END")).toBe(true);
    });
  });

  describe("the writer's notes", () => {
    const TODAY = new Date("2026-10-01T00:00:00Z");
    const usable = (id: string, over: Partial<UsableNote> = {}): UsableNote => ({
      id,
      text: `VN ${id}`,
      textEn: `EN ${id}`,
      kind: "fact",
      happenedOn: null,
      pinned: false,
      ...over,
    });
    const similar = (id: string, similarity: number, over: Partial<UsableNote> = {}): SimilarNote => ({
      ...usable(id, over),
      similarity,
    });
    const many = (n: number) => Array.from({ length: n }, (_, i) => usable(`n${i}`));

    function notesHarness(
      options: { pinned?: UsableNote[]; unpinned?: UsableNote[]; similar?: SimilarNote[]; failList?: boolean; embedFails?: boolean } = {},
    ) {
      const filters: NotesReadFilter[] = [];
      const searches: unknown[][] = [];
      const reader: NotesReader = {
        listPinned: async (filter) => {
          filters.push(filter);
          if (options.failList) throw new Error("db down");
          return options.pinned ?? [];
        },
        listUnpinned: async (filter, limit) => {
          filters.push(filter);
          return (options.unpinned ?? []).slice(0, limit);
        },
        findSimilar: async (vector, model, filter, limit) => {
          searches.push([vector, model, filter, limit]);
          return options.similar ?? [];
        },
        getUsable: async () => null,
      };
      const embed = vi.fn(async () => (options.embedFails ? null : [0.5, 0.5]));
      const embedMany = vi.fn(async (texts: string[]) => (options.embedFails ? null : texts.map((_, i) => [i + 1, i + 1])));
      const embedder: Embedder = { model: "voyage-test", embed, embedMany };
      const notes: NotesUseDeps = { reader, embedder, embedModel: "voyage-test", now: () => TODAY };
      return { notes, filters, searches, embed, embedMany, embedder };
    }

    // A pasted message needs a thread; a typed idea does not.
    async function runNotes(
      body: Partial<GenerateBody>,
      h: ReturnType<typeof notesHarness>,
      options: { text?: string; memory?: MemoryDeps } = {},
    ) {
      const repoSetup = fakeRepo();
      const { stream, seen } = fakeStream([finalPart(options.text ? { text: options.text } : {})]);
      const typed = body.mode === "vi_to_en";
      const result = await startGeneration(
        { ...BODY, useNotes: true, ...(typed ? {} : { conversationId: CONV }), ...body },
        deps({ repo: repoSetup.repo, stream, notes: h.notes, memory: options.memory, ...(typed ? {} : { threads: fakeThreads().threads }) }),
      );
      if (!result.ok) throw new Error(`expected a stream, got ${result.error}`);
      const evs = await readEvents(result.stream);
      return {
        seen,
        calls: repoSetup.calls,
        meta: evs[0] as Extract<ReplyStreamEvent, { t: "meta" }>,
        done: evs.at(-1) as Extract<ReplyStreamEvent, { t: "done" }>,
        evs,
      };
    }

    describe("a pasted message", () => {
      it("sends a small collection whole, with pinned notes in the cached prefix, and searches nothing", async () => {
        const h = notesHarness({
          pinned: [usable("p1", { pinned: true })],
          unpinned: [usable("o1"), usable("o2", { kind: "event", happenedOn: "2026-09-14" })],
        });
        const { seen, meta } = await runNotes(paste(SLACK), h);

        const prefix = seen[0].system;
        expect(prefix).toHaveLength(2);
        expect(prefix[1].text).toContain("# Pinned notes");
        expect(prefix[1].text).toContain("[1] EN p1");
        const prompt = seen[0].messages[0].content;
        expect(prompt).toContain("<about_me>\n[2] EN o1\n[3] (2026-09) EN o2\n</about_me>");
        expect(prompt.indexOf("<thread>")).toBeLessThan(prompt.indexOf("<about_me>"));

        expect(meta.notes).toEqual({ status: "ready", offered: 3, suggestions: [] });
        expect(h.embed).not.toHaveBeenCalled();
        expect(h.embedMany).not.toHaveBeenCalled();
        expect(h.searches).toEqual([]);
      });

      it("uses the smart model when notes are in the prompt, and the fast one when there are none", async () => {
        const withNotes = await runNotes(paste(SLACK), notesHarness({ unpinned: many(2) }));
        expect(withNotes.seen[0]).toMatchObject({ tier: "smart", model: "claude-sonnet-5-5" });
        expect(withNotes.calls.created[0]).toMatchObject({ tier: "smart" });

        const pinnedOnly = await runNotes(paste(SLACK), notesHarness({ pinned: [usable("p1", { pinned: true })] }));
        expect(pinnedOnly.seen[0]).toMatchObject({ tier: "smart" });

        const without = await runNotes(paste(SLACK), notesHarness());
        expect(without.seen[0]).toMatchObject({ tier: "fast", model: "claude-haiku-4-5" });

        const switchedOff = await runNotes({ ...paste(SLACK), useNotes: false }, notesHarness({ unpinned: many(2) }));
        expect(switchedOff.seen[0]).toMatchObject({ tier: "fast" });
      });

      it("keeps the fast model when the writer chose fast on purpose", async () => {
        const { seen } = await runNotes({ ...paste(SLACK), speed: "fast" }, notesHarness({ unpinned: many(2) }));
        expect(seen[0]).toMatchObject({ tier: "fast" });
      });

      it("tells the model today's date, but only when it has notes to compare it with", async () => {
        const withNotes = await runNotes(paste(SLACK), notesHarness({ unpinned: many(2) }));
        expect(withNotes.seen[0].messages[0].content).toContain("<today>2026-10-01</today>");
        const without = await runNotes(paste(SLACK), notesHarness());
        expect(without.seen[0].messages[0].content).not.toContain("<today>");
      });

      it("asks the reader only for this request's context, with the notes switched off left out", async () => {
        const h = notesHarness({ unpinned: many(2) });
        await runNotes({ ...paste(SLACK), context: "casual", excludeNoteIds: ["4f1c3b0e-8a52-4a67-9d6f-0c8e1b2a3d44"] }, h);
        expect(h.filters.length).toBeGreaterThan(0);
        for (const filter of h.filters) {
          expect(filter).toEqual({ context: "casual", excludeIds: ["4f1c3b0e-8a52-4a67-9d6f-0c8e1b2a3d44"] });
        }
      });

      it("tells which notes the model used, saves them with the request and keeps the report out of the replies", async () => {
        const h = notesHarness({ pinned: [usable("p1", { pinned: true })], unpinned: [usable("o1"), usable("o2")] });
        const { done, calls } = await runNotes(paste(SLACK), h, { text: `${REPLY_TEXT}\n@@used 3, 1` });

        expect(done.notesUsed).toEqual([
          { id: "o2", text: "EN o2", pinned: false },
          { id: "p1", text: "EN p1", pinned: true },
        ]);
        expect(calls.finished[0].result.noteIds).toEqual(["o2", "p1"]);
        expect(done.options.map((option) => option.variant)).toEqual(["short", "medium", "alt"]);
        expect(JSON.stringify(done.options)).not.toContain("@@used");
      });

      it("counts no note as used when the model reports none, reports an unknown number, or says nothing", async () => {
        for (const text of [`${REPLY_TEXT}\n@@used none`, `${REPLY_TEXT}\n@@used 9`, REPLY_TEXT]) {
          const h = notesHarness({ unpinned: many(2) });
          const { done, calls } = await runNotes(paste(SLACK), h, { text });
          expect(done.notesUsed).toEqual([]);
          expect(calls.finished[0].result.noteIds).toEqual([]);
        }
      });

      it("searches a larger collection by the newest part of the paste, with one embedding request, and offers the nearest", async () => {
        const h = notesHarness({
          unpinned: many(31),
          similar: [similar("near", 0.7), similar("nearer", 0.8), similar("far", 0.1)],
        });
        const { seen, meta } = await runNotes(paste(SLACK), h);

        expect(h.embed).toHaveBeenCalledTimes(1);
        const query = (h.embed.mock.calls[0] as unknown as [string])[0];
        expect(SLACK.endsWith(query)).toBe(true);
        expect(h.searches).toHaveLength(1);
        expect(h.searches[0].slice(0, 2)).toEqual([[0.5, 0.5], "voyage-test"]);
        expect(seen[0].messages[0].content).toContain("<about_me>\n[1] EN nearer\n[2] EN near\n</about_me>");
        expect(meta.notes).toEqual({ status: "ready", offered: 2, suggestions: [] });
      });

      it("keeps the pinned notes and skips the search when the embedding could not be made", async () => {
        const h = notesHarness({ pinned: [usable("p1", { pinned: true })], unpinned: many(31), embedFails: true });
        const { seen, meta, done } = await runNotes(paste(SLACK), h);
        expect(meta.notes).toEqual({ status: "skipped", offered: 1, suggestions: [] });
        expect(h.searches).toEqual([]);
        expect(seen[0].system[1].text).toContain("EN p1");
        expect(seen[0].messages[0].content).not.toContain("<about_me>");
        expect(done.t).toBe("done");
      });

      function memoryWith(h: ReturnType<typeof notesHarness>) {
        const findCandidates = vi.fn(async () => []);
        const memory: MemoryDeps = {
          embedder: h.embedder,
          repo: { findCandidates, saveEmbedding: async () => {}, listNeedingEmbedding: async () => [] },
          afterResponse: () => {},
        };
        return { memory, findCandidates };
      }

      it("serves the memory lookup and the notes search of a long paste with ONE embedding request", async () => {
        const h = notesHarness({ unpinned: many(31), similar: [similar("near", 0.7)] });
        const { memory, findCandidates } = memoryWith(h);
        const longPaste = `Alice: ${"an older line of the chat. ".repeat(60)}Are you free tomorrow?`;
        const { meta } = await runNotes({ ...paste(longPaste), useMemory: true }, h, { memory });

        expect(h.embed).not.toHaveBeenCalled();
        expect(h.embedMany).toHaveBeenCalledTimes(1);
        const texts = (h.embedMany.mock.calls[0] as unknown as [string[]])[0];
        expect(texts).toHaveLength(2);
        // Memory looks at the newest 1,500 characters, notes at the newest 600.
        expect(texts[0].length).toBeGreaterThan(texts[1].length);
        expect(texts[1].endsWith("Are you free tomorrow?")).toBe(true);
        // The memory lookup used the first vector and the notes search the second.
        expect(findCandidates.mock.calls[0]).toEqual([[1, 1], expect.anything(), expect.anything()]);
        expect(h.searches[0][0]).toEqual([2, 2]);
        expect(meta.notes?.status).toBe("ready");
      });

      it("uses a single embedding when the memory lookup and the notes search want the same text", async () => {
        const h = notesHarness({ unpinned: many(31), similar: [similar("near", 0.7)] });
        const { memory } = memoryWith(h);
        await runNotes({ ...paste(SLACK), useMemory: true }, h, { memory });
        expect(h.embed).toHaveBeenCalledTimes(1);
        expect(h.embedMany).not.toHaveBeenCalled();
      });

      it("reports an empty collection, and still answers", async () => {
        const h = notesHarness();
        const { meta, done, seen } = await runNotes(paste(SLACK), h);
        expect(meta.notes).toEqual({ status: "empty", offered: 0, suggestions: [] });
        expect(done.notesUsed).toEqual([]);
        expect(seen[0].system).toHaveLength(1);
      });

      it("answers, without notes, when they cannot be read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const h = notesHarness({ failList: true });
        const { meta, done, seen } = await runNotes(paste(SLACK), h);
        expect(meta.notes?.status).toBe("skipped");
        expect(done.t).toBe("done");
        expect(seen[0].messages[0].content).not.toContain("<about_me>");
      });

      it("keeps the cached prefix the same from one request to the next while the pinned notes do not change", async () => {
        const pinned = [usable("p1", { pinned: true }), usable("p2", { pinned: true })];
        const first = await runNotes(paste(SLACK), notesHarness({ pinned, unpinned: many(2) }));
        const second = await runNotes({ ...paste("Alice: A different question?"), context: "work" }, notesHarness({ pinned, unpinned: many(5) }));
        expect(JSON.stringify(second.seen[0].system)).toBe(JSON.stringify(first.seen[0].system));
      });
    });

    describe("a typed idea", () => {
      const idea = "Tôi cũng sống ở chung cư";
      const typed = (extra: Partial<GenerateBody> = {}): Partial<GenerateBody> => ({ mode: "vi_to_en", input: idea, ...extra });

      it("puts no note in the replies, and suggests the nearest ones as chips", async () => {
        const h = notesHarness({
          unpinned: many(3),
          similar: [similar("flat", 0.7, { textEn: "I moved from my old flat in September." }), similar("far", 0.1)],
        });
        const { seen, meta, done } = await runNotes(typed(), h);

        expect(seen[0].messages[0].content).not.toContain("<about_me>");
        expect(meta.notes).toEqual({
          status: "ready",
          offered: 0,
          suggestions: [{ id: "flat", text: "I moved from my old flat in September.", pinned: false }],
        });
        expect(h.embed).toHaveBeenCalledTimes(1);
        expect((h.embed.mock.calls[0] as unknown as [string])[0]).toBe(idea);
        // No report is expected for a typed idea, so none is read.
        expect(done.notesUsed).toBeUndefined();
      });

      it("uses one embedding request when the memory lookup wants the same text", async () => {
        const h = notesHarness({ unpinned: many(3), similar: [similar("flat", 0.7)] });
        const memory: MemoryDeps = {
          embedder: h.embedder,
          repo: { findCandidates: async () => [], saveEmbedding: async () => {}, listNeedingEmbedding: async () => [] },
          afterResponse: () => {},
        };
        await runNotes(typed({ useMemory: true }), h, { memory });
        expect(h.embed).toHaveBeenCalledTimes(1);
        expect(h.embedMany).not.toHaveBeenCalled();
      });

      it("makes no suggestion, and no embedding request, when there are no notes", async () => {
        const h = notesHarness();
        const { meta } = await runNotes(typed(), h);
        expect(meta.notes).toEqual({ status: "empty", offered: 0, suggestions: [] });
        expect(h.embed).not.toHaveBeenCalled();
      });

      it("makes no suggestion when the embedding could not be made", async () => {
        const h = notesHarness({ unpinned: many(3), embedFails: true });
        const { meta } = await runNotes(typed(), h);
        expect(meta.notes).toEqual({ status: "skipped", offered: 0, suggestions: [] });
      });
    });

    it("touches nothing about notes when the switch is off", async () => {
      const h = notesHarness({ pinned: [usable("p1", { pinned: true })], unpinned: many(2) });
      const { seen, meta, done } = await runNotes({ ...paste(SLACK), useNotes: false }, h);
      expect(h.filters).toEqual([]);
      expect(h.embed).not.toHaveBeenCalled();
      expect(meta.notes).toBeUndefined();
      expect(done.notesUsed).toBeUndefined();
      expect(seen[0].system).toHaveLength(1);
      expect(seen[0].messages[0].content).not.toContain("<about_me>");
    });

    it("is not used at all on a server that has no notes set up", async () => {
      const repoSetup = fakeRepo();
      const { stream } = fakeStream([finalPart()]);
      const result = await startGeneration({ ...BODY, useNotes: true }, deps({ repo: repoSetup.repo, stream }));
      if (!result.ok) throw new Error("expected a stream");
      const evs = await readEvents(result.stream);
      expect((evs[0] as Extract<ReplyStreamEvent, { t: "meta" }>).notes).toBeUndefined();
    });
  });
});

describe("style profile", () => {
  const PROFILE = { id: "profile-7", rules: "- Use short sentences.\n- Say 'ok', not 'okay'." };

  async function runWith(styles: StyleDeps | undefined, repoSetup = fakeRepo()) {
    const { stream, seen } = fakeStream([finalPart()]);
    const result = await startGeneration(BODY, deps({ repo: repoSetup.repo, stream, styles }));
    if (!result.ok) throw new Error("expected a stream");
    const evs = await readEvents(result.stream);
    return { seen, calls: repoSetup.calls, evs };
  }

  it("adds the active profile as a second cached block and records which one was used", async () => {
    const { seen, calls } = await runWith({ getActive: async () => PROFILE });
    expect(seen[0].system).toHaveLength(2);
    expect(seen[0].system[1].text).toContain("- Use short sentences.");
    expect(seen[0].system[1].cache_control).toEqual({ type: "ephemeral" });
    expect(calls.created[0].styleProfileId).toBe("profile-7");
  });

  it("leaves the first block exactly as it is without a profile", async () => {
    const withProfile = await runWith({ getActive: async () => PROFILE });
    const without = await runWith({ getActive: async () => null });
    expect(without.seen[0].system).toHaveLength(1);
    expect(without.seen[0].system[0]).toEqual(withProfile.seen[0].system[0]);
    expect(without.calls.created[0].styleProfileId).toBeUndefined();
  });

  it("works when the server has no style profile support at all", async () => {
    const { seen, calls } = await runWith(undefined);
    expect(seen[0].system).toHaveLength(1);
    expect(calls.created[0].styleProfileId).toBeUndefined();
  });

  it("carries on without the profile when it cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { seen, evs } = await runWith({
      getActive: async () => {
        throw new Error("db down");
      },
    });
    expect(seen[0].system).toHaveLength(1);
    expect(evs.at(-1)?.t).toBe("done");
  });

  it("reads the profile while the other checks run", async () => {
    const order: string[] = [];
    const repoSetup = fakeRepo();
    const original = repoSetup.repo.spentTodayUsd;
    repoSetup.repo.spentTodayUsd = async (now) => {
      order.push("budget");
      return original(now);
    };
    await runWith(
      {
        getActive: async () => {
          order.push("profile");
          return PROFILE;
        },
      },
      repoSetup,
    );
    expect(order.slice(0, 2)).toEqual(["profile", "budget"]);
  });
});
