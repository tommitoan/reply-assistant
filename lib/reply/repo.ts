import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import type { ReplyDb } from "./db";
import { generations, replyOptions, replyUsage } from "./schema";
import { appendChosenReply, removeChosenReply, replaceChosenReply, type Tx } from "./thread-store";
import type {
  DevelopedGroup,
  ModelTier,
  OptionRating,
  RecentGeneration,
  ReplyContext,
  ReplyMode,
  ReplyOptionDraft,
  ReplyOptionView,
  ReplySpeed,
  ReplyUsage,
  StoredOption,
} from "./types";

export interface NewGeneration {
  mode: ReplyMode;
  context: ReplyContext;
  inputText: string;
  model: string;
  tier: ModelTier;
  speed: ReplySpeed;
  learn: boolean;
  useMemory: boolean;
  // The request this one redoes ("better" regenerate).
  parentGenerationId?: string;
  // reply_options rows injected into the prompt as memory examples.
  memoryExampleIds?: string[];
  // The conversation thread this request was made in, if any.
  conversationId?: string;
  // The style profile whose rules were in the prompt, if any.
  styleProfileId?: string;
  // Set when this request develops an existing reply: the reply it grew from
  // and the direction kept for learning. The direction is never empty.
  refineOfOptionId?: string;
  refineInstruction?: string;
}

// What a request to develop a reply needs from the reply and its request.
export interface RefineBase {
  optionId: string;
  generationId: string;
  // The wording the writer sees: their own edit when there is one.
  text: string;
  mode: ReplyMode;
  context: ReplyContext;
  inputText: string;
  conversationId: string | null;
  learn: boolean;
  // True when this reply is itself a developed version.
  developed: boolean;
}

// Which requests the recent list shows: all, those made outside any thread
// (conversationId null), or those made in one thread.
export interface RecentScope {
  conversationId: string | null;
}

export interface OptionUpdate {
  rating?: OptionRating | null;
  editedText?: string | null;
  chosen?: boolean;
}

export interface FinishedGeneration {
  model: string;
  options: ReplyOptionDraft[];
  // The notes of the writer the reply used, when it was offered any.
  noteIds?: string[];
  usage: ReplyUsage;
  costUsd: number | null;
  firstTokenMs: number | null;
  totalMs: number;
}

export interface FailedGeneration {
  status: "error" | "refused";
  model?: string;
  usage?: ReplyUsage;
  costUsd?: number | null;
  firstTokenMs?: number | null;
  totalMs?: number;
}

// The storage operations the generate flow needs. The Drizzle implementation
// is below; tests substitute an in-memory one.
export interface ReplyRepo {
  spentTodayUsd(now?: Date): Promise<number>;
  createGeneration(input: NewGeneration): Promise<string>;
  finishGeneration(id: string, result: FinishedGeneration): Promise<ReplyOptionView[]>;
  failGeneration(id: string, update: FailedGeneration): Promise<void>;
  generationExists(id: string): Promise<boolean>;
  // Null when the option does not exist.
  getRefineBase(optionId: string): Promise<RefineBase | null>;
  // Returns null when the option does not exist.
  updateOption(id: string, update: OptionUpdate): Promise<StoredOption | null>;
  listRecentGenerations(limit: number, scope?: RecentScope): Promise<RecentGeneration[]>;
}

type OptionRow = typeof replyOptions.$inferSelect;

function toStoredOption(row: OptionRow): StoredOption {
  return {
    id: row.id,
    generationId: row.generationId,
    variant: row.variant as StoredOption["variant"],
    text: row.text,
    rating: row.rating as OptionRating | null,
    editedText: row.editedText,
    chosen: row.chosen,
  };
}

// The daily budget resets at 00:00 UTC.
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatCost(costUsd: number | null | undefined): string | null {
  return costUsd === null || costUsd === undefined ? null : costUsd.toFixed(6);
}

// Anything that can run a statement, so the same insert works inside a
// transaction and outside one.
type Executor = Pick<ReplyDb, "execute">;

// Records what a request cost in the usage table. The conversation link is
// copied from the request's own row.
async function recordGenerationUsage(
  executor: Executor,
  id: string,
  model: string | undefined,
  usage: ReplyUsage,
  costUsd: number | null | undefined,
): Promise<void> {
  await executor.execute(sql`
    insert into reply_usage (kind, model, conversation_id, generation_id,
                             input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd)
    select case when g.refine_instruction is not null then 'refine' else 'generate' end,
           coalesce(${model ?? null}::text, g.model), g.conversation_id, g.id,
           ${usage.input_tokens}::int, ${usage.output_tokens}::int,
           ${usage.cache_creation_input_tokens}::int, ${usage.cache_read_input_tokens}::int,
           ${formatCost(costUsd)}::numeric
    from generations g where g.id = ${id}`);
}

// Keeps the Vietnamese explanation of a pasted message with its request.
export async function saveExplanation(db: ReplyDb, generationId: string, text: string): Promise<void> {
  await db.update(generations).set({ explanation: text }).where(eq(generations.id, generationId));
}

