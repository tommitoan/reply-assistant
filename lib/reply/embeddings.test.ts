// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbedLimiter } from "./embed-limiter";
import { createLimitedEmbedder, createVoyageEmbedder, type Embedder } from "./embeddings";
import { EMBEDDING_DIMENSIONS } from "./schema";

const VECTOR = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i % 7) / 10);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function embedderWith(fetchImpl: typeof fetch, timeoutMs?: number) {
  return createVoyageEmbedder({ apiKey: "test-key-123", model: "voyage-3.5-lite", fetchImpl, timeoutMs });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createVoyageEmbedder", () => {
  it("sends the text to Voyage and returns the vector", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: VECTOR }] }));
    const result = await embedderWith(fetchImpl as unknown as typeof fetch).embed("Mình sẽ đến muộn.");

    expect(result).toEqual(VECTOR);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key-123");
    expect(JSON.parse(init.body)).toEqual({
      input: ["Mình sẽ đến muộn."],
      model: "voyage-3.5-lite",
      output_dimension: EMBEDDING_DIMENSIONS,
    });
  });

  it("leaves out input_type so stored and new inputs are embedded the same way", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: VECTOR }] }));
    await embedderWith(fetchImpl as unknown as typeof fetch).embed("x");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty("input_type");
  });

  it("exposes the model so stored vectors can be tagged with it", () => {
    expect(embedderWith(vi.fn() as unknown as typeof fetch).model).toBe("voyage-3.5-lite");
  });

  it("returns null when Voyage answers with an error status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: "bad key" }, 401));
    expect(await embedderWith(fetchImpl as unknown as typeof fetch).embed("x")).toBeNull();
  });

  it("returns null for a response without a usable embedding", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const body of [{}, { data: [] }, { data: [{}] }, { data: [{ embedding: "nope" }] }]) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
      expect(await embedderWith(fetchImpl as unknown as typeof fetch).embed("x")).toBeNull();
    }
  });

  it("returns null when the vector has the wrong width or non-numbers in it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const short = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: [0.1, 0.2] }] }));
    expect(await embedderWith(short as unknown as typeof fetch).embed("x")).toBeNull();

    const broken = [...VECTOR];
    broken[3] = null as unknown as number;
    const withNull = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: broken }] }));
    expect(await embedderWith(withNull as unknown as typeof fetch).embed("x")).toBeNull();
  });

  it("returns null when the network call throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
    expect(await embedderWith(fetchImpl as unknown as typeof fetch).embed("x")).toBeNull();
  });

  it("gives up after the timeout instead of waiting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hanging = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    const started = Date.now();
    const result = await embedderWith(hanging as unknown as typeof fetch, 30).embed("x");
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("never logs the key or the text it was given", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn().mockResolvedValue(jsonResponse({ detail: "echo: private words" }, 500));
    await embedderWith(failing as unknown as typeof fetch).embed("private words");
    const rejected = vi.fn().mockRejectedValue(new Error("private words test-key-123"));
    await embedderWith(rejected as unknown as typeof fetch).embed("private words");

    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("private words");
    expect(logged).not.toContain("test-key-123");
  });
});

