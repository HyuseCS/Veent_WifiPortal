CREATE TABLE "network_client_attribution" (
	"mac" text PRIMARY KEY NOT NULL,
	"circuit_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "network_health" ALTER COLUMN "throughput_mbps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN "mac" text;--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN "ap_circuit_id" text;--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN "attribution_source" text;--> statement-breakpoint
ALTER TABLE "network_health" ADD COLUMN "traffic_bytes" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "network_health_mac_key" ON "network_health" USING btree ("mac");