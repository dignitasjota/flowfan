CREATE TYPE "public"."scheduled_post_status" AS ENUM('scheduled', 'processing', 'posted', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."social_account_connection" AS ENUM('native', 'webhook');--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"title" varchar(500),
	"content" text NOT NULL,
	"media_urls" text[] DEFAULT '{}',
	"target_platforms" text[] NOT NULL,
	"platform_configs" jsonb DEFAULT '{}'::jsonb,
	"schedule_at" timestamp NOT NULL,
	"timezone" varchar(60) DEFAULT 'UTC' NOT NULL,
	"status" "scheduled_post_status" DEFAULT 'scheduled' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"published_at" timestamp,
	"external_post_ids" jsonb DEFAULT '{}'::jsonb,
	"job_id" varchar(255),
	"created_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_type" "platform_type" NOT NULL,
	"connection_type" "social_account_connection" DEFAULT 'webhook' NOT NULL,
	"account_username" varchar(255),
	"encrypted_credentials" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_verified_at" timestamp,
	"last_error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_created_by_id_creators_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_posts_creator_idx" ON "scheduled_posts" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "scheduled_posts_creator_schedule_idx" ON "scheduled_posts" USING btree ("creator_id","schedule_at");--> statement-breakpoint
CREATE INDEX "scheduled_posts_status_idx" ON "scheduled_posts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_creator_platform_idx" ON "social_accounts" USING btree ("creator_id","platform_type");