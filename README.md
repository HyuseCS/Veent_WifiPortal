# Veent WiFi Portal — monorepo

Three independent SvelteKit apps on one shared Postgres database, managed as a bun workspace.

```
apps/
  customer/   veent-customer — captive portal for wifi end-users   (portal.veent.io)
  admin/      radius-admin   — staff management dashboard           (admin.veent.io)
  locator/    veent-locator  — public read-only AP/coverage map     (radius.veent.io)
packages/
  db/         @veent/db      — shared Drizzle schema + client; the single migration source
compose.yaml  shared Postgres for local dev
```

### Why it's split this way

- **Three apps, deployed separately.** Each app has its own SvelteKit build, adapter and
  `ORIGIN`, so they can ship to separate subdomains and scale independently. (`customer` +
  `admin` drive the router; `locator` is a read-only map and touches neither router nor telemetry.)
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
cp apps/locator/.env.example  apps/locator/.env   # needs DATABASE_URL or `bun run build` fails

# 2. Set a DISTINCT BETTER_AUTH_SECRET in EACH app's .env (do not leave it empty).
#    The two secrets must differ — that's what isolates the customer and admin
#    auth domains. They do NOT need to match anyone else's machine.
openssl rand -base64 32     # run once per app, paste each result into its .env

# 3. Set CRON_SECRET in apps/customer/.env (ships empty). The cron endpoints
#    (revoke/reconcile) are fail-closed without it, and the local scheduler
#    (`dev:cron`, below) reads this value — leave it empty and access never expires.
openssl rand -base64 32     # paste into apps/customer/.env → CRON_SECRET=

# 4. Bring up the database.
bun run db:start            # start Postgres (docker compose; runs in the foreground)
bun run db:migrate          # apply the committed migrations → all tables
```

> Run `db:migrate` (applies the migrations checked into `packages/db/drizzle`), **not**
> `db:generate`. Only schema _authors_ run `db:generate`, after editing
> `packages/db/src/schema` — and they commit the generated SQL. See
> [Database](#database-run-from-the-repo-root--delegates-to-veentdb) below.

Each developer's `DATABASE_URL` is identical because it points at their **own** local
Docker Postgres (`localhost:5432`), not a shared server.

## Develop

Run each in its own terminal:

```sh
bun run dev:customer        # http://localhost:5173
bun run dev:admin           # http://localhost:5174
bun run dev:locator         # http://localhost:5172 — public AP/coverage map
bun run dev:cron            # the revoke/reconcile scheduler — REQUIRED for access to expire (see below)
```

### Local cron — run `dev:cron` alongside the dev server

In production a scheduler (systemd timer / crontab — `docs/DEPLOYMENT.md` §8) POSTs the
customer cron endpoints every minute. A dev box has no such scheduler, so `dev:cron` stands
in for it. **Treat it as part of running the dev server**, not an optional extra — without it:

- **Paid/free time never expires** — `/api/network/revoke` is what removes the router bypass
  when a window lapses. No cron → a granted device stays online forever.
- **Missed-webhook payments never settle** — `/api/payments/reconcile` is the safety net that
  credits a payment whose webhook never arrived (common in local dev, where Maya can't reach
  your laptop).
- **State drifts** — expired-but-`active` sessions pile up and orphan router bypasses linger,
  which clogs the per-account device cap and causes flaky reconnects / "connected then
  dropped" flicker on a real router.

```sh
bun run dev:cron            # POSTs /api/network/revoke + /api/payments/reconcile once a minute
```

Prerequisite: `CRON_SECRET` must be set in `apps/customer/.env` (Setup step 3) — the endpoints
are fail-closed and `dev:cron` exits if it's missing. The script reads `CRON_SECRET` + the base
URL from `apps/customer/.env`; override with env vars:

```sh
DEV_CRON_INTERVAL_MS=20000 bun run dev:cron     # tick every 20s instead of 60s
DEV_CRON_BASE_URL=http://127.0.0.1:5173 bun run dev:cron   # default; change if your port differs
```

It changes nothing about the app — production still uses an external scheduler. (Admin's
`/api/network/health/refresh` cron isn't covered here; add it to the script if you need the
Networks page to refresh without a viewer.)

### Git hooks (optional, one-time per clone)

A `pre-push` hook in `.githooks/` runs `bun run test` before every push. Enable it with:

```sh
git config core.hooksPath .githooks
```

Bypass a single push (e.g. a WIP branch) with `git push --no-verify`.

## Payments — Maya (PayMaya) sandbox testing

Top-ups go through Maya Checkout. Credits are **never** added when checkout is created —
they're added only when Maya calls our webhook (`POST /api/webhooks/payment`) and we
re-confirm the payment with Maya's API. To exercise this end-to-end locally you need
sandbox API keys **and** a public URL Maya can reach (ngrok), because the webhook is an
inbound call from Maya's servers to your laptop.

### 1. Get sandbox API keys

Create a sandbox account at the [Maya Developer Portal](https://developers.maya.ph) and
copy your **sandbox** public + secret keys (public starts with `pk-…`, secret with `sk-…`).
Maya also publishes shared generic sandbox keys in its docs if you just want to try the
flow. Put them in `apps/customer/.env`:

```sh
MAYA_PUBLIC_KEY="pk-...your sandbox public key..."   # used to CREATE checkouts
MAYA_SECRET_KEY="sk-...your sandbox secret key..."   # used to VERIFY webhooks (re-fetch payment)
MAYA_SANDBOX="true"                                   # "true" = pg-sandbox.paymaya.com, "false" = production
```

> Both keys must belong to the **same** environment. `MAYA_SANDBOX="true"` points every call
> at `https://pg-sandbox.paymaya.com`; using a production secret key against the sandbox host
> (or vice-versa) makes webhook verification fail with `401`. Restart `dev:customer` after
> editing `.env`.

