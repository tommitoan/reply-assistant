import { chunkByTokens, DEFAULT_REQUEST_TOKENS } from "./embed-limiter";
import type { Embedder } from "./embeddings";
import type { NoteNeedingEmbedding, NotesRepo } from "./notes-store";

export const NOTE_BACKFILL_BATCH = 20;

export interface NoteBackfillResult {
  embedded: number;
  // Notes in the group that could not be embedded; the pass stops there.
  failed: number;
}

export interface EmbedPendingNotesOptions {
  batchSize?: number;
  maxTokens?: number;
}

// Splits notes into groups that each fit one embedding request. A note's size
// is its text and its English version, counted without sharing, to be safe.
function groupsOf(notes: NoteNeedingEmbedding[], maxTokens: number): NoteNeedingEmbedding[][] {
  const sizes = notes.map((note) => `${note.text}${note.textEn ?? ""}`);
  const groups: NoteNeedingEmbedding[][] = [];
  let offset = 0;
  for (const chunk of chunkByTokens(sizes, maxTokens)) {
    groups.push(notes.slice(offset, offset + chunk.length));
    offset += chunk.length;
  }
  return groups;
}

// One request for one group: every text of every note in it, each once. Null
// means the whole group failed, so nothing is saved for it.
async function embedGroup(repo: NotesRepo, embedder: Embedder, group: NoteNeedingEmbedding[]): Promise<boolean> {
  const texts = [...new Set(group.flatMap((note) => (note.textEn ? [note.text, note.textEn] : [note.text])))];
  const vectors = await embedder.embedMany(texts);
  if (!vectors) return false;

  const byText = new Map(texts.map((text, index) => [text, vectors[index]]));
  for (const note of group) {
    await repo.saveEmbeddings(
      note.id,
      { embedding: byText.get(note.text)!, embeddingEn: note.textEn ? (byText.get(note.textEn) ?? null) : null },
      embedder.model,
    );
  }
  return true;
}

// Embeds some of the notes that are still waiting, with ONE request to the
// provider. The app runs this in the background when the notes page is opened,
// so a note saved while the per-minute budget was spent catches up by itself.
// Private notes are never listed.
export async function embedPendingNotes(
  repo: NotesRepo,
  embedder: Embedder,
  { batchSize = NOTE_BACKFILL_BATCH, maxTokens = DEFAULT_REQUEST_TOKENS }: EmbedPendingNotesOptions = {},
): Promise<NoteBackfillResult> {
  const notes = await repo.listNeedingEmbedding(embedder.model, batchSize, 0);
  const [group] = groupsOf(notes, maxTokens);
  if (!group) return { embedded: 0, failed: 0 };
  return (await embedGroup(repo, embedder, group)) ? { embedded: group.length, failed: 0 } : { embedded: 0, failed: group.length };
}

export interface NoteBackfillOptions extends EmbedPendingNotesOptions {
  onProgress?: (done: number) => void;
  // Wait this long between requests, so a run stays inside a per-minute limit.
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Embeds every note that has no up-to-date vectors: notes saved while embedding
// was unavailable, or that carry vectors from another model. Each group is one
// request; the first failed request ends the pass, because it means the
// service is unavailable. Private notes are never listed.
export async function backfillNoteEmbeddings(
  repo: NotesRepo,
  embedder: Embedder,
  {
    batchSize = NOTE_BACKFILL_BATCH,
    maxTokens = DEFAULT_REQUEST_TOKENS,
    onProgress,
    pauseMs = 0,
    sleep = realSleep,
  }: NoteBackfillOptions = {},
): Promise<NoteBackfillResult> {
  let embedded = 0;
  let requests = 0;

  for (;;) {
    const notes = await repo.listNeedingEmbedding(embedder.model, batchSize, 0);
    if (notes.length === 0) return { embedded, failed: 0 };

    for (const group of groupsOf(notes, maxTokens)) {
      if (requests > 0 && pauseMs > 0) await sleep(pauseMs);
      requests += 1;
      if (!(await embedGroup(repo, embedder, group))) return { embedded, failed: group.length };
      embedded += group.length;
      onProgress?.(embedded);
    }
  }
}
