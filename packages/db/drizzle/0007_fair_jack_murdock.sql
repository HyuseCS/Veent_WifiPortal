ALTER TABLE "network_health" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN "address" text;