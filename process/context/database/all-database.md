---
name: context:all-database
description: "Drizzle/Postgres schema, migrations, client setup, and shared cross-app tables — the database group entrypoint/router"
keywords: database, drizzle, postgres, schema, migration, db:push, db:generate, db:migrate, db:studio, db:seed, drizzle-kit, client, connection pool, rate_limits, network_health, journal drift, idempotent migrations
related: [context:all-auth]
date: 10-07-26
---

# Database Context

This file is the canonical database context entrypoint for veent-wifiportal.

Use it after `process/context/all-context.md` when the task needs Drizzle schema changes, migration
workflow, or the shared Postgres client.

---

## Scope

This group covers:

- `packages/db` as the SOLE schema/migration authority for all three apps (`apps/admin`,
  `apps/customer`, `apps/locator`) — no app defines its own tables
- Drizzle schema conventions (`packages/db/src/schema/*.ts`), the barrel `index.ts`, and which file
  owns which table
- Migration workflow: `db:generate` → review → `db:push`/`db:migrate`, plus the push-managed
  dev-DB / journal-drift gotcha
- Database client setup (`createDb`, `createListenClient`) and connection-pool sizing
- Seeding (`packages/db/src/seed.ts`, `db:seed`)
- Local Postgres bootstrap (`compose.yaml` / `db:start`)
- Shared cross-app tables that live in one app's schema file but are read/written by more than one
  app: `rate_limits` (in `customer.ts`) and `network_health` (in `admin.ts`), plus the shared
  staleness-check module (`network-health.ts`)

It does not cover:

- Auth-table schema conventions (`auth-admin.ts`, `auth-customer.ts`, `_auth-factory.ts`,
  `admin-two-factor.ts`) — those live in the `auth/` group even though the files are physically
  inside `packages/db/src/schema/`
- Feature-specific migration plans — those belong under `process/features/*/active/` or
  `process/general-plans/active/`
- Business-logic services that read/write via Drizzle (`packages/core/src/services/*`) — routed via
  `all-context.md` §API and backend, not this group

## Read When

Read this entrypoint when:

- adding, changing, or removing a Drizzle table/column anywhere in `packages/db/src/schema/`
- running or troubleshooting `db:generate` / `db:push` / `db:migrate` / `db:studio` / `db:seed`
- debugging why `db:migrate` fails locally, or why the local schema is out of sync with committed
  migrations
- writing code that opens a DB connection (`createDb`) or a Postgres LISTEN/NOTIFY client
  (`createListenClient`)
- touching `rate_limits` or `network_health` — both are cross-app shared tables, not owned by a
  single app's feature surface

## Quick Routing

(No deeper database docs yet — this entrypoint is the only file in the group. Add routing entries
here when a `schema-guide.md`, `migration-procedures.md`, or `seeding.md` is split out.)

## Source Paths

- `packages/db/src/schema/index.ts` — barrel; every table must be exported here or `drizzle-kit`
  won't see it
- `packages/db/src/schema/admin.ts` — `admin_role`, `admin_profile`, `router_model`,
  `network_health`, `admin_bypass_device`
- `packages/db/src/schema/admin-two-factor.ts` — `admin_two_factor` (auth-adjacent; see `auth/` group)
- `packages/db/src/schema/admin-owner-change.ts` — `admin_owner_change_request`,
  `admin_owner_change_approval`
- `packages/db/src/schema/admin-issue.ts` — `admin_issue`, `admin_issue_assignee`
- `packages/db/src/schema/admin-issue-event.ts` — `admin_issue_event`, `admin_notification_read`
- `packages/db/src/schema/customer.ts` — `customer_profile`, `packages`, `credit_ledger`,
  `points_ledger`, `payment_transactions`, `payment_checkouts`, `network_sessions`, `rate_limits`
  (shared, see Canonical Notes), `faqs`, `app_settings`
- `packages/db/src/schema/_auth-factory.ts`, `auth-admin.ts`, `auth-customer.ts` — auth tables
  (conventions covered by the `auth/` group; listed here only because they physically live in this
  package)
- `packages/db/src/client.ts` — `createDb(connectionString, opts?)` and
  `createListenClient(connectionString)`; the package reads NO env itself, every caller passes its
  own `DATABASE_URL`
- `packages/db/src/network-health.ts` — `NETWORK_HEALTH_STALE_MS` + `isNetworkHealthStale()`, the
  one shared staleness rule for admin + locator readers
- `packages/db/src/seed.ts` — backs `db:seed`
- `packages/db/drizzle.config.ts` — single source of truth for `drizzle-kit` (schema path,
  `./drizzle` output dir, `postgresql` dialect, `strict: true`)
- `packages/db/drizzle/` — committed SQL migrations (47 as of 2026-07-10, `0000`–`0046`;
  `0046_oval_lorna_dane.sql` relaxes `admin_issue_event_type_ck` for IMS `note_edited`) + `meta/`
  snapshots + `_journal.json`
