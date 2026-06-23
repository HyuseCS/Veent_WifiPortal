# Veent WiFi Portal — monorepo

Two independent SvelteKit apps on one shared Postgres database, managed as a bun workspace.

```
apps/
  customer/   veent-customer — captive portal for wifi end-users   (portal.veent.io)
  admin/      veent-admin    — staff management dashboard           (admin.veent.io)
packages/
  db/         @veent/db      — shared Drizzle schema + client; the single migration source
compose.yaml  shared Postgres for local dev
```

### Why it's split this way

- **Two apps, deployed separately.** Each app has its own SvelteKit build, adapter and
  `ORIGIN`, so they can ship to separate subdomains and scale independently.
- **One database, one schema.** All tables live in `packages/db`. Only that package runs
  migrations, so the customer and admin schemas can never drift apart.
- **Separate auth domains.** Customers and staff are different populations. There are two
  isolated better-auth instances: customer auth uses the `customer_*` tables with the
  `veent-portal` cookie prefix; admin auth uses the `admin_*` tables with the `veent-admin`
  cookie prefix. Each app also has its own `BETTER_AUTH_SECRET`, so a session from one app
  is never valid in the other.

## Setup

**Prerequisites:** [bun](https://bun.sh) and Docker (with `docker compose`). Postgres
runs in a container — nothing to install on the host.

Each developer sets up their own local environment; **`.env` files are never shared or
committed** (they're gitignored). Only the `.env.example` templates live in git — copy
them and fill in your own values.

```sh
bun install                 # resolves the workspace, links @veent/db into each app

# 1. Copy the env templates. The DB one works as-is (local Docker creds).
cp packages/db/.env.example   packages/db/.env
cp apps/customer/.env.example apps/customer/.env
cp apps/admin/.env.example    apps/admin/.env

# 2. Set a DISTINCT BETTER_AUTH_SECRET in EACH app's .env (do not leave it empty).
#    The two secrets must differ — that's what isolates the customer and admin
#    auth domains. They do NOT need to match anyone else's machine.
openssl rand -base64 32     # run once per app, paste each result into its .env

# 3. Bring up the database.
bun run db:start            # start Postgres (docker compose; runs in the foreground)
bun run db:migrate          # apply the committed migrations → all tables
```

> Run `db:migrate` (applies the migrations checked into `packages/db/drizzle`), **not**
> `db:generate`. Only schema *authors* run `db:generate`, after editing
> `packages/db/src/schema` — and they commit the generated SQL. See
> [Database](#database-run-from-the-repo-root--delegates-to-veentdb) below.

Each developer's `DATABASE_URL` is identical because it points at their **own** local
Docker Postgres (`localhost:5432`), not a shared server.

## Develop

```sh
bun run dev:customer        # http://localhost:5173
bun run dev:admin           # http://localhost:5174
```

### Git hooks (optional, one-time per clone)

A `pre-push` hook in `.githooks/` runs `bun run test` before every push. Enable it with:

```sh
git config core.hooksPath .githooks
```

Bypass a single push (e.g. a WIP branch) with `git push --no-verify`.

## Database (run from the repo root — delegates to @veent/db)

```sh
bun run db:generate         # generate SQL migrations from the schema
bun run db:migrate          # apply migrations
bun run db:push             # push schema directly (dev)
bun run db:studio           # open Drizzle Studio
```

The schema lives in `packages/db/src/schema`:
`auth-customer.ts` / `auth-admin.ts` (better-auth tables via the prefixed factory),
`customer.ts` (the captive-portal domain tables — `customer_profile`, `packages`,
`credit_ledger`, `network_sessions`, `rate_limits`, modeled from
`docs/use-cases/wifi-portal-erd.puml`), and `admin.ts` (`network_health` + others; the
dashboard also reads the shared customer tables).

### Migration workflow (keep `db:migrate` unbreakable across machines)

The golden rule: **the migrations in `packages/db/drizzle` are the single source of
truth for the DB.** Everyone — every laptop, staging, prod — reaches the same schema by
running the *same committed migrations* on a fresh-or-up-to-date database. Never change a
database any other way, or it drifts and the next `db:migrate` breaks for that machine.

**Changing the schema (authors only):**

```sh
# 1. Edit packages/db/src/schema/*.ts
bun run db:generate         # writes a new packages/db/drizzle/NNNN_*.sql
bun run db:migrate          # apply it to your own DB
git add packages/db/drizzle # COMMIT the generated SQL with your schema change
```

**Everyone else, after `git pull`:** just `bun run db:migrate`. That's it.

**Rules that keep it seamless:**

- **Never hand-edit the database.** No `psql ALTER`, no `CREATE TABLE` by hand, and don't
  run `db:push` against a database you migrate. `db:push` writes changes the migration
  files don't know about → the next `db:migrate` tries to re-create them and dies with
  `column/relation already exists`. Use `db:push` **only** on a throwaway DB you're happy
  to reset.
- **Write idempotent migrations.** Prefer `ADD COLUMN IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. They no-op safely if a column
  already exists (drift) and are harmless on a fresh DB — so a half-drifted machine still
  recovers. (Drizzle applies pending migrations in timestamp order and stops on the first
  error, so one un-guarded statement blocks every later migration.)
- **Always commit generated SQL** in the same commit as the schema change. An un-pushed
  migration means teammates' DBs silently fall behind.

**If `db:migrate` is already broken on a machine** (usually `… already exists` from past
drift): the clean reset — destroys local data — is

```sh
psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' \
  -c 'DROP SCHEMA IF EXISTS drizzle CASCADE;'
bun run db:migrate          # rebuild from the committed migrations
bun run db:seed             # optional: reseed packages/dev data
```

To sanity-check a fresh install works end-to-end, migrate a throwaway database:

```sh
psql "postgres://root:mysecretpassword@localhost:5432/postgres" -c 'CREATE DATABASE migrate_test;'
DATABASE_URL="postgres://root:mysecretpassword@localhost:5432/migrate_test" bun run --filter @veent/db db:migrate
psql "postgres://root:mysecretpassword@localhost:5432/postgres" -c 'DROP DATABASE migrate_test;'
```

## Deploying to production

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the first-run runbook on the
on-site device — env, migrations, building with `adapter-node`, running both servers
under systemd, the router + cron setup, and the pre-production checklist.

## Other

```sh
bun run build               # build both apps
bun run check               # svelte-check both apps
bun run lint                # prettier + eslint across the workspace
bun run format
```

### Regenerating auth tables (optional)

The better-auth tables are hand-maintained in `packages/db`. If you change an app's auth
config and want better-auth to emit the schema, run `bun run --filter veent-customer auth:schema`
(or `veent-admin`) — it writes a `auth-*.generated.ts` you can reconcile into the prefixed
factory.
