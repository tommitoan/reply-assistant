import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { ReplyDb } from "./db";
import { MAX_REMEMBERED_DISMISSED } from "./limits";
import { toVectorLiteral } from "./memory-repo";
import { profileNotes } from "./schema";
import type { NoteKind, NoteScope } from "./types";

export interface KnownText {
  text: string;
  textEn: string | null;
}

export interface NewSuggestion {
  text: string;
  textEn: string | null;
  kind: NoteKind;
  happenedOn: string | null;
  scope: NoteScope;
  embedding: number[] | null;
  embeddingEn: number[] | null;
  embedModel: string | null;
}

// What proposing notes needs from the database. A proposal waits as a note with
// status "suggested"; a dismissed one stays as "dismissed", which is how the app
// remembers not to propose it again.
export interface SuggestionsRepo {
  countWaiting(): Promise<number>;
  // The text of every note of every status, private ones included. It is only
  // compared here to spot a repeat and never leaves the server.
  listKnownTexts(): Promise<KnownText[]>;
  // The best similarity between a vector and any note that is not private, of
  // any status (so a dismissed or archived note counts); null when none is comparable.
  bestSimilarity(vector: number[], model: string): Promise<number | null>;
  // Saves proposals as waiting suggestions; returns how many were saved.
  save(rows: NewSuggestion[]): Promise<number>;
}

export function createSuggestionsRepo(db: ReplyDb): SuggestionsRepo {
  return {
    async countWaiting() {
      const [row] = (await db.execute(
        sql`select count(*)::int as n from profile_notes where status = 'suggested'`,
      )) as unknown as Array<{ n: number }>;
      return Number(row?.n ?? 0);
    },

    async listKnownTexts() {
      return db.select({ text: profileNotes.text, textEn: profileNotes.textEn }).from(profileNotes);
    },

    async bestSimilarity(vector, model) {
      const query = sql`${toVectorLiteral(vector)}::vector`;
      const similarity = sql<number>`greatest(1 - (${profileNotes.embedding} <=> ${query}), coalesce(1 - (${profileNotes.embeddingEn} <=> ${query}), -1))`;
      const [row] = await db
        .select({ similarity: sql<number>`max(${similarity})` })
        .from(profileNotes)
        .where(and(eq(profileNotes.private, false), isNotNull(profileNotes.embedding), eq(profileNotes.embedModel, model)));
      return row?.similarity === null || row?.similarity === undefined ? null : Number(row.similarity);
    },

    async save(rows) {
      if (rows.length === 0) return 0;
      await db.insert(profileNotes).values(
        rows.map((row) => ({
          text: row.text,
          textEn: row.textEn,
          kind: row.kind,
          happenedOn: row.happenedOn,
          scope: row.scope,
          private: false,
          pinned: false,
          status: "suggested",
          source: "suggested",
          embedding: row.embedding,
          embeddingEn: row.embeddingEn,
          embedModel: row.embedModel,
        })),
      );
      // Only the newest dismissed texts are remembered.
      await db.execute(sql`
        delete from profile_notes
        where status = 'dismissed'
          and id not in (
            select id from profile_notes where status = 'dismissed' order by updated_at desc limit ${MAX_REMEMBERED_DISMISSED}
          )`);
      return rows.length;
    },
  };
}
