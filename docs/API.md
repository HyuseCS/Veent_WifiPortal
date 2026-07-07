# Veent WiFi Portal — API & Integration Reference

How the apps talk to the database, the network hardware, and the payment gateway.
All server logic lives in the shared **`@veent/core`** package; the SvelteKit
routes are thin wrappers over it.

## Architecture

```
apps/customer ─┐                         ┌─ NetworkController (stub → UniFi/Omada/RADIUS)
apps/admin   ──┼─→ @veent/core services ─┤
               │   (db-injected logic)   └─ PaymentProvider  (Maya, stubbed)
               └─→ @veent/db (Drizzle schema + client) ─→ Postgres
```

- **`@veent/core/services`** — `credits`, `freeTime`, `sessions`, `rateLimit`,
  `accounts`. Pure functions that take the `db` client as a parameter (no env, no
  framework). Reused by both apps.
- **`@veent/core/integrations`** — adapter interfaces + implementations:
  - `PaymentProvider` → `createMayaProvider` (Maya / PayMaya) — **live** (`createCheckout` + re-fetch `verifyWebhook`).
  - `NetworkController` → `createStubNetworkController` (logs only) **or** `createMikrotikController`
    (real RouterOS grant/revoke), selected by `NETWORK_CONTROLLER` (`stub` | `mikrotik`).
- Each app builds the configured adapter from its own env in
  `src/lib/server/{network,payments}.ts`.

## Business rules enforced (CLAUDE.md)

| Rule | Where |
|------|-------|
| Credits added only on verified webhook, exactly once | `addCredits` idempotent on `external_transaction_id` (unique) |
| Free Time = 15 min / 12 h cooldown | `getFreeTimeStatus`, `startFreeSession` (atomic claim) |
| Access granted only after session logged + firewall dropped | `startSession` (DB row first, then `network.grant`) |
| Body `macAddress` is advisory, not authoritative | `resolveMacForUser` (M-1/L-1) logs + ignores a mismatched body MAC. NB: the captive-portal `?mac=` param is still client-visible by design — see R12 |
| A revoke never cuts another account still live on the same MAC | `revokeGuestUnlessShared` / `hasLiveAccessForMacExcludingUser` (M-2, fully closes the cross-user DoS) |
| SSE for connected users, never poll-per-second | `GET /api/connected` (admin), `GET /api/account/stream` (customer) |
| Payment gateways reachable via Walled Garden whitelist (no payment grace period) | Router-level allowlist of Maya/PayMaya/GCash hosts (+ PayMongo/Xendit), plus per-device checkout hosts opened at checkout time (`setup:router`) |

---

## Customer endpoints (`apps/customer`)

### `POST /api/network/grant` — start access (authenticated)
Body `{ macAddress?: string, packageId?: number }`
- The device MAC is resolved **server-side** (`resolveMacForUser`: portal `?mac=` → router IP→MAC →
  browser-scoped `veent_device` hint → durable per-account `last_known_mac` fallback). `macAddress` in
  the body is **advisory only** — if it disagrees
  with the resolved MAC it's logged (`scope:mac-trust`) and ignored (M-1). `400` if the device can't be
  detected. **Caveat:** the resolved MAC can still originate from the client-visible captive-portal
  `?mac=` query param (inherent to captive portals — that's how a real device's MAC reaches us), so a
  determined authenticated caller can still bind an arbitrary MAC at their own credit cost; the
  cross-user damage that would enable is contained by the **M-2** revoke guard, not by rejecting the
  param. See `docs/SECURITY_RISKS.md` → R12.
- no `packageId` → Free Time session (429 if in cooldown)
- with `packageId` → spends the tier's `creditCost`, then grants (402 if short)
- 403 if the account is blocked.
- → `{ ok, mode: 'free'|'tier', accessExpiresAt, balance? }` (`balance` only on the tier path)

### `POST /api/network/revoke` — expire due access (cron)
Header `x-cron-secret: <CRON_SECRET>` (optionally IP-gated by `CRON_IP_ALLOWLIST`). Expires every
account whose access window has passed and re-blocks its MAC — **unless another account still holds a
live window on that same MAC** (shared device / NAT), in which case the DB row is marked expired but
the router binding is kept so the co-tenant isn't cut (M-2). In the same pass it sweeps expired
per-device checkout/admin walled-garden entries and folds in a reconcile pass.
→ `{ ok, outage, revoked, reconciled, sweptCheckoutAccess, sweptAdminAccess }`. Run every minute.

### `POST /api/payments/reconcile` — credit missed webhooks (cron)
Header `x-cron-secret: <CRON_SECRET>` (same IP-gate). Safety net: polls Maya for every pending
checkout old enough that its webhook should have arrived and credits any that actually paid —
idempotent via the `payment_checkouts` claim, so it never double-credits alongside the webhook.
Run every minute.

### `POST /api/webhooks/payment` (dev) · `POST /api/webhooks/maya/payment-status` (prod) — gateway → us (the source of truth for credits)
This is the **Maya payload-receiving service**: Maya (Maya Checkout) calls us server-to-server
whenever a payment changes state, posting the transaction payload rather than relying on the
customer's browser redirect. **Both paths delegate to one shared handler**
(`$lib/server/paymentWebhook.ts`). In local dev, Maya (via a registered ngrok tunnel) hits
`/api/webhooks/payment` directly; in production Maya notifies the central Veent DO relay, which
forwards the event to `${TUNNEL_ORIGIN}/api/webhooks/maya/payment-status` to route it back to this
NAT'd site. The handler re-verifies against Maya regardless of who delivered it.

