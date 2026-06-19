ALTER TABLE "network_sessions" ADD COLUMN IF NOT EXISTS "network_id" integer;--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN IF NOT EXISTS "interface_name" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_sessions_network_id_idx" ON "network_sessions" USING btree ("network_id");
