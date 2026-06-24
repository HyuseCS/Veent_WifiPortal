# Production deployment — first run

How to bring the portal up on the real device (the box on-site, not a dev laptop).
There are two long-lived servers — the **customer** captive portal and the **admin**
dashboard — plus a Postgres database and two cron jobs. This is a self-hosted setup:
both apps use `@sveltejs/adapter-node`, so `bun run build` emits a `build/index.js`
you run with `node build`.

> Dev note: `bun run dev` (vite) is **not** a production server. It runs with
> `dev === true`, which activates dev-only bypasses (placeholder device MAC, the
> `BETTER_AUTH_SECRET` fallback, console-logged OTP codes). Production must run the
> built `node build` output, where `dev === false`.

---

## Automated path (recommended)

Most of the steps below are scripted. From the repo root on the prod device:

```sh
bun run setup:prod --dry-run   # preview every action, change nothing
bun run setup:prod             # do it
```

It's **cross-platform** (Linux/Windows/macOS) and **idempotent** (re-run it to update).
It: checks prerequisites, provisions a local Postgres DB + role, writes the env files
and **generates** `BETTER_AUTH_SECRET`/`CRON_SECRET`, installs deps, migrates, seeds,
bootstraps the owner (if `OWNER_*` is set), builds, and writes OS-specific service +
cron config under `./deploy/` (systemd units on Linux, NSSM script on Windows) with
the exact privileged commands to finish. It never runs sudo/admin itself.

It does **not** install system packages (bun/node/Postgres), fill external secrets
(Maya/iTexMo/Resend/MikroTik/`OWNER_*`), configure the router, or set up TLS — do
those by hand (the script prints the checklist). The manual walkthrough below documents
every step the script performs, for when you want to understand or override it.

---

## 0. Prerequisites on the device

- **Bun** (build + tooling) and **Node** (to run `build/index.js`; `bun ./build` also works).
- **PostgreSQL** — on the device, or a central DB reachable from it (for a multi-site
  setup see `docs/mikrotik/adding-a-remote-router.md` and the Tailscale + central-DB
  recipe in the README history).
- Network access to the **MikroTik router** API (default `10.0.0.1:8728`).

## 1. Get the code and install

```bash
git clone <repo> /opt/Veent_WifiPortal
cd /opt/Veent_WifiPortal
bun install          # workspace deps — also needed at runtime by adapter-node
```

## 2. Create the production env files

Copy the templates and fill **real** values (never commit the filled files):

```bash
cp apps/customer/.env.example apps/customer/.env
cp apps/admin/.env.example    apps/admin/.env
```

Minimum for production:

**`apps/customer/.env`**
- `DATABASE_URL` — the prod DB
- `ORIGIN` — public URL of the portal (e.g. `https://portal.example.com`)
- `BETTER_AUTH_SECRET` — 32+ random chars (**required**; the app refuses to start without it)
- `NETWORK_CONTROLLER="mikrotik"`
- `MIKROTIK_HOST` / `MIKROTIK_USER` / `MIKROTIK_PASSWORD` — the router API login (the customer
  app drives grant/revoke). Production uses **api-ssl**: `MIKROTIK_PORT="8729"`,
  `MIKROTIK_TLS="true"`, `MIKROTIK_TLS_INSECURE="true"` (self-signed router cert). See **§7a**.
- `CRON_SECRET` — shared secret for the revoke + reconcile crons
- `CRON_IP_ALLOWLIST` — optional comma-separated source-IP allowlist for the cron endpoints
  (`/api/network/revoke`, `/api/payments/reconcile`); empty = allow any IP (still secret-gated)
- `MAYA_PUBLIC_KEY` / `MAYA_SECRET_KEY` — your **live** account keys
- `MAYA_SANDBOX="false"`
- `ITEXMO_API_CODE` / `ITEXMO_EMAIL` / `ITEXMO_PASSWORD` — SMS OTP delivery (all three)

> **Boot-time validation:** each app runs `validateEnv()` on startup (`hooks.server.ts`). In
> production a missing **required** var aborts the boot with a clear message instead of failing
> on first request. Required — customer: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CRON_SECRET`,
> `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY` (+ `MIKROTIK_*` when `NETWORK_CONTROLLER=mikrotik`);
> admin: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ORIGIN` (+ mikrotik conditional). In dev these
> only warn.

