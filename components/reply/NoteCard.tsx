"use client";

import { useState } from "react";
import { MAX_NOTE_CHARS, MAX_NOTE_EN_CHARS } from "@/lib/reply/limits";
import { NOTE_SCOPES, type NoteRecord, type NoteScope } from "@/lib/reply/types";
import type { NoteChanges } from "./notesApi";
import { CARD, ERROR, FIELD, PRIMARY, SCOPE_LABELS, SELECT, SMALL } from "./notesUi";

const CHIP = "rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-600 dark:bg-stone-700 dark:text-stone-300";

function dateLabel(note: NoteRecord): string {
  return note.kind === "event" ? (note.happenedOn ? `sự kiện · ${note.happenedOn}` : "sự kiện") : "thông tin";
}

// One saved note, with the actions that change it. `onChange` resolves true
// when the server accepted the change.
export default function NoteCard({
  note,
  onChange,
  onDelete,
}: {
  note: NoteRecord;
  onChange: (changes: NoteChanges) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [textEn, setTextEn] = useState(note.textEn ?? "");
  const [confirming, setConfirming] = useState<"delete" | "public" | null>(null);
  const [busy, setBusy] = useState(false);

  const archived = note.status === "archived";

  async function run(action: () => Promise<boolean | void>): Promise<boolean> {
    setBusy(true);
    try {
      return (await action()) !== false;
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    setText(note.text);
    setTextEn(note.textEn ?? "");
    setEditing(true);
  }

  async function saveEdit() {
    const changes: NoteChanges = {};
    if (text.trim() !== note.text) changes.text = text.trim();
    // A private note has no English version.
    if (!note.private && textEn.trim() !== (note.textEn ?? "")) changes.textEn = textEn.trim() || null;
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    if (await run(() => onChange(changes))) setEditing(false);
  }

  return (
    <article id={`note-${note.id}`} className={`${CARD} space-y-2 ${archived ? "opacity-60" : ""}`}>
      <header className="flex flex-wrap items-center gap-1.5">
        {note.pinned && <span className={CHIP}>📌 đã ghim</span>}
        {note.private && <span className={CHIP}>🔒 riêng tư</span>}
        <span className={CHIP}>{SCOPE_LABELS[note.scope]}</span>
        <span className={CHIP}>{dateLabel(note)}</span>
        {archived && <span className={CHIP}>đã lưu trữ</span>}
        {!note.indexed && (
          <span className={CHIP} title="Lưu lúc dịch vụ embedding bị lỗi, nên chưa thể tìm thấy theo ý nghĩa.">
            chưa tìm kiếm được
          </span>
        )}
      </header>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_NOTE_CHARS}
            rows={3}
            aria-label="Nội dung ghi chú"
            className={FIELD}
          />
          {!note.private && (
            <textarea
              value={textEn}
              onChange={(e) => setTextEn(e.target.value)}
              maxLength={MAX_NOTE_EN_CHARS}
              rows={2}
              aria-label="Bản tiếng Anh"
              placeholder="Bản tiếng Anh (để trống thì app viết lại nếu bạn đã sửa nội dung)"
              className={FIELD}
            />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={saveEdit} disabled={busy || text.trim().length === 0} className={PRIMARY}>
              {busy ? "Đang lưu…" : "Lưu"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className={SMALL}>
              Hủy
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-stone-800 dark:text-stone-200">{note.text}</p>
          {note.textEn && (
            <p className="whitespace-pre-wrap text-sm italic leading-relaxed text-stone-500 dark:text-stone-400">
              EN: {note.textEn}
            </p>
          )}
        </>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={startEdit} disabled={busy} className={SMALL}>
            ✏️ Sửa
          </button>
          <button
            type="button"
            onClick={() => void run(() => onChange({ pinned: !note.pinned }))}
            disabled={busy || note.private || archived}
            aria-pressed={note.pinned}
            title={note.private ? "Ghi chú riêng tư không bao giờ được dùng, nên không ghim được." : undefined}
            className={SMALL}
          >
            {note.pinned ? "📌 Bỏ ghim" : "📌 Ghim"}
          </button>
          <label className="flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
            Dùng khi
            <select
              value={note.scope}
              onChange={(e) => void run(() => onChange({ scope: e.target.value as NoteScope }))}
              disabled={busy}
              aria-label="Dùng khi"
              className={`${SELECT} !py-0.5 text-xs`}
            >
              {NOTE_SCOPES.map((value) => (
                <option key={value} value={value}>
                  {SCOPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => (note.private ? setConfirming("public") : void run(() => onChange({ private: true })))}
            disabled={busy}
            aria-pressed={note.private}
            className={SMALL}
          >
            {note.private ? "🔓 Cho phép dùng" : "🔒 Đặt riêng tư"}
          </button>
          <button
            type="button"
            onClick={() => void run(() => onChange({ status: archived ? "active" : "archived" }))}
            disabled={busy}
            className={SMALL}
          >
            {archived ? "Khôi phục" : "Lưu trữ"}
          </button>
          <button type="button" onClick={() => setConfirming("delete")} disabled={busy} className={SMALL}>
            Xóa
          </button>
        </div>
      )}

      {confirming === "delete" && (
        <p role="alertdialog" aria-label="Xóa ghi chú này?" className={`${ERROR} flex flex-wrap items-center gap-2`}>
          <span className="flex-1">Xóa ghi chú này và mọi thứ được tạo ra từ nó? Không thể hoàn tác.</span>
          <button type="button" className={SMALL} disabled={busy} onClick={() => void run(onDelete)}>
            Xóa luôn
          </button>
          <button type="button" className={SMALL} disabled={busy} onClick={() => setConfirming(null)}>
            Giữ lại
          </button>
        </p>
      )}
      {confirming === "public" && (
        <p
          role="alertdialog"
          aria-label="Cho phép dùng ghi chú này?"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          <span className="flex-1">
            Nội dung ghi chú sẽ được gửi cho mô hình AI để viết bản tiếng Anh và giúp tìm kiếm được, và các bản trả lời có thể dùng nó.
          </span>
          <button
            type="button"
            className={SMALL}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const ok = await onChange({ private: false });
                if (ok) setConfirming(null);
                return ok;
              })
            }
          >
            Cho phép dùng
          </button>
          <button type="button" className={SMALL} disabled={busy} onClick={() => setConfirming(null)}>
            Giữ riêng tư
          </button>
        </p>
      )}
    </article>
  );
}
