"use client";

import type { ConversationListItem } from "@/lib/reply/types";

const ROW =
  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition";
const ACTIVE = "bg-stone-200/70 text-stone-900 dark:bg-stone-800 dark:text-stone-50";
const IDLE = "text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/70";

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

// "Quick translate" (no thread) plus the saved conversations.
export default function ThreadList({
  items,
  error,
  activeId,
  creating,
  onSelect,
  onCreate,
}: {
  items: ConversationListItem[] | null;
  error: string | null;
  activeId: string | null;
  creating: boolean;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
}) {
  return (
    <nav aria-label="Conversations" className="space-y-1">
      <button
        type="button"
        onClick={onCreate}
        disabled={creating}
        className="mb-3 w-full rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-accent-300 hover:bg-accent-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-accent-700 dark:hover:bg-stone-700"
      >
        {creating ? "Starting…" : "＋ New conversation"}
      </button>

      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-current={activeId === null ? "page" : undefined}
        className={`${ROW} ${activeId === null ? ACTIVE : IDLE}`}
      >
        <span aria-hidden="true">⚡</span>
        <span className="font-medium">Quick translate</span>
      </button>

      {error && <p className="px-3 py-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {items === null && !error && <p className="px-3 py-1 text-xs text-stone-400">Loading…</p>}
      {items?.length === 0 && (
        <p className="px-3 py-1 text-xs text-stone-400 dark:text-stone-500">
          No conversations yet. Start one to paste a chat and get replies in context.
        </p>
      )}

      {items?.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          aria-current={activeId === item.id ? "page" : undefined}
          className={`${ROW} ${activeId === item.id ? ACTIVE : IDLE}`}
        >
          <span aria-hidden="true">{item.context === "work" ? "💼" : "☕"}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{item.title || "Untitled"}</span>
            <span className="block text-xs opacity-70">
              {item.messageCount} {item.messageCount === 1 ? "message" : "messages"} · {relativeTime(item.updatedAt)}
            </span>
          </span>
        </button>
      ))}
    </nav>
  );
}
