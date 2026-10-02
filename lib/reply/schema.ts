import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Embedding width must match REPLY_EMBED_MODEL. Changing the model means a new
// migration plus a backfill, because vectors of different widths cannot share
// a column.
export const EMBEDDING_DIMENSIONS = 1024;

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default(""),
    context: text("context").notNull(),
    summary: text("summary"),
    summaryUptoSeq: integer("summary_upto_seq"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("conversations_context_check", sql`${t.context} IN ('work','casual')`)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    author: text("author").notNull(),
    text: text("text").notNull(),
    // Hash of the normalized text; paste de-duplication compares these.
    normHash: text("norm_hash").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("messages_conversation_seq_unique").on(t.conversationId, t.seq),
    check("messages_author_check", sql`${t.author} IN ('them','me','unknown')`),
    check("messages_source_check", sql`${t.source} IN ('pasted','chosen_reply')`),
  ],
);

export const generations = pgTable(
  "generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    parentGenerationId: uuid("parent_generation_id").references(
      (): AnyPgColumn => generations.id,
      { onDelete: "set null" },
    ),
    mode: text("mode").notNull(),
    context: text("context").notNull(),
    inputText: text("input_text").notNull(),
    inputEmbedding: vector("input_embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embedModel: text("embed_model"),
    model: text("model").notNull(),
    speed: text("speed").notNull(),
    learn: boolean("learn").notNull(),
    useMemory: boolean("use_memory").notNull(),
    // reply_options rows that were injected into the prompt as examples.
    memoryExampleIds: uuid("memory_example_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    styleProfileId: uuid("style_profile_id"),
    // The Vietnamese translation and notes on the other person's message,
    // for requests that pasted a conversation.
    explanation: text("explanation"),
    // profile_notes rows the writer's notes block carried into the prompt.
    noteIds: uuid("note_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    // Set on a developed version: the reply it grew from and what the writer
    // asked for. The instruction is always set on such a request, even when
    // the link was cleared later, so it also marks the row as a refinement.
    refineOfOptionId: uuid("refine_of_option_id").references((): AnyPgColumn => replyOptions.id, {
      onDelete: "set null",
    }),
    refineInstruction: text("refine_instruction"),
    status: text("status").notNull(),
    // Raw API usage, including cache read/write token counts.
    usage: jsonb("usage"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    firstTokenMs: integer("first_token_ms"),
    totalMs: integer("total_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("generations_mode_check", sql`${t.mode} IN ('vi_to_en','en_reply')`),
    check("generations_context_check", sql`${t.context} IN ('work','casual')`),
    check("generations_speed_check", sql`${t.speed} IN ('auto','fast','smart')`),
    check(
      "generations_status_check",
      sql`${t.status} IN ('streaming','done','error','refused')`,
    ),
    index("generations_embedding_hnsw").using(
      "hnsw",
      t.inputEmbedding.op("vector_cosine_ops"),
    ),
    index("generations_lookup").on(t.mode, t.context, t.learn, t.createdAt.desc()),
    index("generations_refine_idx").on(t.refineOfOptionId),
  ],
);

export const replyOptions = pgTable(
  "reply_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    variant: text("variant").notNull(),
    position: smallint("position").notNull(),
    text: text("text").notNull(),
    rating: text("rating"),
    // The user's own rewrite; the strongest learning signal.
    editedText: text("edited_text"),
    chosen: boolean("chosen").notNull().default(false),
    ratedAt: timestamp("rated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("reply_options_variant_check", sql`${t.variant} IN ('short','medium','long','alt')`),
    check("reply_options_rating_check", sql`${t.rating} IN ('good','bad')`),
    index("reply_options_generation_idx").on(t.generationId),
  ],
);

export const styleProfiles = pgTable("style_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  rules: text("rules").notNull(),
  sourceCounts: jsonb("source_counts").notNull(),
  model: text("model").notNull(),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per paid model call, whichever feature made it. It outlives the
// request and the thread it belongs to (both links are cleared, not cascaded),
// so deleting a conversation never erases what it cost.
export const replyUsage = pgTable(
  "reply_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    model: text("model").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    generationId: uuid("generation_id").references(() => generations.id, { onDelete: "set null" }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    // Null when the model has no known price.
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  },
  (t) => [
    check(
      "reply_usage_kind_check",
      sql`${t.kind} IN ('generate','refine','explain','summary','style_profile','embedding','warm','notes')`,
    ),
    index("reply_usage_created_idx").on(t.createdAt.desc()),
    index("reply_usage_conversation_idx").on(t.conversationId),
  ],
);

// Facts about the writer's own life, which replies may use when they fit.
// `text` is what the writer wrote; `text_en` is an English version, because a
// note matches English messages far better in English. A private note is kept
// in the app only: the check below makes it impossible to store an English
// version or an embedding for one, so nothing derived from it can exist.
export const profileNotes = pgTable(
  "profile_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    text: text("text").notNull(),
    textEn: text("text_en"),
    // fact: stays true ("I work as a backend engineer"); event: happened once.
    kind: text("kind").notNull().default("fact"),
    // When an event happened, so old events can count for less.
    happenedOn: date("happened_on", { mode: "string" }),
    scope: text("scope").notNull().default("both"),
    private: boolean("private").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("manual"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingEn: vector("embedding_en", { dimensions: EMBEDDING_DIMENSIONS }),
    embedModel: text("embed_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("profile_notes_kind_check", sql`${t.kind} IN ('fact','event')`),
    check("profile_notes_scope_check", sql`${t.scope} IN ('work','casual','both')`),
    check("profile_notes_status_check", sql`${t.status} IN ('active','suggested','archived','dismissed')`),
    check("profile_notes_source_check", sql`${t.source} IN ('manual','imported','suggested')`),
    check(
      "profile_notes_private_check",
      sql`NOT ${t.private} OR (${t.textEn} IS NULL AND ${t.embedding} IS NULL AND ${t.embeddingEn} IS NULL AND NOT ${t.pinned})`,
    ),
    index("profile_notes_status_idx").on(t.status, t.createdAt.desc()),
  ],
);
