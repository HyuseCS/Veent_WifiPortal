ALTER TABLE "customer_profile" ADD COLUMN IF NOT EXISTS "access_package_id" integer;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "customer_profile" ADD CONSTRAINT "customer_profile_access_package_id_packages_id_fk" FOREIGN KEY ("access_package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
-- Backfill (idempotent): seed each account's window package from its most-recent active
-- session's package, so existing multi-device accounts show one consistent package. Guarded
-- by a live window + IS NULL so a re-run is a no-op.
UPDATE "customer_profile" p
SET "access_package_id" = sub.pkg
FROM (
	SELECT DISTINCT ON ("user_id") "user_id", "package_id" AS pkg
	FROM "network_sessions"
	WHERE "status" = 'active'
	ORDER BY "user_id", "started_at" DESC
) sub
WHERE p."user_id" = sub."user_id"
	AND p."access_expires_at" IS NOT NULL
	AND p."access_package_id" IS NULL;