### 2. Expose your local server with ngrok

Maya can't reach `localhost`. Start the customer app, then tunnel it:

```sh
bun run dev:customer                    # http://localhost:5173
ngrok http 5173                         # in a second terminal
```

ngrok prints a public URL like `https://abc123.ngrok-free.app`. Your webhook endpoint is
that URL + `/api/webhooks/payment`. Open the ngrok inspector at **http://127.0.0.1:4040**
to watch every webhook hit (request body + your response code) — this is your best
debugging tool.

> ⚠️ **Free ngrok gives a NEW URL every restart.** If you restart ngrok you must
> re-register the webhook (step 3) with the new URL, or Maya will keep POSTing to the old
> dead address and nothing will arrive. A reserved/static ngrok domain avoids this.

### 3. Point Maya's webhooks at your tunnel

Tell Maya where to send payment notifications. Webhooks live **per Maya account**, so this
is a one-time setup you only repeat when your public URL changes:

```sh
cd apps/customer
bun run maya:webhooks register https://abc123.ngrok-free.app
```

This registers the `PAYMENT_SUCCESS` / `PAYMENT_FAILED` / `PAYMENT_EXPIRED` events against
`<url>/api/webhooks/payment` (the path is appended for you) using `MAYA_SECRET_KEY` /
`MAYA_SANDBOX` from `.env`. It's idempotent — re-running replaces any stale registration, so
just run it again with the new URL after an ngrok restart. Inspect or remove with
`bun run maya:webhooks list` and `bun run maya:webhooks clear`.

### 4. Make a test payment

1. Log into the customer app, go to **/top-up**, pick a bundle, **Continue to payment**.
2. On Maya's hosted page, pay with a Maya **sandbox test card** (numbers are on Maya's
   [Testing and Validating](https://developers.maya.ph/reference/testing-and-validating-your-maya-checkout-integration)
   page — never use a real card in sandbox).
3. **Complete the payment promptly.** A Maya checkout **expires after ~1 hour**; if you let
   it lapse you get a `PAYMENT_EXPIRED` webhook with no underlying payment, and re-fetching
   it returns `PY0009 "Payment does not exist"` — that's expected for an unpaid checkout, not
   a bug. Only a _completed_ payment fires `PAYMENT_SUCCESS` and credits the balance.

On success you should see, in order: a `POST /api/webhooks/payment` → `200` in the ngrok
inspector, a new `topup` row in `credit_ledger`, the balance updated on `/dashboard`, and a
`PAYMENT_SUCCESS` row on the admin **/finance** page.

### Troubleshooting

| Symptom                                                                              | Likely cause                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| No `POST /api/webhooks/payment` in the ngrok inspector after paying                  | Webhook not registered, or pointing at a **stale ngrok URL** — re-run `bun run maya:webhooks register <url>` (check with `maya:webhooks list`) |
| Webhook arrives but responds `400 … verification failed`                             | Signature verification failed: `MAYA_SECRET_KEY` empty/wrong, or sandbox↔production key mismatch (Maya's re-fetch returns `401`)               |
| Webhook arrives but responds `400 … verification failed` after a checkout sat unpaid | The checkout **expired** before payment — Maya's re-fetch returns `PY0009 "Payment does not exist"` (expected for an unpaid/expired checkout)  |
| Checkout page (Maya) errors on **Continue to payment**                               | `MAYA_PUBLIC_KEY` empty/wrong                                                                                                                  |
| Webhook `200` but balance unchanged                                                  | The event wasn't `PAYMENT_SUCCESS` (e.g. expired/failed) — credits are added only on a confirmed paid payment                                  |

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
running the _same committed migrations_ on a fresh-or-up-to-date database. Never change a
database any other way, or it drifts and the next `db:migrate` breaks for that machine.

**Changing the schema (authors only):**

```sh
# 1. Edit packages/db/src/schema/*.ts
bun run db:generate         # writes a new packages/db/drizzle/NNNN_*.sql
bun run db:idempotent       # rewrite the new SQL to IF NOT EXISTS / guarded forms
bun run db:migrate          # apply it to your own DB
git add packages/db/drizzle # COMMIT the generated SQL with your schema change
```

`db:idempotent` (`scripts/idempotent-migrations.ts`) makes every migration safe to
re-run over an existing/drifted schema — `CREATE TABLE/INDEX IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, guarded `ADD CONSTRAINT` (catches `duplicate_object`/
`duplicate_table`), `DROP ... IF EXISTS`, `DROP TRIGGER IF EXISTS` before `CREATE
TRIGGER`. Run it after every `db:generate`. Drizzle gates by journal timestamp, so
editing the generated SQL never re-runs it where already applied.

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
on-site device — the one-command `bun run setup:prod` (auto-detects the device's LAN IP),
env, migrations, building with `adapter-node`, running the servers under systemd, the
router + cron setup, and the pre-production checklist.

## Other

```sh
bun run build               # build all apps
bun run check               # svelte-check all apps
bun run lint                # prettier + eslint across the workspace
bun run format
```

### Regenerating auth tables (optional)

The better-auth tables are hand-maintained in `packages/db`. If you change an app's auth
config and want better-auth to emit the schema, run `bun run --filter veent-customer auth:schema`
(or `veent-admin`) — it writes a `auth-*.generated.ts` you can reconcile into the prefixed
factory.
