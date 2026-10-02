"use client";

import { useId, useState } from "react";
import { MAX_DIARY_CHARS, MAX_NOTE_CHARS } from "@/lib/reply/limits";
import { NOTE_KINDS, NOTE_SCOPES, type NoteDraft, type NoteKind, type NoteRecord, type NoteScope } from "@/lib/reply/types";
import { previewDiary, saveNotes } from "./notesApi";
import { BUTTON, CARD, ERROR, FIELD, KIND_LABELS, PRIMARY, SCOPE_LABELS, SELECT } from "./notesUi";

// One proposed note as the writer edits it before saving.
interface Item {
  key: number;
  keep: boolean;
  text: string;
  textEn: string;
  kind: NoteKind;
  happenedOn: string;
  scope: NoteScope;
  private: boolean;
}

const toItem = (draft: NoteDraft, key: number): Item => ({
  key,
  keep: true,
  text: draft.text,
  textEn: draft.textEn ?? "",
  kind: draft.kind,
  happenedOn: draft.happenedOn ?? "",
  scope: draft.scope,
  private: false,
});

// Paste a diary, see it split into notes, tick and edit them, then save. Nothing
// is stored before the writer saves.
export default function DiaryImport({ onSaved }: { onSaved: (notes: NoteRecord[]) => void }) {
  const [diary, setDiary] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<"split" | "save" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const diaryId = useId();

  const kept = (items ?? []).filter((item) => item.keep && item.text.trim().length > 0);
  const tooLong = diary.length > MAX_DIARY_CHARS;

  function change(key: number, changes: Partial<Item>) {
    setItems((current) => current?.map((item) => (item.key === key ? { ...item, ...changes } : item)) ?? null);
  }

  async function split() {
    setBusy("split");
    setProblem(null);
    try {
      const drafts = await previewDiary(diary.trim());
      setItems(drafts.map(toItem));
      if (drafts.length === 0) setProblem("The model found nothing worth keeping in that text.");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not split the diary.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setProblem(null);
    try {
      const saved = await saveNotes(
        kept.map((item) => ({
          text: item.text.trim(),
          // Empty means "write it for me"; a private note never gets one.
          ...(!item.private && item.textEn.trim() ? { textEn: item.textEn.trim() } : {}),
          kind: item.kind,
          ...(item.kind === "event" && item.happenedOn ? { happenedOn: item.happenedOn } : {}),
          scope: item.scope,
          private: item.private,
          pinned: false,
        })),
      );
      setItems(null);
      setDiary("");
      onSaved(saved);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save the notes.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Import a diary" className={`${CARD} space-y-3`}>
      <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Import a diary</h2>

      {items === null ? (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Paste a diary or a long text. A model splits it into separate notes for you to review; nothing is saved until you
            say so. The text you paste here is sent to the model to split it, so for anything that must stay out of every model,
            add a 🔒 private note by hand instead.
          </p>
          <label htmlFor={diaryId} className="sr-only">
            The diary to split into notes
          </label>
          <textarea
            id={diaryId}
            value={diary}
            onChange={(e) => setDiary(e.target.value)}
            rows={6}
            placeholder="Dán nhật ký hoặc ghi chú dài của bạn ở đây…"
            className={FIELD}
          />
          <p className={`text-right text-xs ${tooLong ? "text-red-600" : "text-stone-400"}`}>
            {diary.length} / {MAX_DIARY_CHARS}
          </p>
          <button type="button" onClick={split} disabled={diary.trim().length === 0 || tooLong || busy !== null} className={BUTTON}>
            {busy === "split" ? "Splitting…" : "Split into notes"}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {items.length} proposed. Untick what you do not want, and fix anything that is wrong.
          </p>
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.key}
                className={`space-y-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700 ${item.keep ? "" : "opacity-50"}`}
              >
                <label className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-200">
                  <input
                    type="checkbox"
                    checked={item.keep}
                    onChange={(e) => change(item.key, { keep: e.target.checked })}
                    aria-label={`Keep this note: ${item.text.slice(0, 40)}`}
                  />
                  Keep
                </label>
                <textarea
                  value={item.text}
                  onChange={(e) => change(item.key, { text: e.target.value })}
                  maxLength={MAX_NOTE_CHARS}
                  rows={2}
                  aria-label="Note text"
                  className={FIELD}
                />
                <textarea
                  value={item.private ? "" : item.textEn}
                  onChange={(e) => change(item.key, { textEn: e.target.value })}
                  disabled={item.private}
                  rows={2}
                  aria-label="English version"
                  placeholder="English version"
                  className={FIELD}
                />
                <div className="flex flex-wrap items-center gap-3 text-sm text-stone-700 dark:text-stone-200">
                  <select
                    value={item.kind}
                    onChange={(e) => change(item.key, { kind: e.target.value as NoteKind })}
                    aria-label="Kind"
                    className={SELECT}
                  >
                    {NOTE_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {KIND_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  {item.kind === "event" && (
                    <input
                      type="date"
                      value={item.happenedOn}
                      onChange={(e) => change(item.key, { happenedOn: e.target.value })}
                      aria-label="Date"
                      className={SELECT}
                    />
                  )}
                  <select
                    value={item.scope}
                    onChange={(e) => change(item.key, { scope: e.target.value as NoteScope })}
                    aria-label="Use in"
                    className={SELECT}
                  >
                    {NOTE_SCOPES.map((value) => (
                      <option key={value} value={value}>
                        {SCOPE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={item.private}
                      onChange={(e) => change(item.key, { private: e.target.checked })}
                    />
                    🔒 Private
                  </label>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={kept.length === 0 || busy !== null} className={PRIMARY}>
              {busy === "save" ? "Saving…" : `Save ${kept.length} ${kept.length === 1 ? "note" : "notes"}`}
            </button>
            <button type="button" onClick={() => setItems(null)} disabled={busy !== null} className={BUTTON}>
              Cancel
            </button>
          </div>
        </>
      )}

      {problem && (
        <p role="alert" className={ERROR}>
          {problem}
        </p>
      )}
    </section>
  );
}
