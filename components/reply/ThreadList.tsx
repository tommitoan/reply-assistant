"use client";

import type { ConversationListItem } from "@/lib/reply/types";
import { relativeTime } from "./relativeTime";

const ROW =
  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition";
const ACTIVE = "bg-stone-200/70 text-stone-900 dark:bg-stone-800 dark:text-stone-50";
const IDLE = "text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/70";

// "Dịch nhanh" (no thread) plus the saved conversations.
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
    <nav aria-label="Cuộc trò chuyện" className="space-y-1">
      <button
        type="button"
        onClick={onCreate}
        disabled={creating}
        className="mb-2 w-full rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-accent-300 hover:bg-accent-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-accent-700 dark:hover:bg-stone-700"
      >
        {creating ? "Đang tạo…" : "＋ Cuộc trò chuyện mới"}
      </button>

      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-current={activeId === null ? "page" : undefined}
        className={`${ROW} ${activeId === null ? ACTIVE : IDLE}`}
      >
        <span aria-hidden="true">⚡</span>
        <span className="font-medium">Dịch nhanh</span>
      </button>

      {error && <p className="px-3 py-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {items === null && !error && <p className="px-3 py-1 text-xs text-stone-400">Đang tải…</p>}
      {items?.length === 0 && (
        <p className="px-3 py-1 text-xs text-stone-400 dark:text-stone-500">
          Chưa có cuộc trò chuyện nào. Tạo một cuộc để dán đoạn chat và nhận gợi ý trả lời đúng ngữ cảnh.
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
            <span className="block truncate font-medium">{item.title || "Chưa đặt tên"}</span>
            <span className="block text-xs opacity-70">
              {item.messageCount} tin nhắn · {relativeTime(item.updatedAt)}
            </span>
          </span>
        </button>
      ))}
    </nav>
  );
}
