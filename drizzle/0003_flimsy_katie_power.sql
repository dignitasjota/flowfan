ALTER TABLE "scheduled_posts" ADD COLUMN "recurrence_rule" jsonb;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "recurrence_count" integer DEFAULT 0 NOT NULL;