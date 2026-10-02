import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { ReplyDb } from "./db";
import { PERSONAL_DETAIL_TAG } from "./refine-directions";
import { profileNotes } from "./schema";
import type { NoteCounts, NoteKind, NoteRecord, NoteScope, NoteSource, NoteStatus } from "./types";

export interface NewNote {
  text: string;
  textEn: string | null;
  kind: NoteKind;
  happenedOn: string | null;
  scope: NoteScope;
  private: boolean;
  pinned: boolean;
  source: NoteSource;
  status?: NoteStatus;
  embedding?: number[] | null;
  embeddingEn?: number[] | null;
  embedModel?: string | null;
}

// Every field is optional; an absent field is left as it is, and null clears.
export interface NoteChanges {
  text?: string;
  textEn?: string | null;
  kind?: NoteKind;
  happenedOn?: string | null;
  scope?: NoteScope;
  private?: boolean;
  pinned?: boolean;
  status?: NoteStatus;
  embedding?: number[] | null;
  embeddingEn?: number[] | null;
  embedModel?: string | null;
}

export interface NoteFilter {
  // "suggested" is the inbox: notes proposed by the app and not yet approved.
  status: "active" | "archived" | "all" | "suggested";
  scope?: NoteScope;
  kind?: NoteKind;
  pinned?: boolean;
  private?: boolean;
}

export interface NoteNeedingEmbedding {
  id: string;
  text: string;
  textEn: string | null;
}

export interface NotesRepo {
  list(filter: NoteFilter, limit: number): Promise<NoteRecord[]>;
  get(id: string): Promise<NoteRecord | null>;
  // All or none: one statement.
  create(notes: NewNote[]): Promise<NoteRecord[]>;
  update(id: string, changes: NoteChanges): Promise<NoteRecord | null>;
  // Removes the row, and with it every embedding made from it.
  remove(id: string): Promise<boolean>;
  removeAll(): Promise<number>;
  // Removes the copy of a note's wording that a reply developed with it keeps in
  // its stored direction, which the style-profile builder and the export read.
  // The direction keeps its "[personal detail]" tag, so the row still marks a
  // developed reply. "all" covers every reply that used any note. A direction the
  // writer typed or chose from a quick button is not a copy and is left alone.
  scrubDirections(noteIds: string[] | "all"): Promise<number>;
  counts(): Promise<NoteCounts>;
  // Notes that can be embedded (never a private one) but have no up-to-date
  // vectors from `model`. `offset` skips rows that were tried and failed.
  listNeedingEmbedding(model: string, limit: number, offset: number): Promise<NoteNeedingEmbedding[]>;
  saveEmbeddings(
    id: string,
    vectors: { embedding: number[]; embeddingEn: number[] | null },
    model: string,
  ): Promise<void>;
}

// A private note is never embedded, so it is never "waiting" for an index.
const INDEXED = sql<boolean>`(${profileNotes.private} OR (${profileNotes.embedding} IS NOT NULL AND (${profileNotes.textEn} IS NULL OR ${profileNotes.embeddingEn} IS NOT NULL)))`;

// Embeddings stay in the database: they are never selected for the page.
const columns = {
  id: profileNotes.id,
  text: profileNotes.text,
  textEn: profileNotes.textEn,
  kind: profileNotes.kind,
  happenedOn: profileNotes.happenedOn,
  scope: profileNotes.scope,
  private: profileNotes.private,
  pinned: profileNotes.pinned,
  status: profileNotes.status,
  source: profileNotes.source,
  indexed: INDEXED,
  createdAt: profileNotes.createdAt,
  updatedAt: profileNotes.updatedAt,
};