Flow:
0. **Per-IP flood cap** (120/min) — every call triggers an outbound re-fetch, so this is
   guarded first; over budget → `429`.
1. Read the **raw** request body (do not parse first).
2. Verify via `payments.verifyWebhook`. **No HMAC** — Maya Checkout webhooks are unsigned, so
   it takes only the payment id from the (untrusted) body and **re-fetches the authoritative
   payment from Maya's API with `MAYA_SECRET_KEY`**, trusting that response; `400` on any
   lookup/status mismatch. The posted body is never trusted on its own.
3. Record **every** event (success and failure) in `payment_transactions` (upsert) for the
   admin Finance page.
4. On a `paid` event, credit `creditsProvided` for the package in `referenceId`, idempotent on
   the gateway transaction id so a re-delivered payload never double-credits.
5. Non-`paid` events (e.g. `failed`, `expired`) are acknowledged with `200` but credit nothing.

→ `{ ok, credited: boolean, balance }`

Always return `2xx` once the payload is accepted, even when no credit is applied —
PayMaya retries on any non-2xx, so reserve error codes for genuinely unverifiable
or malformed payloads.

### `GET /api/account/stream` — this account's live dashboard slice (SSE, authenticated)
Server-Sent Events of the caller's own balance / free-time / access window / devices. Emits a
view on connect, then a fresh one on every Postgres trigger for this user (no polling). `?mac=`
is display-only (flags `thisDevice`). Concurrent streams capped per account (4).

### `GET /auth/handoff?token=…` — CNA→browser session handoff
Consumes a single-use, short-TTL better-auth one-time token minted in the captive-network-assistant
webview and mints a real session in the system browser, so the guest skips a second OTP. Per-IP
rate-limited. Redirects on success.

### Captive-portal probe endpoints
OS "is there internet?" probes answered so the captive UI behaves: `GET /generate_204`, `/gen_204`,
`/hotspot-detect.html`, `/ncsi.txt`, `/connecttest.txt`.

### Form actions
- `dashboard` → `startFreeTime`, `buyTier` (hidden `mac` field from the captive
  redirect `?mac=`).
- `top-up` → `checkout` (creates a Maya checkout, redirects to the gateway).

---

## Admin endpoints (`apps/admin`)

Loaders return the exact shapes in `src/lib/types.ts`, so pages swap
`import … from '$lib/mocks'` for `let { data } = $props()`.

- `(app)/users` `load` → `{ users: AdminUserRow[] }`.
  Actions: **`block`** (refuse future grants + cut current), **`unblock`**,
  **`kick`** (cut current only). Form field: `userId`.
- `(app)/dashboard` `load` → `{ kpis, revenue, activeSessions }`.
- `GET /api/connected` — SSE stream of the dashboard snapshot: initial snapshot on connect,
  then a fresh push on every Postgres `NOTIFY` (real write to sessions / ledger / health,
  250 ms-debounced), with a 25 s heartbeat. No polling. Concurrent streams capped per user (6).
- `POST /api/network/health/refresh` — cron-callable (`x-cron-secret: <CRON_SECRET>`). Polls the
  router for per-AP health + latency so the Networks view stays warm. Run every minute.

---

## Integration seams (what's stubbed)

| Seam | File | To go live |
|------|------|-----------|
| **Payments (Maya)** | `packages/core/src/integrations/payments/maya.ts` | **Live** — both `createCheckout` (Maya Checkout API) and `verifyWebhook` (re-fetch, no HMAC) are implemented. Set `MAYA_*` env. |
| **Network controller** | `packages/core/src/integrations/network/` | MikroTik RouterOS impl is **live** (`mikrotik.ts`, `NETWORK_CONTROLLER=mikrotik`). Other controllers (UniFi/Omada/RADIUS/grant_url) still need an impl behind the same `NetworkController` interface. |
| **Connected-users feed** | `apps/admin/.../api/connected/+server.ts` | Already push-based (Postgres NOTIFY → SSE). To go truly live, drive the NOTIFY from RADIUS accounting instead of app writes (same SSE wire format). |
| **Per-user data usage** | `apps/admin/src/lib/server/queries.ts` (`usage: '—'`) | Needs a byte-accounting feed. |
| **Network health (APs)** | admin `networks` page (still on mocks) | Needs AP/location + health-sample tables (ICMP/SNMP polling) — not yet modeled. |

## Env vars

**customer:** `DATABASE_URL`, `ORIGIN`, `TUNNEL_ORIGIN` (Maya round-trip on a NAT'd site),
`BETTER_AUTH_SECRET`, `NETWORK_CONTROLLER` + `MIKROTIK_*`, `CRON_SECRET`, `CRON_IP_ALLOWLIST`,
`MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY`, `MAYA_SANDBOX`, `SMS_PROVIDER` + `ITEXMO_*`/`UNISMS_*`,
`PUBLIC_SENTRY_DSN`.
**admin:** `DATABASE_URL`, `ORIGIN`, `BETTER_AUTH_SECRET`, `NETWORK_CONTROLLER` + `MIKROTIK_*`,
`CRON_SECRET`, `RESEND_API_KEY`/`EMAIL_FROM`, `PUBLIC_SENTRY_DSN`.
See each app's `.env.example` for the full list.
