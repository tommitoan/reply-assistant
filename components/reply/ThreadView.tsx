"use client";

import { useState } from "react";
import { MAX_TITLE_CHARS } from "@/lib/reply/limits";
import type { ConversationDetail, StoredMessage } from "@/lib/reply/types";

const AUTHOR_STYLE: Record<StoredMessage["author"], string> = {
  them: "mr-10 bg-stone-100 text-stone-800 dark:bg-stone-700 dark:text-stone-100",
  me: "ml-10 bg-accent-100 text-stone-900 dark:bg-accent-900/60 dark:text-stone-100",
  unknown: "mr-10 border border-dashed border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-300",
};
const AUTHOR_LABEL: Record<StoredMessage["author"], string> = { them: "Họ", me: "Tôi", unknown: "Chưa rõ" };

const HEADER_BUTTON =
  "rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition hover:bg-stone-100 disabled:opacity-40 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700";

// The title bar of the open conversation, with the rename, archive and delete controls.
export function ThreadHeader({
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

  function submitRename() {
    const title = draft.trim();
    setRenaming(false);
    if (title !== conversation.title) onRename(title);
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {renaming ? (
          <input
            aria-label="Tên cuộc trò chuyện"
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
            {conversation.title || "Cuộc trò chuyện chưa đặt tên"}
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
              Đổi tên
            </button>
          )}
          <button type="button" className={HEADER_BUTTON} disabled={busy} onClick={onArchive}>
            Lưu trữ
          </button>
          <button type="button" className={HEADER_BUTTON} disabled={busy} onClick={() => setConfirmingDelete(true)}>
            Xóa
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <div
          role="alertdialog"
          aria-label="Xóa cuộc trò chuyện này?"
          className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          <span className="flex-1">Xóa cuộc trò chuyện này cùng các bản trả lời đã viết trong đó? Không thể hoàn tác.</span>
          <button
            type="button"
            className={HEADER_BUTTON}
            onClick={() => {
              setConfirmingDelete(false);
              onDelete();
            }}
          >
            Xóa
          </button>
          <button type="button" className={HEADER_BUTTON} onClick={() => setConfirmingDelete(false)}>
            Hủy
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

// The messages of the conversation so far, oldest first. The chat column
// around it does the scrolling.
export function ThreadMessages({ messages }: { messages: StoredMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <section aria-label="Cuộc trò chuyện">
      <ol className="space-y-2">
        {messages.map((message) => (
          <li key={message.id} className={`rounded-2xl px-3.5 py-2 text-sm ${AUTHOR_STYLE[message.author]}`}>
            <span className="mb-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide opacity-70">
              {AUTHOR_LABEL[message.author]}
              {message.source === "chosen_reply" && <span className="font-normal normal-case">· bản trả lời bạn đã dùng</span>}
            </span>
            <span className="whitespace-pre-wrap">{message.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
