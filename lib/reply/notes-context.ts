import type { Embedder } from "./embeddings";
import type { NotesReader } from "./notes-read";
import {
  labelNotes,
  noteWording,
  NOTE_SUGGESTIONS_MAX,
  notesQueryText,
  pickSimilar,
  SMALL_COLLECTION_MAX,
  type LabelledNote,
  type UsableNote,
} from "./notes-select";
import type { PromptNote } from "./prompt";
import type { NotesStatus, ReplyContext, ReplyMode } from "./types";

export interface NotesUseDeps {
  reader: NotesReader;
  // For the lookup a reply waits for; null when the server has no embedding key,
  // in which case only a small collection (sent whole) and pinned notes work.
  embedder: Embedder | null;
  // The embedding model the notes were embedded with; only those are compared.
  embedModel: string;
  now?: () => Date;
}

// How the notes will be found for one request:
// whole  - a pasted message and a small collection: every note goes to the model, which picks;
// search - a pasted message and a larger collection: the nearest few go to the model;
// chips  - a typed idea: nothing is put in the replies, the nearest notes are only suggested;
// none   - no note could apply.
export type NotesStrategy = "whole" | "search" | "chips" | "none";

export interface NotesPlan {
  strategy: NotesStrategy;
  // The notes the request may use, already filtered in the database.
  pinned: UsableNote[];
  everything: UsableNote[];
  // What to embed to search, or null when no search is needed.
  queryText: string | null;
  // The lookup itself failed, so the request goes on without notes.
  failed: boolean;
}

const EMPTY_PLAN: NotesPlan = { strategy: "none", pinned: [], everything: [], queryText: null, failed: false };

interface PlanInput {
  mode: ReplyMode;
  context: ReplyContext;
  // What the writer sent: a pasted chat, or a typed Vietnamese idea.
  input: string;
  // Notes switched off for this request.
  excludeIds: string[];
}

// Reads the notes this request may use, and decides how to find the right
// ones. A failure to read is not a failure of the request: it goes on without notes.
export async function planNotes(deps: NotesUseDeps, { mode, context, input, excludeIds }: PlanInput): Promise<NotesPlan> {
  const filter = { context, excludeIds };
  try {
    const [pinned, unpinned] = await Promise.all([
      deps.reader.listPinned(filter),
      // One more than "small", to learn whether the collection is.
      deps.reader.listUnpinned(filter, SMALL_COLLECTION_MAX + 1),
    ]);

    if (mode === "en_reply") {
      if (unpinned.length === 0) return { ...EMPTY_PLAN, pinned };
      if (unpinned.length <= SMALL_COLLECTION_MAX) return { ...EMPTY_PLAN, strategy: "whole", pinned, everything: unpinned };
      return { ...EMPTY_PLAN, strategy: "search", pinned, everything: unpinned, queryText: notesQueryText(input) };
    }

    // A typed idea: the notes are suggested, never inserted.
    if (unpinned.length === 0) return { ...EMPTY_PLAN, pinned };
    return { ...EMPTY_PLAN, strategy: "chips", pinned, everything: unpinned, queryText: input.trim() };
  } catch (err) {
    console.error("[reply/notes] could not read the notes", err);
    return { ...EMPTY_PLAN, failed: true };
  }
}

export interface NotesChoice {
  status: NotesStatus;
  pinned: UsableNote[];
  // Notes put in this request for the model to use or leave.
  offered: UsableNote[];
  // Notes the writer may add to a typed idea with one click.
  suggestions: UsableNote[];
}

// Settles which notes go with the request, once the query's vector is known
// (null when there was none to make, or it could not be made).
export async function chooseNotes(
  deps: NotesUseDeps,
  plan: NotesPlan,
  vector: number[] | null,
  context: ReplyContext,
  excludeIds: string[],
): Promise<NotesChoice> {
  const none = (status: NotesStatus): NotesChoice => ({ status, pinned: plan.pinned, offered: [], suggestions: [] });
  if (plan.failed) return none("skipped");

  const today = (deps.now ?? (() => new Date()))();

  if (plan.strategy === "whole") return { ...none("ready"), offered: plan.everything };
  if (plan.strategy === "none") return none(plan.pinned.length > 0 ? "ready" : "empty");

  // Search and chips both need the nearest notes by meaning.
  if (!vector) return none("skipped");
  try {
    const rows = await deps.reader.findSimilar(vector, deps.embedModel, { context, excludeIds }, 20);
    if (plan.strategy === "search") {
      const offered = pickSimilar(rows, today);
      return { ...none(offered.length > 0 || plan.pinned.length > 0 ? "ready" : "empty"), offered };
    }
    const suggestions = pickSimilar(rows, today, NOTE_SUGGESTIONS_MAX);
    return { ...none(suggestions.length > 0 ? "ready" : "empty"), suggestions };
  } catch (err) {
    console.error("[reply/notes] could not search the notes", err);
    return none("skipped");
  }
}

export function toPromptNote({ label, note }: LabelledNote): PromptNote {
  return {
    label,
    text: noteWording(note),
    kind: note.kind,
    when: note.kind === "event" && note.happenedOn ? note.happenedOn.slice(0, 7) : null,
  };
}

// The numbered notes for one request: pinned first, then the offered ones.
export function labelledFor(choice: NotesChoice): LabelledNote[] {
  return labelNotes(choice.pinned, choice.offered);
}
