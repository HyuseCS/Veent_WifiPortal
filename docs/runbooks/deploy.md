# Deploy runbook — single-VM docker compose

The whole stack runs on ONE VM that sits on the **same LAN as the MikroTik router**. The admin
app reaches the router over the RouterOS **API** (`node-routeros`, api-ssl) at `MIKROTIK_HOST` =
the router's LAN IP. No WireGuard, no tunnel.

Services (all in `compose.prod.yaml`): `db` (Postgres + named volume), `migrate` (one-shot),
`customer` (3001), `admin` (3002), `locator` (3003), `cron` (sidecar hitting the cron endpoints).

Images come from `Dockerfile` (multi-stage): a build stage runs `bun run --filter ./apps/<APP>
build`; a slim `node:22` runtime runs `node build`. `@veent/db` + `@veent/core` are bundled into
each app by vite (`ssr.noExternal`), so runtime images carry only `build/` + a production
`node_modules`. `drizzle-kit` lives only in the `migrate` image, never in the app images.

---

## 1. One-time VM prep

- Install Docker Engine + the compose plugin.
- Clone the repo (or copy `Dockerfile`, `compose.prod.yaml`, `.env.prod.example`, and source).
- On the **router**: enable `api-ssl` and allow the VM's LAN IP to reach it (see
  `docs/mikrotik/*` and `apps/admin/scripts/setup-router.ts`). Every physical AP MAC must be
  `type=bypassed` in `/ip/hotspot/ip-binding` (see `docs/mikrotik/ap-liveness-bypass.md`).

## 2. Configure env

```bash
cp .env.prod.example .env
# Edit .env — fill DB password, per-app ORIGIN (LAN IPs), the two BETTER_AUTH_SECRETs
# (openssl rand -base64 32), the two CRON_SECRETs, MIKROTIK_*, Maya, SMS, Resend, Sentry.
```

`DATABASE_URL` host is the compose service name `db` and must match `POSTGRES_USER/PASSWORD/DB`.
Customer and admin use **distinct** `BETTER_AUTH_SECRET` and **distinct** `CRON_SECRET` — the
compose file maps `CUSTOMER_*` / `ADMIN_*` onto the var name each app reads. `.env` is
git-ignored — never commit it.

## 3. Build + start

```bash
docker compose -f compose.prod.yaml build
docker compose -f compose.prod.yaml up -d
```

Startup order is enforced: `db` (healthy) → `migrate` (runs `bun run db:migrate` = `drizzle-kit
migrate`, then exits 0) → the 3 apps (`depends_on: migrate completed`) → `cron`.

> Migrations run via the dedicated one-shot `migrate` service — **never `db:push`** (that is the
> dev-only, push-managed path). To re-run after a schema change: `docker compose -f
> compose.prod.yaml run --rm migrate`.

## 4. Bootstrap the owner (first deploy only)

`OWNER_EMAIL`/`OWNER_PASSWORD` in `.env`, then:

```bash
docker compose -f compose.prod.yaml exec admin node -e "" # (sanity: admin up)
# Owner bootstrap runs inside the admin workspace; simplest is to run it once from a bun checkout:
bun run --filter radius-admin bootstrap:owner   # needs DATABASE_URL pointing at the db container
```

(Owner bootstrap is a manual one-shot, not part of the compose lifecycle.)

## 5. Verify

```bash
docker compose -f compose.prod.yaml ps          # all healthy; migrate = Exited (0)
curl -I http://LAN_IP:3001/                      # customer
curl -I http://LAN_IP:3002/                      # admin  (302 → /login is "up")
curl -I http://LAN_IP:3003/                      # locator
docker compose -f compose.prod.yaml logs -f cron # revoke/reconcile/health each minute
```

Each app container also has a `HEALTHCHECK` hitting `/` (any status <400 = up).

## 6. Router reachability note

The admin app talks to the router over api-ssl. If AP health reads DOWN or grants fail:

- Confirm `MIKROTIK_HOST` is the router's LAN IP and reachable from the VM
  (`docker compose -f compose.prod.yaml exec admin node -e "fetch('http://MIKROTIK_HOST').catch(()=>{})"`
  is not a real API test — use the admin Networks page / `setup-router.ts`).
- Confirm the API service is enabled on the router and the VM IP is allowed.
- Confirm every AP MAC is `type=bypassed` (false-DOWN otherwise — see the mikrotik runbook).

## 7. Nightly Postgres backup (minimal)

Data lives in the `pgdata` named volume; dumps go to the `pgbackups` volume. Add a **host** cron
entry (simplest, keeps the app stack lean):

```cron
# /etc/crontab or `crontab -e` on the VM — nightly at 02:30
30 2 * * * cd /path/to/repo && docker compose -f compose.prod.yaml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > /backups/radius-$(date +\%F).sql.gz'
```

Restore: `gunzip -c /backups/radius-YYYY-MM-DD.sql.gz | docker compose -f compose.prod.yaml exec -T db psql -U radius radius`.
Prune old dumps with a `find /backups -mtime +14 -delete` line as needed.

## 8. Updating (pull new images / rebuild)

```bash
git pull
docker compose -f compose.prod.yaml build
docker compose -f compose.prod.yaml run --rm migrate     # apply any new migrations
docker compose -f compose.prod.yaml up -d                # rolling replace of the app containers
```

CI publishes images to GHCR on push to `staging`/`main` (`.github/workflows/publish.yml`) tagged
`ghcr.io/<owner>/<repo>-<app>:<branch>-<sha>` (+ a moving `<branch>` tag) — a VM can pull those
instead of building locally by swapping each service's `build:` for `image:`.
