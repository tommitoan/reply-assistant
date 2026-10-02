"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { FeedbackItem } from "@/lib/reply/feedback-state";
import { MAX_EDIT_CHARS } from "@/lib/reply/limits";
import type { OptionRating, ReplyVariant } from "@/lib/reply/types";

const LABELS: Record<ReplyVariant, string> = {
  short: "Ngắn",
  medium: "Vừa",
  long: "Dài",
  alt: "Cách khác",
};

export interface OptionActions {
  item: FeedbackItem;
  // null clears the rating.
  onRate: (rating: OptionRating | null) => void;
  // null puts the model's own text back. Resolves true once saved.
  onSaveEdit: (editedText: string | null) => Promise<boolean>;
  onUse: () => void;
  onDismissError: () => void;
}

export const SMALL_BUTTON =
  "rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700";
export const ACTIVE_BUTTON =
  "border-accent-300 bg-accent-100 text-accent-900 hover:bg-accent-200 dark:border-accent-700 dark:bg-accent-900/50 dark:text-accent-100 dark:hover:bg-accent-900";

export default function ReplyOptionCard({
  variant,
  text,
  streaming = false,
  actions,
  label,
  extraAction,
}: {
  variant: ReplyVariant;
  text: string;
  streaming?: boolean;
  actions?: OptionActions;
  // Replaces the variant's name in the heading (developed versions use it).
  label?: string;
  // One more button after "Use this", for actions that belong to the caller.
  extraAction?: ReactNode;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const editFieldId = useId();
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const shown = actions?.item.shown;
  const pending = actions?.item.pending ?? false;
  const displayText = shown?.editedText ?? text;
  const heading = label ?? LABELS[variant];

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(displayText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 1500);
  }

  async function use(): Promise<void> {
    await copy();
    actions?.onUse();
  }

  function startEdit() {
    setDraft(displayText);
    setEditing(true);
  }

  async function saveEdit() {
    if (!actions) return;
    const value = draft.trim();
    if (value === displayText) {
      setEditing(false);
      return;
    }
    // Writing the model's text back is the same as having no edit.
    const ok = await actions.onSaveEdit(value === text ? null : value);
    if (ok) setEditing(false);
  }

  async function resetEdit() {
    if (!actions) return;
    if (await actions.onSaveEdit(null)) setEditing(false);
  }

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-400">
          {heading}
          {shown?.editedText != null && (
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-stone-500 dark:bg-stone-700 dark:text-stone-300">
              đã sửa
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={copy}
          disabled={displayText.length === 0}
          aria-label={`Sao chép bản nháp ${heading.toLowerCase()}`}
          className={SMALL_BUTTON}
        >
          {copyState === "copied" ? "Đã chép ✓" : copyState === "failed" ? "Chép không được" : "Sao chép"}
        </button>
      </header>

      {editing ? (
        <div className="space-y-2">
          <label htmlFor={editFieldId} className="sr-only">
            Sửa bản nháp {heading.toLowerCase()}
          </label>
          <textarea
            id={editFieldId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_EDIT_CHARS}
            rows={4}
            autoFocus
            className="w-full resize-y rounded-lg border border-stone-300 bg-white p-3 text-[15px] leading-relaxed text-stone-800 outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-200 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:ring-accent-900"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveEdit}
              disabled={pending || draft.trim().length === 0}
              className={`${SMALL_BUTTON} ${ACTIVE_BUTTON}`}
            >
              {pending ? "Đang lưu…" : "Lưu"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={pending} className={SMALL_BUTTON}>
              Hủy
            </button>
            {shown?.editedText != null && (
              <button type="button" onClick={resetEdit} disabled={pending} className={SMALL_BUTTON}>
                Dùng bản gốc
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap font-serif text-[17px] leading-[1.65] text-stone-800 dark:text-stone-100">
          {displayText}
          {streaming && (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-stone-400 dark:bg-stone-500"
            />
          )}
        </p>
      )}

      {actions && shown && !editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => actions.onRate(shown.rating === "good" ? null : "good")}
            disabled={pending}
            aria-pressed={shown.rating === "good"}
            aria-label="Bản nháp hay"
            className={`${SMALL_BUTTON} ${shown.rating === "good" ? ACTIVE_BUTTON : ""}`}
          >
            👍
          </button>
          <button
            type="button"
            onClick={() => actions.onRate(shown.rating === "bad" ? null : "bad")}
            disabled={pending}
            aria-pressed={shown.rating === "bad"}
            aria-label="Bản nháp chưa ổn"
            className={`${SMALL_BUTTON} ${shown.rating === "bad" ? ACTIVE_BUTTON : ""}`}
          >
            👎
          </button>
          <button type="button" onClick={startEdit} disabled={pending} className={SMALL_BUTTON}>
            ✏️ Sửa
          </button>
          <button
            type="button"
            onClick={use}
            disabled={pending}
            aria-pressed={shown.chosen}
            className={`${SMALL_BUTTON} ${shown.chosen ? ACTIVE_BUTTON : ""}`}
          >
            {shown.chosen ? "Đã dùng ✓" : "Dùng bản này"}
          </button>
          {extraAction}
        </div>
      )}

      {actions?.item.error && (
        <p
          role="alert"
          className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          <span>{actions.item.error}</span>
          <button type="button" onClick={actions.onDismissError} aria-label="Đóng" className="font-semibold">
            ×
          </button>
        </p>
      )}
    </article>
  );
}
