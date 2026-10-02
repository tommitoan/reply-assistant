CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"context" text NOT NULL,
	"summary" text,
	"summary_upto_seq" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_context_check" CHECK ("conversations"."context" IN ('work','casual'))
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"parent_generation_id" uuid,
	"mode" text NOT NULL,
	"context" text NOT NULL,
	"input_text" text NOT NULL,
	"input_embedding" vector(1024),
	"embed_model" text,
	"model" text NOT NULL,
	"speed" text NOT NULL,
	"learn" boolean NOT NULL,
	"use_memory" boolean NOT NULL,
	"memory_example_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"style_profile_id" uuid,
	"status" text NOT NULL,
	"usage" jsonb,
	"cost_usd" numeric(10, 6),
	"first_token_ms" integer,
	"total_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generations_mode_check" CHECK ("generations"."mode" IN ('vi_to_en','en_reply')),
	CONSTRAINT "generations_context_check" CHECK ("generations"."context" IN ('work','casual')),
	CONSTRAINT "generations_speed_check" CHECK ("generations"."speed" IN ('auto','fast','smart')),
	CONSTRAINT "generations_status_check" CHECK ("generations"."status" IN ('streaming','done','error','refused'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"author" text NOT NULL,
	"text" text NOT NULL,
	"norm_hash" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_conversation_seq_unique" UNIQUE("conversation_id","seq"),
	CONSTRAINT "messages_author_check" CHECK ("messages"."author" IN ('them','me','unknown')),
	CONSTRAINT "messages_source_check" CHECK ("messages"."source" IN ('pasted','chosen_reply'))
);
--> statement-breakpoint
CREATE TABLE "reply_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"position" smallint NOT NULL,
	"text" text NOT NULL,
	"rating" text,
	"edited_text" text,
	"chosen" boolean DEFAULT false NOT NULL,
	"rated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_options_variant_check" CHECK ("reply_options"."variant" IN ('short','medium','long','alt')),
	CONSTRAINT "reply_options_rating_check" CHECK ("reply_options"."rating" IN ('good','bad'))
);
--> statement-breakpoint
CREATE TABLE "style_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rules" text NOT NULL,
	"source_counts" jsonb NOT NULL,
	"model" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_parent_generation_id_generations_id_fk" FOREIGN KEY ("parent_generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_options" ADD CONSTRAINT "reply_options_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generations_embedding_hnsw" ON "generations" USING hnsw ("input_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "generations_lookup" ON "generations" USING btree ("mode","context","learn","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reply_options_generation_idx" ON "reply_options" USING btree ("generation_id");