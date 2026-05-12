CREATE TABLE "oauth_pending_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" varchar(128) NOT NULL,
	"creator_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"code_verifier" text,
	"redirect_after" varchar(255) DEFAULT '/scheduler',
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_pending_flows_state_unique" UNIQUE("state")
);
--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "encrypted_oauth_access_token" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "encrypted_oauth_refresh_token" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "oauth_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "oauth_scopes" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "external_account_id" varchar(255);--> statement-breakpoint
ALTER TABLE "oauth_pending_flows" ADD CONSTRAINT "oauth_pending_flows_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_pending_creator_idx" ON "oauth_pending_flows" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "oauth_pending_expires_idx" ON "oauth_pending_flows" USING btree ("expires_at");