import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { ReplyDb } from "./db";
import { conversations, messages } from "./schema";
import { hashText, mergePaste as mergeIntoThread } from "./thread-merge";
import type {
  ConversationListItem,
  ConversationRecord,
  MessageAuthor,
  MessageSource,
  ReplyContext,
  StoredMessage,
} from "./types";

export type Tx = Parameters<Parameters<ReplyDb["transaction"]>[0]>[0];

export interface MergeOutcome {
  conversation: ConversationRecord;
  messages: StoredMessage[];
  added: number;
  skipped: number;
}

export interface ConversationUpdate {
  title?: string;
  context?: ReplyContext;
  archived?: boolean;
}

export interface ThreadRepo {
  listConversations(options: { archived: boolean; limit: number }): Promise<ConversationListItem[]>;
  createConversation(input: { title: string; context: ReplyContext }): Promise<ConversationRecord>;
  getConversation(id: string): Promise<ConversationRecord | null>;
  getMessages(conversationId: string): Promise<StoredMessage[]>;
  updateConversation(id: string, update: ConversationUpdate): Promise<ConversationRecord | null>;
  // Deletes the thread and, through the foreign keys, its messages and the
  // requests (with their replies) that were made in it.
  deleteConversation(id: string): Promise<boolean>;
  // Adds the new part of a pasted conversation. Null when the thread is gone.
  mergePaste(conversationId: string, paste: string, selfNames: readonly string[]): Promise<MergeOutcome | null>;
  saveSummary(conversationId: string, summary: string, uptoSeq: number): Promise<void>;
}

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

const TITLE_CHARS = 60;

function toConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    context: row.context as ReplyContext,
    summary: row.summary,
    summaryUptoSeq: row.summaryUptoSeq,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    seq: row.seq,
    author: row.author as MessageAuthor,
    text: row.text,
    source: row.source as MessageSource,
    createdAt: row.createdAt.toISOString(),
  };
}

// A thread with no title takes its name from its first message.
function titleFrom(text: string): string {
  const firstLine = text.split("\n")[0].replace(/\s+/g, " ").trim();
  return firstLine.length > TITLE_CHARS ? `${firstLine.slice(0, TITLE_CHARS).trimEnd()}…` : firstLine;
}

async function lockConversation(tx: Tx, conversationId: string): Promise<ConversationRow | null> {
  const [row] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .for("update")
    .limit(1);
  return row ?? null;
}

async function nextSeq(tx: Tx, conversationId: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${messages.seq}), 0)` })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  return Number(row?.max ?? 0) + 1;
}

// Adds a reply picked with "Use this" to its thread as the writer's own message.
export async function appendChosenReply(tx: Tx, conversationId: string, text: string): Promise<void> {
  if (!(await lockConversation(tx, conversationId))) return;
  await tx.insert(messages).values({
    conversationId,
    seq: await nextSeq(tx, conversationId),
    author: "me",
    text,
    normHash: hashText(text),
    source: "chosen_reply",
  });
  await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
}

// The newest picked reply with exactly this text, if any. Picked replies carry
// no link to the option they came from, so the text is how they are found.
async function findChosenReply(tx: Tx, conversationId: string, text: string): Promise<MessageRow | undefined> {
  const [row] = await tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.source, "chosen_reply"),
        eq(messages.text, text),
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(1);
  return row;
}

export async function removeChosenReply(tx: Tx, conversationId: string, text: string): Promise<void> {
  const row = await findChosenReply(tx, conversationId, text);
  if (row) await tx.delete(messages).where(eq(messages.id, row.id));
}

export async function replaceChosenReply(
  tx: Tx,
  conversationId: string,
  oldText: string,
  newText: string,
): Promise<void> {
  const row = await findChosenReply(tx, conversationId, oldText);
  if (row) {
    await tx.update(messages).set({ text: newText, normHash: hashText(newText) }).where(eq(messages.id, row.id));
  }
}

export function createThreadRepo(db: ReplyDb): ThreadRepo {
  return {
    async listConversations({ archived, limit }) {
      // Written out in full: inside a subquery drizzle leaves the table name off
      // a column, so `conversation_id = id` would compare the messages table with
      // itself and always count zero.
      const count = sql<number>`(select count(*) from messages m where m.conversation_id = "conversations"."id")`;
      const rows = await db
        .select({
          id: conversations.id,
          title: conversations.title,
          context: conversations.context,
          archived: conversations.archived,
          updatedAt: conversations.updatedAt,
          messageCount: count,
        })
        .from(conversations)
        .where(eq(conversations.archived, archived))
        .orderBy(desc(conversations.updatedAt))
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        context: row.context as ReplyContext,
        archived: row.archived,
        updatedAt: row.updatedAt.toISOString(),
        messageCount: Number(row.messageCount),
      }));
    },

    async createConversation({ title, context }) {
      const [row] = await db.insert(conversations).values({ title, context }).returning();
      return toConversation(row);
    },

    async getConversation(id) {
      const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
      return row ? toConversation(row) : null;
    },

    async getMessages(conversationId) {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.seq));
      return rows.map(toMessage);
    },

    async updateConversation(id, update) {
      const [row] = await db
        .update(conversations)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(conversations.id, id))
        .returning();
      return row ? toConversation(row) : null;
    },

    async deleteConversation(id) {
      const rows = await db.delete(conversations).where(eq(conversations.id, id)).returning({ id: conversations.id });
      return rows.length > 0;
    },

    async mergePaste(conversationId, paste, selfNames) {
      return db.transaction(async (tx) => {
        // Holding the thread's row keeps two pastes from numbering messages alike.
        const conversation = await lockConversation(tx, conversationId);
        if (!conversation) return null;

        const existing = await tx
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(asc(messages.seq));

        const result = mergeIntoThread(
          existing.map((row) => ({
            author: row.author as MessageAuthor,
            source: row.source as MessageSource,
            text: row.text,
            normHash: row.normHash,
          })),
          paste,
          selfNames,
        );

        let inserted: MessageRow[] = [];
        let latest = conversation;
        if (result.appended.length > 0) {
          const first = (existing.at(-1)?.seq ?? 0) + 1;
          inserted = await tx
            .insert(messages)
            .values(
              result.appended.map((block, index) => ({
                conversationId,
                seq: first + index,
                author: block.author,
                text: block.text,
                normHash: block.normHash,
                source: "pasted",
              })),
            )
            .returning();
          const [updated] = await tx
            .update(conversations)
            .set({
              updatedAt: new Date(),
              ...(conversation.title === "" ? { title: titleFrom(result.appended[0].text) } : {}),
            })
            .where(eq(conversations.id, conversationId))
            .returning();
          latest = updated;
        }

        return {
          conversation: toConversation(latest),
          messages: [...existing, ...inserted].map(toMessage),
          added: result.appended.length,
          skipped: result.skippedDuplicates,
        };
      });
    },

    async saveSummary(conversationId, summary, uptoSeq) {
      await db
        .update(conversations)
        .set({ summary, summaryUptoSeq: uptoSeq })
        .where(eq(conversations.id, conversationId));
    },
  };
}
