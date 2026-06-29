CREATE TABLE IF NOT EXISTS "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"max_devices_per_account" integer DEFAULT 2 NOT NULL,
	"free_time_minutes" integer DEFAULT 15 NOT NULL,
	"free_time_cooldown_hours" integer DEFAULT 12 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Seed the singleton row (id=1) with the defaults that mirror the @veent/core constants,
-- so getSessionLimits() reads real values immediately. Idempotent: no-op if id=1 exists.
INSERT INTO "app_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
