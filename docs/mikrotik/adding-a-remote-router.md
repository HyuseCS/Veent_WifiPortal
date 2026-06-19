# Adding a router at a new location

Steps to bring up a captive portal at a second (far) site with its own MikroTik —
and an honest map of what works today vs. what needs code.

## Read this first: one app instance talks to one router

The portal resolves a single network controller from env (`NETWORK_CONTROLLER`,
`MIKROTIK_HOST`, …). It grants/revokes/samples against **that one router**. There is
no built-in registry of multiple routers. So a new site is first a **topology
decision**, then per-router config.

> **The hosting constraint (the thing that decides this):** the portal can only reach a
> router it has a **network path to**. Today the app is hosted **locally** (on the LAN, e.g.
> `10.0.0.147`), so it can only talk to routers on that LAN. A router at a far site is on a
> *different* network — a locally-hosted portal simply can't see it. There are only two ways
> around that:
>
> 1. **Each site hosts its own portal instance**, talking to its **own local** router — so no
>    instance ever needs to reach a far router. Unify reporting by pointing them all at **one
>    shared database** hosted somewhere every site can reach (a cloud/VPS Postgres). *(Option A
>    — works today.)*
> 2. **Host the portal centrally** (cloud/VPS) and run a **VPN** from it to every site's router,
>    so one instance can reach them all. *(Needs the multi-controller code — Option B.)*
>
> Either way, the **database must move off the local box** to a host all sites can reach.
> Local hosting is fine for one site; it's the first thing that has to change for many.

| | **A. Per-site app instance** (works today) | **B. Central multi-controller** (needs code) |
|---|---|---|
| App instances | One per site (each with its own `MIKROTIK_HOST`) | One, talks to every router |
| Database | **Shared** Postgres (one `DATABASE_URL` for all) so reporting is unified | Shared |
| Dashboards | One per site, or aggregate from the shared DB | One |
| Code change | None | Controller registry + per-device routing (see last section) |
| Best for | A few sites, quick rollout | Many sites, single pane of glass |

**Recommended now: Option A with a shared database.** Each site runs `apps/customer`
(+ optionally `apps/admin`) pointed at its **local** router but the **same** Postgres,
so credits, sessions, and revenue are unified while each instance only ever touches its
own router. No code change.

---

## Per-router setup (do this on every new MikroTik — both options)

These mirror the single-site setup; adapt the interface/VLAN names to the site.

### 1. Base hardening + clock

- Set `/system/clock` + an NTP client. Time-based session expiry and TLS depend on it.
- Give it a unique `/system/identity`.
- Lock down the API (see step 5) — never expose it raw to the internet.

### 2. Guest network (VLAN + DHCP + pool)

- A guest VLAN/interface (e.g. `vlan70 hotspot`) with a private subnet
  (`/ip/address add address=10.x.0.1/24 interface=<guest-iface>`).
- A DHCP server + address pool on it. (At our main site, `dhcp1` runs on
  `vlan70 hotspot`; a network with no DHCP server is *not* a client network.)
