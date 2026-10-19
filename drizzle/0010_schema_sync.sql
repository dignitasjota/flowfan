ALTER TYPE "public"."ai_request_type" ADD VALUE 'report';--> statement-breakpoint
ALTER TYPE "public"."ai_request_type" ADD VALUE 'price_advice';--> statement-breakpoint
ALTER TYPE "public"."scheduled_message_status" ADD VALUE 'sending' BEFORE 'sent';--> statement-breakpoint
CREATE TABLE "message_experiment_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"variant_key" varchar(40) NOT NULL,
	"message_id" uuid,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"replied" boolean DEFAULT false NOT NULL,
	"replied_at" timestamp,
	"reply_sentiment" real,
	"converted" boolean DEFAULT false NOT NULL,
	"converted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "message_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"platform_type" "platform_type",
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"winner_variant_key" varchar(40),
	"started_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referred_id" uuid NOT NULL,
	"plan" "subscription_plan" NOT NULL,
	"reward_cents" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_configs" ALTER COLUMN "model" SET DEFAULT 'claude-sonnet-4-6';--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "email_verification_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "referral_code" varchar(20);--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "referred_by_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;--> statement-breakpoint
ALTER TABLE "message_experiment_sends" ADD CONSTRAINT "message_experiment_sends_experiment_id_message_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."message_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_experiment_sends" ADD CONSTRAINT "message_experiment_sends_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_experiment_sends" ADD CONSTRAINT "message_experiment_sends_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_experiment_sends" ADD CONSTRAINT "message_experiment_sends_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_experiments" ADD CONSTRAINT "message_experiments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_creators_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referrer_id_creators_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referred_id_creators_id_fk" FOREIGN KEY ("referred_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_exp_sends_exp_idx" ON "message_experiment_sends" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "message_exp_sends_exp_variant_idx" ON "message_experiment_sends" USING btree ("experiment_id","variant_key");--> statement-breakpoint
CREATE INDEX "message_exp_sends_contact_idx" ON "message_experiment_sends" USING btree ("creator_id","contact_id");--> statement-breakpoint
CREATE INDEX "message_exp_creator_idx" ON "message_experiments" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_sub_endpoint_unique_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_sub_creator_idx" ON "push_subscriptions" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "referral_rewards_referrer_idx" ON "referral_rewards" USING btree ("referrer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_rewards_referred_unique_idx" ON "referral_rewards" USING btree ("referred_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_search_idx" ON "messages" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_enrollments_active_unique_idx" ON "sequence_enrollments" USING btree ("sequence_id","contact_id") WHERE "sequence_enrollments"."status" IN ('active', 'paused');--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_referral_code_unique" UNIQUE("referral_code");--> statement-breakpoint
-- Full-text search: trigger que mantiene search_vector (antes vivía solo en
-- 0002_add_message_search.sql, fuera del journal de drizzle).
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('spanish', COALESCE(NEW.content, '')) || to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS messages_search_vector_trigger ON messages;--> statement-breakpoint
CREATE TRIGGER messages_search_vector_trigger BEFORE INSERT OR UPDATE OF content ON messages FOR EACH ROW EXECUTE FUNCTION messages_search_vector_update();--> statement-breakpoint
UPDATE messages SET search_vector = to_tsvector('spanish', COALESCE(content, '')) || to_tsvector('english', COALESCE(content, '')) WHERE search_vector IS NULL;
