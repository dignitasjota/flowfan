CREATE TYPE "public"."comment_moderation_status" AS ENUM('visible', 'hidden', 'reported');--> statement-breakpoint
ALTER TABLE "social_comments" ADD COLUMN "moderation_status" "comment_moderation_status" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_comments" ADD COLUMN "moderated_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_comments" ADD COLUMN "moderated_by_id" uuid;--> statement-breakpoint
ALTER TABLE "social_comments" ADD COLUMN "moderation_reason" text;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_moderated_by_id_creators_id_fk" FOREIGN KEY ("moderated_by_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;