# Production deployment — first run

How to bring the portal up on the real device (the box on-site, not a dev laptop).
There are three long-lived servers — the **customer** captive portal, the **admin**
dashboard, and the **locator** public AP map — plus a Postgres database and the cron
jobs. This is a self-hosted setup: each app uses `@sveltejs/adapter-node`, so
`bun run build` emits a `build/index.js` you run with `node build`.

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
It checks prerequisites, **auto-detects this device's LAN IP** and writes the per-app
`ORIGIN`s plus a ready-to-upload `deploy/login.html` from it, provisions a local Postgres
database and role, writes the env files and **generates** `BETTER_AUTH_SECRET`/`CRON_SECRET`,
installs deps, migrates, seeds, bootstraps the owner (if `OWNER_*` is set), builds, and writes
OS-specific service + cron config under `./deploy/` (systemd units on Linux, NSSM script on
Windows) with the exact privileged commands to finish. It never runs sudo/admin itself.

**Zero-touch IP on a box move.** The script picks the device's LAN IP (the egress address
toward the router — correct even on a multi-homed box) and writes `http://<ip>:3001/3002/3003`
into the customer/admin/locator `ORIGIN`s, plus `deploy/login.html` pointed at the customer
portal. Re-running on a new box (or after a lease change) refreshes a stale LAN-IP `ORIGIN`
automatically; a real `https://` domain you set for a TLS deploy is left untouched. Override
detection with `--ip=10.210.0.50` or `PROD_LAN_IP=10.210.0.50` (e.g. a static IP the box will
move to). The router api-ssl _Available From_ is **not** repointed automatically — that stays
the explicit `setup:router --restrict-api` step (**§7a**).

It does **not** install system packages (bun/node/Postgres), fill external secrets
(Maya/iTexMo/Resend/MikroTik/`OWNER_*`), upload `login.html` / run `setup:router`, or set up
TLS — do those by hand (the script prints the checklist). The manual walkthrough below documents
every step the script performs, for when you want to understand or override it.

---

## 0. Prerequisites on the device

- **Bun** (build + tooling) and **Node** (to run `build/index.js`; `bun ./build` also works).
- **PostgreSQL** — on the device, or a central DB reachable from it (for a multi-site
  setup see `docs/mikrotik/adding-a-remote-router.md` and the Tailscale + central-DB
  recipe in the README history).
- Network access to the **MikroTik router** API (gateway `10.210.0.1`, LAN `10.210.0.0/18`; API `:8728` plain / `:8729` api-ssl).

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
cp apps/locator/.env.example  apps/locator/.env
```

> **Every** app needs a `.env` with a non-empty `DATABASE_URL` — `bun run build` builds all
> three (customer, admin, locator) and each opens its DB client at import, so a missing
> `apps/locator/.env` fails the whole build. `setup:prod` writes all three for you.

Minimum for production:

**`apps/customer/.env`**

- `DATABASE_URL` — the prod DB
- `ORIGIN` — the portal's URL. `setup:prod` **auto-sets this** to `http://<device-ip>:3001`.
  A private-LAN host (RFC1918 IP / `.lan` / localhost) may stay on **http**; a portal exposed
  beyond the LAN **must** be `https://<domain>` behind TLS (validateEnv hard-fails otherwise).
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
> admin: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ORIGIN` (+ mikrotik conditional). The customer
> app also requires `ORIGIN` to be `https://` **unless** its host is a private-LAN address (then
> http is allowed but warned — the LAN-appliance exception). In dev these
> only warn.

**`apps/admin/.env`**

- `DATABASE_URL` — same DB
- `ORIGIN` — the admin's **LAN** address. Served directly on the LAN, this must match the
  port the service listens on (`PORT=3002`), e.g. `http://10.5.50.1:3002` — or a proxied
  hostname like `http://admin.lan`. (`5174` is the Vite _dev_ port, not the prod one.)
- `BETTER_AUTH_SECRET` — a **distinct** 32+ char secret (must differ from the customer one)
- `NETWORK_CONTROLLER="mikrotik"` + `MIKROTIK_HOST/USER/PASSWORD` (and `MIKROTIK_PORT/TLS` if needed)
- `HEALTH_EXCLUDE_INTERFACES` — interfaces to hide from the Networks view (e.g. `ether2`)
- `ADMIN_WG_HOSTS` / `ADMIN_WG_IPS` — extra walled-garden entries (optional)
- `CRON_SECRET` — for the health-refresh cron
- `RESEND_API_KEY` + `EMAIL_FROM` — staff invite emails (without it, invites only log)
- `OWNER_EMAIL` / `OWNER_PASSWORD` / `OWNER_NAME` — used once by `bootstrap:owner`

