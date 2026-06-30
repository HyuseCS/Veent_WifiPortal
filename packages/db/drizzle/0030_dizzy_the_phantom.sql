CREATE TABLE "router_model" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"range_meters" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Baseline catalog row so the catalog is never empty after this migration (the app
-- treats the lowest sort_order as the default model). Matches the former hardcoded entry.
INSERT INTO "router_model" ("id", "name", "range_meters", "sort_order")
VALUES ('suncomm-ap3000g', 'Suncomm AP3000G', 200, 0)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Re-point any APs left on the pre-rename model id onto the renamed catalog row.
UPDATE "network_health" SET "model" = 'suncomm-ap3000g' WHERE "model" = 'sancom-ap3000g';