- `compose.yaml` (repo root) — local Postgres container definition (`postgres` image, port 5432,
  user `root`, db `local`)
- `scripts/idempotent-migrations.ts` — one-off that rewrote historical migrations to be idempotent
  (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`-style guards,
  `ADD CONSTRAINT` wrapped in a `DO $$ … EXCEPTION` block) so `db:migrate` never dies on
  "already exists" against a clean/prod DB; safe to re-run (`db:idempotent`)

## Commands

| Command | What it does |
|---|---|
| `bun run db:start` | `docker compose up` — starts local Postgres (port 5432, db `local`, user `root`) |
| `bun run db:push` | `drizzle-kit push` — pushes the schema straight to the DB, no migration file. **This is how the local dev DB is actually kept in sync.** |
| `bun run db:generate` | `drizzle-kit generate` — writes a new migration file under `packages/db/drizzle/` from the schema diff |
| `bun run db:migrate` | `drizzle-kit migrate` — replays the committed migration chain. **Fails against the local dev DB** — see Canonical Notes |
| `bun run db:studio` | `drizzle-kit studio` — browser DB explorer |
| `bun run db:seed` | `bun run src/seed.ts` inside `@veent/db` |
| `bun run db:idempotent` | `bun scripts/idempotent-migrations.ts` — rewrites `packages/db/drizzle/*.sql` to be idempotent; one-off maintenance, safe to re-run |

All root `db:*` scripts proxy to `bun run --filter @veent/db <script>` (except `db:idempotent`,
which runs the root script directly).

## Update Triggers

Update this group when:

- a new schema file is added to `packages/db/src/schema/`, or the barrel `index.ts` changes
- the migration workflow changes (e.g., the dev DB moves off push-managed sync, or the journal
  drift is deliberately reconciled)
- `drizzle.config.ts`, the client factory (`createDb`/`createListenClient`), or the default pool
  size changes
- `rate_limits` or `network_health` move to their own schema file, or gain new cross-app call sites
- the group grows enough to split into `schema-guide.md` / `migration-procedures.md` / `seeding.md`

## Canonical Notes

- **Push-managed dev DB / journal drift — read before running `db:migrate` locally.** The local dev
  DB (`postgres://root:***@localhost:5432/local`) is kept in sync via `bun run db:push`, not
  `db:migrate` — its `drizzle.__drizzle_migrations` journal does not track every committed migration
  file, so `cd packages/db && bun run db:migrate` fails trying to replay an already-applied
  migration and dies with an "already exists" error (the spinner can swallow the message — capture
  with `bunx drizzle-kit migrate > log 2>&1` if it's unclear). **Do not "fix" the chain casually** —
  reconciling it is a separate, risky cleanup on a live dev DB, not something to do as a side effect
  of an unrelated task.
  - To verify a NEW migration locally: still run `db:generate` to produce the committed migration
    file (this is correct and required for a clean/prod DB) — just don't rely on `db:migrate` to
    prove it works locally. Apply the new migration's DDL directly (e.g. a `postgres` one-liner) to
    verify against the drifted dev DB; the migrations are already written idempotently
    (`idempotent-migrations.ts`) so a direct apply is safe to re-run.
- `@veent/db` never reads environment variables itself (no `$env`, no `process.env`) — every
  consumer (`apps/admin`, `apps/customer`, `apps/locator`) reads its own `DATABASE_URL` and passes
  it into `createDb()`. All three apps point at the SAME Postgres instance/database.
- Connection pool: `createDb` defaults to `max: 10` (explicit, not relying on `postgres.js`'s own
  default) so a leak can't grow unbounded. `createListenClient` is a SEPARATE single connection
  (`max: 1`) for Postgres LISTEN/NOTIFY — never borrowed from the query pool, since a LISTEN ties up
  its connection for the process lifetime.
- `rate_limits` (physically in `customer.ts`) and `network_health` (physically in `admin.ts`) are
  shared cross-app tables despite living in one app's schema file. `rate_limits` backs the
  Postgres sliding-window limiter in `packages/core/src/services/rateLimit.ts`, consumed by both
  apps' thin per-app wrappers (`apps/admin/src/lib/server/{rateLimit,emailRateLimit}.ts`,
  `apps/customer/src/lib/server/{rateLimit,otpRateLimit}.ts`). `network_health` is read by both the
  admin dashboard and the public locator — `isNetworkHealthStale()` in `network-health.ts` is the
  one shared staleness rule that keeps the two surfaces from disagreeing about whether an AP is live.
- Migration count is a snapshot (46, `0000`–`0045` as of 2026-07-10) — re-check
  `ls packages/db/drizzle/*.sql | wc -l` if the exact count matters for a task.
