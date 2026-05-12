DROP INDEX "social_accounts_creator_platform_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_creator_external_idx" ON "social_accounts" USING btree ("creator_id","platform_type","external_account_id");--> statement-breakpoint
CREATE INDEX "social_accounts_creator_platform_idx" ON "social_accounts" USING btree ("creator_id","platform_type");