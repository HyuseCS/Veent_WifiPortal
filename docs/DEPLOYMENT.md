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
(Maya/Semaphore/Resend/MikroTik/`OWNER_*`), configure the router, or set up TLS — do
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
- `CRON_SECRET` — shared secret for the revoke cron
- `MAYA_PUBLIC_KEY` / `MAYA_SECRET_KEY` — your **live** account keys
- `MAYA_SANDBOX="false"`
- `SEMAPHORE_API_KEY` (+ optional `SEMAPHORE_SENDER_NAME`) — SMS OTP delivery

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

## 8. Cron jobs

Schedule these on the device (systemd timers or crontab), with the `x-cron-secret`
header set to each app's `CRON_SECRET`:

```cron
* * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3001/api/network/revoke
* * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3002/api/network/health/refresh
```

- **revoke** (customer) — enforces session end. **Without it, paid time never expires.**
- **health/refresh** (admin) — keeps per-AP health + latency warm.

## Pre-production checklist (do NOT ship without)

- [ ] **Remove the open admin signup** — delete `apps/admin/src/routes/register/` and
      the `<!-- TEMP: remove with /register -->` link in `apps/admin/src/routes/login/+page.svelte`.
      (Anyone reaching it can mint an owner.) Create the real owner with `bootstrap:owner`.
- [ ] `BETTER_AUTH_SECRET` set (distinct per app), real `CRON_SECRET`s.
- [ ] Maya **live** keys + `MAYA_SANDBOX="false"`.
- [ ] `SEMAPHORE_API_KEY` set (otherwise prod refuses the OTP flow).
- [ ] Built + running via `node build` (not `vite dev`).
- [ ] TLS in front; `ORIGIN` matches the public URL.
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
