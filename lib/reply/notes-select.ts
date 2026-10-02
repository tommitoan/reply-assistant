import type { NoteKind, NoteRef } from "./types";

// Starting values. The floor in particular must be tuned on the writer's real
// notes: the spike found only about 0.05 between a right match and a wrong one,
// so embeddings narrow the list and the model makes the final choice.
export const SMALL_COLLECTION_MAX = 30;
export const NOTES_SIMILARITY_FLOOR = 0.4;
export const NOTES_TOP_K = 5;
export const NOTE_SUGGESTIONS_MAX = 3;
// An event a year old (or older) counts this much less than one from today.
export const EVENT_FADE_MAX = 0.15;
export const FADE_FULL_AFTER_DAYS = 365;
// A pasted chat is matched on its newest part, which is what the reply answers.
export const NOTES_QUERY_CHARS = 600;
// How much of a note is shown on a reply.
export const NOTE_REF_CHARS = 160;

// A note that may be used in a reply: it is active, not private, and fits the
// request's scope. Filtering for that happens in the database, never here.
export interface UsableNote {
  id: string;
  text: string;
  // The English version, when there is one.
  textEn: string | null;
  kind: NoteKind;
  // YYYY-MM-DD, for an event.
  happenedOn: string | null;
  pinned: boolean;
}

export interface SimilarNote extends UsableNote {
  // Cosine similarity of the better of the note's two vectors (1 = same meaning).
  similarity: number;
}

// Replies are written in English, so the English version is what the model sees.
export const noteWording = (note: Pick<UsableNote, "text" | "textEn">): string => note.textEn ?? note.text;

const DAY_MS = 86_400_000;

// A fact does not fade. An event counts a little less as it gets older.
export function fadeFactor(note: Pick<UsableNote, "kind" | "happenedOn">, today: Date): number {
  if (note.kind !== "event" || !note.happenedOn) return 1;
  // Whole days: an event from earlier today has not aged.
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const ageDays = (todayStart - new Date(`${note.happenedOn}T00:00:00Z`).getTime()) / DAY_MS;
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return 1 - EVENT_FADE_MAX * Math.min(1, ageDays / FADE_FULL_AFTER_DAYS);
}

// Keeps the notes that are close enough in meaning, best first. The floor is
// applied to the raw similarity; the ranking also lets old events count less.
export function pickSimilar(rows: SimilarNote[], today: Date, limit = NOTES_TOP_K): SimilarNote[] {
  return rows
    .filter((row) => row.similarity >= NOTES_SIMILARITY_FLOOR)
    .map((row) => ({ row, score: row.similarity * fadeFactor(row, today) }))
    .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
    .slice(0, limit)
    .map(({ row }) => row);
}

// What a pasted chat is matched on.
export function notesQueryText(input: string): string {
  const trimmed = input.trim();
  return trimmed.length > NOTES_QUERY_CHARS ? trimmed.slice(-NOTES_QUERY_CHARS) : trimmed;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function toNoteRef(note: UsableNote): NoteRef {
  return { id: note.id, text: clip(noteWording(note), NOTE_REF_CHARS), pinned: note.pinned };
}

export interface LabelledNote {
  // The number the model uses to say which notes it used.
  label: number;
  note: UsableNote;
}

// Pinned notes first, then the others, numbered from 1 with no gaps, so the
// numbers of the pinned block (part of the cached prefix) never depend on the
// request.
export function labelNotes(pinned: UsableNote[], offered: UsableNote[]): LabelledNote[] {
  return [...pinned, ...offered].map((note, index) => ({ label: index + 1, note }));
}

// Turns the numbers the model reported back into notes. Numbers that were
// never offered are ignored, and a note counts once. Null (no report) means none.
export function usedNotes(labelled: LabelledNote[], used: number[] | null): UsableNote[] {
  if (!used) return [];
  const seen = new Set<string>();
  const notes: UsableNote[] = [];
  for (const label of used) {
    const found = labelled.find((entry) => entry.label === label);
    if (found && !seen.has(found.note.id)) {
      seen.add(found.note.id);
      notes.push(found.note);
    }
  }
  return notes;
}
