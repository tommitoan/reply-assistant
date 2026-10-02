"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_TITLE_CHARS } from "@/lib/reply/limits";
import type { ConversationDetail, StoredMessage } from "@/lib/reply/types";

const AUTHOR_STYLE: Record<StoredMessage["author"], string> = {
  them: "mr-8 bg-stone-100 text-stone-800 dark:bg-stone-700 dark:text-stone-100",
  me: "ml-8 bg-accent-100 text-stone-900 dark:bg-accent-900/60 dark:text-stone-100",
  unknown: "mr-8 border border-dashed border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-300",
};
const AUTHOR_LABEL: Record<StoredMessage["author"], string> = { them: "Them", me: "Me", unknown: "Unknown" };

const HEADER_BUTTON =
  "rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition hover:bg-stone-100 disabled:opacity-40 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700";

// The conversation so far, with the title, archive and delete controls.
export default function ThreadView({
  conversation,
  busy,
  error,
  onRename,
  onArchive,
  onDelete,
}: {
  conversation: ConversationDetail;
  busy: boolean;
  error: string | null;
  onRename: (title: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const messageCount = conversation.messages.length;

  // New messages arrive at the bottom; keep them in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messageCount]);

  function submitRename() {
    const title = draft.trim();
    setRenaming(false);
    if (title !== conversation.title) onRename(title);
  }

  return (
    <section aria-label="Conversation" className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {renaming ? (
          <input
            aria-label="Conversation title"
            value={draft}
            autoFocus
            maxLength={MAX_TITLE_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm font-semibold dark:border-stone-600 dark:bg-stone-900"
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-800 dark:text-stone-100">
            {conversation.title || "Untitled conversation"}
          </h2>
        )}
        <div className="flex gap-2">
          {!renaming && (
            <button
              type="button"
              className={HEADER_BUTTON}
              disabled={busy}
              onClick={() => {
                setDraft(conversation.title);
                setRenaming(true);
              }}
            >
              Rename
            </button>
          )}
          <button type="button" className={HEADER_BUTTON} disabled={busy} onClick={onArchive}>
            Archive
          </button>
          <button type="button" className={HEADER_BUTTON} disabled={busy} onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        </div>
      </header>

      {confirmingDelete && (
        <div
          role="alertdialog"
          aria-label="Delete this conversation?"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          <span className="flex-1">Delete this conversation and the replies written in it? This cannot be undone.</span>
          <button
            type="button"
            className={HEADER_BUTTON}
            onClick={() => {
              setConfirmingDelete(false);
              onDelete();
            }}
          >
            Delete
          </button>
          <button type="button" className={HEADER_BUTTON} onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}

      {messageCount === 0 ? (
        <p className="text-sm text-stone-400 dark:text-stone-500">
          Nothing here yet. Paste the conversation below to start.
        </p>
      ) : (
        <ol ref={listRef} className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {conversation.messages.map((message) => (
            <li key={message.id} className={`rounded-xl px-3 py-2 text-sm ${AUTHOR_STYLE[message.author]}`}>
              <span className="mb-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                {AUTHOR_LABEL[message.author]}
                {message.source === "chosen_reply" && <span className="font-normal normal-case">· reply you used</span>}
              </span>
              <span className="whitespace-pre-wrap">{message.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
