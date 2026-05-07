CREATE TYPE "public"."ai_task_type" AS ENUM('suggestion', 'analysis', 'summary', 'report', 'price_advice', 'coaching', 'content_gap');--> statement-breakpoint
CREATE TYPE "public"."broadcast_recipient_status" AS ENUM('pending', 'sent', 'failed', 'manual');--> statement-breakpoint
CREATE TYPE "public"."broadcast_status" AS ENUM('draft', 'processing', 'sending', 'completed', 'cancelled', 'scheduled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."conversation_mode_type" AS ENUM('BASE', 'POTENCIAL_PREMIUM', 'CONVERSION', 'VIP', 'LOW_VALUE');--> statement-breakpoint
CREATE TYPE "public"."creator_role" AS ENUM('creator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('image', 'video', 'gif');--> statement-breakpoint
CREATE TYPE "public"."scheduled_message_status" AS ENUM('pending', 'sent', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."segment_membership" AS ENUM('included', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."segment_type" AS ENUM('dynamic', 'static', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."sequence_enrollment_status" AS ENUM('active', 'completed', 'cancelled', 'paused');--> statement-breakpoint
CREATE TYPE "public"."sequence_type" AS ENUM('nurturing', 'followup', 'custom');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('owner', 'manager', 'chatter');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('tip', 'ppv', 'subscription', 'custom');--> statement-breakpoint
CREATE TYPE "public"."webhook_event" AS ENUM('contact.created', 'contact.updated', 'message.received', 'funnel_stage.changed', 'transaction.created');--> statement-breakpoint
CREATE TYPE "public"."workflow_action_type" AS ENUM('send_message', 'send_template', 'create_notification', 'change_tags', 'advance_sequence');--> statement-breakpoint
CREATE TYPE "public"."workflow_trigger_type" AS ENUM('no_response_timeout', 'funnel_stage_change', 'sentiment_change', 'keyword_detected', 'new_contact');--> statement-breakpoint
ALTER TYPE "public"."ai_request_type" ADD VALUE 'coaching';--> statement-breakpoint
ALTER TYPE "public"."ai_request_type" ADD VALUE 'content_gap';--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"target_creator_id" uuid,
	"action" varchar(100) NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_model_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"task_type" "ai_task_type" NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model" varchar(100) NOT NULL,
	"api_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"encrypted_key" text NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "auto_response_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_type" "platform_type" NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"inactivity_minutes" integer DEFAULT 30 NOT NULL,
	"use_ai_reply" boolean DEFAULT false NOT NULL,
	"max_tokens" integer DEFAULT 256 NOT NULL,
	"fallback_message" text,
	"classify_messages" boolean DEFAULT true NOT NULL,
	"pre_generate_replies" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"platform_user_id" varchar(255),
	"resolved_content" text NOT NULL,
	"status" "broadcast_recipient_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"segment_id" uuid,
	"filters" jsonb DEFAULT '[]'::jsonb,
	"platform_type" "platform_type",
	"status" "broadcast_status" DEFAULT 'draft' NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"manual_count" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"coaching_type" varchar(50) NOT NULL,
	"analysis" jsonb NOT NULL,
	"model_used" varchar(100) NOT NULL,
	"tokens_used" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"report_data" jsonb NOT NULL,
	"model_used" varchar(100),
	"tokens_used" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_gap_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"report_data" jsonb NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"contacts_analyzed" integer NOT NULL,
	"messages_analyzed" integer NOT NULL,
	"model_used" varchar(100) NOT NULL,
	"tokens_used" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"assigned_to_user_id" uuid NOT NULL,
	"assigned_by_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ab_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"mode_type" "conversation_mode_type" NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"variant_a_config" jsonb NOT NULL,
	"variant_b_config" jsonb NOT NULL,
	"traffic_split" integer DEFAULT 50 NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"winner" varchar(1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_modes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"mode_type" "conversation_mode_type" NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"tone" varchar(255),
	"style" varchar(255),
	"message_length" varchar(20),
	"objectives" jsonb DEFAULT '[]'::jsonb,
	"restrictions" jsonb DEFAULT '[]'::jsonb,
	"additional_instructions" text,
	"activation_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"permissions" text[] NOT NULL,
	"color" varchar(20),
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"variant" varchar(1) NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"variant" varchar(1) NOT NULL,
	"metric_type" varchar(50) NOT NULL,
	"value" integer DEFAULT 1 NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fan_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"description" text,
	"transaction_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"status" "import_job_status" DEFAULT 'pending' NOT NULL,
	"column_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skip_duplicates" boolean DEFAULT true NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(7) DEFAULT '#6366f1',
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"filename" varchar(500) NOT NULL,
	"original_name" varchar(500) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"media_type" "media_type" NOT NULL,
	"file_size" integer NOT NULL,
	"storage_path" text NOT NULL,
	"thumbnail_path" text,
	"width" integer,
	"height" integer,
	"duration" integer,
	"tags" text[] DEFAULT '{}',
	"category_id" uuid,
	"is_archived" boolean DEFAULT false NOT NULL,
	"send_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_item_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"contact_id" uuid,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "platform_scoring_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_type" "platform_type" NOT NULL,
	"engagement_weights" jsonb,
	"payment_weights" jsonb,
	"benchmarks" jsonb,
	"funnel_thresholds" jsonb,
	"contact_age_factor" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"category" varchar(100),
	"platform_type" "platform_type",
	"variables" text[] DEFAULT '{}',
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"content" text NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"status" "scheduled_message_status" DEFAULT 'pending' NOT NULL,
	"sent_message_id" uuid,
	"ai_suggestion" text,
	"ai_suggestion_used" boolean,
	"sent_by_id" uuid,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"membership_type" "segment_membership" DEFAULT 'included' NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" "segment_type" NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"color" varchar(7) DEFAULT '#6366f1',
	"icon" varchar(10),
	"is_predefined" boolean DEFAULT false NOT NULL,
	"predefined_key" varchar(50),
	"contact_count" integer DEFAULT 0 NOT NULL,
	"count_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_config" (
	"id" varchar(50) PRIMARY KEY DEFAULT 'global' NOT NULL,
	"site_title" varchar(255) DEFAULT 'FanFlow - CRM con IA para Creadores de Contenido' NOT NULL,
	"site_description" text DEFAULT 'Gestiona conversaciones con fans usando inteligencia artificial. Scoring automatico, sugerencias de respuesta, analisis de sentimiento y mas. Empieza gratis.' NOT NULL,
	"keywords" text DEFAULT 'CRM creadores, gestion fans, IA conversacional, OnlyFans CRM, asistente IA',
	"canonical_url" varchar(255) DEFAULT 'https://flowfan.app',
	"og_title" varchar(255),
	"og_description" text,
	"og_image_url" text,
	"twitter_title" varchar(255),
	"twitter_description" text,
	"twitter_image_url" text,
	"favicon_url" text,
	"robots_index" boolean DEFAULT true NOT NULL,
	"robots_follow" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"status" "sequence_enrollment_status" DEFAULT 'active' NOT NULL,
	"enrolled_at" timestamp DEFAULT now() NOT NULL,
	"last_step_at" timestamp,
	"next_step_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" "sequence_type" DEFAULT 'custom' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"enrollment_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_enrolled" integer DEFAULT 0 NOT NULL,
	"total_completed" integer DEFAULT 0 NOT NULL,
	"total_converted" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"platform_type" "platform_type" NOT NULL,
	"external_comment_id" varchar(255),
	"author_contact_id" uuid,
	"author_username" varchar(255) NOT NULL,
	"author_display_name" varchar(255),
	"author_avatar_url" text,
	"role" "message_role" DEFAULT 'fan' NOT NULL,
	"content" text NOT NULL,
	"sentiment" jsonb,
	"ai_suggestion" text,
	"ai_suggestion_used" boolean,
	"is_handled" boolean DEFAULT false NOT NULL,
	"handled_at" timestamp,
	"handled_by_id" uuid,
	"creator_reply_id" uuid,
	"published_at" timestamp,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_type" "platform_type" NOT NULL,
	"external_post_id" varchar(255),
	"url" text,
	"title" text,
	"content" text,
	"media_urls" text[] DEFAULT '{}',
	"published_at" timestamp,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"unhandled_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"last_comment_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"user_id" uuid,
	"user_name" varchar(255) NOT NULL,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(255),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "team_role" DEFAULT 'chatter' NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"accepted_by_user_id" uuid,
	"custom_role_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'chatter' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"custom_role_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_bot_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"bot_token" text NOT NULL,
	"bot_username" varchar(255),
	"bot_id" varchar(100),
	"webhook_secret" varchar(255) NOT NULL,
	"webhook_url" text,
	"status" varchar(20) DEFAULT 'disconnected' NOT NULL,
	"auto_reply_enabled" boolean DEFAULT false NOT NULL,
	"auto_reply_delay_sec" integer DEFAULT 0 NOT NULL,
	"welcome_message" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_bot_configs_creator_id_unique" UNIQUE("creator_id"),
	CONSTRAINT "telegram_bot_configs_webhook_secret_unique" UNIQUE("webhook_secret")
);
--> statement-breakpoint
CREATE TABLE "webhook_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_config_id" uuid NOT NULL,
	"event" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer,
	"response_body" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"delivered_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"contact_id" uuid,
	"conversation_id" uuid,
	"trigger_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_message" text,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"trigger_type" "workflow_trigger_type" NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_type" "workflow_action_type" NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"execution_count" integer DEFAULT 0 NOT NULL,
	"last_executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_profiles" ADD COLUMN "current_conversation_mode" "conversation_mode_type";--> statement-breakpoint
ALTER TABLE "contact_profiles" ADD COLUMN "mode_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact_profiles" ADD COLUMN "churn_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_profiles" ADD COLUMN "churn_factors" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "contact_profiles" ADD COLUMN "churn_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "platform_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "email_verification_token" varchar(255);--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "role" "creator_role" DEFAULT 'creator' NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "stripe_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "stripe_price_id" varchar(255);--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "current_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "onboarding_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "email_notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "daily_summary_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "weekly_summary_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_message_id" varchar(255);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "source" varchar(20) DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sent_by_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_creators_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_target_creator_id_creators_id_fk" FOREIGN KEY ("target_creator_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_assignments" ADD CONSTRAINT "ai_model_assignments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_response_configs" ADD CONSTRAINT "auto_response_configs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_reports" ADD CONSTRAINT "contact_reports_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_reports" ADD CONSTRAINT "contact_reports_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_gap_reports" ADD CONSTRAINT "content_gap_reports_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_assigned_to_user_id_creators_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_assigned_by_user_id_creators_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_experiments" ADD CONSTRAINT "ab_experiments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_modes" ADD CONSTRAINT "conversation_modes_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_experiment_id_ab_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."ab_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_metrics" ADD CONSTRAINT "experiment_metrics_experiment_id_ab_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."ab_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_metrics" ADD CONSTRAINT "experiment_metrics_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan_transactions" ADD CONSTRAINT "fan_transactions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan_transactions" ADD CONSTRAINT "fan_transactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_categories" ADD CONSTRAINT "media_categories_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_category_id_media_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."media_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_sends" ADD CONSTRAINT "media_sends_media_item_id_media_items_id_fk" FOREIGN KEY ("media_item_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_sends" ADD CONSTRAINT "media_sends_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_sends" ADD CONSTRAINT "media_sends_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_scoring_configs" ADD CONSTRAINT "platform_scoring_configs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_templates" ADD CONSTRAINT "response_templates_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_sent_message_id_messages_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_sent_by_id_creators_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_author_contact_id_contacts_id_fk" FOREIGN KEY ("author_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_handled_by_id_creators_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_audit_log" ADD CONSTRAINT "team_audit_log_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_audit_log" ADD CONSTRAINT "team_audit_log_user_id_creators_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_accepted_by_user_id_creators_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_creators_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bot_configs" ADD CONSTRAINT "telegram_bot_configs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_configs" ADD CONSTRAINT "webhook_configs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_logs" ADD CONSTRAINT "webhook_delivery_logs_webhook_config_id_webhook_configs_id_fk" FOREIGN KEY ("webhook_config_id") REFERENCES "public"."webhook_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_admin_idx" ON "admin_audit_log" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "admin_audit_log" USING btree ("target_creator_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "admin_audit_log" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "model_assignments_creator_task_idx" ON "ai_model_assignments" USING btree ("creator_id","task_type");--> statement-breakpoint
CREATE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_creator_idx" ON "api_keys" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auto_response_configs_creator_platform_idx" ON "auto_response_configs" USING btree ("creator_id","platform_type");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_broadcast_idx" ON "broadcast_recipients" USING btree ("broadcast_id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_broadcast_status_idx" ON "broadcast_recipients" USING btree ("broadcast_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_recipients_unique_idx" ON "broadcast_recipients" USING btree ("broadcast_id","contact_id");--> statement-breakpoint
CREATE INDEX "broadcasts_creator_idx" ON "broadcasts" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "broadcasts_creator_status_idx" ON "broadcasts" USING btree ("creator_id","status");--> statement-breakpoint
CREATE INDEX "coaching_sessions_creator_created_idx" ON "coaching_sessions" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "coaching_sessions_conversation_idx" ON "coaching_sessions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "contact_reports_creator_contact_idx" ON "contact_reports" USING btree ("creator_id","contact_id");--> statement-breakpoint
CREATE INDEX "contact_reports_contact_idx" ON "contact_reports" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "content_gap_reports_creator_created_idx" ON "content_gap_reports" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conv_assignments_unique_idx" ON "conversation_assignments" USING btree ("conversation_id","assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "conv_assignments_user_idx" ON "conversation_assignments" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "conv_mode_exp_creator_idx" ON "ab_experiments" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_modes_creator_mode_idx" ON "conversation_modes" USING btree ("creator_id","mode_type");--> statement-breakpoint
CREATE INDEX "conversation_modes_creator_idx" ON "conversation_modes" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_roles_creator_name_idx" ON "custom_roles" USING btree ("creator_id","name");--> statement-breakpoint
CREATE INDEX "custom_roles_creator_idx" ON "custom_roles" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_assignment_unique_idx" ON "experiment_assignments" USING btree ("experiment_id","contact_id");--> statement-breakpoint
CREATE INDEX "exp_metrics_exp_variant_idx" ON "experiment_metrics" USING btree ("experiment_id","variant");--> statement-breakpoint
CREATE INDEX "exp_metrics_exp_type_idx" ON "experiment_metrics" USING btree ("experiment_id","metric_type");--> statement-breakpoint
CREATE INDEX "fan_transactions_creator_idx" ON "fan_transactions" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "fan_transactions_contact_idx" ON "fan_transactions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "fan_transactions_creator_contact_idx" ON "fan_transactions" USING btree ("creator_id","contact_id");--> statement-breakpoint
CREATE INDEX "fan_transactions_date_idx" ON "fan_transactions" USING btree ("creator_id","transaction_date");--> statement-breakpoint
CREATE INDEX "import_jobs_creator_idx" ON "import_jobs" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "media_categories_creator_idx" ON "media_categories" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_categories_creator_name_idx" ON "media_categories" USING btree ("creator_id","name");--> statement-breakpoint
CREATE INDEX "media_items_creator_idx" ON "media_items" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "media_items_creator_category_idx" ON "media_items" USING btree ("creator_id","category_id");--> statement-breakpoint
CREATE INDEX "media_items_creator_type_idx" ON "media_items" USING btree ("creator_id","media_type");--> statement-breakpoint
CREATE INDEX "media_sends_media_idx" ON "media_sends" USING btree ("media_item_id");--> statement-breakpoint
CREATE INDEX "media_sends_contact_idx" ON "media_sends" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_sends_media_contact_idx" ON "media_sends" USING btree ("media_item_id","contact_id");--> statement-breakpoint
CREATE INDEX "notifications_creator_idx" ON "notifications" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "notifications_creator_unread_idx" ON "notifications" USING btree ("creator_id","is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_scoring_configs_creator_platform_idx" ON "platform_scoring_configs" USING btree ("creator_id","platform_type");--> statement-breakpoint
CREATE INDEX "templates_creator_idx" ON "response_templates" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "scheduled_messages_creator_idx" ON "scheduled_messages" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "scheduled_messages_status_idx" ON "scheduled_messages" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "scheduled_messages_conversation_idx" ON "scheduled_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "segment_members_segment_idx" ON "segment_members" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "segment_members_contact_idx" ON "segment_members" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_members_unique_idx" ON "segment_members" USING btree ("segment_id","contact_id");--> statement-breakpoint
CREATE INDEX "segments_creator_idx" ON "segments" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "sequence_enrollments_sequence_status_idx" ON "sequence_enrollments" USING btree ("sequence_id","status");--> statement-breakpoint
CREATE INDEX "sequence_enrollments_contact_idx" ON "sequence_enrollments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "sequence_enrollments_status_next_idx" ON "sequence_enrollments" USING btree ("status","next_step_at");--> statement-breakpoint
CREATE INDEX "sequences_creator_idx" ON "sequences" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "sequences_creator_active_idx" ON "sequences" USING btree ("creator_id","is_active");--> statement-breakpoint
CREATE INDEX "social_comments_creator_idx" ON "social_comments" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "social_comments_creator_handled_idx" ON "social_comments" USING btree ("creator_id","is_handled");--> statement-breakpoint
CREATE INDEX "social_comments_post_idx" ON "social_comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "social_comments_parent_idx" ON "social_comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "social_comments_author_contact_idx" ON "social_comments" USING btree ("author_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_comments_external_idx" ON "social_comments" USING btree ("creator_id","platform_type","external_comment_id");--> statement-breakpoint
CREATE INDEX "social_posts_creator_idx" ON "social_posts" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "social_posts_creator_platform_idx" ON "social_posts" USING btree ("creator_id","platform_type");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_external_idx" ON "social_posts" USING btree ("creator_id","platform_type","external_post_id");--> statement-breakpoint
CREATE INDEX "team_audit_log_creator_created_idx" ON "team_audit_log" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "team_audit_log_creator_action_idx" ON "team_audit_log" USING btree ("creator_id","action");--> statement-breakpoint
CREATE INDEX "team_audit_log_creator_user_idx" ON "team_audit_log" USING btree ("creator_id","user_id");--> statement-breakpoint
CREATE INDEX "team_audit_log_creator_entity_idx" ON "team_audit_log" USING btree ("creator_id","entity_type");--> statement-breakpoint
CREATE INDEX "team_invites_token_idx" ON "team_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "team_invites_creator_idx" ON "team_invites" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_unique_idx" ON "team_members" USING btree ("creator_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webhook_configs_creator_idx" ON "webhook_configs" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_logs_config_created_idx" ON "webhook_delivery_logs" USING btree ("webhook_config_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_executions_workflow_idx" ON "workflow_executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_executions_creator_idx" ON "workflow_executions" USING btree ("creator_id","executed_at");--> statement-breakpoint
CREATE INDEX "workflow_executions_contact_idx" ON "workflow_executions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "workflows_creator_idx" ON "workflows" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "workflows_creator_active_idx" ON "workflows" USING btree ("creator_id","is_active");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_id_creators_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_platform_user_idx" ON "contacts" USING btree ("creator_id","platform_type","platform_user_id");