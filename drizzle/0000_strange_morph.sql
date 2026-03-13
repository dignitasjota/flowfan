CREATE TYPE "public"."ai_provider" AS ENUM('anthropic', 'openai', 'google', 'minimax', 'kimi');--> statement-breakpoint
CREATE TYPE "public"."ai_request_type" AS ENUM('suggestion', 'analysis', 'scoring', 'summary');--> statement-breakpoint
CREATE TYPE "public"."conversation_depth" AS ENUM('superficial', 'moderate', 'deep');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."estimated_budget" AS ENUM('low', 'medium', 'high', 'premium');--> statement-breakpoint
CREATE TYPE "public"."funnel_stage" AS ENUM('cold', 'curious', 'interested', 'hot_lead', 'buyer', 'vip');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('fan', 'creator');--> statement-breakpoint
CREATE TYPE "public"."platform_type" AS ENUM('instagram', 'tinder', 'reddit', 'onlyfans', 'twitter', 'telegram', 'snapchat', 'other');--> statement-breakpoint
CREATE TYPE "public"."response_speed" AS ENUM('fast', 'medium', 'slow');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'starter', 'pro', 'business');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled', 'trialing');--> statement-breakpoint
CREATE TABLE "ai_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"provider" "ai_provider" DEFAULT 'anthropic' NOT NULL,
	"model" varchar(100) DEFAULT 'claude-sonnet-4-6-20250514' NOT NULL,
	"api_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_configs_creator_id_unique" UNIQUE("creator_id")
);
--> statement-breakpoint
CREATE TABLE "ai_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"request_type" "ai_request_type" NOT NULL,
	"tokens_used" integer NOT NULL,
	"model_used" varchar(100) NOT NULL,
	"response_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"engagement_level" integer DEFAULT 0 NOT NULL,
	"response_speed" "response_speed" DEFAULT 'medium',
	"conversation_depth" "conversation_depth" DEFAULT 'superficial',
	"communication_style" jsonb DEFAULT '{}'::jsonb,
	"payment_probability" integer DEFAULT 0 NOT NULL,
	"estimated_budget" "estimated_budget" DEFAULT 'low',
	"recommended_price_range" jsonb DEFAULT '{}'::jsonb,
	"funnel_stage" "funnel_stage" DEFAULT 'cold' NOT NULL,
	"scoring_history" jsonb DEFAULT '[]'::jsonb,
	"behavioral_signals" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contact_profiles_contact_id_unique" UNIQUE("contact_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"username" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"platform_type" "platform_type" NOT NULL,
	"first_interaction_at" timestamp DEFAULT now() NOT NULL,
	"last_interaction_at" timestamp DEFAULT now() NOT NULL,
	"total_conversations" integer DEFAULT 1 NOT NULL,
	"tags" text[] DEFAULT '{}',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"platform_type" "platform_type" NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"summary" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"avatar_url" text,
	"subscription_plan" "subscription_plan" DEFAULT 'free' NOT NULL,
	"subscription_status" "subscription_status" DEFAULT 'active' NOT NULL,
	"stripe_customer_id" varchar(255),
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creators_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"ai_suggestion" text,
	"ai_suggestion_used" boolean,
	"sentiment" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_type" "platform_type" NOT NULL,
	"personality_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_configs" ADD CONSTRAINT "ai_configs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_profiles" ADD CONSTRAINT "contact_profiles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platforms" ADD CONSTRAINT "platforms_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_creator_idx" ON "ai_usage_log" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "contacts_creator_idx" ON "contacts" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "contacts_creator_platform_idx" ON "contacts" USING btree ("creator_id","platform_type");--> statement-breakpoint
CREATE INDEX "conversations_creator_idx" ON "conversations" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "conversations_contact_idx" ON "conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_creator_contact_idx" ON "notes" USING btree ("creator_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platforms_creator_platform_idx" ON "platforms" USING btree ("creator_id","platform_type");