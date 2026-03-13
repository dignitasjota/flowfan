-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE "public"."ai_provider" AS ENUM('anthropic', 'openai', 'google', 'minimax', 'kimi');
CREATE TYPE "public"."ai_request_type" AS ENUM('suggestion', 'analysis', 'scoring', 'summary');
CREATE TYPE "public"."ai_task_type" AS ENUM('suggestion', 'analysis', 'summary', 'report', 'price_advice');
CREATE TYPE "public"."conversation_depth" AS ENUM('superficial', 'moderate', 'deep');
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'paused', 'archived');
CREATE TYPE "public"."estimated_budget" AS ENUM('low', 'medium', 'high', 'premium');
CREATE TYPE "public"."funnel_stage" AS ENUM('cold', 'curious', 'interested', 'hot_lead', 'buyer', 'vip');
CREATE TYPE "public"."message_role" AS ENUM('fan', 'creator');
CREATE TYPE "public"."platform_type" AS ENUM('instagram', 'tinder', 'reddit', 'onlyfans', 'twitter', 'telegram', 'snapchat', 'other');
CREATE TYPE "public"."response_speed" AS ENUM('fast', 'medium', 'slow');
CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'starter', 'pro', 'business');
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled', 'trialing');

-- ============================================================
-- TABLES
-- ============================================================

-- Creators (tenant principal)
CREATE TABLE "public"."creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL UNIQUE,
	"name" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"avatar_url" text,
	"subscription_plan" "subscription_plan" DEFAULT 'free' NOT NULL,
	"subscription_status" "subscription_status" DEFAULT 'active' NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"stripe_price_id" varchar(255),
	"current_period_end" timestamp,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Platforms (personalidad por red social)
CREATE TABLE "public"."platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public"."creators"("id") ON DELETE cascade,
	"platform_type" "platform_type" NOT NULL,
	"personality_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "platforms_creator_platform_idx" ON "public"."platforms" USING btree ("creator_id","platform_type");

-- Contacts (los fans/usuarios)
CREATE TABLE "public"."contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public"."creators"("id") ON DELETE cascade,
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
CREATE INDEX "contacts_creator_idx" ON "public"."contacts" USING btree ("creator_id");
CREATE INDEX "contacts_creator_platform_idx" ON "public"."contacts" USING btree ("creator_id","platform_type");

-- Contact Profiles (perfil dinámico calculado)
CREATE TABLE "public"."contact_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL UNIQUE REFERENCES "public"."contacts"("id") ON DELETE cascade,
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
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Conversations
CREATE TABLE "public"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public"."creators"("id") ON DELETE cascade,
	"contact_id" uuid NOT NULL REFERENCES "public"."contacts"("id") ON DELETE cascade,
	"platform_type" "platform_type" NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"summary" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "conversations_creator_idx" ON "public"."conversations" USING btree ("creator_id");
CREATE INDEX "conversations_contact_idx" ON "public"."conversations" USING btree ("contact_id");

-- Messages
CREATE TABLE "public"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL REFERENCES "public"."conversations"("id") ON DELETE cascade,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"ai_suggestion" text,
	"ai_suggestion_used" boolean,
	"sentiment" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "messages_conversation_idx" ON "public"."messages" USING btree ("conversation_id","created_at");

-- Notes
CREATE TABLE "public"."notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public"."creators"("id") ON DELETE cascade,
	"contact_id" uuid NOT NULL REFERENCES "public"."contacts"("id") ON DELETE cascade,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "notes_creator_contact_idx" ON "public"."notes" USING btree ("creator_id","contact_id");

-- AI Configs (configuración de proveedor IA por creador)
CREATE TABLE "public"."ai_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL UNIQUE REFERENCES "public"."creators"("id") ON DELETE cascade,
	"provider" "ai_provider" DEFAULT 'anthropic' NOT NULL,
	"model" varchar(100) NOT NULL DEFAULT 'claude-sonnet-4-6-20250514',
	"api_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- AI Usage Log
CREATE TABLE "public"."ai_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public"."creators"("id") ON DELETE cascade,
	"request_type" "ai_request_type" NOT NULL,
	"tokens_used" integer NOT NULL,
	"model_used" varchar(100) NOT NULL,
	"response_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "ai_usage_creator_idx" ON "public"."ai_usage_log" USING btree ("creator_id");

-- Response Templates
CREATE TABLE "public"."response_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public"."creators"("id") ON DELETE cascade,
	"name" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"category" varchar(100),
	"platform_type" "platform_type",
	"variables" text[] DEFAULT '{}',
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "templates_creator_idx" ON "public"."response_templates" USING btree ("creator_id");

-- AI Model Assignments (multi-modelo por tarea)
CREATE TABLE "public"."ai_model_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public"."creators"("id") ON DELETE cascade,
	"task_type" "ai_task_type" NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model" varchar(100) NOT NULL,
	"api_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "model_assignments_creator_task_idx" ON "public"."ai_model_assignments" USING btree ("creator_id","task_type");

-- Notifications
CREATE TABLE "public"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public"."creators"("id") ON DELETE cascade,
	"contact_id" uuid REFERENCES "public"."contacts"("id") ON DELETE cascade,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "notifications_creator_idx" ON "public"."notifications" USING btree ("creator_id");
CREATE INDEX "notifications_creator_unread_idx" ON "public"."notifications" USING btree ("creator_id","is_read");