**`apps/admin/.env`**
- `DATABASE_URL` — same DB
- `ORIGIN` — the admin's **LAN** address (e.g. `http://10.5.50.1:5174` or `http://admin.lan`)
- `BETTER_AUTH_SECRET` — a **distinct** 32+ char secret (must differ from the customer one)
- `NETWORK_CONTROLLER="mikrotik"` + `MIKROTIK_HOST/USER/PASSWORD` (and `MIKROTIK_PORT/TLS` if needed)
- `HEALTH_EXCLUDE_INTERFACES` — interfaces to hide from the Networks view (e.g. `ether2`)
- `ADMIN_WG_HOSTS` / `ADMIN_WG_IPS` — extra walled-garden entries (optional)
- `CRON_SECRET` — for the health-refresh cron
- `RESEND_API_KEY` + `EMAIL_FROM` — staff invite emails (without it, invites only log)
- `OWNER_EMAIL` / `OWNER_PASSWORD` / `OWNER_NAME` — used once by `bootstrap:owner`

## 3. Database

```bash
bun run db:migrate                               # apply the committed schema. NEVER db:push in prod.
bun run db:seed                                  # optional: starter packages (REVIEW prices). Demo APs self-clean.
bun run --filter radius-admin bootstrap:owner    # create the first owner (uses OWNER_* env)
```

## 4. Build

```bash
bun run build        # builds both apps → apps/*/build/index.js
```

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

`/etc/systemd/system/radius-admin.service` — identical but
`EnvironmentFile=…/apps/admin/.env`, `Environment=PORT=3002`,
`ExecStart=/usr/bin/node apps/admin/build`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now radius-customer radius-admin
```

(Alternative: `bun --env-file=apps/customer/.env ./apps/customer/build` auto-loads the
env, but `EnvironmentFile` is cleaner as a service.)

## 6. Reverse proxy + TLS (recommended)

Put **Caddy** or **nginx** in front so the customer portal is served over HTTPS at a
stable hostname. This also fixes secure-session-cookie behaviour and avoids Maya
rejecting an `http://` / private-IP redirect URL. Make `ORIGIN` match the public URL
the proxy serves. The admin app is served on the LAN for staff.

## 7. Router (MikroTik)

- **Edit the captive-portal login page** (`docs/mikrotik/login.html`) so its redirect
  points at the **production** portal URL, then upload it to the hotspot. This is the
  link between router and portal — guests can't reach the portal without it.
- Provision the walled garden (admin host + payment domains):
  ```bash
  bun run --filter radius-admin setup:router
  ```
- See `docs/mikrotik/admin-lan-access.md` for serving admin on the LAN.

## 7a. Router API over TLS (api-ssl) — and what changes when the server moves

Both apps reach the router over the RouterOS **API**, which in production runs encrypted on
**api-ssl (8729)**; cleartext `api` (8728) is disabled so the API password never crosses the
wire in the clear (`SECURITY_RISKS.md` R10).

**On the app server's `.env` (BOTH apps — customer and admin both connect to the router):**

```sh
MIKROTIK_PORT="8729"
MIKROTIK_TLS="true"
MIKROTIK_TLS_INSECURE="true"   # the router cert is self-signed
```

**On the router (one-time):** a self-signed cert attached to `api-ssl`, enabled with
*Available From* restricted to the app server's LAN IP, and cleartext `api` turned off:

```
/certificate add name=api-cert common-name=10.0.0.1 key-usage=tls-server,key-cert-sign days-valid=3650
/certificate sign api-cert
/ip service set api-ssl certificate=api-cert address=<APP_SERVER_IP>/32 disabled=no
/ip service set api disabled=yes
/ip dhcp-server lease make-static [find address=<APP_SERVER_IP>]   # pin the server IP
```

Pin the app server's LAN IP (static, or a static DHCP lease) so the *Available From*
restriction can't break on a lease change.

