# Admin access over the WiFi LAN

How an operator reaches the admin dashboard from any device on the WiFi — and
gets working internet the moment they sign in — without hosting the admin app
externally.

## The problem

The admin dashboard (`apps/admin`) is a separate SvelteKit app. A device joined
to the guest WiFi sits behind the hotspot's default deny-all firewall, so by
default it can't reach the admin app *or* the internet until credits/Free Time
are spent. We want operators to:

1. Open the admin dashboard from **any device on the WiFi**, before authenticating.
2. Get **instant internet on that device** the moment they sign in — no credits.
3. Do it **within the LAN**, so there's nothing to host on the public internet.

## How it works

### 1. Serve the admin app on the LAN

Run `apps/admin` on a box reachable on the WiFi LAN (the gateway itself, or any
LAN host) and point `ORIGIN` at its LAN address — an IP (`http://10.5.50.1:5174`)
or an mDNS/DNS name (`http://admin.veent.lan`). Loopback (`localhost`) is rejected
by the setup script: guests can't reach it.

### 2. Whitelist the admin host in the walled garden

A hotspot intercepts unauthenticated HTTP and redirects to login, so the admin
host must be in the **walled garden** — the same allowlist that keeps the payment
gateways reachable (Core Business Rule #2). Provision it from the repo:

```bash
cd apps/admin
# .env has NETWORK_CONTROLLER=mikrotik, MIKROTIK_*, and a LAN ORIGIN
bun run setup:router
```

This calls `provisionWalledGarden()` (in `@veent/core`), which idempotently adds:

- `/ip/hotspot/walled-garden` `action=allow dst-host=<admin host>` — for DNS-name origins
- `/ip/hotspot/walled-garden/ip` `action=accept dst-address=<ip>` — for IP origins

Extra hosts/IPs come from `ADMIN_WG_HOSTS` / `ADMIN_WG_IPS`. Re-running after an
`ORIGIN` change just adds the new hole; existing entries are left untouched.

### 3. Grant internet on sign-in

When an **active staff** member signs in (`apps/admin/src/routes/login`):

1. The device's MAC is resolved from its LAN IP via the router
   (`resolveMacByIp` → `/ip/hotspot/host`, then `/ip/arp`). The walled-garden
   path has no captive-portal `?mac=` to read, so we look it up.
2. `grantAdminAccess()` writes a MikroTik `ip-binding type=bypassed` tagged
   `veent-admin` — full internet for that device.

The grant is **best-effort**: if the controller can't resolve the MAC or the grant
fails (e.g. the dev `stub` controller), sign-in still succeeds — the operator just
doesn't get the auto-grant.

### Why the bypass persists

Guest sessions are swept by the revoke cron (`expireDueSessions`), but that only
revokes MACs that have a `network_sessions` row. The admin bypass writes **no
session row** and carries its own `veent-admin` tag, so the cron never touches it.
It stays until an explicit sign-out / kick (`revokeAdminAccess()`), or until you
remove the binding on the router.

## Dev behaviour

With `NETWORK_CONTROLLER=stub` (default in dev) there's no router: `resolveMacByIp`
returns `null`, the grant no-ops with a log line, and `setup:router` refuses to run
(nothing to provision). Sign-in works normally — the LAN/grant behaviour only
engages against a real MikroTik.

## Components

| Concern | Where |
|---------|-------|
| MAC-from-IP lookup, tagged grant | `packages/core/src/integrations/network/mikrotik.ts` |
| Walled-garden provisioning | `provisionWalledGarden()` — same file |
| Admin grant/revoke/resolve service | `packages/core/src/services/adminAccess.ts` |
| Grant on sign-in | `apps/admin/src/routes/login/+page.server.ts` |
| Router setup CLI | `apps/admin/scripts/setup-router.ts` (`bun run setup:router`) |
