import { and, asc, desc, eq, inArray, isNotNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { ReplyDb } from "./db";
import { MAX_PINNED_NOTES } from "./limits";
import { toVectorLiteral } from "./memory-repo";
import type { SimilarNote, UsableNote } from "./notes-select";
import { profileNotes } from "./schema";
import type { NoteKind, ReplyContext } from "./types";

// Which notes a request may use. The rules live here, in the queries, and
// nowhere else: only active notes that are not private, and only those whose
// scope is this request's context or both. No caller can widen them.
export interface NotesReadFilter {
  context: ReplyContext;
  // Notes the writer switched off for this request.
  excludeIds?: string[];
}

export interface NotesReader {
  // The pinned notes, in a fixed order, so the cached prefix built from them stays the same.
  listPinned(filter: NotesReadFilter): Promise<UsableNote[]>;
  // The notes that are not pinned, oldest first. Ask for one more than the
  // limit you care about to learn whether there are more.
  listUnpinned(filter: NotesReadFilter, limit: number): Promise<UsableNote[]>;
  // The unpinned notes nearest in meaning to a vector, best first. Only notes
  // embedded with `model` are compared; each is scored by the better of its two
  // vectors (the writer's text and the English version).
  findSimilar(vector: number[], model: string, filter: NotesReadFilter, limit: number): Promise<SimilarNote[]>;
  // One note, if this request may use it.
  getUsable(id: string, filter: NotesReadFilter): Promise<UsableNote | null>;
}

const usableColumns = {
  id: profileNotes.id,
  text: profileNotes.text,
  textEn: profileNotes.textEn,
  kind: profileNotes.kind,
  happenedOn: profileNotes.happenedOn,
  pinned: profileNotes.pinned,
};

type Row = { id: string; text: string; textEn: string | null; kind: string; happenedOn: string | null; pinned: boolean };

const toUsable = (row: Row): UsableNote => ({
  id: row.id,
  text: row.text,
  textEn: row.textEn,
  kind: row.kind as NoteKind,
  happenedOn: row.happenedOn,
  pinned: row.pinned,
});

function allowed({ context, excludeIds = [] }: NotesReadFilter): SQL {
  return and(
    eq(profileNotes.status, "active"),
    eq(profileNotes.private, false),
    inArray(profileNotes.scope, [context, "both"]),
    excludeIds.length > 0 ? notInArray(profileNotes.id, excludeIds) : undefined,
  ) as SQL;
}

export function createNotesReader(db: ReplyDb): NotesReader {
  return {
    async listPinned(filter) {
      const rows = await db
        .select(usableColumns)
        .from(profileNotes)
        .where(and(allowed(filter), eq(profileNotes.pinned, true)))
        .orderBy(asc(profileNotes.createdAt), asc(profileNotes.id))
        .limit(MAX_PINNED_NOTES);
      return rows.map(toUsable);
    },

    async listUnpinned(filter, limit) {
      const rows = await db
        .select(usableColumns)
        .from(profileNotes)
        .where(and(allowed(filter), eq(profileNotes.pinned, false)))
        .orderBy(asc(profileNotes.createdAt), asc(profileNotes.id))
        .limit(limit);
      return rows.map(toUsable);
    },

    async findSimilar(vector, model, filter, limit) {
      const query = sql`${toVectorLiteral(vector)}::vector`;
      // The better of the two similarities; a note without an English vector is judged on its own text.
      const similarity = sql<number>`greatest(1 - (${profileNotes.embedding} <=> ${query}), coalesce(1 - (${profileNotes.embeddingEn} <=> ${query}), -1))`;
      const rows = await db
        .select({ ...usableColumns, similarity })
        .from(profileNotes)
        .where(
          and(
            allowed(filter),
            eq(profileNotes.pinned, false),
            isNotNull(profileNotes.embedding),
            eq(profileNotes.embedModel, model),
          ),
        )
        .orderBy(desc(similarity))
        .limit(limit);
      return rows.map((row) => ({ ...toUsable(row), similarity: Number(row.similarity) }));
    },

    async getUsable(id, filter) {
      const [row] = await db
        .select(usableColumns)
        .from(profileNotes)
        .where(and(allowed({ ...filter, excludeIds: [] }), eq(profileNotes.id, id)))
        .limit(1);
      return row ? toUsable(row) : null;
    },
  };
}
