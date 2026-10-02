"use client";

import { useCallback, useEffect, useState } from "react";
import { MAX_NOTE_CHARS, MAX_NOTE_EN_CHARS } from "@/lib/reply/limits";
import { NOTE_SCOPES, type NoteRecord, type NoteScope } from "@/lib/reply/types";
import { approveSuggestion, dismissSuggestion, listSuggestions, type ApprovalChanges } from "./notesApi";
import { CARD, ERROR, FIELD, PRIMARY, SCOPE_LABELS, SELECT, SMALL } from "./notesUi";

// One proposal: the writer can fix the wording, choose where it is used and pin
// it, then add it to their notes or dismiss it.
function Suggestion({
  note,
  onApprove,
  onDismiss,
}: {
  note: NoteRecord;
  onApprove: (changes: ApprovalChanges) => Promise<boolean>;
  onDismiss: () => Promise<boolean>;
}) {
  const [text, setText] = useState(note.text);
  const [textEn, setTextEn] = useState(note.textEn ?? "");
  const [scope, setScope] = useState<NoteScope>(note.scope);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<boolean>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  function approve() {
    const changes: ApprovalChanges = { scope, pinned };
    if (text.trim() !== note.text) changes.text = text.trim();
    if (textEn.trim() !== (note.textEn ?? "")) changes.textEn = textEn.trim() || null;
    return run(() => onApprove(changes));
  }

  return (
    <article id={`note-${note.id}`} className={`${CARD} space-y-2`}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_NOTE_CHARS}
        rows={2}
        aria-label="Suggested note"
        className={FIELD}
      />
      <textarea
        value={textEn}
        onChange={(e) => setTextEn(e.target.value)}
        maxLength={MAX_NOTE_EN_CHARS}
        rows={2}
        aria-label="English version of the suggested note"
        placeholder="English version (written for you when you add it, if empty)"
        className={FIELD}
      />
      <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
        <label className="flex items-center gap-1">
          Use in
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as NoteScope)}
            disabled={busy}
            aria-label="Use in"
            className={`${SELECT} !py-0.5 text-xs`}
          >
            {NOTE_SCOPES.map((value) => (
              <option key={value} value={value}>
                {SCOPE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={pinned} disabled={busy} onChange={(e) => setPinned(e.target.checked)} />
          Pin
        </label>
        {note.kind === "event" && <span>event{note.happenedOn ? ` · ${note.happenedOn}` : ""}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={approve} disabled={busy || text.trim().length === 0} className={PRIMARY}>
          {busy ? "Saving…" : "Add to my notes"}
        </button>
        <button type="button" onClick={() => void run(onDismiss)} disabled={busy} className={SMALL}>
          Dismiss
        </button>
      </div>
    </article>
  );
}

// Facts the app noticed in what you typed. Nothing here is used in a reply until
// you add it; a dismissed one is not proposed again.
export default function SuggestionsInbox({ onApproved }: { onApproved: () => void }) {
  const [notes, setNotes] = useState<NoteRecord[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listSuggestions()
      .then((list) => {
        if (!cancelled) setNotes(list);
      })
      .catch(() => {
        // The inbox is an extra: when it cannot load, the notes page still works.
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const decide = useCallback(
    async (action: () => Promise<unknown>, approved: boolean): Promise<boolean> => {
      setProblem(null);
      try {
        await action();
        setVersion((value) => value + 1);
        if (approved) onApproved();
        return true;
      } catch (err) {
        setProblem(err instanceof Error ? err.message : "Could not save that.");
        return false;
      }
    },
    [onApproved],
  );

  if (notes === null || (notes.length === 0 && problem === null)) return null;

  return (
    <section aria-label="Suggested notes" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">
          💡 Suggested notes ({notes.length})
        </h2>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Facts about you that the app noticed in what you typed. Nothing is used in a reply until you add it.
        </p>
      </div>
      {problem && (
        <p role="alert" className={ERROR}>
          {problem}
        </p>
      )}
      <ul className="space-y-3">
        {notes.map((note) => (
          <li key={note.id}>
            <Suggestion
              note={note}
              onApprove={(changes) => decide(() => approveSuggestion(note.id, changes), true)}
              onDismiss={() => decide(() => dismissSuggestion(note.id), false)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