describe("embedding usage", () => {
  it("reports the tokens Voyage billed", async () => {
    const onUsage = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: VECTOR }], usage: { total_tokens: 42 } }));
    const embedder = createVoyageEmbedder({ apiKey: "k", model: "voyage-3.5-lite", fetchImpl: fetchImpl as unknown as typeof fetch, onUsage });
    await embedder.embed("hello");
    expect(onUsage).toHaveBeenCalledWith(42);
  });

  it("reports nothing when the response has no usage, or the call failed", async () => {
    const onUsage = vi.fn();
    const ok = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: VECTOR }] }));
    await createVoyageEmbedder({ apiKey: "k", model: "m", fetchImpl: ok as unknown as typeof fetch, onUsage }).embed("a");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn().mockResolvedValue(jsonResponse({}, 429));
    await createVoyageEmbedder({ apiKey: "k", model: "m", fetchImpl: failing as unknown as typeof fetch, onUsage }).embed("a");
    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe("embedMany", () => {
  const other = VECTOR.map((value) => value + 0.01);

  it("sends all the texts in one request and returns the vectors in order", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ embedding: VECTOR, index: 0 }, { embedding: other, index: 1 }], usage: { total_tokens: 9 } }));
    const result = await embedderWith(fetchImpl as unknown as typeof fetch).embedMany(["một", "hai"]);

    expect(result).toEqual([VECTOR, other]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      input: ["một", "hai"],
      model: "voyage-3.5-lite",
      output_dimension: EMBEDDING_DIMENSIONS,
    });
  });

  it("puts the results back in input order when the provider sends them shuffled", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ embedding: other, index: 1 }, { embedding: VECTOR, index: 0 }] }));
    expect(await embedderWith(fetchImpl as unknown as typeof fetch).embedMany(["a", "b"])).toEqual([VECTOR, other]);
  });

  it("gives up after a shorter timeout when one is asked for", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const slow = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")));
      }),
    );
    const started = Date.now();
    const result = await embedderWith(slow as unknown as typeof fetch).embedMany(["a", "b"], { timeoutMs: 40 });
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("makes no request for no texts", async () => {
    const fetchImpl = vi.fn();
    expect(await embedderWith(fetchImpl as unknown as typeof fetch).embedMany([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null, not a partial result, when anything is wrong", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const status = vi.fn().mockResolvedValue(jsonResponse({}, 429));
    expect(await embedderWith(status as unknown as typeof fetch).embedMany(["a", "b"])).toBeNull();

    const fewer = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: VECTOR, index: 0 }] }));
    expect(await embedderWith(fewer as unknown as typeof fetch).embedMany(["a", "b"])).toBeNull();

    const badWidth = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: VECTOR, index: 0 }, { embedding: [1, 2], index: 1 }] }));
    expect(await embedderWith(badWidth as unknown as typeof fetch).embedMany(["a", "b"])).toBeNull();

    const thrown = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await embedderWith(thrown as unknown as typeof fetch).embedMany(["a", "b"])).toBeNull();
  });

  it("reports the tokens of a batch once", async () => {
    const onUsage = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ embedding: VECTOR, index: 0 }, { embedding: other, index: 1 }], usage: { total_tokens: 77 } }));
    const embedder = createVoyageEmbedder({ apiKey: "k", model: "m", fetchImpl: fetchImpl as unknown as typeof fetch, onUsage });
    await embedder.embedMany(["a", "b"]);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(77);
  });

  it("never logs the texts or the key", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args.join(" ")));
    const fetchImpl = vi.fn().mockRejectedValue(new Error("secret diary line test-key-123"));
    await embedderWith(fetchImpl as unknown as typeof fetch).embedMany(["secret diary line"]);
    expect(logged.join(" ")).not.toContain("secret diary line");
    expect(logged.join(" ")).not.toContain("test-key-123");
  });
});

describe("createLimitedEmbedder", () => {
  function inner() {
    const embed = vi.fn(async () => VECTOR);
    const embedMany = vi.fn(async (texts: string[]) => texts.map(() => VECTOR));
    const embedder: Embedder = { model: "m", embed, embedMany };
    return { embedder, embed, embedMany };
  }
  const limiterOf = (rpm: number, tpm = 10_000) => createEmbedLimiter({ rpm, tpm });

  it("passes calls through while they fit and keeps the model", async () => {
    const { embedder, embed, embedMany } = inner();
    const limited = createLimitedEmbedder(embedder, limiterOf(3), "foreground");
    expect(limited.model).toBe("m");
    expect(await limited.embed("a")).toEqual(VECTOR);
    expect(await limited.embedMany(["a", "b"])).toEqual([VECTOR, VECTOR]);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embedMany).toHaveBeenCalledTimes(1);
  });

  it("resolves null without calling the provider once the budget is spent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { embedder, embed, embedMany } = inner();
    const limited = createLimitedEmbedder(embedder, limiterOf(2), "foreground");
    await limited.embed("a");
    await limited.embedMany(["a"]);
    expect(await limited.embed("c")).toBeNull();
    expect(await limited.embedMany(["c"])).toBeNull();
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embedMany).toHaveBeenCalledTimes(1);
  });

  it("counts a call of any kind against the same budget", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { embedder } = inner();
    const limiter = limiterOf(3);
    const foreground = createLimitedEmbedder(embedder, limiter, "foreground");
    const background = createLimitedEmbedder(embedder, limiter, "background");
    expect(await background.embed("a")).toEqual(VECTOR);
    expect(await background.embed("b")).toEqual(VECTOR);
    // The last request belongs to the foreground.
    expect(await background.embed("c")).toBeNull();
    expect(await foreground.embed("c")).toEqual(VECTOR);
  });

  it("refuses a call that is too large for the token budget, and says only its size", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args.join(" ")));
    const { embedder, embedMany } = inner();
    const limited = createLimitedEmbedder(embedder, limiterOf(3, 1000), "foreground");
    expect(await limited.embedMany(["secret diary line ".repeat(200)])).toBeNull();
    expect(embedMany).not.toHaveBeenCalled();
    expect(logged.join(" ")).toContain("foreground");
    expect(logged.join(" ")).not.toContain("secret diary line");
  });

  it("makes no call and uses no budget for an empty batch", async () => {
    const { embedder, embedMany } = inner();
    const limiter = limiterOf(1);
    const limited = createLimitedEmbedder(embedder, limiter, "foreground");
    expect(await limited.embedMany([])).toEqual([]);
    expect(embedMany).not.toHaveBeenCalled();
    expect(limiter.waitMs("foreground", 1)).toBe(0);
  });
});
