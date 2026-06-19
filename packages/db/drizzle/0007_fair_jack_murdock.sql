ALTER TABLE "network_health" ADD COLUMN IF NOT EXISTS "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN IF NOT EXISTS "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN IF NOT EXISTS "address" text;
