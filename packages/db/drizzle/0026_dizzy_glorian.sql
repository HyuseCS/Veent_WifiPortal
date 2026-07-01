DROP INDEX IF EXISTS "rate_limits_mac_address_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "rate_limits_phone_number_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "rate_limits_scope_identifier_idx";--> statement-breakpoint
-- rate_limits holds only transient throttle counters. The pre-fix consume path could insert
-- duplicate rows for the same key under concurrency, which would make the UNIQUE indexes below
-- fail to build. Collapse any duplicates (keep the highest id per key) before creating them.
-- NULL-safe match (IS NOT DISTINCT FROM) so mac / phone / scope rows each dedup within their key.
DELETE FROM "rate_limits" a USING "rate_limits" b
	WHERE a.id < b.id
		AND a.scope IS NOT DISTINCT FROM b.scope
		AND a.identifier IS NOT DISTINCT FROM b.identifier
		AND a.mac_address IS NOT DISTINCT FROM b.mac_address
		AND a.phone_number IS NOT DISTINCT FROM b.phone_number;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limits_mac_address_key" ON "rate_limits" USING btree ("mac_address");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limits_phone_number_key" ON "rate_limits" USING btree ("phone_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limits_scope_identifier_key" ON "rate_limits" USING btree ("scope","identifier");
