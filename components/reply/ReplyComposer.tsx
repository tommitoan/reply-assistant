"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EMPTY_FEEDBACK } from "@/lib/reply/feedback-state";
import { MAX_INPUT_CHARS, MAX_PASTE_CHARS } from "@/lib/reply/limits";
import type { ReplyStreamState } from "@/lib/reply/stream-state";
import type { ConversationDetail, RecentGeneration, ReplyContext, ReplyMode } from "@/lib/reply/types";
import ReplyControls from "./ReplyControls";
import { feedbackRowsOf } from "./RecentGenerations";
import TurnView, { HistoryTurn } from "./TurnView";
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

// Earlier requests of this visit that stay on screen above the current one.
const MAX_KEPT_TURNS = 12;
// Closer than this to the bottom counts as "following the chat".
const FOLLOW_DISTANCE_PX = 160;
const INPUT_MAX_HEIGHT_PX = 220;

interface KeptTurn {
  key: number;
  request: GenerateRequest;
  state: ReplyStreamState;
}

// The chat: what was asked and answered so far (scrolling), and the input box
// at the bottom. The writer's input leaves the box when it is sent and
// reappears above it as their side of the chat, with the drafts below.
export default function ReplyComposer({
  conversation,
  transcript,
  reviewing,
  onCloseReview,
  onGenerationDone,
  onThreadChanged,
  onContextChange,
}: {
  // The thread replies are written in, or null for "Dịch nhanh".
  conversation: ConversationDetail | null;
  // The thread's earlier messages, shown above the first request.
  transcript?: ReactNode;
  // An earlier request opened from the Recent list.
  reviewing?: RecentGeneration | null;
  onCloseReview?: () => void;
  // A request finished and was saved; the Recent list should reload.
  onGenerationDone?: (generationId: string) => void;
  // Called when the thread's messages changed (a paste was added, a reply was used).
  onThreadChanged: () => void;
  onContextChange: (context: ReplyContext) => void;
}) {
  const [input, setInput] = useState("");
  // Inside a thread: paste their message (English) or type an idea (Vietnamese).
  const [threadInput, setThreadInput] = useState<"paste" | "idea">("paste");
  // What "Better" redoes: the last request that was actually sent.
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);
  const [kept, setKept] = useState<KeptTurn[]>([]);
  const keptCounter = useRef(0);
  const [settings, updateSettings] = useReplySettings();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const following = useRef(true);

  // A used or edited reply changes the thread's own messages.
  const feedback = useOptionFeedback((_id, patch) => {
    if (conversation && (patch.chosen !== undefined || patch.editedText !== undefined)) onThreadChanged();
  });
  const { load } = feedback;
  const { state, start, cancel } = useReplyStream({
    onMeta: (event) => {
      // The server has added the pasted conversation to the thread.
      if (event.thread) onThreadChanged();
    },
    onDone: (event, generationId) => {
      load(event.options.map((option) => ({ id: option.id, generationId, ...EMPTY_FEEDBACK })));
      onGenerationDone?.(generationId);
    },
  });

  const mode: ReplyMode = conversation && threadInput === "paste" ? "en_reply" : "vi_to_en";
  const limit = mode === "en_reply" ? MAX_PASTE_CHARS : MAX_INPUT_CHARS;
  const context = conversation?.context ?? settings.context;

  const streaming = state.status === "streaming";
  const trimmedLength = input.trim().length;
  const canSubmit = !streaming && trimmedLength > 0 && input.length <= limit;
  const canRedo = !streaming && state.done !== null && state.meta !== null && lastRequest !== null;
  const hasCurrentTurn = lastRequest !== null && (state.status !== "idle" || state.options.length > 0);
  const hasMessages = (conversation?.messages.length ?? 0) > 0;
  const showIntro = !hasCurrentTurn && kept.length === 0 && !reviewing && !hasMessages && trimmedLength === 0;
  const showStarters = mode === "vi_to_en" && input === "" && !hasCurrentTurn && kept.length === 0 && !reviewing;

  // The first request after a quiet spell pays for writing the prompt cache.
  // Doing it on page load hides that cost.
  useEffect(() => {
    warmReplyCache(context);
  }, [context]);

  // An opened request needs its ratings and edits in the store before its cards show them.
  useEffect(() => {
    if (reviewing) load(feedbackRowsOf([reviewing]));
  }, [reviewing, load]);

  // The box grows with what is typed, up to a limit, and shrinks when it is emptied.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, INPUT_MAX_HEIGHT_PX)}px`;
  }, [input, mode]);

  // Keep the newest part in view while the chat grows, unless the writer scrolled up to read.
  const turnsSignature = `${kept.length}|${state.status}|${state.options.map((option) => option.text.length).join(",")}|${state.done ? 1 : 0}|${reviewing?.id ?? ""}`;
  useEffect(() => {
    const area = scrollRef.current;
    if (area && following.current) area.scrollTop = area.scrollHeight;
  }, [turnsSignature]);

  function onScroll() {
    const area = scrollRef.current;
    if (area) following.current = area.scrollHeight - area.scrollTop - area.clientHeight < FOLLOW_DISTANCE_PX;
  }

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
    // The request on screen stays as part of the chat; the new one takes its place.
    if (lastRequest && hasCurrentTurn) {
      const finished = { key: (keptCounter.current += 1), request: lastRequest, state };
      setKept((turns) => [...turns, finished].slice(-MAX_KEPT_TURNS));
    }
    following.current = true;
    setInput("");
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

  function retry() {
    if (!lastRequest || streaming) return;
    void start(lastRequest);
  }

  function restoreInput() {
    if (!lastRequest) return;
    setInput(lastRequest.input);
    boxRef.current?.focus();
  }

  const develop = { speed: settings.speed, learn: settings.learn };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 ${showIntro ? "" : "gap-6"}`}>
          {transcript}

          {showIntro && (
            <div className="my-auto py-8 text-center">
              {conversation ? (
                <>
                  <p aria-hidden="true" className="text-3xl">
                    📋
                  </p>
                  <h1 className="mt-2 font-serif text-2xl tracking-tight text-stone-900 sm:text-3xl dark:text-stone-50">
                    Dán đoạn chat vào đây
                  </h1>
                  <p className="mx-auto mt-2 max-w-md text-[15px] text-stone-500 dark:text-stone-400">
                    Dán đoạn chat tiếng Anh (hoặc chỉ tin nhắn mới nhất của họ) vào ô bên dưới, bạn sẽ nhận vài gợi ý trả lời đúng
                    ngữ cảnh. Phần đã dán sẽ hiện ở đây.
                  </p>
                </>
              ) : (
                <>
                  <p aria-hidden="true" className="text-3xl text-accent-600 dark:text-accent-500">
                    ✻
                  </p>
                  <h1 className="mt-2 font-serif text-3xl tracking-tight text-stone-900 sm:text-4xl dark:text-stone-50">
                    Bạn muốn nói gì?
                  </h1>
                  <p className="mx-auto mt-2 max-w-xl text-[15px] text-stone-500 dark:text-stone-400">
                    Gõ ý của bạn bằng tiếng Việt, hoặc mở một cuộc trò chuyện để dán đoạn chat tiếng Anh. Bạn sẽ nhận vài bản nháp
                    theo đúng giọng của mình. App không bao giờ tự gửi thay bạn.
                  </p>
                </>
              )}
            </div>
          )}
          {!showIntro && <h1 className="sr-only">Reply Assistant</h1>}

          {kept.map((turn) => (
            <TurnView key={turn.key} request={turn.request} state={turn.state} store={feedback} settings={develop} live={false} />
          ))}

          {lastRequest && hasCurrentTurn && (
            <TurnView
              request={lastRequest}
              state={state}
              store={feedback}
              settings={develop}
              live
              onLeaveOut={canRedo ? redoWithoutNote : undefined}
              onRetry={retry}
              onRestore={restoreInput}
            />
          )}

          {reviewing && (
            <section aria-label="Lượt đang xem lại" className="space-y-3">
              <div className="flex items-center justify-between gap-2 rounded-lg bg-stone-100 px-3 py-1.5 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                <span>Đang xem lại một lượt trước đó</span>
                <button type="button" onClick={onCloseReview} className="rounded-full px-2 py-0.5 font-medium hover:bg-stone-200 dark:hover:bg-stone-700">
                  Đóng
                </button>
              </div>
              <HistoryTurn generation={reviewing} store={feedback} settings={develop} />
            </section>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2">
        <div className="mx-auto w-full max-w-3xl space-y-2.5">
          {showStarters && (
            <div role="group" aria-label="Gợi ý" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 sm:pb-0">
              {STARTERS.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setInput(example);
                    boxRef.current?.focus();
                  }}
                  className="shrink-0 whitespace-nowrap rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-[13px] text-stone-600 transition hover:border-accent-300 hover:bg-accent-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-accent-700 dark:hover:bg-stone-700"
                >
                  {example}
                </button>
              ))}
            </div>
          )}

          {conversation && (
            <div role="group" aria-label="Nội dung muốn viết" className="flex gap-2">
              {(
                [
                  ["paste", "📋 Dán tin nhắn của họ"],
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
              {mode === "en_reply" ? "Đoạn chat hoặc tin nhắn mới nhất của họ, bằng tiếng Anh" : "Điều bạn muốn nói, bằng tiếng Việt"}
            </label>
            <textarea
              id="reply-input"
              ref={boxRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => warmReplyCache(context)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter starts a new line. While an input method is still
                // composing a word (Vietnamese Telex/VNI), Enter belongs to the method.
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                submit();
              }}
              rows={mode === "en_reply" ? 3 : 2}
              placeholder={
                mode === "en_reply"
                  ? "Dán đoạn chat hoặc chỉ tin nhắn mới nhất của họ. Những dòng đã có trong cuộc trò chuyện sẽ được bỏ qua."
                  : "Bạn muốn nói gì? Gõ ý tiếng Việt ở đây…"
              }
              className="block w-full resize-none bg-transparent px-3 pb-1 pt-2 text-[16px] leading-relaxed text-stone-800 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
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
                    Dừng
                  </button>
                )}
                {canRedo && (
                  <button
                    type="button"
                    onClick={redoBetter}
                    aria-label="Viết kỹ hơn: viết lại các bản này bằng mô hình kỹ lưỡng"
                    title="Viết lại bằng mô hình kỹ lưỡng"
                    className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700"
                  >
                    🎯 Viết kỹ hơn
                  </button>
                )}
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  aria-label={streaming ? "Đang viết…" : mode === "en_reply" ? "Gợi ý trả lời" : "Viết bản nháp"}
                  title={`${mode === "en_reply" ? "Gợi ý trả lời" : "Viết bản nháp"} (Enter · Shift+Enter để xuống dòng)`}
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
        </div>
      </div>
    </div>
  );
}
