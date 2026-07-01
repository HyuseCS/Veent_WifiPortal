# Containerize the Veent WiFi Portal (full stack, production)

## Context

The portal currently deploys as bare-metal processes: `bun run build` emits `apps/*/build/index.js`
per app, run under systemd with `EnvironmentFile`, fronted by a host reverse proxy, with Postgres
on the host and three cron endpoints poked every minute by host crontab/systemd timers
(`docs/DEPLOYMENT.md`). The only container today is `compose.yaml`, which runs **Postgres alone**
for local dev.

Goal: package the whole stack — **customer + admin + locator + Postgres + migrations + cron** — as
production-grade container images and a single `docker compose` stack, so the on-site box runs
`docker compose -f compose.prod.yaml up -d` instead of hand-provisioning bun/node/systemd. Optimize
for a **single-host production deploy** (one replica per app, MikroTik router on the same LAN).

Scope note: this explicitly goes beyond the admin-only CLAUDE.md rule — the user authorized
full-stack containerization.

## Key facts established during research

- **Runtime**: all apps use `@sveltejs/adapter-node` **except locator, which uses `adapter-auto`**
  (must be swapped — see Step 0). adapter-node output runs under `bun ./build` *or* `node build`;
  we standardize on a **bun-only** image (`oven/bun`), no separate Node needed.
- **adapter-node output is NOT self-contained**: it externalizes runtime npm deps (`postgres`,
  `drizzle-orm`, `better-auth`, `node-routeros`, `resend`, `leaflet`, `uqr`, …). The runtime image
  needs production `node_modules`. The workspace packages `@veent/db` / `@veent/core` ARE bundled
  into the build (`ssr.noExternal` in each `vite.config.ts`), so `packages/` source is not needed at
  runtime — but core's external deps (`node-routeros`, `resend`) still are.
- **Build-time gotcha**: each app instantiates its DB client at import, so `vite build` fails on an
  empty `DATABASE_URL`. The build stage must export a **placeholder** `DATABASE_URL` (postgres-js
  connects lazily; the value need not be live to build).
- **`node build` / `bun ./build` does NOT auto-load `.env`** — env is injected via compose `env_file`.
- **Migrations** only ever run from `packages/db` via `drizzle-kit migrate` (needs the `drizzle-kit`
  devDep + `packages/db` source + a live `DATABASE_URL`). Never `db:push` in prod.
- **Cron**: three thin SvelteKit routes wrap `@veent/core` functions, gated by `requireCron`
  (`x-cron-secret` + optional `CRON_IP_ALLOWLIST`):
  - customer `POST /api/network/revoke` → `expireDueAccounts` + `reconcileGuestBindings`
  - customer `POST /api/payments/reconcile` → `reconcilePendingPayments`
  - admin `POST /api/network/health/refresh` → `refreshNetworkHealth`
- **No `svelte.config.js`** — SvelteKit config is inline in each `vite.config.ts`.
- Versions on this box: bun `1.3.14`, node `20.20.2`. `bun.lock` is committed → `--frozen-lockfile`.
- Existing probe routes reusable as healthchecks: customer `GET /generate_204` (→204),
  admin `GET /login` (→200), locator `GET /` (→200).

## Deliverables

| File | Purpose |
|------|---------|
| `apps/locator/vite.config.ts` (edit) + `apps/locator/package.json` (edit) | Swap `adapter-auto` → `adapter-node` so locator emits a runnable server |
| `Dockerfile` (new, repo root) | Multi-stage, parameterized by `ARG APP` — one file builds all three app images |
| `.dockerignore` (new, repo root) | Keep build context small; never copy `.env`, `node_modules`, build output, tooling |
| `compose.prod.yaml` (new, repo root) | Full stack: `db` + `migrate` (one-shot) + `customer` + `admin` + `locator` + `cron` |
| `docs/DEPLOYMENT.md` (edit) | Add a "Containerized deployment" section alongside the existing bare-metal path |

Existing `compose.yaml` (dev Postgres only) is left untouched.

## Step 0 — Fix locator's adapter (prerequisite)

In `apps/locator/vite.config.ts`, change `import adapter from '@sveltejs/adapter-auto'` →
`'@sveltejs/adapter-node'`. Add `@sveltejs/adapter-node` to `apps/locator/package.json` devDeps
(customer/admin already pin `^5.5.6`) and refresh `bun.lock`. Without this, `apps/locator/build`
is not a runnable server and the locator container can't start.

## Step 1 — `Dockerfile` (multi-stage, one file for all apps)

```dockerfile
# ---- base: pinned bun ----
FROM oven/bun:1.3.14-slim AS base
WORKDIR /app

# ---- deps: full install (dev+prod) for building ----
FROM base AS deps
COPY ../../package.json bun.lock ./
COPY ../../apps/customer/package.json apps/customer/
COPY ../../apps/admin/package.json apps/admin/
COPY ../../apps/locator/package.json apps/locator/
COPY ../../packages/db/package.json packages/db/
COPY ../../packages/core/package.json packages/core/
RUN bun install --frozen-lockfile

# ---- build: compile all three apps ----
FROM deps AS build
COPY ../.. .
ENV DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder
RUN bun run build            # emits apps/*/build

# ---- prod-deps: production-only node_modules ----
FROM base AS prod-deps
COPY ../../package.json bun.lock ./
COPY apps/*/package.json apps/*/        # (expanded per-app as above)
COPY packages/*/package.json packages/*/
RUN bun install --frozen-lockfile --production

# ---- runtime: thin per-app image ----
FROM base AS runtime
ARG APP                                  # customer | admin | locator
ENV NODE_ENV=production PORT=3000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build     /app/apps/${APP}/build ./build
EXPOSE 3000
CMD ["bun", "./build"]
```

