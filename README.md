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

```sh
bun install                 # resolves the workspace, links @veent/db into each app

cp packages/db/.env.example   packages/db/.env
cp apps/customer/.env.example apps/customer/.env
cp apps/admin/.env.example    apps/admin/.env
# set a distinct BETTER_AUTH_SECRET in each app's .env

bun run db:start            # start Postgres (docker compose)
bun run db:push             # create customer_* and admin_* tables in the one database
```

## Develop

```sh
bun run dev:customer        # http://localhost:5173
bun run dev:admin           # http://localhost:5174
```

## Database (run from the repo root — delegates to @veent/db)

```sh
bun run db:generate         # generate SQL migrations from the schema
bun run db:migrate          # apply migrations
bun run db:push             # push schema directly (dev)
bun run db:studio           # open Drizzle Studio
```

The schema lives in `packages/db/src/schema`:
`auth-customer.ts` / `auth-admin.ts` (better-auth tables via the prefixed factory),
`customer.ts` / `admin.ts` (each module's domain tables).

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
