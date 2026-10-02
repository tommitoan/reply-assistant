import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { ReplyDb } from "./db";
import type { MemoryCandidate } from "./memory";
import { generations, replyOptions } from "./schema";
import type { OptionRating, ReplyContext, ReplyMode } from "./types";

export interface MemoryFilter {
  mode: ReplyMode;
  context: ReplyContext;
}

export interface UnembeddedGeneration {
  id: string;
  mode: ReplyMode;
  inputText: string;
}

export interface MemoryRepo {
  // The nearest earlier replies that carry a positive signal, closest first.
  findCandidates(embedding: number[], filter: MemoryFilter, limit: number): Promise<MemoryCandidate[]>;
  saveEmbedding(generationId: string, embedding: number[], model: string): Promise<void>;
  // Learnable requests with no embedding from `model` yet. `offset` skips rows
  // that were tried and failed, so a pass over a batch always ends.
  listNeedingEmbedding(model: string, limit: number, offset: number): Promise<UnembeddedGeneration[]>;
}

// pgvector reads its text form: "[0.1,0.2,...]".
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export function createMemoryRepo(db: ReplyDb): MemoryRepo {
  return {
    async findCandidates(embedding, { mode, context }, limit) {
      const distance = sql<number>`(${generations.inputEmbedding} <=> ${toVectorLiteral(embedding)}::vector)`;
      const rows = await db
        .select({
          optionId: replyOptions.id,
          generationId: generations.id,
          input: generations.inputText,
          text: replyOptions.text,
          editedText: replyOptions.editedText,
          chosen: replyOptions.chosen,
          rating: replyOptions.rating,
          position: replyOptions.position,
          distance,
        })
        .from(replyOptions)
        .innerJoin(generations, eq(replyOptions.generationId, generations.id))
        .where(
          and(
            // "Learn off" requests are kept but never used as memory.
            eq(generations.learn, true),
            eq(generations.status, "done"),
            eq(generations.mode, mode),
            eq(generations.context, context),
            isNotNull(generations.inputEmbedding),
            or(
              isNotNull(replyOptions.editedText),
              eq(replyOptions.rating, "good"),
              and(eq(replyOptions.chosen, true), or(isNull(replyOptions.rating), ne(replyOptions.rating, "bad"))),
            ),
          ),
        )
        .orderBy(distance)
        .limit(limit);

      return rows.map((row) => ({
        optionId: row.optionId,
        generationId: row.generationId,
        input: row.input,
        text: row.text,
        editedText: row.editedText,
        chosen: row.chosen,
        rating: row.rating as OptionRating | null,
        position: row.position,
        distance: Number(row.distance),
      }));
    },

    async saveEmbedding(generationId, embedding, model) {
      await db
        .update(generations)
        .set({ inputEmbedding: embedding, embedModel: model })
        .where(eq(generations.id, generationId));
    },

    async listNeedingEmbedding(model, limit, offset) {
      const rows = await db
        .select({ id: generations.id, mode: generations.mode, inputText: generations.inputText })
        .from(generations)
        .where(
          and(
            eq(generations.learn, true),
            eq(generations.status, "done"),
            or(
              isNull(generations.inputEmbedding),
              isNull(generations.embedModel),
              ne(generations.embedModel, model),
            ),
          ),
        )
        .orderBy(asc(generations.createdAt), asc(generations.id))
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({ id: row.id, mode: row.mode as ReplyMode, inputText: row.inputText }));
    },
  };
}
