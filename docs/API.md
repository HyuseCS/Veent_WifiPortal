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
  - `PaymentProvider` → `createMayaProvider` (Maya / PayMaya) — **stubbed**.
  - `NetworkController` → `createStubNetworkController` — **stubbed** (logs only).
- Each app builds the configured adapter from its own env in
  `src/lib/server/{network,payments}.ts`.

## Business rules enforced (CLAUDE.md)

| Rule | Where |
|------|-------|
| Credits added only on verified webhook, exactly once | `addCredits` idempotent on `external_transaction_id` (unique) |
| Free Time = 15 min / 12 h cooldown | `getFreeTimeStatus`, `startFreeSession` (atomic claim) |
| Access granted only after session logged + firewall dropped | `startSession` (DB row first, then `network.grant`) |
| SSE for connected users, never poll-per-second | `GET /api/connected` (admin) |
| Payment gateways reachable via Walled Garden whitelist (no payment grace period) | Router-level allowlist of PayMongo/Xendit + bank/e-wallet redirect hosts |

---

## Customer endpoints (`apps/customer`)

### `POST /api/network/grant` — start access (authenticated)
Body `{ macAddress: string, packageId?: number }`
- no `packageId` → Free Time session (429 if in cooldown)
- with `packageId` → spends the tier's `creditCost`, then grants (402 if short)
- 403 if the account is blocked.
- → `{ ok, mode: 'free'|'tier', session, balance? }`

### `POST /api/network/revoke` — expire due sessions (cron)
Header `x-cron-secret: <CRON_SECRET>`. Revokes every active session past its
`expiresAt` and re-blocks the MAC. → `{ ok, revoked: number }`. Run every minute.

### `POST /api/webhooks/payment` — gateway → us (the source of truth for credits)
This is the **PayMaya payload-receiving service**: PayMaya (Maya Checkout) calls
this endpoint server-to-server whenever a payment changes state, posting the
transaction payload here rather than relying on the customer's browser redirect.

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

---

## Integration seams (what's stubbed)

| Seam | File | To go live |
|------|------|-----------|
| **Payments (Maya)** | `packages/core/src/integrations/payments/maya.ts` | `verifyWebhook` is **done** (re-fetch, no HMAC). Still stubbed: `createCheckout` (Maya Checkout API). Set `MAYA_*` env. |
| **Network controller** | `packages/core/src/integrations/network/` | Add a real impl behind `NetworkController` (UniFi/Omada/RADIUS/grant_url); register in `index.ts`; set `NETWORK_CONTROLLER`. |
| **Connected-users feed** | `apps/admin/.../api/connected/+server.ts` | Already push-based (Postgres NOTIFY → SSE). To go truly live, drive the NOTIFY from RADIUS accounting instead of app writes (same SSE wire format). |
| **Per-user data usage** | `apps/admin/src/lib/server/queries.ts` (`usage: '—'`) | Needs a byte-accounting feed. |
| **Network health (APs)** | admin `networks` page (still on mocks) | Needs AP/location + health-sample tables (ICMP/SNMP polling) — not yet modeled. |

## Env vars

**customer:** `DATABASE_URL`, `ORIGIN`, `BETTER_AUTH_SECRET`, `NETWORK_CONTROLLER`,
`CRON_SECRET`, `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY`, `MAYA_WEBHOOK_SECRET`, `MAYA_SANDBOX`.
**admin:** `DATABASE_URL`, `ORIGIN`, `BETTER_AUTH_SECRET`, `NETWORK_CONTROLLER`.
See each app's `.env.example`.
