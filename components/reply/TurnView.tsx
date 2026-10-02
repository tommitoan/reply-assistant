"use client";

import { formatMetaLine } from "@/lib/reply/format";
import type { ReplyStreamState } from "@/lib/reply/stream-state";
import type { RecentGeneration } from "@/lib/reply/types";
import DevelopableOption from "./DevelopableOption";
import ExplainBox from "./ExplainBox";
import MemoryDisclosure from "./MemoryDisclosure";
import NotesDisclosure from "./NotesDisclosure";
import ReplyOptionCard from "./ReplyOptionCard";
import ThreadNotice from "./ThreadNotice";
import type { OptionFeedbackStore } from "./useOptionFeedback";
import type { GenerateRequest } from "./useReplyStream";

// What the writer sent, as their side of the chat.
export function InputBubble({ text, pasted }: { text: string; pasted: boolean }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-stone-200/70 px-4 py-2.5 text-[15px] text-stone-800 dark:bg-stone-700/70 dark:text-stone-100">
        {pasted && <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-60">📋 Tin nhắn đã dán</p>}
        <p className={`whitespace-pre-wrap break-words ${pasted ? "line-clamp-6" : ""}`}>{text}</p>
      </div>
    </div>
  );
}

export interface TurnSettings {
  speed: "auto" | "fast" | "smart";
  learn: boolean;
}

// One request and its answer: the writer's input, then what came back. Used
// for the request being written and for the earlier ones of this visit; the
// earlier ones are shown as they ended, without the controls that redo them.
export default function TurnView({
  request,
  state,
  store,
  settings,
  live,
  onLeaveOut,
  onRetry,
  onRestore,
}: {
  request: GenerateRequest;
  state: ReplyStreamState;
  store: OptionFeedbackStore;
  settings: TurnSettings;
  // True for the request still on screen as the current one.
  live: boolean;
  onLeaveOut?: (noteId: string) => void;
  onRetry?: () => void;
  // Puts what was sent back in the input box.
  onRestore?: () => void;
}) {
  const streaming = state.status === "streaming";

  // Once the stream is done the options have ids, and feedback can be saved.
  const cards = state.done
    ? state.done.options.map((option) => ({ key: option.id, id: option.id, variant: option.variant, text: option.text }))
    : state.options.map((option, index) => ({
        key: `${index}-${option.variant}`,
        id: null,
        variant: option.variant,
        text: option.text,
      }));

  const suggestedNotes = state.done && request.mode === "vi_to_en" ? (state.meta?.notes?.suggestions ?? []) : [];
  const suggestionTarget = Math.max(0, cards.findIndex((card) => card.variant === "medium"));

  return (
    <div className="space-y-4">
      <InputBubble text={request.input} pasted={request.mode === "en_reply"} />

      {state.meta?.thread && <ThreadNotice added={state.meta.thread.added} skipped={state.meta.thread.skipped} />}

      {(state.explanation || (streaming && request.explain && request.mode === "en_reply")) && (
        <ExplainBox text={state.explanation} />
      )}

      {state.meta && <MemoryDisclosure status={state.meta.memoryStatus} memories={state.meta.memories} />}

      {state.meta && (
        <NotesDisclosure
          mode={request.mode}
          notes={state.meta.notes}
          used={state.done?.notesUsed}
          disabled={!live || streaming}
          onLeaveOut={onLeaveOut ?? (() => undefined)}
        />
      )}

      {cards.length > 0 && (
        <section aria-label="Các bản nháp" aria-live={live ? "polite" : "off"} className="space-y-3">
          {cards.map((card, index) =>
            card.id && state.meta ? (
              <DevelopableOption
                key={card.key}
                option={{ id: card.id, generationId: state.meta.generationId, variant: card.variant, text: card.text }}
                store={store}
                settings={settings}
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

      {state.error && (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          <p>{state.error.message}</p>
          {live && (
            <div className="flex flex-wrap gap-2">
              {state.error.retryable && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium transition hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
                >
                  Thử lại
                </button>
              )}
              {onRestore && (
                <button
                  type="button"
                  onClick={onRestore}
                  className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium transition hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
                >
                  Đưa lại vào ô nhập
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {state.done && state.meta && (
        <p className="text-xs text-stone-400 dark:text-stone-500">
          {formatMetaLine({
            model: state.meta.model,
            firstTokenMs: state.done.firstTokenMs,
            totalMs: state.done.totalMs,
            costUsd: state.done.costUsd,
          })}{" "}
          (chi phí chỉ là ước tính)
        </p>
      )}
    </div>
  );
}

// An earlier request opened from the Recent list: the writer's input and the
// replies saved for it, with the developed versions under their reply.
export function HistoryTurn({
  generation,
  store,
  settings,
}: {
  generation: RecentGeneration;
  store: OptionFeedbackStore;
  settings: TurnSettings;
}) {
  return (
    <div className="space-y-4">
      <InputBubble text={generation.inputText} pasted={false} />
      <section aria-label="Các bản nháp" className="space-y-3">
        {generation.options.map((option) => (
          <DevelopableOption
            key={option.id}
            option={{ id: option.id, generationId: generation.id, variant: option.variant, text: option.text }}
            store={store}
            settings={settings}
            developed={generation.developed.filter((group) => group.ofOptionId === option.id)}
          />
        ))}
      </section>
    </div>
  );
}
