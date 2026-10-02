import { chunkByTokens, DEFAULT_REQUEST_TOKENS } from "./embed-limiter";
import type { Embedder } from "./embeddings";
import { MAX_NOTES, MAX_PINNED_NOTES } from "./limits";
import type { NewNote, NoteChanges, NotesRepo } from "./notes-store";
import type { NoteInput, NotePatch, SuggestionReview } from "./schemas";
import type { NoteRecord, NoteSource, NoteSuggestion } from "./types";

// Notes written without an English version get one from the model, but a batch
// does not turn into dozens of model calls: past this many, the rest are saved
// without one (the writer can add it by hand).
export const MAX_ENGLISH_FILLS_PER_REQUEST = 5;

export interface NotesServiceDeps {
  repo: NotesRepo;
  // Null when the server has no embedding key: notes are then saved without vectors.
  embedder: Embedder | null;
  // Suggests an English version for one note. It is only ever given the text
  // of a note that is not private.
  suggest: (text: string) => Promise<NoteSuggestion | null>;
}

export type NotesResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; error: string };

const fail = (status: 400 | 404, error: string): { ok: false; status: 400 | 404; error: string } => ({
  ok: false,
  status,
  error,
});

interface Vectors {
  embedding: number[] | null;
  embeddingEn: number[] | null;
  embedModel: string | null;
}

const NO_VECTORS: Vectors = { embedding: null, embeddingEn: null, embedModel: null };

// Embeds the texts of several notes, as few requests as the provider's token
// limit allows (one, for a normal batch of notes). Fail-open: any problem means
// "no vectors yet", and the note is saved anyway (a later pass fills it in). A
// failed request ends the rest, because the next one would be refused too.
async function embedTexts(
  embedder: Embedder | null,
  items: Array<{ text: string; textEn: string | null }>,
): Promise<Vectors[]> {
  if (!embedder || items.length === 0) return items.map(() => NO_VECTORS);

  // The same text is embedded once, however many times it appears.
  const unique = [...new Set(items.flatMap((item) => (item.textEn ? [item.text, item.textEn] : [item.text])))];
  const byText = new Map<string, number[]>();
  for (const chunk of chunkByTokens(unique, DEFAULT_REQUEST_TOKENS)) {
    const vectors = await embedder.embedMany(chunk);
    if (!vectors) break;
    for (const [index, text] of chunk.entries()) byText.set(text, vectors[index]);
  }

  return items.map((item) => {
    const embedding = byText.get(item.text) ?? null;
    const embeddingEn = item.textEn ? (byText.get(item.textEn) ?? null) : null;
    return { embedding, embeddingEn, embedModel: embedding || embeddingEn ? embedder.model : null };
  });
}

// The date only means something for an event.
const dateFor = (kind: string, date: string | null | undefined): string | null => (kind === "event" ? (date ?? null) : null);

// Saves one or several notes. A private note keeps nothing but its own text: no
// English version, no vectors, no model call of any kind.
export async function createNotes(
  deps: NotesServiceDeps,
  inputs: NoteInput[],
  source: Extract<NoteSource, "manual" | "imported">,
): Promise<NotesResult<NoteRecord[]>> {
  const counts = await deps.repo.counts();
  if (counts.active + counts.archived + inputs.length > MAX_NOTES) {
    return fail(400, `You can keep at most ${MAX_NOTES} notes. Delete or archive some first.`);
  }
  const newPins = inputs.filter((input) => input.pinned && !input.private).length;
  if (counts.pinned + newPins > MAX_PINNED_NOTES) {
    return fail(400, `At most ${MAX_PINNED_NOTES} notes can be pinned.`);
  }

  // English versions: the writer's own wins; the model only fills a gap, and
  // never for a private note.
  const english: Array<string | null> = [];
  let fills = 0;
  for (const input of inputs) {
    if (input.private) {
      english.push(null);
    } else if (input.textEn !== undefined) {
      english.push(input.textEn);
    } else if (fills < MAX_ENGLISH_FILLS_PER_REQUEST) {
      fills += 1;
      english.push((await deps.suggest(input.text))?.textEn ?? null);
    } else {
      english.push(null);
    }
  }

  const vectors = await embedTexts(
    deps.embedder,
    inputs.flatMap((input, index) => (input.private ? [] : [{ text: input.text, textEn: english[index] }])),
  );

  let next = 0;
  const rows: NewNote[] = inputs.map((input, index) => {
    const own = input.private ? NO_VECTORS : vectors[next++];
    return {
      text: input.text,
      textEn: input.private ? null : english[index],
      kind: input.kind,
      happenedOn: dateFor(input.kind, input.happenedOn),
      scope: input.scope,
      private: input.private,
      pinned: input.private ? false : input.pinned,
      source,
      ...own,
    };
  });
  return { ok: true, value: await deps.repo.create(rows) };
}

