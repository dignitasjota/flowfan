ALTER TABLE "creators" ADD COLUMN "stripe_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "stripe_price_id" varchar(255);--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "current_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "onboarding_completed" boolean DEFAULT false NOT NULL;
