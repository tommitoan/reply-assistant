"use client";

import { useCallback, useEffect, useState } from "react";
import { NOTE_KINDS, NOTE_SCOPES, type NoteCounts, type NoteKind, type NoteRecord, type NoteScope } from "@/lib/reply/types";
import DiaryImport from "./DiaryImport";
import NoteCard from "./NoteCard";
import NoteForm from "./NoteForm";
import SuggestionsInbox from "./SuggestionsInbox";
import {
  deleteAllNotes,
  deleteNote,
  listNotes,
  NO_FILTERS,
  updateNote,
  type NoteChanges,
  type NoteFilters,
} from "./notesApi";
import { BUTTON, ERROR, KIND_LABELS, SCOPE_LABELS, SELECT, SMALL } from "./notesUi";

// The About me page: add notes by hand or from a diary, then keep them tidy.
export default function NotesPanel() {
  const [filters, setFilters] = useState<NoteFilters>(NO_FILTERS);
  const [notes, setNotes] = useState<NoteRecord[] | null>(null);
  const [counts, setCounts] = useState<NoteCounts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [confirmingAll, setConfirmingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listNotes(filters)
      .then((body) => {
        if (cancelled) return;
        setNotes(body.notes);
        setCounts(body.counts);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load the notes.");
      });
    return () => {
      cancelled = true;
    };
  }, [filters, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  async function change(id: string, changes: NoteChanges): Promise<boolean> {
    setProblem(null);
    try {
      await updateNote(id, changes);
      reload();
      return true;
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save that.");
      return false;
    }
  }

  async function remove(id: string): Promise<void> {
    setProblem(null);
    try {
      await deleteNote(id);
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not delete that.");
    }
  }

  async function removeAll() {
    setProblem(null);
    try {
      const deleted = await deleteAllNotes();
      setConfirmingAll(false);
      setNotice(`Deleted ${deleted} ${deleted === 1 ? "note" : "notes"}.`);
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not delete the notes.");
    }
  }

  const total = counts ? counts.active + counts.archived : 0;

  return (
    <div className="space-y-6">
      <SuggestionsInbox onApproved={reload} />
      <NoteForm
        onSaved={() => {
          setNotice(null);
          reload();
        }}
      />
      <DiaryImport
        onSaved={(saved) => {
          setNotice(`Saved ${saved.length} ${saved.length === 1 ? "note" : "notes"}.`);
          reload();
        }}
      />

      <section aria-label="Your notes" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Your notes</h2>
          {counts && (
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {counts.active} active · {counts.pinned} pinned · {counts.private} private
              {counts.archived > 0 ? ` · ${counts.archived} archived` : ""}
            </p>
          )}
        </div>

        <p className="text-xs text-stone-500 dark:text-stone-400">
          <a href="/api/reply/notes/export" download className="underline">
            ⬇ Export my notes (JSON)
          </a>{" "}
          · private notes are not included
        </p>

        {counts && counts.unindexed > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {counts.unindexed} {counts.unindexed === 1 ? "note is" : "notes are"} not searchable yet, because the embedding
            service was unavailable when {counts.unindexed === 1 ? "it was" : "they were"} saved. Run{" "}
            <code>scripts/reply-backfill-note-embeddings.ts</code>, or edit the note to try again.
          </p>
        )}

        <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-3 text-sm text-stone-700 dark:text-stone-200">
          <select
            value={filters.scope}
            onChange={(e) => setFilters({ ...filters, scope: e.target.value as NoteScope | "" })}
            aria-label="Filter by scope"
            className={SELECT}
          >
            <option value="">Any scope</option>
            {NOTE_SCOPES.map((value) => (
              <option key={value} value={value}>
                {SCOPE_LABELS[value]}
              </option>
            ))}
          </select>
          <select
            value={filters.kind}
            onChange={(e) => setFilters({ ...filters, kind: e.target.value as NoteKind | "" })}
            aria-label="Filter by kind"
            className={SELECT}
          >
            <option value="">Facts and events</option>
            {NOTE_KINDS.map((value) => (
              <option key={value} value={value}>
                {KIND_LABELS[value]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.pinnedOnly}
              onChange={(e) => setFilters({ ...filters, pinnedOnly: e.target.checked })}
            />
            Pinned
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.privateOnly}
              onChange={(e) => setFilters({ ...filters, privateOnly: e.target.checked })}
            />
            Private
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.showArchived}
              onChange={(e) => setFilters({ ...filters, showArchived: e.target.checked })}
            />
            Show archived
          </label>
        </div>

        {notice && (
          <p role="status" className="text-xs text-green-700 dark:text-green-400">
            {notice}
          </p>
        )}
        {problem && (
          <p role="alert" className={ERROR}>
            {problem}
          </p>
        )}
        {loadError && notes === null && (
          <p role="alert" className={ERROR}>
            {loadError}
          </p>
        )}

        {notes !== null && notes.length === 0 && (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            {total === 0 ? "No notes yet. Add one above, or import a diary." : "No notes match these filters."}
          </p>
        )}
        <ul className="space-y-3">
          {(notes ?? []).map((note) => (
            <li key={note.id}>
              <NoteCard note={note} onChange={(changes) => change(note.id, changes)} onDelete={() => remove(note.id)} />
            </li>
          ))}
        </ul>

        {total > 0 && (
          <div className="pt-2">
            {confirmingAll ? (
              <p role="alertdialog" aria-label="Delete every note?" className={`${ERROR} flex flex-wrap items-center gap-2`}>
                <span className="flex-1">
                  Delete all {total} notes, including archived and private ones, and everything made from them? This cannot be
                  undone.
                </span>
                <button type="button" className={SMALL} onClick={removeAll}>
                  Delete everything
                </button>
                <button type="button" className={SMALL} onClick={() => setConfirmingAll(false)}>
                  Keep my notes
                </button>
              </p>
            ) : (
              <button type="button" className={BUTTON} onClick={() => setConfirmingAll(true)}>
                Delete all notes…
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
