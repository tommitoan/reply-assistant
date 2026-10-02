import { describe, expect, it } from "vitest";
import { INITIAL_STREAM_STATE, replyStreamReducer, type ReplyStreamState } from "./stream-state";
import type { ReplyStreamEvent } from "./types";

type DoneEvent = Extract<ReplyStreamEvent, { t: "done" }>;

const DONE: DoneEvent = {
  t: "done",
  options: [{ id: "o1", variant: "short", text: "Final text." }],
  usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  costUsd: 0.001,
  firstTokenMs: 500,
  totalMs: 900,
  stopReason: "end_turn",
};

function streaming(): ReplyStreamState {
  return replyStreamReducer(INITIAL_STREAM_STATE, { type: "start" });
}

describe("replyStreamReducer", () => {
  it("starts from a clean streaming state", () => {
    const dirty: ReplyStreamState = {
      ...INITIAL_STREAM_STATE,
      status: "error",
      error: { message: "old", retryable: false },
      options: [{ variant: "short", text: "old" }],
    };
    expect(replyStreamReducer(dirty, { type: "start" })).toEqual({ ...INITIAL_STREAM_STATE, status: "streaming" });
  });

  it("tracks metadata and streamed options", () => {
    let state = streaming();
    state = replyStreamReducer(state, {
      type: "meta",
      meta: { generationId: "g1", model: "claude-haiku-4-5", tier: "fast", memoryStatus: "off", memories: [] },
    });
    state = replyStreamReducer(state, { type: "options", options: [{ variant: "short", text: "Hel" }] });
    expect(state.meta?.generationId).toBe("g1");
    expect(state.options).toEqual([{ variant: "short", text: "Hel" }]);
  });

  it("replaces streamed text with the saved options when done", () => {
    let state = streaming();
    state = replyStreamReducer(state, { type: "options", options: [{ variant: "short", text: "Draft" }] });
    state = replyStreamReducer(state, { type: "done", event: DONE });
    expect(state.status).toBe("done");
    expect(state.options).toEqual([{ variant: "short", text: "Final text." }]);
    expect(state.done).toBe(DONE);
  });

  it("keeps partial options when an error arrives", () => {
    let state = streaming();
    state = replyStreamReducer(state, { type: "options", options: [{ variant: "short", text: "Partial" }] });
    state = replyStreamReducer(state, { type: "error", message: "Dropped", retryable: true });
    expect(state.status).toBe("error");
    expect(state.error).toEqual({ message: "Dropped", retryable: true });
    expect(state.options).toHaveLength(1);
  });

  it("ignores late option updates after the stream has ended", () => {
    let state = streaming();
    state = replyStreamReducer(state, { type: "done", event: DONE });
    const after = replyStreamReducer(state, { type: "options", options: [{ variant: "alt", text: "late" }] });
    expect(after).toBe(state);
  });

  it("returns to idle on cancel only while streaming", () => {
    expect(replyStreamReducer(streaming(), { type: "cancel" }).status).toBe("idle");
    const done = replyStreamReducer(streaming(), { type: "done", event: DONE });
    expect(replyStreamReducer(done, { type: "cancel" })).toBe(done);
  });
});

describe("explanation", () => {
  it("keeps the explanation while the replies stream and after they finish", () => {
    let state = replyStreamReducer(streaming(), { type: "explain", text: "Dịch: xin chào" });
    expect(state.explanation).toBe("Dịch: xin chào");
    state = replyStreamReducer(state, { type: "done", event: DONE });
    expect(state.explanation).toBe("Dịch: xin chào");
  });

  it("accepts an explanation that arrives after the replies are done", () => {
    const done = replyStreamReducer(streaming(), { type: "done", event: DONE });
    expect(replyStreamReducer(done, { type: "explain", text: "late" }).explanation).toBe("late");
  });

  it("clears it when a new request starts", () => {
    const withText = replyStreamReducer(streaming(), { type: "explain", text: "old" });
    expect(replyStreamReducer(withText, { type: "start" }).explanation).toBeNull();
  });

  it("ignores one that arrives when nothing was asked", () => {
    expect(replyStreamReducer(INITIAL_STREAM_STATE, { type: "explain", text: "stray" }).explanation).toBeNull();
  });
});
