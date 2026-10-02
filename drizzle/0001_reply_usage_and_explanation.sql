CREATE TABLE "reply_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"conversation_id" uuid,
	"generation_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6),
	CONSTRAINT "reply_usage_kind_check" CHECK ("reply_usage"."kind" IN ('generate','explain','summary','style_profile','embedding','warm'))
);
--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "reply_usage" ADD CONSTRAINT "reply_usage_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_usage" ADD CONSTRAINT "reply_usage_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reply_usage_created_idx" ON "reply_usage" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reply_usage_conversation_idx" ON "reply_usage" USING btree ("conversation_id");--> statement-breakpoint
-- Carry existing request costs into the usage table, so totals and the daily
-- budget keep counting what was already spent. Runs once, with the migration.
INSERT INTO "reply_usage" ("created_at", "kind", "model", "conversation_id", "generation_id", "input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "cost_usd")
SELECT "created_at", 'generate', "model", "conversation_id", "id",
  COALESCE(("usage"->>'input_tokens')::int, 0),
  COALESCE(("usage"->>'output_tokens')::int, 0),
  COALESCE(("usage"->>'cache_creation_input_tokens')::int, 0),
  COALESCE(("usage"->>'cache_read_input_tokens')::int, 0),
  "cost_usd"
FROM "generations"
WHERE "usage" IS NOT NULL OR "cost_usd" IS NOT NULL;