> **⚠️ Moving from one box to another (e.g. dev laptop → on-site server).** The router's
> api-ssl *Available From* is pinned to the OLD machine's IP, so the new server gets
> `SOCKTMOUT` / connection-refused until you repoint it.
>
> **Automated (run from the NEW server, once it can reach the router):** it detects this
> machine's own source IP, restricts api-ssl to it, and pins the lease — no fat-fingered IP:
>
> ```sh
> bun run --filter radius-admin setup:router --restrict-api --dry-run   # preview
> bun run --filter radius-admin setup:router --restrict-api             # lock api-ssl to this server + pin lease
> #   add --disable-plain-api to also turn off cleartext 8728 (needs MIKROTIK_TLS="true")
> ```
>
> Chicken-and-egg: if the router currently restricts api-ssl to the OLD box, the new server
> can't connect at all — temporarily **widen** the router's api-ssl *Available From* (or open
> it) so the new server can reach it, then run the command above to re-lock it to the new IP.
>
> **Manual equivalent** (on the router CLI):
>
> ```
> /ip service set api-ssl address=<NEW_SERVER_IP>/32
> /ip dhcp-server lease make-static [find address=<NEW_SERVER_IP>]
> ```
>
> Either way: update `ADMIN_WG_IPS` (admin walled-garden) and re-run `setup:router` if the admin
> host IP changed. The cert itself does **not** change — it's the **router's** identity
> (CN=10.0.0.1), not the server's; only the allowed source IP moves. Also drop any
> `comment=dev-laptop` bypass from the old box:
> `/ip hotspot ip-binding remove [find comment=dev-laptop]`.

> **Fresh prod DB:** committed migrations apply cleanly in order on a new database — there's no
> bookkeeping quirk to worry about (that only happens on a DB where a since-discarded migration
> was applied, a dev-only artifact).

## 8. Cron jobs

Schedule these on the device (systemd timers or crontab), with the `x-cron-secret`
header set to each app's `CRON_SECRET`:

```cron
* * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3001/api/network/revoke
* * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3001/api/payments/reconcile
* * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3002/api/network/health/refresh
```

- **revoke** (customer) — enforces session end. **Without it, paid time never expires.**
- **payments/reconcile** (customer) — safety net: credits payments whose webhook never
  landed. **Without it, a paid user can go uncredited if their webhook is missed.**
- **health/refresh** (admin) — keeps per-AP health + latency warm.

## Pre-production checklist (do NOT ship without)

- [x] ~~**Remove the open admin signup**~~ — **already done**: `apps/admin/src/routes/register/`
      and its `/login` link were deleted in the hardening pass. Create the real owner with
      `bootstrap:owner`; do not reintroduce a browser signup route.
- [ ] `BETTER_AUTH_SECRET` set (distinct per app), real `CRON_SECRET`s.
      (Boot validation now **hard-fails** in prod on any missing required var — see note below.)
- [ ] Maya **live** keys + `MAYA_SANDBOX="false"`.
- [ ] `ITEXMO_API_CODE` / `ITEXMO_EMAIL` / `ITEXMO_PASSWORD` set (otherwise prod refuses the OTP flow).
- [ ] Built + running via `node build` (not `vite dev`).
- [ ] TLS in front; `ORIGIN` matches the public URL.
- [ ] Router API on **api-ssl (8729)** — both apps' `.env` set `MIKROTIK_TLS="true"` /
      `MIKROTIK_PORT="8729"`; router *Available From* = the app server's IP; cleartext `api`
      disabled; server IP pinned (§7a). **On a server move, repoint the `Available From` IP.**
- [ ] Router `login.html` points at prod; walled garden provisioned; crons scheduled.

## Updating a running deployment

```bash
cd /opt/Veent_WifiPortal
git pull
bun install
bun run db:migrate          # if there are new migrations
bun run build
sudo systemctl restart radius-customer radius-admin
```

## Troubleshooting setup

Most setup failures are a **missing env var** or the **router IP restriction**. Symptom → cause → fix:

**`createDb: connection string is required` during `bun run build`**
- `bun run build` builds **every** workspace app (customer, admin, **locator**); each creates its DB
  client at import, so an empty/missing `DATABASE_URL` in **any** app's `.env` fails the whole build.
