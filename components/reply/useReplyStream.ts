"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { createLineSplitter } from "@/lib/reply/ndjson";
import type { GenerateBody, RefineBody } from "@/lib/reply/schemas";
import { createOptionParser } from "@/lib/reply/stream-parser";
import {
  INITIAL_STREAM_STATE,
  replyStreamReducer,
  type ReplyStreamState,
} from "@/lib/reply/stream-state";
import type { ReplyStreamEvent } from "@/lib/reply/types";

// The request body as the form builds it, before server-side validation.
export type GenerateRequest = Pick<GenerateBody, "mode" | "input" | "context" | "speed" | "learn" | "useMemory"> &
  Partial<Pick<GenerateBody, "better" | "parentGenerationId" | "conversationId" | "explain" | "useNotes" | "excludeNoteIds">>;

// A request to develop one reply; the server reads everything else from the stored request.
export type RefineRequest = RefineBody;

type DoneEvent = Extract<ReplyStreamEvent, { t: "done" }>;
type MetaEvent = Extract<ReplyStreamEvent, { t: "meta" }>;

export interface StreamCallbacks {
  // The server has accepted the request (and, for a pasted conversation, added it to the thread).
  onMeta?: (event: MetaEvent) => void;
  onDone?: (event: DoneEvent, generationId: string) => void;
}

async function readFailure(res: Response): Promise<string> {
  if (res.status === 401) return "Phiên đăng nhập đã hết hạn. Hãy tải lại trang để đăng nhập lại.";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON; fall through to the generic message.
  }
  return "Không kết nối được với Reply Assistant. Bạn thử lại nhé.";
}

function parseEvent(line: string): ReplyStreamEvent | null {
  try {
    const value = JSON.parse(line) as { t?: unknown };
    return typeof value.t === "string" ? (value as ReplyStreamEvent) : null;
  } catch {
    return null;
  }
}

export function useReplyStream(callbacks: StreamCallbacks = {}): {
  state: ReplyStreamState;
  start: (request: GenerateRequest | RefineRequest) => Promise<void>;
  cancel: () => void;
} {
  const [state, dispatch] = useReducer(replyStreamReducer, INITIAL_STREAM_STATE);
  const abortRef = useRef<AbortController | null>(null);
  // The latest callbacks, without making `start` change on every render.
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "cancel" });
  }, []);

  // Leaving the page must not leave a model call running for nobody.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async (request: GenerateRequest | RefineRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "start" });

    const parser = createOptionParser();
    const splitter = createLineSplitter();
    let finished = false;
    let generationId = "";

    const handle = (event: ReplyStreamEvent) => {
      switch (event.t) {
        case "meta":
          generationId = event.generationId;
          callbacksRef.current.onMeta?.(event);
          dispatch({
            type: "meta",
            meta: {
              generationId: event.generationId,
              model: event.model,
              tier: event.tier,
              memoryStatus: event.memoryStatus,
              memories: event.memories,
              thread: event.thread,
              notes: event.notes,
            },
          });
          break;
        case "delta":
          dispatch({ type: "options", options: parser.push(event.text) });
          break;
        case "explain":
          dispatch({ type: "explain", text: event.text });
          break;
        case "done":
          finished = true;
          dispatch({ type: "done", event });
          callbacksRef.current.onDone?.(event, generationId);
          break;
        case "error":
          finished = true;
          dispatch({ type: "error", message: event.message, retryable: event.retryable });
          break;
      }
    };

    try {
      const res = await fetch("/api/reply/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        dispatch({ type: "error", message: await readFailure(res), retryable: res.status >= 500 });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of splitter.push(decoder.decode(value, { stream: true }))) {
          const event = parseEvent(line);
          if (event) handle(event);
        }
      }
      for (const line of splitter.flush()) {
        const event = parseEvent(line);
        if (event) handle(event);
      }
      if (!finished) {
        dispatch({
          type: "error",
          message: "Kết nối bị ngắt trước khi viết xong các bản nháp. Bạn thử lại nhé.",
          retryable: true,
        });
      }
    } catch {
      // An abort is the user's own cancel or a newer request; anything else is a network failure.
      if (!controller.signal.aborted) {
        dispatch({
          type: "error",
          message: "Không kết nối được với Reply Assistant. Hãy kiểm tra kết nối rồi thử lại.",
          retryable: true,
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  return { state, start, cancel };
}