// Finished requests that developed any of the given replies, oldest first, each
// with its options.
async function loadDeveloped(db: ReplyDb, optionIds: string[]): Promise<DevelopedGroup[]> {
  if (optionIds.length === 0) return [];
  const requests = await db
    .select({
      id: generations.id,
      createdAt: generations.createdAt,
      refineOfOptionId: generations.refineOfOptionId,
      refineInstruction: generations.refineInstruction,
    })
    .from(generations)
    .where(and(inArray(generations.refineOfOptionId, optionIds), eq(generations.status, "done")))
    .orderBy(asc(generations.createdAt));
  if (requests.length === 0) return [];

  const rows = await db
    .select()
    .from(replyOptions)
    .where(
      inArray(
        replyOptions.generationId,
        requests.map((request) => request.id),
      ),
    )
    .orderBy(asc(replyOptions.position));

  return requests.flatMap((request) =>
    request.refineOfOptionId === null
      ? []
      : [
          {
            generationId: request.id,
            ofOptionId: request.refineOfOptionId,
            instruction: request.refineInstruction ?? "",
            createdAt: request.createdAt.toISOString(),
            options: rows.filter((row) => row.generationId === request.id).map(toStoredOption),
          },
        ],
  );
}

// The requests that answer one turn: the original request and every request
// that developed one of its replies. Choosing any reply among them replaces the
// choice made among the others, so a thread never gets two messages for one turn.
async function familyGenerationIds(
  tx: Tx,
  generationId: string,
  refineOfOptionId: string | null,
): Promise<string[]> {
  let rootId = generationId;
  if (refineOfOptionId) {
    const [base] = await tx
      .select({ generationId: replyOptions.generationId })
      .from(replyOptions)
      .where(eq(replyOptions.id, refineOfOptionId))
      .limit(1);
    if (base) rootId = base.generationId;
  }
  const developed = await tx
    .select({ id: generations.id })
    .from(generations)
    .innerJoin(replyOptions, eq(generations.refineOfOptionId, replyOptions.id))
    .where(eq(replyOptions.generationId, rootId));
  return [rootId, ...developed.map((row) => row.id)];
}