**`apps/locator/.env`** (public AP-map app, runs as `radius-locator` on `PORT=3003`)

- `DATABASE_URL` — same DB (read-only; the locator never touches routers or telemetry)
- `ORIGIN` — the public URL the map is served at

## 3. Database

```bash
bun run db:migrate                               # apply the committed schema. NEVER db:push in prod.
bun run db:seed                                  # optional: starter packages (REVIEW prices). Demo APs self-clean.
bun run --filter radius-admin bootstrap:owner    # create the first owner (uses OWNER_* env)
```

## 4. Build

```bash
bun run build        # builds all apps → apps/*/build/index.js
```

### Sentry source maps (optional)

Client stack traces in Sentry are minified unless source maps are uploaded at build time.
This is **opt-in**: the upload plugin (admin + customer `vite.config.ts`) only activates when
**all three** of `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, and `SENTRY_PROJECT_ID` are present in the
**build** environment. Without them the build is unchanged — no source maps are generated, so none
can ever be served to browsers. When configured, maps are uploaded and then deleted from the build
output (`filesToDeleteAfterUpload`), so they still never ship to clients.

> ⚠️ The build-time `SENTRY_AUTH_TOKEN` is a **different credential** from the runtime dashboard
> token, even though they share the env var name. The build token needs the **`project:releases`**
> scope; the runtime `/sentry` dashboard token (admin app) needs `event:read` + `event:write` +
> `org:read`. Provide the build token only to the build/CI step — never commit it, never put it in
> the systemd `EnvironmentFile` that runs the servers. Set `PUBLIC_SENTRY_RELEASE` and
> `SENTRY_RELEASE` to the same value (e.g. the git SHA) so uploaded maps match the running release.

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

`/etc/systemd/system/radius-locator.service` — the public AP-map app, same shape with
`EnvironmentFile=…/apps/locator/.env`, `Environment=PORT=3003`,
`ExecStart=/usr/bin/node apps/locator/build`. (`setup:prod` generates this unit too.)

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now radius-customer radius-admin radius-locator
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
_Available From_ restricted to the app server's LAN IP, and cleartext `api` turned off:

```
/certificate add name=api-cert common-name=10.210.0.1 key-usage=tls-server,key-cert-sign days-valid=3650
/certificate sign api-cert
/ip service set api-ssl certificate=api-cert address=<APP_SERVER_IP>/32 disabled=no
/ip service set api disabled=yes
/ip dhcp-server lease make-static [find address=<APP_SERVER_IP>]   # pin the server IP
```

Pin the app server's LAN IP (static, or a static DHCP lease) so the _Available From_
restriction can't break on a lease change.

> **⚠️ Moving from one box to another (e.g. dev laptop → on-site server).** The router's
> api-ssl _Available From_ is pinned to the OLD machine's IP, so the new server gets
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
> can't connect at all — temporarily **widen** the router's api-ssl _Available From_ (or open
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
> (CN=10.210.0.1), not the server's; only the allowed source IP moves. Also drop any
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

## 9. Sentry — error tracking & alerts

The apps report handled failures and cron check-ins to **Sentry**; the alerting on top is what makes
a dead scheduler or a charged-but-uncredited buyer *visible*. Two independent pieces:

- **Build-time source maps** (optional) — see **§4**. A *different* credential; only makes client
  stack traces readable.
- **Runtime capture + alerts** — this section.

### Runtime DSN (per app)

Set `PUBLIC_SENTRY_DSN` in each app's `.env` to its Sentry project DSN. **Fail-open:** an empty DSN
means Sentry never initializes and the app runs normally — which is exactly why dev (empty DSN) emits
nothing. Point all three at ONE project, or give each its own; the alert rules then live where each
app's events land:

- `apps/customer/.env` — money-path + network captures, and the `customer-network-revoke` /
  `customer-payments-reconcile` cron monitors.
- `apps/admin/.env` — the `admin-network-health-refresh` cron monitor + admin crashes.
- `apps/locator/.env` — crashes only.

Optional: `PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (client) / `SENTRY_TRACES_SAMPLE_RATE` (server) tune
performance-trace sampling — default `0.2`, clamped to `[0,1]`; leave empty to accept the default.

### Alert rules — a go-live task

