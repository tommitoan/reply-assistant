"use client";

import { useEffect, useState } from "react";
import { EMPTY_FEEDBACK } from "@/lib/reply/feedback-state";
import { formatMetaLine } from "@/lib/reply/format";
import { MAX_INPUT_CHARS, MAX_PASTE_CHARS } from "@/lib/reply/limits";
import type { ConversationDetail, ReplyContext, ReplyMode } from "@/lib/reply/types";
import DevelopableOption from "./DevelopableOption";
import ExplainBox from "./ExplainBox";
import MemoryDisclosure from "./MemoryDisclosure";
import NotesDisclosure from "./NotesDisclosure";
import RecentGenerations from "./RecentGenerations";
import ReplyControls from "./ReplyControls";
import ReplyOptionCard from "./ReplyOptionCard";
import ThreadNotice from "./ThreadNotice";
import { useOptionFeedback } from "./useOptionFeedback";
import { useReplySettings } from "./useReplySettings";
import { useReplyStream, type GenerateRequest } from "./useReplyStream";
import { warmReplyCache } from "./warm";

// Things people often want to say, to start from. Clicking one fills the box.
const STARTERS = [
  "Cảm ơn bạn, mình sẽ xem và phản hồi trong chiều nay.",
  "Xin lỗi vì trả lời muộn, mấy hôm nay mình hơi bận.",
  "Cuối tuần này bạn rảnh không? Mình đi uống cà phê nhé.",
  "Mình cần thêm một ngày để kiểm tra lại số liệu.",
] as const;