export function createReplyRepo(db: ReplyDb): ReplyRepo {
  return {
    // Counts every paid call, not only replies: summaries, explanations,
    // style profiles and embeddings spend the same budget.
    async spentTodayUsd(now = new Date()) {
      const [row] = await db
        .select({ total: sql<string | null>`coalesce(sum(${replyUsage.costUsd}), 0)` })
        .from(replyUsage)
        .where(gte(replyUsage.createdAt, utcDayStart(now)));
      return Number(row?.total ?? 0);
    },

    async createGeneration(input) {
      const [row] = await db
        .insert(generations)
        .values({
          mode: input.mode,
          context: input.context,
          inputText: input.inputText,
          model: input.model,
          speed: input.speed,
          learn: input.learn,
          useMemory: input.useMemory,
          parentGenerationId: input.parentGenerationId ?? null,
          memoryExampleIds: input.memoryExampleIds ?? [],
          conversationId: input.conversationId ?? null,
          styleProfileId: input.styleProfileId ?? null,
          refineOfOptionId: input.refineOfOptionId ?? null,
          refineInstruction: input.refineInstruction ?? null,
          status: "streaming",
        })
        .returning({ id: generations.id });
      return row.id;
    },

    async finishGeneration(id, result) {
      return db.transaction(async (tx) => {
        await tx
          .update(generations)
          .set({
            status: "done",
            model: result.model,
            usage: result.usage,
            costUsd: formatCost(result.costUsd),
            firstTokenMs: result.firstTokenMs,
            totalMs: result.totalMs,
            ...(result.noteIds ? { noteIds: result.noteIds } : {}),
          })
          .where(eq(generations.id, id));
        await recordGenerationUsage(tx, id, result.model, result.usage, result.costUsd);

        const rows = await tx
          .insert(replyOptions)
          .values(
            result.options.map((option, index) => ({
              generationId: id,
              variant: option.variant,
              position: index,
              text: option.text,
            })),
          )
          .returning({
            id: replyOptions.id,
            variant: replyOptions.variant,
            text: replyOptions.text,
            position: replyOptions.position,
          });

        return rows
          .sort((a, b) => a.position - b.position)
          .map((row) => ({
            id: row.id,
            variant: row.variant as ReplyOptionView["variant"],
            text: row.text,
          }));
      });
    },

    async failGeneration(id, update) {
      await db.transaction(async (tx) => {
        await tx
          .update(generations)
          .set({
            status: update.status,
            ...(update.model ? { model: update.model } : {}),
            usage: update.usage ?? null,
            costUsd: formatCost(update.costUsd),
            firstTokenMs: update.firstTokenMs ?? null,
            totalMs: update.totalMs ?? null,
          })
          .where(eq(generations.id, id));
        // A refused or empty answer was still paid for.
        if (update.usage) await recordGenerationUsage(tx, id, update.model, update.usage, update.costUsd);
      });
    },

    async generationExists(id) {
      const [row] = await db
        .select({ id: generations.id })
        .from(generations)
        .where(eq(generations.id, id))
        .limit(1);
      return row !== undefined;
    },

    async getRefineBase(optionId) {
      const [row] = await db
        .select({
          optionId: replyOptions.id,
          generationId: replyOptions.generationId,
          text: replyOptions.text,
          editedText: replyOptions.editedText,
          mode: generations.mode,
          context: generations.context,
          inputText: generations.inputText,
          conversationId: generations.conversationId,
          learn: generations.learn,
          refineInstruction: generations.refineInstruction,
        })
        .from(replyOptions)
        .innerJoin(generations, eq(replyOptions.generationId, generations.id))
        .where(eq(replyOptions.id, optionId))
        .limit(1);
      if (!row) return null;
      return {
        optionId: row.optionId,
        generationId: row.generationId,
        text: row.editedText ?? row.text,
        mode: row.mode as ReplyMode,
        context: row.context as ReplyContext,
        inputText: row.inputText,
        conversationId: row.conversationId,
        learn: row.learn,
        developed: row.refineInstruction !== null,
      };
    },

    async updateOption(id, update) {
      return db.transaction(async (tx) => {
        const [current] = await tx.select().from(replyOptions).where(eq(replyOptions.id, id)).limit(1);
        if (!current) return null;

        const [generation] = await tx
          .select({
            conversationId: generations.conversationId,
            refineOfOptionId: generations.refineOfOptionId,
          })
          .from(generations)
          .where(eq(generations.id, current.generationId))
          .limit(1);
        const conversationId = generation?.conversationId ?? null;

        const changes: Partial<typeof replyOptions.$inferInsert> = {};
        if (update.rating !== undefined) {
          changes.rating = update.rating;
          changes.ratedAt = update.rating === null ? null : new Date();
        }
        if (update.editedText !== undefined) {
          // Saving the model's own text back is the same as having no edit.
          changes.editedText = update.editedText === current.text ? null : update.editedText;
        }

        // Replies picked earlier for the same turn lose their mark below.
        let displaced: OptionRow[] = [];
        if (update.chosen !== undefined) {
          changes.chosen = update.chosen;
          if (update.chosen) {
            const family = await familyGenerationIds(tx, current.generationId, generation?.refineOfOptionId ?? null);
            displaced = await tx
              .select()
              .from(replyOptions)
              .where(
                and(
                  inArray(replyOptions.generationId, family),
                  ne(replyOptions.id, id),
                  eq(replyOptions.chosen, true),
                ),
              );
            // One reply is "the one I used" per turn, whether it is an original
            // option or a developed version of one.
            await tx
              .update(replyOptions)
              .set({ chosen: false })
              .where(and(inArray(replyOptions.generationId, family), ne(replyOptions.id, id)));
          }
        }

        const [row] = await tx.update(replyOptions).set(changes).where(eq(replyOptions.id, id)).returning();

        // In a thread, the reply that was used is the writer's own next message.
        if (conversationId) {
          const wording = (option: OptionRow) => option.editedText ?? option.text;
          if (row.chosen && !current.chosen) {
            for (const other of displaced) await removeChosenReply(tx, conversationId, wording(other));
            await appendChosenReply(tx, conversationId, wording(row));
          } else if (!row.chosen && current.chosen) {
            await removeChosenReply(tx, conversationId, wording(current));
          } else if (row.chosen && wording(row) !== wording(current)) {
            await replaceChosenReply(tx, conversationId, wording(current), wording(row));
          }
        }

        return toStoredOption(row);
      });
    },

    async listRecentGenerations(limit, scope) {
      const rows = await db
        .select({
          id: generations.id,
          createdAt: generations.createdAt,
          context: generations.context,
          // A pasted conversation can be long; the list only needs a preview.
          inputText: sql<string>`left(${generations.inputText}, 300)`,
          model: generations.model,
        })
        .from(generations)
        .where(
          and(
            eq(generations.status, "done"),
            // Developed versions are listed under the reply they grew from.
            isNull(generations.refineOfOptionId),
            scope === undefined
              ? undefined
              : scope.conversationId === null
                ? isNull(generations.conversationId)
                : eq(generations.conversationId, scope.conversationId),
          ),
        )
        .orderBy(desc(generations.createdAt))
        .limit(limit);
      if (rows.length === 0) return [];

      const options = await db
        .select()
        .from(replyOptions)
        .where(
          inArray(
            replyOptions.generationId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(asc(replyOptions.position));

      const developed = await loadDeveloped(
        db,
        options.map((option) => option.id),
      );
      return rows.map((row) => {
        const own = options.filter((option) => option.generationId === row.id).map(toStoredOption);
        const ownIds = new Set(own.map((option) => option.id));
        return {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          context: row.context as ReplyContext,
          inputText: row.inputText,
          model: row.model,
          options: own,
          developed: developed.filter((group) => ownIds.has(group.ofOptionId)),
        };
      });
    },
  };
}