Notes:
- `prod-deps` keeps devDeps (vite, playwright, vitest, svelte-check) **out** of the runtime image.
- `build` runs once and compiles all three apps; each runtime image copies only its own `build/`.
- `packages/` is intentionally not copied to runtime (bundled via `noExternal`).
- `migrate` and `cron` services reuse stages from this same Dockerfile (below) — no extra Dockerfiles.

## Step 2 — `.dockerignore`

Exclude: `node_modules`, `**/build`, `**/.svelte-kit`, `.git`, `**/.env`, `**/.env.*`,
`test-results`, `.playwright-mcp`, `graphify-out`, `.claude`, `.idea`, `.vscode`, `.vibecode-backup`,
`*.md` docs not needed for build. **Critical**: never copy `.env*` into the image — secrets are
injected at runtime via compose `env_file`.

## Step 3 — `compose.prod.yaml` (the stack)

Services:

- **`db`** — `postgres:16`, named volume `pgdata`, `healthcheck: pg_isready`, **bound to
  `127.0.0.1:5432`** (never publicly exposed). Credentials + `POSTGRES_DB` from env.
- **`migrate`** — built from the Dockerfile `build` stage (has `drizzle-kit` + `packages/db`).
  `command: bun run --filter @veent/db db:migrate`. `depends_on: db (service_healthy)`.
  `restart: "no"` — a one-shot that must exit 0 before apps start.
- **`customer`** — `build: { context: ., args: { APP: customer } }`, `env_file: apps/customer/.env`,
  `environment: PORT=3001`, `ports: 3001:3001`, `depends_on: { migrate: service_completed_successfully }`,
  healthcheck hitting `/generate_204`.
- **`admin`** — same shape, `APP: admin`, `apps/admin/.env`, `PORT=3002`, `ports: 3002:3002`,
  healthcheck `/login`.
- **`locator`** — same shape, `APP: locator`, `apps/locator/.env`, `PORT=3003`, `ports: 3003:3003`,
  healthcheck `/`.
- **`cron`** — tiny sidecar (reuse `base` bun image or `alpine` + `curl`) running a 60s loop that
  POSTs the three endpoints with `x-cron-secret`. Mirrors `scripts/dev-cron.ts` but targets the
  compose service names (`http://customer:3001/...`, `http://admin:3002/...`) and adds the admin
  health endpoint. `depends_on: { customer: service_healthy, admin: service_healthy }`.
  `CRON_SECRET` must match the apps' values.

Apps reach Postgres via the compose service name — set `DATABASE_URL=postgres://…@db:5432/…` in each
`.env` (the doc already anticipates this: "use the compose service name `@db:5432`, not localhost").

## Step 4 — Networking & env for the on-site box

- **Router reachability (bridge networking is fine).** Containers reach the MikroTik API
  (`10.210.0.1:8729`) outbound through the host. With default bridge + NAT, the router sees the
  **Docker host's LAN IP** as source — so the existing api-ssl *Available From* pin to the host IP
  keeps working. **No `network_mode: host` needed.** (Document this so nobody panics about the IP pin.)
- **`ORIGIN`**: still the LAN/public URL of each app, matched to the published port (customer `:3001`,
  admin `:3002`, locator `:3003`) or the reverse-proxy hostname. customer `validateEnv` still enforces
  https-or-private-LAN — unchanged by containerizing.
- **Reverse proxy / TLS** stays in front (host Caddy/nginx, or add a proxy service later). If a proxy
  fronts an app, set `ADDRESS_HEADER` / `XFF_DEPTH` per `.env.example`.
- **Secrets**: per-app `.env` files (gitignored) injected via `env_file`. `setup:prod` still generates
  them; nothing about secret handling changes.

## What we are NOT doing (and when to add it)

- **No in-process scheduler refactor.** Cron stays an external sidecar (user's call). The in-process
  option remains available later if the sidecar proves annoying.
- **No k8s / Swarm / registry push.** Plain compose for a single host. Add an orchestrator only if a
  multi-site/central deploy materializes.
- **No horizontal scaling / leader election.** One replica per app; the sidecar cron assumes exactly
  one of each. Revisit if replicas are ever added.

## Verification

1. **Locator adapter**: `bun run --filter veent-locator build` → produces a runnable
   `apps/locator/build/index.js` (sanity: `head` shows `import http from 'node:http'` like the others).
2. **Image build**: `docker compose -f compose.prod.yaml build` succeeds for all three apps (the
   placeholder `DATABASE_URL` lets `bun run build` pass).
3. **Cold start**: with real `apps/*/.env` in place (DB URL pointing at `db:5432`),
   `docker compose -f compose.prod.yaml up -d`:
   - `migrate` exits 0 (check `docker compose logs migrate` → drizzle "applied" output).
   - all three apps reach `healthy` (`docker compose ps`).
4. **Endpoints**: `curl -fsS localhost:3001/generate_204` → 204; `localhost:3002/login` → 200;
   `localhost:3003/` → 200.
5. **Cron**: `docker compose logs cron` shows the three POSTs returning 200 each minute; a paid test
   session expires after its window (revoke working).
6. **DB isolation**: `db` is not reachable from outside the host (only `127.0.0.1:5432`).
7. **No secrets in image**: `docker history` / `docker run --rm <img> sh -c 'ls /app && ! test -f /app/.env'`
   confirms no `.env` baked in.