export default function ReplyComposer({
  conversation,
  onThreadChanged,
  onContextChange,
}: {
  // The thread replies are written in, or null for "Quick translate".
  conversation: ConversationDetail | null;
  // Called when the thread's messages changed (a paste was added, a reply was used).
  onThreadChanged: () => void;
  onContextChange: (context: ReplyContext) => void;
}) {
  const [input, setInput] = useState("");
  // Inside a thread: paste their message (English) or type an idea (Vietnamese).
  const [threadInput, setThreadInput] = useState<"paste" | "idea">("paste");
  // What "Better" redoes: the last request that was actually sent.
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);
  const [settings, updateSettings] = useReplySettings();
  // A used or edited reply changes the thread's own messages.
  const feedback = useOptionFeedback((_id, patch) => {
    if (conversation && (patch.chosen !== undefined || patch.editedText !== undefined)) onThreadChanged();
  });
  const { load } = feedback;
  const { state, start, cancel } = useReplyStream({
    onMeta: (event) => {
      // The server has added the pasted conversation to the thread.
      if (event.thread) {
        setInput("");
        onThreadChanged();
      }
    },
    onDone: (event, generationId) => {
      load(event.options.map((option) => ({ id: option.id, generationId, ...EMPTY_FEEDBACK })));
    },
  });

  const mode: ReplyMode = conversation && threadInput === "paste" ? "en_reply" : "vi_to_en";
  const limit = mode === "en_reply" ? MAX_PASTE_CHARS : MAX_INPUT_CHARS;
  const context = conversation?.context ?? settings.context;

  const streaming = state.status === "streaming";
  const trimmedLength = input.trim().length;
  const canSubmit = !streaming && trimmedLength > 0 && input.length <= limit;
  const canRedo = !streaming && state.done !== null && state.meta !== null && lastRequest !== null;

  // The first request after a quiet spell pays for writing the prompt cache.
  // Doing it on page load hides that cost.
  useEffect(() => {
    warmReplyCache(context);
  }, [context]);

  function submit() {
    if (!canSubmit) return;
    const request: GenerateRequest = {
      mode,
      input: input.trim(),
      context,
      speed: settings.speed,
      learn: settings.learn,
      useMemory: settings.useMemory,
      useNotes: settings.useNotes,
      conversationId: conversation?.id,
      ...(mode === "en_reply" ? { explain: settings.explain } : {}),
    };
    setLastRequest(request);
    void start(request);
  }

  function redoBetter() {
    if (!canRedo || !lastRequest || !state.meta) return;
    void start({
      ...lastRequest,
      speed: "smart",
      better: true,
      // The message was explained the first time.
      explain: false,
      parentGenerationId: state.meta.generationId,
    });
  }

  // "Don't use this one": the same request again, without that note.
  function redoWithoutNote(noteId: string) {
    if (!canRedo || !lastRequest || !state.meta) return;
    const request: GenerateRequest = {
      ...lastRequest,
      excludeNoteIds: [...new Set([...(lastRequest.excludeNoteIds ?? []), noteId])],
      // The message was explained the first time.
      explain: false,
      parentGenerationId: state.meta.generationId,
    };
    // Kept, so a second note left out adds to the first.
    setLastRequest(request);
    void start(request);
  }

  // Once the stream is done the options have ids, and feedback can be saved.
  const cards = state.done
    ? state.done.options.map((option) => ({ key: option.id, id: option.id, variant: option.variant, text: option.text }))
    : state.options.map((option, index) => ({
        key: `${index}-${option.variant}`,
        id: null,
        variant: option.variant,
        text: option.text,
      }));

  const suggestedNotes =
    state.done && lastRequest?.mode === "vi_to_en" ? (state.meta?.notes?.suggestions ?? []) : [];
  const suggestionTarget = Math.max(0, cards.findIndex((card) => card.variant === "medium"));

  return (
    <div className="space-y-5">
      {conversation && (
        <div role="group" aria-label="What to write" className="flex gap-2">
          {(
            [
              ["paste", "📋 Paste their message"],
              ["idea", "✍️ Ý tiếng Việt"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={streaming}
              aria-pressed={threadInput === value}
              onClick={() => setThreadInput(value)}
              className={`rounded-full border px-3.5 py-1 text-sm font-medium transition disabled:opacity-60 ${
                threadInput === value
                  ? "border-accent-300 bg-accent-100 text-accent-900 dark:border-accent-700 dark:bg-accent-900/50 dark:text-accent-100"
                  : "border-stone-300 bg-white text-stone-600 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-3xl border border-stone-200 bg-white p-3 shadow-sm transition focus-within:border-accent-300 focus-within:ring-4 focus-within:ring-accent-100/70 dark:border-stone-700 dark:bg-stone-800 dark:focus-within:border-accent-700 dark:focus-within:ring-accent-900/40">
        <label htmlFor="reply-input" className="sr-only">
          {mode === "en_reply" ? "The conversation or their latest message, in English" : "What you want to say, in Vietnamese"}
        </label>
        <textarea
          id="reply-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => warmReplyCache(context)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          rows={mode === "en_reply" ? 7 : 4}
          placeholder={
            mode === "en_reply"
              ? "Paste the chat or just their newest message. Earlier lines that are already in this conversation are skipped."
              : "Bạn muốn nói gì? Gõ ý tiếng Việt ở đây…"
          }
          className="w-full resize-none bg-transparent px-3 pb-1 pt-2 text-[16px] leading-relaxed text-stone-800 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
        />

        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-1">
          <div className="min-w-0 flex-1">
            <ReplyControls
              settings={{ ...settings, context }}
              onChange={({ context: nextContext, ...rest }) => {
                // Inside a thread the context belongs to the thread.
                if (nextContext !== undefined) {
                  if (conversation) onContextChange(nextContext);
                  else updateSettings({ context: nextContext });
                }
                if (Object.keys(rest).length > 0) updateSettings(rest);
              }}
              disabled={streaming}
              showExplain={mode === "en_reply"}
            />
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`hidden text-xs sm:inline ${
                input.length > limit ? "text-red-600 dark:text-red-400" : "text-stone-400 dark:text-stone-500"
              }`}
            >
              {input.length} / {limit}
            </span>
            {streaming && (
              <button
                type="button"
                onClick={cancel}
                className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700"
              >
                Stop
              </button>
            )}
            {canRedo && (
              <button
                type="button"
                onClick={redoBetter}
                aria-label="Better: write these again with the careful model"
                title="Write these again with the careful model"
                className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700"
              >
                🎯 Better
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              aria-label={streaming ? "Writing…" : mode === "en_reply" ? "Suggest replies" : "Write replies"}
              title={`${mode === "en_reply" ? "Suggest replies" : "Write replies"} (Ctrl/⌘ + Enter)`}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-600 text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500 dark:disabled:bg-stone-700 dark:disabled:text-stone-500"
            >
              {streaming ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {mode === "vi_to_en" && input === "" && state.status === "idle" && (
        <div role="group" aria-label="Examples" className="flex flex-wrap justify-center gap-2">
          {STARTERS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setInput(example)}
              className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-[13px] text-stone-600 transition hover:border-accent-300 hover:bg-accent-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-accent-700 dark:hover:bg-stone-700"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {state.error.message}
        </p>
      )}

      {state.meta?.thread && <ThreadNotice added={state.meta.thread.added} skipped={state.meta.thread.skipped} />}

      {(state.explanation || (streaming && lastRequest?.explain && lastRequest.mode === "en_reply")) && (
        <ExplainBox text={state.explanation} />
      )}

      {state.meta && <MemoryDisclosure status={state.meta.memoryStatus} memories={state.meta.memories} />}

      {state.meta && lastRequest && (
        <NotesDisclosure
          mode={lastRequest.mode}
          notes={state.meta.notes}
          used={state.done?.notesUsed}
          disabled={streaming}
          onLeaveOut={redoWithoutNote}
        />
      )}

      {cards.length > 0 && (
        <section aria-label="Reply options" aria-live="polite" className="space-y-3">
          {cards.map((card, index) =>
            card.id && state.meta ? (
              <DevelopableOption
                key={card.key}
                option={{ id: card.id, generationId: state.meta.generationId, variant: card.variant, text: card.text }}
                store={feedback}
                settings={{ speed: settings.speed, learn: settings.learn }}
                // Notes that fit a typed idea are suggested under one reply (the medium one).
                suggestions={index === suggestionTarget ? suggestedNotes : undefined}
              />
            ) : (
              <ReplyOptionCard
                key={card.key}
                variant={card.variant}
                text={card.text}
                streaming={streaming && index === cards.length - 1}
              />
            ),
          )}
        </section>
      )}

      {state.done && state.meta && (
        <p className="text-xs text-stone-400 dark:text-stone-500">
          {formatMetaLine({
            model: state.meta.model,
            firstTokenMs: state.done.firstTokenMs,
            totalMs: state.done.totalMs,
            costUsd: state.done.costUsd,
          })}{" "}
          (cost is an estimate)
        </p>
      )}

      <RecentGenerations
        scope={conversation?.id ?? "none"}
        refreshKey={state.status === "done" ? (state.meta?.generationId ?? null) : null}
        excludeId={state.meta?.generationId ?? null}
        store={feedback}
        develop={{ speed: settings.speed, learn: settings.learn }}
      />
    </div>
  );
}
