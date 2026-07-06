ALTER TABLE "customer_profile" ADD COLUMN "access_paused_reason" text;--> statement-breakpoint
ALTER TABLE "customer_profile" ADD COLUMN "access_paused_network_id" integer;--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN "offline_since" timestamp;