- Fix: give every app a `.env` with a non-empty `DATABASE_URL` — `cp apps/<app>/.env.example apps/<app>/.env`.
  `.env` files are gitignored, so a fresh clone has none. The value needn't reach a live DB to *build*
  (postgres-js connects lazily); it just has to be present.

**App aborts on boot with "… is required in production" (a `validateEnv` failure)**
- `validateEnv()` hard-fails in prod on a missing **required** var — customer: `DATABASE_URL`,
  `BETTER_AUTH_SECRET`, `CRON_SECRET`, `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY` (+ `MIKROTIK_*` when
  `NETWORK_CONTROLLER=mikrotik`); admin: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ORIGIN` (+ mikrotik).
- Fix: set the named var. (In dev these only warn — so a build/dev box can hide a gap that prod rejects.)

**DB: `ECONNREFUSED` / `password authentication failed` / `database "local" does not exist`**
- Postgres isn't running, or `DATABASE_URL` doesn't match it. With Docker: `docker compose up -d db`
  (`compose.yaml` → user `root`, password `mysecretpassword`, db `local`, port `5432`).
- **Prod:** change the default password in **both** `compose.yaml` and `DATABASE_URL`, and bind
  `127.0.0.1:5432:5432` so the DB isn't exposed. If the apps are containerized too, use the compose
  service name (`@db:5432`), not `localhost`.

**Router: `SOCKTMOUT` / connection refused / timeout to the router**
- The api-ssl *Available From* is pinned to a different server IP (classic after moving boxes), or
  `MIKROTIK_PORT`/`MIKROTIK_TLS` are wrong, or the cert/api-ssl service isn't set up.
- Fix: confirm `MIKROTIK_TLS="true"`, `MIKROTIK_PORT="8729"`, `MIKROTIK_TLS_INSECURE="true"`, then
  repoint with `bun run --filter radius-admin setup:router --restrict-api` (or the manual
  `/ip service set api-ssl address=<this-server>/32`). If you've locked yourself out, temporarily
  widen the router's api-ssl *Available From*, then re-lock. See **§7a**.

**Router cert: `failure: CA not found` when signing the api-ssl cert**
- A `tls-server`-only cert can't self-sign. Create it with `key-usage=tls-server,key-cert-sign`,
  then `sign` (see **§7a**).

**Migrations say "applied successfully" but a column is missing**
- A dev-only quirk: drizzle skips a migration whose timestamp predates a since-discarded one already
  recorded in `__drizzle_migrations`. A **fresh prod DB applies everything in order**, so this won't
  happen in prod. On a dev box: the migrations are idempotent (`IF NOT EXISTS`) — apply the skipped
  one's SQL by hand to catch up. **Never `db:push` in prod — only `db:migrate`.**

**OTP never arrives / "iTexMo not configured"**
- Missing `ITEXMO_API_CODE` / `ITEXMO_EMAIL` / `ITEXMO_PASSWORD` (prod refuses to send rather than
  silently swallow the code). Trial iTexMo accounts must use sender id `ITM.TEST3`.

**Maya checkout shows a closed connection / can't load**
- The hotspot walled garden doesn't allow the Maya domains — run `bun run --filter radius-admin setup:router`.
  (Card 3-D Secure may still need the issuing bank's ACS domain added per deployment.)

**Guests connect to WiFi but never see the portal**
- The router `login.html` doesn't point at the prod portal URL (or wasn't uploaded). Edit
  `docs/mikrotik/login.html` → upload to the hotspot (**§7**).

**Paid time never expires, or paid users go uncredited**
- The crons aren't scheduled. Add the revoke + reconcile crons (**§8**).

**App "runs" but behaves like dev (placeholder device MAC, OTP printed to console, weak secret)**
- You're running `vite dev`, not `node build` — production must run the built output, where
  `dev === false` (see the dev note at the top).

**Your operator/dev machine lost internet after its purchased time expired**
- Expected: the revoke cron drops an expired guest bypass. Give the operator box a **standing**
  bypass instead: `/ip hotspot ip-binding add mac-address=<MAC> type=bypassed comment=dev-laptop`
  (the cron only touches `veent-portal`-tagged guest bindings).
