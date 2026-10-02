"use client";

import { useId, useState } from "react";
import { MAX_NOTE_CHARS, MAX_NOTE_EN_CHARS } from "@/lib/reply/limits";
import { NOTE_KINDS, NOTE_SCOPES, type NoteKind, type NoteRecord, type NoteScope } from "@/lib/reply/types";
import { createNote, suggestForNote } from "./notesApi";
import { BUTTON, CARD, ERROR, FIELD, KIND_LABELS, PRIMARY, PRIVATE_HINT, SCOPE_LABELS, SELECT } from "./notesUi";

// Write one note. The English version and the tags can be suggested by a model,
// then adjusted before saving. A private note skips the model entirely.
export default function NoteForm({ onSaved }: { onSaved: (note: NoteRecord) => void }) {
  const [text, setText] = useState("");
  const [textEn, setTextEn] = useState("");
  const [kind, setKind] = useState<NoteKind>("fact");
  const [happenedOn, setHappenedOn] = useState("");
  const [scope, setScope] = useState<NoteScope>("both");
  const [isPrivate, setIsPrivate] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState<"suggest" | "save" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const textId = useId();
  const englishId = useId();

  const trimmed = text.trim();
  const tooLong = text.length > MAX_NOTE_CHARS;

  function changePrivate(value: boolean) {
    setIsPrivate(value);
    if (value) {
      // Nothing derived from a private note may exist.
      setTextEn("");
      setPinned(false);
    }
  }

  async function suggest() {
    setBusy("suggest");
    setProblem(null);
    try {
      const suggestion = await suggestForNote(trimmed);
      setTextEn(suggestion.textEn ?? "");
      setKind(suggestion.kind);
      setScope(suggestion.scope);
      setHappenedOn(suggestion.happenedOn ?? "");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Không gợi ý được bản tiếng Anh.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setProblem(null);
    try {
      const note = await createNote({
        text: trimmed,
        // Left out when empty, so the English version is written for the writer.
        ...(!isPrivate && textEn.trim() ? { textEn: textEn.trim() } : {}),
        kind,
        ...(kind === "event" && happenedOn ? { happenedOn } : {}),
        scope,
        private: isPrivate,
        pinned: pinned && !isPrivate,
      });
      // Back to the defaults, so the next note does not inherit this one's choices.
      setText("");
      setTextEn("");
      setKind("fact");
      setHappenedOn("");
      setScope("both");
      setIsPrivate(false);
      setPinned(false);
      onSaved(note);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Không lưu được ghi chú.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Thêm ghi chú" className={`${CARD} space-y-3`}>
      <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Thêm ghi chú</h2>

      <div>
        <label htmlFor={textId} className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
          Điều gì đúng về bạn? (viết tiếng Việt hoặc tiếng Anh đều được)
        </label>
        <textarea
          id={textId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Ví dụ: Tháng 9 mình mới chuyển sang căn hộ mới ở Quận 7."
          className={FIELD}
        />
        <p className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-stone-400">
          <span>Mỗi ghi chú một ý, viết ngắn, ngôi &quot;mình&quot;. Sự kiện nên kèm tháng.</span>
          <span className={tooLong ? "text-red-600" : undefined}>
            {text.length} / {MAX_NOTE_CHARS}
          </span>
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm text-stone-700 dark:text-stone-200">
        <input type="checkbox" checked={isPrivate} onChange={(e) => changePrivate(e.target.checked)} className="mt-1" />
        <span>
          🔒 Riêng tư
          <span className="block text-xs text-stone-500 dark:text-stone-400">{PRIVATE_HINT}</span>
        </span>
      </label>

      <div>
        <label htmlFor={englishId} className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
          Bản tiếng Anh (dùng để khớp với tin nhắn tiếng Anh; để trống thì app tự viết cho bạn)
        </label>
        <textarea
          id={englishId}
          value={textEn}
          onChange={(e) => setTextEn(e.target.value)}
          disabled={isPrivate}
          maxLength={MAX_NOTE_EN_CHARS}
          rows={2}
          placeholder={isPrivate ? "Ghi chú riêng tư không có bản tiếng Anh." : "I moved to a new apartment in September."}
          className={FIELD}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm text-stone-700 dark:text-stone-200">
          Loại
          <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)} className={SELECT}>
            {NOTE_KINDS.map((value) => (
              <option key={value} value={value}>
                {KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {kind === "event" && (
          <label className="flex items-center gap-1.5 text-sm text-stone-700 dark:text-stone-200">
            Ngày xảy ra
            <input type="date" value={happenedOn} onChange={(e) => setHappenedOn(e.target.value)} className={SELECT} />
          </label>
        )}
        <label className="flex items-center gap-1.5 text-sm text-stone-700 dark:text-stone-200">
          Dùng khi
          <select value={scope} onChange={(e) => setScope(e.target.value as NoteScope)} className={SELECT}>
            {NOTE_SCOPES.map((value) => (
              <option key={value} value={value}>
                {SCOPE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-stone-700 dark:text-stone-200">
          <input type="checkbox" checked={pinned} disabled={isPrivate} onChange={(e) => setPinned(e.target.checked)} />
          📌 Luôn dùng (ghim)
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={suggest}
          disabled={isPrivate || trimmed.length === 0 || tooLong || busy !== null}
          title={isPrivate ? "Ghi chú riêng tư không bao giờ được gửi cho mô hình." : "Nhờ mô hình viết bản tiếng Anh và gợi ý loại, phạm vi dùng"}
          className={BUTTON}
        >
          {busy === "suggest" ? "Đang gợi ý…" : "✨ Gợi ý bản tiếng Anh + nhãn"}
        </button>
        <button type="button" onClick={save} disabled={trimmed.length === 0 || tooLong || busy !== null} className={PRIMARY}>
          {busy === "save" ? "Đang lưu…" : "Lưu ghi chú"}
        </button>
      </div>

      {problem && (
        <p role="alert" className={ERROR}>
          {problem}
        </p>
      )}
    </section>
  );
}
