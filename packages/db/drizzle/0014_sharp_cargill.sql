ALTER TABLE "rate_limits" ADD COLUMN IF NOT EXISTS "scope" text;--> statement-breakpoint
ALTER TABLE "rate_limits" ADD COLUMN IF NOT EXISTS "identifier" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_scope_identifier_idx" ON "rate_limits" USING btree ("scope","identifier");
