# Database

`packages/db` is the only schema and migration authority for all three apps. No app defines its own tables. All apps point at the same Postgres database.

## Schema files (`packages/db/src/schema/`)

| File                                                    | Tables                                                                                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                              | Barrel. Every table must be exported here or `drizzle-kit` cannot see it.                                                                                                                             |
| `admin.ts`                                              | `admin_role`, `admin_profile`, `router_model`, `network_health`, `admin_bypass_device`                                                                                                                |
| `admin-two-factor.ts`                                   | `admin_two_factor` (see `auth.md`)                                                                                                                                                                    |
| `admin-owner-change.ts`                                 | `admin_owner_change_request`, `admin_owner_change_approval`                                                                                                                                           |
| `admin-issue.ts`                                        | `admin_issue`, `admin_issue_assignee`                                                                                                                                                                 |
| `admin-issue-event.ts`                                  | `admin_issue_event`, `admin_notification_read`                                                                                                                                                        |
| `customer.ts`                                           | `customer_profile`, `packages`, `credit_ledger`, `points_ledger`, `payment_transactions`, `payment_checkouts`, `network_sessions`, `rate_limits`, `faqs`, `app_settings`, `customer_otp_delivery_log` |
| `_auth-factory.ts`, `auth-admin.ts`, `auth-customer.ts` | Auth tables (see `auth.md`)                                                                                                                                                                           |

Other files:

- `packages/db/src/client.ts`: `createDb(connectionString, opts?)` and `createListenClient(connectionString)`.
- `packages/db/src/network-health.ts`: `NETWORK_HEALTH_STALE_MS` and `isNetworkHealthStale()`.
- `packages/db/src/seed.ts`: backs `db:seed`.
- `packages/db/drizzle.config.ts`: the one `drizzle-kit` config (schema path, `./drizzle` output, `postgresql` dialect, `strict: true`).
- `packages/db/drizzle/`: committed SQL migrations, `meta/` snapshots, `_journal.json`.
- `compose.yaml` (repo root): local Postgres (port 5432, user `root`, db `local`).

Migrations: 53 files, `0000` to `0052`. The newest is `0052_pink_maginty.sql`. Check with `ls packages/db/drizzle/*.sql | wc -l`.

## Commands (run from repo root)

| Command                 | What it does                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bun run db:start`      | `docker compose up`. Starts local Postgres.                                                                    |
| `bun run db:push`       | `drizzle-kit push`. Pushes the schema, no migration file. This is how the local dev DB stays in sync.          |
| `bun run db:generate`   | `drizzle-kit generate`. Writes a migration file from the schema diff.                                          |
| `bun run db:migrate`    | `drizzle-kit migrate`. Replays the migration chain. Fails on the local dev DB (see below).                     |
| `bun run db:studio`     | `drizzle-kit studio`. Browser DB explorer.                                                                     |
| `bun run db:seed`       | `bun run src/seed.ts` in `@veent/db`.                                                                          |
| `bun run db:idempotent` | `bun scripts/idempotent-migrations.ts`. Rewrites `packages/db/drizzle/*.sql` to be idempotent. Safe to re-run. |

All `db:*` scripts except `db:idempotent` run `bun run --filter @veent/db <script>`.

`scripts/idempotent-migrations.ts` adds `IF NOT EXISTS` guards, `ON CONFLICT DO NOTHING` guards, and wraps `ADD CONSTRAINT` in a `DO $$ ... EXCEPTION` block. So `db:migrate` does not die on "already exists" on a clean or production DB.

## Push-managed dev DB (journal drift)

- The local dev DB is kept in sync with `db:push`. Its `drizzle.__drizzle_migrations` journal does not track every committed migration.
- `cd packages/db && bun run db:migrate` fails there with an "already exists" error. The spinner can hide the message. Capture it with `bunx drizzle-kit migrate > log 2>&1`.
- Do not fix the chain casually. It is a separate, risky cleanup on a live dev DB.
- To verify a new migration locally: run `db:generate` (the migration file is still required for clean and production DBs). Then apply the DDL directly (for example with a `postgres` one-liner). Migrations are idempotent, so a direct apply is safe to repeat.

## Client and pool

- `@veent/db` reads no env vars. Each app reads its own `DATABASE_URL` and passes it to `createDb()`.
- `createDb` defaults to `max: 10`. This is set on purpose so a leak cannot grow without limit.
- `createListenClient` is a separate single connection (`max: 1`) for LISTEN/NOTIFY. Never borrow it from the query pool. A LISTEN holds its connection for the life of the process.

## Shared cross-app tables

- `rate_limits` (in `customer.ts`) backs the sliding-window limiter in `packages/core/src/services/rateLimit.ts`. Both apps use it through thin wrappers.
- `network_health` (in `admin.ts`) is read by the admin dashboard and the public locator. `isNetworkHealthStale()` is the one staleness rule so both show the same AP state.

## Timestamps must be `timestamptz`

Declare every new timestamp column on the finance or session surface as `timestamp('col', { withTimezone: true })`.

Why: some columns were written by `.defaultNow()` (a Postgres wall-clock value in the session `TimeZone`, Manila here). Others were written with a JS `new Date()` (a UTC wall value through `postgres.js`). A bare `timestamp` column loses the zone, so two conventions shared one ambiguous type.

Migration `0052_pink_maginty.sql` converts 13 columns to `timestamptz`:

- `credit_ledger.created_at`, `points_ledger.created_at`, `payment_transactions.created_at`
- `payment_checkouts.{created_at, settled_at, last_polled_at}`
- `network_sessions.{started_at, bound_at, last_seen_at, expires_at}`
- `customer_profile.{last_free_session_at, access_expires_at, access_paused_at}`

Each `USING` cast (`AT TIME ZONE 'Asia/Manila'` or `'UTC'`) was set from that column's real write path, not from schema defaults. For example, the `network_sessions` default never fires. Code always sets it as a UTC wall value.

`apps/admin/src/lib/server/period.ts` `parsePeriod()` now converts a Manila day to a UTC instant (fixed -8h, no DST). It replaced a wall-clock `Date.UTC(...)` trick.

Applied to production and confirmed. Background: `process/general-plans/completed/finance-timestamptz-migration_23-07-26/`.
