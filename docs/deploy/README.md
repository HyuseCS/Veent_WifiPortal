# Deployment

How to bring the Veent WiFi Portal up. There are three long-lived servers — the **customer** captive
portal (3001), the **admin** dashboard (3002), and the **locator** public AP map (3003) — plus a
Postgres database and the cron jobs.

**Pick your path:**

| You are… | Use | Section |
|---|---|---|
| Standing up **production** on a VM (Docker) | `compose.prod.yaml` | **[Part 1 — Production (Docker)](#part-1--production-docker)** |
| Running on a **bare-metal host, no Docker** (dev boxes / self-host) | `setup:prod` + systemd | **[Part 2 — Bare-metal host](#part-2--bare-metal-host-no-docker)** |

Both paths share the same router, Sentry, and secrets setup — those live in three references linked
throughout and collected at the [bottom](#shared-references).

> **Dev note (applies to both paths):** `bun run dev` (vite) is **not** a production server. It runs
> with `dev === true`, which activates dev-only bypasses (placeholder device MAC, the
> `BETTER_AUTH_SECRET` fallback, console-logged OTP codes). Production must run the **built** output
> (`node build` / the app images), where `dev === false`.

> **Fresh DB, either path:** committed migrations apply cleanly in order on a new database — there's no
> bookkeeping quirk. (The "migration skipped, column missing" quirk only happens on a **dev** DB where
> a since-discarded migration was recorded. **Never `db:push` in prod — only `db:migrate`.**)

---

# Part 1 — Production (Docker)

The whole stack runs on ONE VM that sits on the **same LAN as the MikroTik router**. The admin app
reaches the router over the RouterOS **API** (`node-routeros`, api-ssl) at `MIKROTIK_HOST` = the
router's LAN IP. No WireGuard, no tunnel.

Services (all in `compose.prod.yaml`): `db` (Postgres + named volume), `migrate` (one-shot),
`customer` (3001), `admin` (3002), `locator` (3003), `cron` (sidecar hitting the cron endpoints).

Images come from `Dockerfile` (multi-stage): a build stage runs `bun run --filter ./apps/<APP> build`;
a slim `node:22` runtime runs `node build`. `@veent/db` + `@veent/core` are bundled into each app by
vite (`ssr.noExternal`), so runtime images carry only `build/` + a production `node_modules`.
`drizzle-kit` lives only in the `migrate` image, never in the app images.

## 1. One-time VM prep

- Install Docker Engine + the compose plugin.
- Clone the repo (or copy `Dockerfile`, `compose.prod.yaml`, `.env.prod.example`, and source).
- On the **router**: enable `api-ssl`, allow the VM's LAN IP, upload `login.html`, and make every
  physical AP MAC `type=bypassed`. Full steps: **[router-api-ssl.md](router-api-ssl.md)**.

## 2. Configure env

```bash
cp .env.prod.example .env
# Edit .env — fill DB password, per-app ORIGIN (LAN IPs), the two BETTER_AUTH_SECRETs
# (openssl rand -base64 32), the two CRON_SECRETs, MIKROTIK_*, Maya, SMS, Resend, Sentry.
```

`DATABASE_URL` host is the compose service name `db` and must match `POSTGRES_USER/PASSWORD/DB`.
Customer and admin use **distinct** `BETTER_AUTH_SECRET` and **distinct** `CRON_SECRET` — the compose
file maps `CUSTOMER_*` / `ADMIN_*` onto the var name each app reads. `.env` is git-ignored — never
commit it. Secret rules: **[secrets-hardening.md](secrets-hardening.md)**.

## 3. Build + start

```bash
docker compose -f compose.prod.yaml build
docker compose -f compose.prod.yaml up -d
```

Startup order is enforced: `db` (healthy) → `migrate` (`drizzle-kit migrate`, then exits 0) → the 3
apps (`depends_on: migrate completed`) → `cron`.

> Migrations run via the dedicated one-shot `migrate` service — **never `db:push`**. To re-run after a
> schema change: `docker compose -f compose.prod.yaml run --rm migrate`.

## 4. Bootstrap the owner (first deploy only)

Set `OWNER_EMAIL` / `OWNER_PASSWORD` / `OWNER_NAME` in `.env`. Owner bootstrap is a manual one-shot,
**not** part of the compose lifecycle — and it can't run inside the app image: the `node:22` runtime
image carries only `build/` + a production `node_modules` (no bun, no `drizzle-kit`, no scripts). Run
it from a **bun checkout** on the VM, pointing `DATABASE_URL` at the db container. Temporarily publish
the db port (uncomment `ports: ['5432:5432']` on the `db` service, or run on the VM host):

```bash
# from a repo checkout on the VM, with DATABASE_URL → the compose db (e.g. postgres://…@127.0.0.1:5432/…)
bun install
DATABASE_URL="$DATABASE_URL" bun run --filter radius-admin bootstrap:owner
```

Re-comment the db port afterward so the DB isn't reachable off the compose network.

## 5. Verify

```bash
docker compose -f compose.prod.yaml ps          # all healthy; migrate = Exited (0)
curl -I http://LAN_IP:3001/                      # customer
curl -I http://LAN_IP:3002/                      # admin  (302 → /login is "up")
curl -I http://LAN_IP:3003/                      # locator
docker compose -f compose.prod.yaml logs -f cron # revoke/reconcile/health each minute
```

Each app container also has a `HEALTHCHECK` hitting `/` (any status <400 = up).

## 6. Nightly Postgres backup (minimal)

Data lives in the `pgdata` named volume; dumps go to the `pgbackups` volume. Add a **host** cron entry:

```cron
# /etc/crontab or `crontab -e` on the VM — nightly at 02:30
30 2 * * * cd /path/to/repo && docker compose -f compose.prod.yaml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > /backups/radius-$(date +\%F).sql.gz'
```

Restore: `gunzip -c /backups/radius-YYYY-MM-DD.sql.gz | docker compose -f compose.prod.yaml exec -T db psql -U radius radius`.
Prune with a `find /backups -mtime +14 -delete` line as needed.

## 7. Updating (pull new images / rebuild)

```bash
git pull
docker compose -f compose.prod.yaml build
docker compose -f compose.prod.yaml run --rm migrate     # apply any new migrations
docker compose -f compose.prod.yaml up -d                # rolling replace of the app containers
```

CI publishes images to GHCR on push to `staging`/`main` (`.github/workflows/publish.yml`) tagged
`ghcr.io/<owner>/<repo>-<app>:<branch>-<sha>` (+ a moving `<branch>` tag) — a VM can pull those
instead of building locally by swapping each service's `build:` for `image:`.

---

# Part 2 — Bare-metal host (no Docker)

For a host without Docker (a dev box, or a self-host that prefers systemd). Each app uses
`@sveltejs/adapter-node`, so `bun run build` emits `build/index.js` you run with `node build`.

## Automated path (recommended)

Most steps are scripted. From the repo root on the host:

```sh
bun run setup:prod --dry-run   # preview every action, change nothing
bun run setup:prod             # do it
```

It's **cross-platform** and **idempotent** (re-run to update). It checks prerequisites, **auto-detects
the LAN IP** and writes per-app `ORIGIN`s + a ready-to-upload `deploy/login.html`, provisions a local
Postgres db/role, writes the env files and **generates** `BETTER_AUTH_SECRET`/`CRON_SECRET`, installs
deps, migrates, seeds, bootstraps the owner (if `OWNER_*` is set), builds, and writes OS-specific
service + cron config under `./deploy/` (systemd on Linux, NSSM on Windows). It never runs sudo itself.

**Zero-touch IP on a box move.** It picks the device's egress LAN IP and writes
`http://<ip>:3001/3002/3003` into the `ORIGIN`s + `deploy/login.html`. Re-running on a new box refreshes
a stale LAN-IP `ORIGIN`; a real `https://` domain is left untouched. Override with `--ip=10.210.0.50`
or `PROD_LAN_IP=…`. The router api-ssl _Available From_ is **not** repointed automatically — that's the
explicit `setup:router --restrict-api` step in **[router-api-ssl.md](router-api-ssl.md)**.

It does **not** install system packages (bun/node/Postgres), fill external secrets, upload
`login.html` / run `setup:router`, or set up TLS — do those by hand (the script prints the checklist).
The manual walkthrough below documents every step it performs.

## 0. Prerequisites

- **Bun** (build + tooling) and **Node** (to run `build/index.js`).
- **PostgreSQL** — on the host, or a central DB reachable from it.
- Network access to the **MikroTik router** API — **[router-api-ssl.md](router-api-ssl.md)**.

## 1. Get the code and install

```bash
git clone <repo> /opt/Veent_WifiPortal
cd /opt/Veent_WifiPortal
bun install          # workspace deps — also needed at runtime by adapter-node
```

## 2. Create the env files

```bash
cp apps/customer/.env.example apps/customer/.env
cp apps/admin/.env.example    apps/admin/.env
cp apps/locator/.env.example  apps/locator/.env
```

> **Every** app needs a `.env` with a non-empty `DATABASE_URL` — `bun run build` builds all three and
> each opens its DB client at import, so a missing `apps/locator/.env` fails the whole build.

Minimum per app (full var list is in each `.env.example`):

- **customer:** `DATABASE_URL`, `ORIGIN` (`http://<ip>:3001` on a private LAN; `https://<domain>`
  otherwise — validateEnv hard-fails on public http), `BETTER_AUTH_SECRET`, `NETWORK_CONTROLLER=mikrotik`
  + `MIKROTIK_*`, `CRON_SECRET`, `MAYA_PUBLIC_KEY`/`MAYA_SECRET_KEY` + `MAYA_SANDBOX=false`,
  `TUNNEL_ORIGIN` (the site's public https tunnel — **required for Maya on a NAT'd LAN**), `SMS_PROVIDER`
  + its keys (iTexMo `ITEXMO_*` default, or UniSMS `UNISMS_*`).
- **admin:** `DATABASE_URL`, `ORIGIN` (the admin's LAN address matching `PORT=3002`),
  a **distinct** `BETTER_AUTH_SECRET`, `NETWORK_CONTROLLER=mikrotik` + `MIKROTIK_*`,
  `HEALTH_EXCLUDE_INTERFACES`, `ADMIN_WG_HOSTS`/`ADMIN_WG_IPS` (optional), `CRON_SECRET`,
  `RESEND_API_KEY` + `EMAIL_FROM`, `OWNER_EMAIL`/`PASSWORD`/`NAME` (used once by `bootstrap:owner`).
- **locator:** `DATABASE_URL` (read-only), `ORIGIN`.

> **Boot-time validation:** each app runs `validateEnv()` on startup. In production a missing
> **required** var aborts the boot with a clear message. Required — customer: `DATABASE_URL`,
> `BETTER_AUTH_SECRET`, `CRON_SECRET`, `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY` (+ `MIKROTIK_*` when
> `NETWORK_CONTROLLER=mikrotik`); admin: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ORIGIN` (+ mikrotik).
> Secret rules: **[secrets-hardening.md](secrets-hardening.md)**.

## 3. Database

```bash
bun run db:migrate                               # apply the committed schema. NEVER db:push in prod.
bun run db:seed                                  # optional: starter packages (REVIEW prices).
bun run --filter radius-admin bootstrap:owner    # create the first owner (uses OWNER_* env)
```

## 4. Build

```bash
bun run build        # builds all apps → apps/*/build/index.js
```

Sentry source-map upload is opt-in at build time — see **[sentry-alerts.md](sentry-alerts.md)**.

## 5. Run the servers (systemd)

`node build` does **not** auto-load `.env` — inject it via systemd `EnvironmentFile`.

`/etc/systemd/system/radius-customer.service`:

```ini
[Unit]
Description=Radius customer portal
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/Veent_WifiPortal
EnvironmentFile=/opt/Veent_WifiPortal/apps/customer/.env
Environment=PORT=3001
ExecStart=/usr/bin/node apps/customer/build
Restart=always

[Install]
WantedBy=multi-user.target
```

`radius-admin.service` and `radius-locator.service` are identical with their own `EnvironmentFile` and
`Environment=PORT=3002`/`3003` and `ExecStart=…/apps/admin/build` / `…/apps/locator/build`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now radius-customer radius-admin radius-locator
```

## 6. Reverse proxy + TLS (recommended)

Put **Caddy** or **nginx** in front so the customer portal is served over HTTPS at a stable hostname.
This fixes secure-session-cookie behaviour and avoids Maya rejecting an `http://`/private-IP redirect
URL. Make `ORIGIN` match the public URL. The admin app is served on the LAN for staff. If you terminate
at a proxy, set `ADDRESS_HEADER`/`XFF_DEPTH` per **[secrets-hardening.md](secrets-hardening.md)**.

## 7. Cron jobs

Schedule these on the host (systemd timers or crontab), with the `x-cron-secret` header set to each
app's `CRON_SECRET`:

```cron
* * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3001/api/network/revoke
* * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3001/api/payments/reconcile
* * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3002/api/network/health/refresh
```

(The Docker path runs these in the `cron` sidecar instead.) `otp/sweep-delivery` runs on a **5-minute**
cadence in prod — schedule it separately, not every minute.

---

# Shared references

- **[router-api-ssl.md](router-api-ssl.md)** — MikroTik api-ssl cert, walled garden, `login.html`,
  AP `type=bypassed`, and the server-move _Available From_ repoint + router troubleshooting.
- **[sentry-alerts.md](sentry-alerts.md)** — DSN wiring, the A1/A4 go-live alerts, and build-time
  source maps.
- **[secrets-hardening.md](secrets-hardening.md)** — per-app `BETTER_AUTH_SECRET`, rotation, and the
  `ADDRESS_HEADER`/`XFF_DEPTH` reverse-proxy client-IP hardening.

## The cron jobs (both paths)

- **revoke** (customer) — enforces session end. **Without it, paid time never expires.**
- **payments/reconcile** (customer) — safety net: credits payments whose webhook never landed.
  **Without it, a paid user can go uncredited if their webhook is missed.**
- **health/refresh** (admin) — keeps per-AP health + latency warm.
- **otp/sweep-delivery** (customer, every 5 min) — async OTP delivery-receipt sweep.

## Pre-production checklist (do NOT ship without)

- [ ] `BETTER_AUTH_SECRET` set (distinct per app), real `CRON_SECRET`s. (Boot validation hard-fails in
      prod on any missing required var.)
- [ ] Maya **live** keys + `MAYA_SANDBOX="false"`.
- [ ] SMS OTP keys set for the selected `SMS_PROVIDER` (else prod refuses the OTP flow).
- [ ] Built + running via `node build` / app images (not `vite dev`).
- [ ] TLS in front; `ORIGIN` matches the public URL.
- [ ] Router API on **api-ssl (8729)**, _Available From_ = the app server's IP, cleartext `api`
      disabled, app server pinned to a static DHCP lease — **[router-api-ssl.md](router-api-ssl.md)**.
- [ ] Router `login.html` points at prod; walled garden provisioned; every AP MAC `type=bypassed`.
- [ ] Crons scheduled (sidecar or host crontab).
- [ ] **Sentry alerts wired** — `PUBLIC_SENTRY_DSN` per app; at minimum A1 + A4 with the crons already
      running so the monitors exist — **[sentry-alerts.md](sentry-alerts.md)**.

## Troubleshooting

Most setup failures are a **missing env var** or the **router IP restriction**.

**`createDb: connection string is required` during `bun run build`**
- `bun run build` builds every app; each creates its DB client at import, so an empty/missing
  `DATABASE_URL` in **any** app's `.env` fails the whole build. Fix: give every app a `.env` with a
  non-empty `DATABASE_URL` (needn't reach a live DB to build — postgres-js connects lazily).

**App aborts on boot with "… is required in production"**
- `validateEnv()` hard-fails on a missing required var. Fix: set the named var. (In dev these only warn.)

**DB: `ECONNREFUSED` / `password authentication failed` / `database "local" does not exist`**
- Postgres isn't running, or `DATABASE_URL` doesn't match it. Dev Docker: `docker compose up -d db`
  (`compose.yaml` → user `root`, password `mysecretpassword`, db `local`, host port `5433`). Prod:
  change the default password in **both** the compose/db config and `DATABASE_URL`.

**Router / api-ssl / OTP / Maya-checkout / captive-portal issues** → **[router-api-ssl.md](router-api-ssl.md)**.

**Migrations "applied successfully" but a column is missing**
- A **dev-only** quirk (a migration whose timestamp predates a since-discarded recorded one is skipped).
  A fresh prod DB applies everything in order. On a dev box, apply the skipped one's SQL by hand
  (migrations are idempotent). **Never `db:push` in prod.**

**App "runs" but behaves like dev (placeholder MAC, OTP printed to console, weak secret)**
- You're running `vite dev`, not `node build` / the app image — production must run the built output.
