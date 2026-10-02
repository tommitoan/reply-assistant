"use client";

import { useState } from "react";
import type { NoteRef, NotesStatus, ReplyMode } from "@/lib/reply/types";
import { updateNote } from "./notesApi";

const NOTE = "text-xs text-stone-400 dark:text-stone-500";
const SMALL =
  "rounded-md border border-stone-300 px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700";

// Says what the writer's notes did for one request, so a personal detail in a
// reply can be traced to its note, left out ("don't use this one", then the
// replies are written again without it), edited or archived.
export default function NotesDisclosure({
  mode,
  notes,
  used,
  disabled,
  onLeaveOut,
}: {
  mode: ReplyMode;
  // What the stream's first event said; absent when the switch was off.
  notes: { status: NotesStatus; offered: number } | undefined;
  // The notes the model reported using; absent until the replies are done, and for a typed idea.
  used: NoteRef[] | undefined;
  disabled?: boolean;
  // Writes the replies again without this note.
  onLeaveOut: (noteId: string) => void;
}) {
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);

  async function archive(id: string) {
    setProblem(null);
    try {
      await updateNote(id, { status: "archived" });
      setArchived((current) => new Set(current).add(id));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Không lưu trữ được ghi chú này.");
    }
  }

  if (!notes) return null;

  if (notes.status === "skipped") {
    return (
      <p className={NOTE}>
        {mode === "en_reply"
          ? "Không tìm kiếm được ghi chú của bạn cho yêu cầu này (hết hạn mức embedding), nên chỉ dùng được các ghi chú đã ghim."
          : "Đã bỏ qua gợi ý ghi chú cho yêu cầu này (hết hạn mức embedding)."}
      </p>
    );
  }

  // A typed idea gets suggestions (chips), never notes in the replies.
  if (mode !== "en_reply" || !used) return null;

  if (used.length === 0) {
    return notes.offered > 0 ? (
      <p className={NOTE}>
        Có {notes.offered} ghi chú để dùng, nhưng không ghi chú nào hợp với tin nhắn này.
      </p>
    ) : null;
  }

  return (
    <details className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-800">
      <summary className="cursor-pointer text-stone-600 dark:text-stone-300">
        Đã dùng {used.length} ghi chú
      </summary>
      <ul className="mt-2 space-y-2">
        {used.map((note) => (
          <li key={note.id} className="flex flex-wrap items-center gap-2 text-stone-500 dark:text-stone-400">
            <span className="flex-1">
              {note.pinned && <span aria-label="đã ghim">📌 </span>}
              {note.text}
            </span>
            <button type="button" disabled={disabled} onClick={() => onLeaveOut(note.id)} className={SMALL}>
              Đừng dùng ghi chú này
            </button>
            <a href={`/about#note-${note.id}`} className={`${SMALL} inline-block`}>
              Sửa
            </a>
            <button type="button" disabled={disabled || archived.has(note.id)} onClick={() => void archive(note.id)} className={SMALL}>
              {archived.has(note.id) ? "Đã lưu trữ ✓" : "Lưu trữ"}
            </button>
          </li>
        ))}
      </ul>
      {problem && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
    </details>
  );
}