// Changes a note. Anything that touches the text of a note that is not private
// refreshes its English version and vectors; a change of scope, pin or status
// makes no model or embedding call. Making a note private erases everything
// derived from it; making one public again is the one moment its text is sent
// out, because the writer asked for it to be used.
export async function updateNote(
  deps: NotesServiceDeps,
  id: string,
  patch: NotePatch,
): Promise<NotesResult<NoteRecord>> {
  const current = await deps.repo.get(id);
  if (!current) return fail(404, "That note was not found.");

  const isPrivate = patch.private ?? current.private;
  if (isPrivate && patch.pinned === true) {
    return fail(400, "A private note cannot be pinned: it is never used.");
  }
  const status = patch.status ?? current.status;
  // A private or archived note is never in a prompt, so it is not pinned.
  const pinned = isPrivate || status === "archived" ? false : (patch.pinned ?? current.pinned);
  if (pinned && !current.pinned && (await deps.repo.counts()).pinned >= MAX_PINNED_NOTES) {
    return fail(400, `At most ${MAX_PINNED_NOTES} notes can be pinned.`);
  }

  const kind = patch.kind ?? current.kind;
  const changes: NoteChanges = {
    kind,
    happenedOn: dateFor(kind, patch.happenedOn !== undefined ? patch.happenedOn : current.happenedOn),
    scope: patch.scope ?? current.scope,
    private: isPrivate,
    pinned,
    status,
  };
  if (patch.text !== undefined) changes.text = patch.text;

  if (isPrivate) {
    changes.textEn = null;
    changes.embedding = null;
    changes.embeddingEn = null;
    changes.embedModel = null;
  } else {
    const text = patch.text ?? current.text;
    const textChanged = patch.text !== undefined && patch.text !== current.text;
    const madePublic = current.private && !isPrivate;
    const englishGiven = patch.textEn !== undefined;
    const englishChanged = englishGiven && patch.textEn !== current.textEn;

    // The English version is stale or missing, and the writer gave no new one.
    let textEn = englishGiven ? (patch.textEn ?? null) : current.textEn;
    const needsEnglish = !englishGiven && (textChanged || madePublic);
    if (needsEnglish) textEn = (await deps.suggest(text))?.textEn ?? null;
    if (englishGiven || needsEnglish) changes.textEn = textEn;

    if (textChanged || madePublic || englishChanged || needsEnglish) {
      const [vectors] = await embedTexts(deps.embedder, [{ text, textEn }]);
      changes.embedding = vectors.embedding;
      changes.embeddingEn = vectors.embeddingEn;
      changes.embedModel = vectors.embedModel;
    }
  }

  const updated = await deps.repo.update(id, changes);
  if (!updated) return fail(404, "That note was not found.");
  // The wording of a note that is now private must not stay behind in the stored
  // direction of a reply that was developed with it.
  if (isPrivate && !current.private) await deps.repo.scrubDirections([id]);
  return { ok: true, value: updated };
}

// Approves or dismisses a note the app proposed. Approving makes it an ordinary
// active note (the writer may edit it, widen its scope or pin it first) that
// replies can use; dismissing keeps its text only so it is not proposed again.
export async function reviewSuggestion(
  deps: NotesServiceDeps,
  id: string,
  review: SuggestionReview,
): Promise<NotesResult<NoteRecord>> {
  const current = await deps.repo.get(id);
  if (!current || current.status !== "suggested") return fail(404, "That suggestion was not found.");

  if (review.decision === "dismiss") {
    const dismissed = await deps.repo.update(id, { status: "dismissed", pinned: false });
    return dismissed ? { ok: true, value: dismissed } : fail(404, "That suggestion was not found.");
  }

  const counts = await deps.repo.counts();
  if (counts.active + counts.archived + 1 > MAX_NOTES) {
    return fail(400, `You can keep at most ${MAX_NOTES} notes. Delete or archive some first.`);
  }

  const changes = review.changes ?? {};
  const patch: NotePatch = { ...changes, status: "active" };
  // A proposal may come without an English version; approving is the moment to
  // write one, unless the note is being made private.
  if (patch.textEn === undefined && !current.textEn && !(changes.private ?? false)) {
    const english = (await deps.suggest(changes.text ?? current.text))?.textEn;
    if (english) patch.textEn = english;
  }
  return updateNote(deps, id, patch);
}
