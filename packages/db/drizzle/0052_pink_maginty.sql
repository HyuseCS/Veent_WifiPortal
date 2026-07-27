-- Finance / Session timestamptz migration (hand-edited from drizzle-kit scaffold).
-- drizzle-kit emitted bare `SET DATA TYPE timestamp with time zone` with NO USING clause; a bare
-- cast reinterprets the stored wall-clock in the SESSION TimeZone, which is only correct for the
-- Manila-wall columns and WRONG for the UTC-wall columns. Every column below carries an EXPLICIT
-- per-column USING cast matched to its actual write convention (see plan Locked Decision 3), so the
-- correction is auditable and independent of the applying session's TimeZone.
-- Apply atomically: `psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f <this file>`.
-- Manila has no DST, so 'Asia/Manila' is a fixed +08 offset.
--
-- Manila-wall columns  -> USING col AT TIME ZONE 'Asia/Manila'
-- UTC-wall columns     -> USING col AT TIME ZONE 'UTC'

ALTER TABLE "credit_ledger"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'Asia/Manila',
	ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "points_ledger"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'Asia/Manila',
	ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "payment_transactions"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'Asia/Manila',
	ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "payment_checkouts"
	ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'Asia/Manila',
	ALTER COLUMN "created_at" SET DEFAULT now(),
	ALTER COLUMN "settled_at" SET DATA TYPE timestamp with time zone USING "settled_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "last_polled_at" SET DATA TYPE timestamp with time zone USING "last_polled_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "network_sessions"
	ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone USING "started_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "started_at" SET DEFAULT now(),
	ALTER COLUMN "bound_at" SET DATA TYPE timestamp with time zone USING "bound_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "bound_at" SET DEFAULT now(),
	ALTER COLUMN "last_seen_at" SET DATA TYPE timestamp with time zone USING "last_seen_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "last_seen_at" SET DEFAULT now(),
	ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "customer_profile"
	ALTER COLUMN "last_free_session_at" SET DATA TYPE timestamp with time zone USING "last_free_session_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "access_expires_at" SET DATA TYPE timestamp with time zone USING "access_expires_at" AT TIME ZONE 'UTC',
	ALTER COLUMN "access_paused_at" SET DATA TYPE timestamp with time zone USING "access_paused_at" AT TIME ZONE 'UTC';
