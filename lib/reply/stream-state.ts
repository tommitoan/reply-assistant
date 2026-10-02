import type { MemoryRef, MemoryStatus, ModelTier, NoteRef, NotesStatus, ReplyOptionDraft, ReplyStreamEvent } from "./types";

type DoneEvent = Extract<ReplyStreamEvent, { t: "done" }>;

export interface ReplyStreamState {
  status: "idle" | "streaming" | "done" | "error";
  meta: {
    generationId: string;
    model: string;
    tier: ModelTier;
    memoryStatus: MemoryStatus;
    memories: MemoryRef[];
    // What a pasted conversation did to the thread; absent outside threads.
    thread?: { added: number; skipped: number };
    // What the writer's notes did; absent when the switch was off.
    notes?: { status: NotesStatus; offered: number; suggestions: NoteRef[] };
  } | null;
  // Options as parsed so far while streaming; replaced by the saved options
  // (with ids) once the stream is done.
  options: ReplyOptionDraft[];
  done: DoneEvent | null;
  // Vietnamese translation and notes on the pasted message, once it arrives.
  explanation: string | null;
  error: { message: string; retryable: boolean } | null;
}

export type ReplyStreamAction =
  | { type: "start" }
  | { type: "meta"; meta: NonNullable<ReplyStreamState["meta"]> }
  | { type: "options"; options: ReplyOptionDraft[] }
  | { type: "explain"; text: string }
  | { type: "done"; event: DoneEvent }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "cancel" };

export const INITIAL_STREAM_STATE: ReplyStreamState = {
  status: "idle",
  meta: null,
  options: [],
  done: null,
  explanation: null,
  error: null,
};

export function replyStreamReducer(
  state: ReplyStreamState,
  action: ReplyStreamAction,
): ReplyStreamState {
  switch (action.type) {
    case "start":
      return { ...INITIAL_STREAM_STATE, status: "streaming" };
    case "meta":
      return { ...state, meta: action.meta };
    case "options":
      return state.status === "streaming" ? { ...state, options: action.options } : state;
    case "explain":
      // It can arrive after the replies are done, but never before a request started.
      return state.status === "idle" ? state : { ...state, explanation: action.text };
    case "done":
      return {
        ...state,
        status: "done",
        options: action.event.options.map(({ variant, text }) => ({ variant, text })),
        done: action.event,
      };
    case "error":
      // Keep whatever options already arrived; they may still be usable.
      return { ...state, status: "error", error: { message: action.message, retryable: action.retryable } };
    case "cancel":
      return state.status === "streaming" ? { ...state, status: "idle" } : state;
  }
}
