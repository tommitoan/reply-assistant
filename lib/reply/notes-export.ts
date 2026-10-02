import type { NoteKind, NoteRecord, NoteScope } from "./types";

// A safety cap; a personal collection stays far below it.
export const MAX_NOTES_EXPORT = 5000;

export interface ExportedNote {
  text: string;
  textEn: string | null;
  kind: NoteKind;
  happenedOn: string | null;
  scope: NoteScope;
  pinned: boolean;
  archived: boolean;
  source: string;
  createdAt: string;
}

export interface NotesExport {
  exportedAt: string;
  // How many private notes were left out. A private note stays in the app.
  privateOmitted: number;
  notes: ExportedNote[];
}

// The writer's notes as a plain file. Only active and archived notes that are
// not private: a private note is never sent anywhere, and neither are the
// app's own unapproved or dismissed suggestions. No embeddings, no ids.
export function toNotesExport(records: NoteRecord[], privateOmitted: number, now: Date): NotesExport {
  const notes = records
    .filter((note) => !note.private && (note.status === "active" || note.status === "archived"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(
      (note): ExportedNote => ({
        text: note.text,
        textEn: note.textEn,
        kind: note.kind,
        happenedOn: note.happenedOn,
        scope: note.scope,
        pinned: note.pinned,
        archived: note.status === "archived",
        source: note.source,
        createdAt: note.createdAt,
      }),
    );
  return { exportedAt: now.toISOString(), privateOmitted, notes };
}

export function notesExportFilename(now: Date): string {
  return `notes-export-${now.toISOString().slice(0, 10).replaceAll("-", "")}.json`;
}
