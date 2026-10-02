-- Developing a reply: the new request records which reply it grew from and the
-- direction given, and usage rows may carry the new kind 'refine'. Additive:
-- the previous code keeps working until it is replaced.
ALTER TABLE "reply_usage" DROP CONSTRAINT "reply_usage_kind_check";--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "refine_of_option_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "refine_instruction" text;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_refine_of_option_id_reply_options_id_fk" FOREIGN KEY ("refine_of_option_id") REFERENCES "public"."reply_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generations_refine_idx" ON "generations" USING btree ("refine_of_option_id");--> statement-breakpoint
ALTER TABLE "reply_usage" ADD CONSTRAINT "reply_usage_kind_check" CHECK ("reply_usage"."kind" IN ('generate','refine','explain','summary','style_profile','embedding','warm'));