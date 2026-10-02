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
      setProblem(err instanceof Error ? err.message : "Could not suggest an English version.");
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
      setProblem(err instanceof Error ? err.message : "Could not save the note.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Add a note" className={`${CARD} space-y-3`}>
      <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Add a note</h2>

      <div>
        <label htmlFor={textId} className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
          What is true about you? (Vietnamese or English)
        </label>
        <textarea
          id={textId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Ví dụ: Tháng 9 mình mới dọn sang chung cư mới vì bếp cũ ám mùi."
          className={FIELD}
        />
        <p className={`mt-1 text-right text-xs ${tooLong ? "text-red-600" : "text-stone-400"}`}>
          {text.length} / {MAX_NOTE_CHARS}
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm text-stone-700 dark:text-stone-200">
        <input type="checkbox" checked={isPrivate} onChange={(e) => changePrivate(e.target.checked)} className="mt-1" />
        <span>
          🔒 Private
          <span className="block text-xs text-stone-500 dark:text-stone-400">{PRIVATE_HINT}</span>
        </span>
      </label>

      <div>
        <label htmlFor={englishId} className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
          English version (used to match English messages; leave empty and it is written for you)
        </label>
        <textarea
          id={englishId}
          value={textEn}
          onChange={(e) => setTextEn(e.target.value)}
          disabled={isPrivate}
          maxLength={MAX_NOTE_EN_CHARS}
          rows={2}
          placeholder={isPrivate ? "Not made for a private note." : "I moved to a new apartment in September."}
          className={FIELD}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm text-stone-700 dark:text-stone-200">
          Kind
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
            Date
            <input type="date" value={happenedOn} onChange={(e) => setHappenedOn(e.target.value)} className={SELECT} />
          </label>
        )}
        <label className="flex items-center gap-1.5 text-sm text-stone-700 dark:text-stone-200">
          Use in
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
          📌 Always use (pin)
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={suggest}
          disabled={isPrivate || trimmed.length === 0 || tooLong || busy !== null}
          title={isPrivate ? "A private note is never sent to a model." : "Ask the model for an English version and tags"}
          className={BUTTON}
        >
          {busy === "suggest" ? "Suggesting…" : "✨ Suggest English + tags"}
        </button>
        <button type="button" onClick={save} disabled={trimmed.length === 0 || tooLong || busy !== null} className={PRIMARY}>
          {busy === "save" ? "Saving…" : "Save note"}
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
