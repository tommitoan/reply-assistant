import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { ReplyDb } from "./db";
import { MAX_EXPORT_ROWS, type ExportRow, type ThreadMessageRow } from "./export";
import { generations, messages, replyOptions } from "./schema";
import type { MessageAuthor } from "./types";

export interface ExportRepo {
  // Replies kept for learning that the user edited or liked, oldest first.
  loadRows(): Promise<ExportRow[]>;
  loadMessages(conversationIds: string[]): Promise<ThreadMessageRow[]>;
}

export function createExportRepo(db: ReplyDb): ExportRepo {
  return {
    async loadRows() {
      return db
        .select({
          mode: generations.mode,
          context: generations.context,
          inputText: generations.inputText,
          text: replyOptions.text,
          editedText: replyOptions.editedText,
          createdAt: generations.createdAt,
          conversationId: generations.conversationId,
          refineInstruction: generations.refineInstruction,
        })
        .from(replyOptions)
        .innerJoin(generations, eq(replyOptions.generationId, generations.id))
        .where(
          and(
            // "Learn off" requests are kept but never exported.
            eq(generations.learn, true),
            eq(generations.status, "done"),
            or(isNotNull(replyOptions.editedText), eq(replyOptions.rating, "good")),
          ),
        )
        .orderBy(asc(generations.createdAt), asc(replyOptions.position))
        .limit(MAX_EXPORT_ROWS);
    },

    async loadMessages(conversationIds) {
      if (conversationIds.length === 0) return [];
      const rows = await db
        .select({
          conversationId: messages.conversationId,
          author: messages.author,
          text: messages.text,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(inArray(messages.conversationId, conversationIds))
        .orderBy(asc(messages.createdAt));
      return rows.map((row) => ({ ...row, author: row.author as MessageAuthor }));
    },
  };
}