The full capture taxonomy and **click-by-click Sentry-UI steps** live in
**[`docs/dev/sentry-alert-rules.md`](dev/sentry-alert-rules.md)**. This is a **deploy-time ops task,
not a dev task** — there's no live telemetry to alert on in dev. Do it on **staging first** to tune
thresholds, then replicate to prod. The cron monitors auto-create on their first check-in, so they
only appear once the scheduled crons (**§8**) are running.

As part of go-live, set at least these two (both threshold-independent — no tuning needed):

- **A1** — page on any unattributed **paid** event (a buyer charged but not credited; count-1, real money).
- **A4** — the cron monitors' **missed/failed** check-ins (a dead revoke/reconcile cron is invisible
  to error tracking — **§8**; page the two `customer-*` ones).

Volume alerts (A2/A3) go in with the spec's default thresholds and get retuned after the staging soak.

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
      `MIKROTIK_PORT="8729"`; router _Available From_ = the app server's IP; cleartext `api`
      disabled (`/ip service set api disabled=yes`). **On a server move, repoint the `Available From` IP.**
- [ ] **App server IP pinned to a static DHCP lease** on the router — the api-ssl _Available From_
      restriction is by IP, so if the server's lease drifts, api-ssl silently drops the connection
      (no health, latency `—`) while nothing logs an error. A static lease makes the restriction durable.
- [ ] Router `login.html` points at prod; walled garden provisioned; crons scheduled.
- [ ] **Sentry alerts wired for go-live** — `PUBLIC_SENTRY_DSN` set per app; at minimum **A1**
      (unattributed-paid page) and **A4** (cron missed/failed) from `docs/dev/sentry-alert-rules.md`,
      with the crons (**§8**) already running so the monitors exist. Full rules can be tuned post-soak.

## Updating a running deployment

```bash
cd /opt/Veent_WifiPortal
git pull
bun install
bun run db:migrate          # if there are new migrations
bun run build
sudo systemctl restart radius-customer radius-admin radius-locator
```

## Troubleshooting setup

Most setup failures are a **missing env var** or the **router IP restriction**. Symptom → cause → fix:

**`createDb: connection string is required` during `bun run build`**

- `bun run build` builds **every** workspace app (customer, admin, **locator**); each creates its DB
  client at import, so an empty/missing `DATABASE_URL` in **any** app's `.env` fails the whole build.
- Fix: give every app a `.env` with a non-empty `DATABASE_URL` — `cp apps/<app>/.env.example apps/<app>/.env`.
  `.env` files are gitignored, so a fresh clone has none. The value needn't reach a live DB to _build_
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

- The api-ssl _Available From_ is pinned to a different server IP (classic after moving boxes), or
  `MIKROTIK_PORT`/`MIKROTIK_TLS` are wrong, or the cert/api-ssl service isn't set up.
- Fix: confirm `MIKROTIK_TLS="true"`, `MIKROTIK_PORT="8729"`, `MIKROTIK_TLS_INSECURE="true"`, then
  repoint with `bun run --filter radius-admin setup:router --restrict-api` (or the manual
  `/ip service set api-ssl address=<this-server>/32`). If you've locked yourself out, temporarily
  widen the router's api-ssl _Available From_, then re-lock. See **§7a**.

**Router cert: `failure: CA not found` when signing the api-ssl cert**

- A `tls-server`-only cert can't self-sign. Create it with `key-usage=tls-server,key-cert-sign`,
  then `sign` (see **§7a**).

**Networks page suddenly shows no health / latency stuck at `—` (was working before)**

- Almost always the app server's IP **drifted off** the IP pinned in the api-ssl _Available From_
  restriction (a DHCP lease change). api-ssl then silently drops the SYN, so node-routeros hangs to
  its timeout and the health sweep gets nothing — and **no error is logged**. Plain `api` (8728) may
  still appear to work, masking it.
- Confirm from the app server: `openssl s_client -connect <router>:8729 -brief </dev/null` should say
  `CONNECTION ESTABLISHED` in ~100ms. If it hangs, the restriction is blocking this IP.
- Fix: **pin the app server to a static DHCP lease** on the router (durable fix), then re-point the
  restriction at the correct IP — `/ip service set api-ssl address=<this-server>/32` (or
  `setup:router --restrict-api`, which detects this server's IP and pins the lease for you).
- Separately, if `/ping`-based **latency** stays `—` but health is otherwise fine, the router API
  user's group is missing the **`test`** policy (RouterOS gates `/ping` behind it):
  `/user group set [find name=<group>] policy=...,test` (append `test`, don't drop the others).

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
