ALTER TABLE "customer_profile" ADD COLUMN IF NOT EXISTS "access_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "network_sessions" ADD COLUMN IF NOT EXISTS "bound_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "network_sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_sessions_user_status_lastseen_idx" ON "network_sessions" USING btree ("user_id","status","last_seen_at");--> statement-breakpoint
-- Cutover backfill (idempotent): move existing per-device grants up to an account access
-- window so nobody is disconnected mid-session. Seed each account's window from its
-- furthest-out live session, guarded by IS NULL so a re-run is a no-op.
UPDATE "customer_profile" p
SET "access_expires_at" = sub.max_exp
FROM (
	SELECT "user_id", MAX("expires_at") AS max_exp
	FROM "network_sessions"
	WHERE "status" = 'active' AND "expires_at" > now()
	GROUP BY "user_id"
) sub
WHERE p."user_id" = sub."user_id" AND p."access_expires_at" IS NULL;--> statement-breakpoint
-- Mirror the account window onto each of its live device rows so every bound device shares
-- the longest remaining time (re-running sets the same value).
UPDATE "network_sessions" ns
SET "expires_at" = p."access_expires_at"
FROM "customer_profile" p
WHERE ns."user_id" = p."user_id"
	AND ns."status" = 'active'
	AND ns."expires_at" > now()
	AND p."access_expires_at" IS NOT NULL;
