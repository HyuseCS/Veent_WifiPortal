ALTER TABLE "network_sessions" ADD COLUMN "network_id" integer;--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN "interface_name" text;--> statement-breakpoint
CREATE INDEX "network_sessions_network_id_idx" ON "network_sessions" USING btree ("network_id");