- If you want **per-AP/zone user counts at this site**, give each zone its own VLAN
  now — the app attributes users by the interface a device's ARP entry lands on
  (`resolveApForMac`). One flat VLAN = one bucket. See
  [`adding-a-remote-router` → attribution](#per-site-attribution--where-they-connected).

### 3. Hotspot server

- `/ip/hotspot` server bound to the guest interface, with a login profile.
- Upload the portal's `login.html` (see `docs/mikrotik/login.html`) so the captive
  redirect carries `?mac=` to the portal.

### 4. Walled garden (critical — do not skip)

The hotspot denies everything pre-auth, so the portal **and the payment gateways**
must be whitelisted, or guests can't load the page or pay (Core Business Rule #2).

Run the repo's provisioner against the new router — it's idempotent:

```bash
cd apps/customer   # or apps/admin for the admin host
# .env: NETWORK_CONTROLLER=mikrotik, MIKROTIK_* = THIS site's router,
#       ORIGIN = the portal URL guests at this site hit
bun run setup:router
```

This calls `provisionWalledGarden()` and opens holes for `ORIGIN` +
`ADMIN_WG_HOSTS` / `ADMIN_WG_IPS`. **Add the payment-gateway hosts** (PayMongo /
Xendit / bank + e-wallet redirect domains) to `ADMIN_WG_HOSTS` so checkout works at
this site too.

### 5. API user for the portal (least privilege, locked down)

The portal logs into the router API to grant/revoke. Create a dedicated user and
restrict the service:

```
/user add name=veent-portal password=<strong> group=full   # or a custom group w/ hotspot+arp+log read/write
/ip service set api address=<portal-server-ip>/32           # only the portal box
/ip service set api-ssl address=<portal-server-ip>/32       # prefer TLS off-LAN
```

For a **far** site the portal server is not on the LAN, so the API crosses a network
— see [Connectivity](#connectivity--security-for-a-far-site).

### 6. Time-based backstop

Set the hotspot/user-profile session timeout to the max paid duration as a safety net.
The app's revoke cron is the primary expiry mechanism, but if the portal is ever
unreachable, the router still drops idle/expired devices on its own.

---

## Wire the app to the new site (Option A)

On the new site's app instance `.env` (customer, and admin if hosted there):

```ini
NETWORK_CONTROLLER="mikrotik"
MIKROTIK_HOST="<this site's router>"
MIKROTIK_USER="veent-portal"
MIKROTIK_PASSWORD="<strong>"
MIKROTIK_PORT="8729"          # 8729 = api-ssl; 8728 = plain api
MIKROTIK_TLS="true"           # use TLS for any non-LAN hop
MIKROTIK_TLS_INSECURE="true"  # only if the router uses a self-signed cert
ORIGIN="https://portal-<site>.example"   # the URL guests at this site reach
DATABASE_URL="<the shared Postgres>"     # same across all sites for unified reporting
CRON_SECRET="<shared or per-site>"
```

Then:

1. `bun run setup:router` (step 4) against this router.
2. Point a scheduler at **this instance's** revoke endpoint so its sessions expire and
   its orphaned bindings get reconciled:
   `* * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" $ORIGIN/api/network/revoke`
   (one timer per site — each only manages its own router).

---

## Connectivity & security for a far site

The portal server must reach the router's API (`8728`/`8729`). Across the internet:

- **Preferred:** a site-to-site **VPN** (WireGuard / IPsec) between the portal server
  and the router; keep the API bound to the VPN address only. The router API stays off
  the public internet entirely.
- **If no VPN:** use **api-ssl** (`8729`, `MIKROTIK_TLS=true`) and firewall
  `/ip service api-ssl address=` to the portal server's public IP. Never open plain
  `8728` to the internet.
- Each router also needs the **payment gateways** reachable from guests (walled garden,
  step 4) — that's independent of the portal API path.

---

## Per-site attribution — "where they connected"

`resolveApForMac` tags each session with the interface/AP a device is on **for that
router** (CAPsMAN → wireless → ARP). This already separates *zones within one site* if
you put them on separate VLANs.

**Across sites it is not yet enough:** `network_sessions.network_id` points at a
`network_health` row, and those rows are per-router interface names — two sites could
both have a `vlan70 hotspot`. To report **which site** a guest connected at, add a
site/router dimension (e.g. a `sites` table + `network_sessions.site_id`, or namespace
`network_health` rows per router). Flagged as **not built** — scope it before relying on
cross-site "where did they connect" reporting.

---

## Verification checklist (new site)

- [ ] Guest device gets a DHCP lease on the guest VLAN.
- [ ] Pre-auth, the device can reach the portal `ORIGIN` **and** the payment hosts (walled garden).
- [ ] Buying/Free-Time grants internet (a `bypassed` ip-binding appears on the router).
- [ ] Session shows in Active Sessions and its countdown is correct.
- [ ] The revoke cron expires a due session and removes its binding (and reconciles orphans).
- [ ] The portal server reaches the API only over VPN/api-ssl, not plain public `8728`.

---

## What centralized multi-site (Option B) would require — not built

For a single app instance to manage many routers:

1. **Controller registry** — resolve a `NetworkController` per site, not one global, from
   a `sites`/`routers` config or table (host, creds, tls per site).
2. **Per-device routing** — pick the right router for a grant/revoke. The hotspot redirect
   would need to carry a site id, or derive it from the requesting router's address.
3. **Per-site session tagging** — `network_sessions.site_id` so attribution, logs, and the
   revoke/reconcile cron act on the correct router.
4. **Multi-controller cron** — `expireDueSessions` / `reconcileGuestBindings` iterate every
   router instead of the single `network` singleton.

Until that lands, use **Option A** (one instance per site, shared DB).

## See also

- [`admin-lan-access.md`](./admin-lan-access.md) — walled garden + admin grant-on-sign-in.
- `apps/admin/scripts/setup-router.ts` — the `setup:router` provisioner.
- `packages/core/src/integrations/network/mikrotik.ts` — grant/revoke/resolve/log against a router.
