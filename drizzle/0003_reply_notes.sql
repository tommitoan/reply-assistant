-- Personal notes: facts about the writer that replies may use. A private note
-- can never hold an English version or an embedding (profile_notes_private_check),
-- so nothing derived from it exists. generations.note_ids is filled when notes
-- start to be used in replies. Additive: the previous code keeps working.
CREATE TABLE "profile_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"text_en" text,
	"kind" text DEFAULT 'fact' NOT NULL,
	"happened_on" date,
	"scope" text DEFAULT 'both' NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"embedding" vector(1024),
	"embedding_en" vector(1024),
	"embed_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_notes_kind_check" CHECK ("profile_notes"."kind" IN ('fact','event')),
	CONSTRAINT "profile_notes_scope_check" CHECK ("profile_notes"."scope" IN ('work','casual','both')),
	CONSTRAINT "profile_notes_status_check" CHECK ("profile_notes"."status" IN ('active','suggested','archived','dismissed')),
	CONSTRAINT "profile_notes_source_check" CHECK ("profile_notes"."source" IN ('manual','imported','suggested')),
	CONSTRAINT "profile_notes_private_check" CHECK (NOT "profile_notes"."private" OR ("profile_notes"."text_en" IS NULL AND "profile_notes"."embedding" IS NULL AND "profile_notes"."embedding_en" IS NULL AND NOT "profile_notes"."pinned"))
);
--> statement-breakpoint
ALTER TABLE "reply_usage" DROP CONSTRAINT "reply_usage_kind_check";--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "note_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE INDEX "profile_notes_status_idx" ON "profile_notes" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "reply_usage" ADD CONSTRAINT "reply_usage_kind_check" CHECK ("reply_usage"."kind" IN ('generate','refine','explain','summary','style_profile','embedding','warm','notes'));