type Row = {
  id: string;
  text: string;
  textEn: string | null;
  kind: string;
  happenedOn: string | null;
  scope: string;
  private: boolean;
  pinned: boolean;
  status: string;
  source: string;
  indexed: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: Row): NoteRecord {
  return {
    id: row.id,
    text: row.text,
    textEn: row.textEn,
    kind: row.kind as NoteKind,
    happenedOn: row.happenedOn,
    scope: row.scope as NoteScope,
    private: row.private,
    pinned: row.pinned,
    status: row.status as NoteStatus,
    source: row.source as NoteSource,
    indexed: Boolean(row.indexed),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function whereFor(filter: NoteFilter): SQL | undefined {
  const parts: Array<SQL | undefined> = [
    filter.status === "all"
      ? inArray(profileNotes.status, ["active", "archived"])
      : eq(profileNotes.status, filter.status),
    filter.scope ? eq(profileNotes.scope, filter.scope) : undefined,
    filter.kind ? eq(profileNotes.kind, filter.kind) : undefined,
    filter.pinned === undefined ? undefined : eq(profileNotes.pinned, filter.pinned),
    filter.private === undefined ? undefined : eq(profileNotes.private, filter.private),
  ];
  return and(...parts);
}

export function createNotesRepo(db: ReplyDb): NotesRepo {
  async function get(id: string): Promise<NoteRecord | null> {
    const [row] = await db.select(columns).from(profileNotes).where(eq(profileNotes.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  return {
    async list(filter, limit) {
      const rows = await db
        .select(columns)
        .from(profileNotes)
        // Pinned first, then newest.
        .where(whereFor(filter))
        .orderBy(desc(profileNotes.pinned), desc(profileNotes.createdAt))
        .limit(limit);
      return rows.map(toRecord);
    },

    get,

    async create(notes) {
      if (notes.length === 0) return [];
      const inserted = await db
        .insert(profileNotes)
        .values(
          notes.map((note) => ({
            text: note.text,
            textEn: note.textEn,
            kind: note.kind,
            happenedOn: note.happenedOn,
            scope: note.scope,
            private: note.private,
            pinned: note.pinned,
            status: note.status ?? "active",
            source: note.source,
            embedding: note.embedding ?? null,
            embeddingEn: note.embeddingEn ?? null,
            embedModel: note.embedModel ?? null,
          })),
        )
        .returning({ id: profileNotes.id });
      const rows = await db
        .select(columns)
        .from(profileNotes)
        .where(
          inArray(
            profileNotes.id,
            inserted.map((row) => row.id),
          ),
        )
        .orderBy(asc(profileNotes.createdAt));
      return rows.map(toRecord);
    },

    async update(id, changes) {
      const set: Partial<typeof profileNotes.$inferInsert> = { updatedAt: new Date() };
      if (changes.text !== undefined) set.text = changes.text;
      if (changes.textEn !== undefined) set.textEn = changes.textEn;
      if (changes.kind !== undefined) set.kind = changes.kind;
      if (changes.happenedOn !== undefined) set.happenedOn = changes.happenedOn;
      if (changes.scope !== undefined) set.scope = changes.scope;
      if (changes.private !== undefined) set.private = changes.private;
      if (changes.pinned !== undefined) set.pinned = changes.pinned;
      if (changes.status !== undefined) set.status = changes.status;
      if (changes.embedding !== undefined) set.embedding = changes.embedding;
      if (changes.embeddingEn !== undefined) set.embeddingEn = changes.embeddingEn;
      if (changes.embedModel !== undefined) set.embedModel = changes.embedModel;

      const [updated] = await db
        .update(profileNotes)
        .set(set)
        .where(eq(profileNotes.id, id))
        .returning({ id: profileNotes.id });
      return updated ? get(id) : null;
    },

    async scrubDirections(noteIds) {
      if (noteIds !== "all" && noteIds.length === 0) return 0;
      const used =
        noteIds === "all"
          ? sql`coalesce(cardinality(note_ids), 0) > 0`
          : sql`note_ids && array[${sql.join(
              noteIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )}]`;
      const rows = await db.execute(sql`
        update generations set refine_instruction = ${PERSONAL_DETAIL_TAG}
        where refine_instruction like ${`${PERSONAL_DETAIL_TAG} %`} and ${used}
        returning id`);
      return rows.length;
    },

    async remove(id) {
      await this.scrubDirections([id]);
      const rows = await db.delete(profileNotes).where(eq(profileNotes.id, id)).returning({ id: profileNotes.id });
      return rows.length > 0;
    },

    async removeAll() {
      await this.scrubDirections("all");
      const rows = await db.delete(profileNotes).returning({ id: profileNotes.id });
      return rows.length;
    },

    async counts() {
      const [row] = (await db.execute(sql`
        select
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where status = 'archived')::int as archived,
          count(*) filter (where status = 'active' and pinned)::int as pinned,
          count(*) filter (where status in ('active','archived') and private)::int as private,
          count(*) filter (where status in ('active','archived') and not ${INDEXED})::int as unindexed
        from profile_notes`)) as unknown as Array<Record<string, number>>;
      return {
        active: Number(row?.active ?? 0),
        archived: Number(row?.archived ?? 0),
        pinned: Number(row?.pinned ?? 0),
        private: Number(row?.private ?? 0),
        unindexed: Number(row?.unindexed ?? 0),
      };
    },

    async listNeedingEmbedding(model, limit, offset) {
      return db
        .select({ id: profileNotes.id, text: profileNotes.text, textEn: profileNotes.textEn })
        .from(profileNotes)
        .where(
          and(
            eq(profileNotes.private, false),
            inArray(profileNotes.status, ["active", "archived"]),
            or(
              isNull(profileNotes.embedding),
              isNull(profileNotes.embedModel),
              sql`${profileNotes.embedModel} <> ${model}`,
              sql`${profileNotes.textEn} IS NOT NULL AND ${profileNotes.embeddingEn} IS NULL`,
            ),
          ),
        )
        .orderBy(asc(profileNotes.createdAt), asc(profileNotes.id))
        .limit(limit)
        .offset(offset);
    },

    async saveEmbeddings(id, vectors, model) {
      await db
        .update(profileNotes)
        .set({ embedding: vectors.embedding, embeddingEn: vectors.embeddingEn, embedModel: model })
        .where(and(eq(profileNotes.id, id), eq(profileNotes.private, false)));
    },
  };
}
