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
| Grace period rate-limited (3/hr) | `consumeRateLimit` (wired for OTP/grace use) |

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
Raw body verified via `payments.verifyWebhook` (400 if invalid). On a `paid`
event, credits `creditsProvided` for the package in `referenceId`
(`"${userId}:${packageId}"`), idempotent on the gateway txn id.
→ `{ ok, credited: boolean, balance }`

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
- `GET /api/connected` — SSE stream of `ActiveSession[]` (snapshot + every 5 s).

---

## Integration seams (what's stubbed)

| Seam | File | To go live |
|------|------|-----------|
| **Payments (Maya)** | `packages/core/src/integrations/payments/maya.ts` | Implement `createCheckout` (Maya Checkout API) + `verifyWebhook` (HMAC). Set `MAYA_*` env. |
| **Network controller** | `packages/core/src/integrations/network/` | Add a real impl behind `NetworkController` (UniFi/Omada/RADIUS/grant_url); register in `index.ts`; set `NETWORK_CONTROLLER`. |
| **Connected-users feed** | `apps/admin/.../api/connected/+server.ts` | Replace the 5 s DB poll with a push from RADIUS accounting (same SSE wire format). |
| **Per-user data usage** | `apps/admin/src/lib/server/queries.ts` (`usage: '—'`) | Needs a byte-accounting feed. |
| **Network health (APs)** | admin `networks` page (still on mocks) | Needs AP/location + health-sample tables (ICMP/SNMP polling) — not yet modeled. |

## Env vars

**customer:** `DATABASE_URL`, `ORIGIN`, `BETTER_AUTH_SECRET`, `NETWORK_CONTROLLER`,
`CRON_SECRET`, `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY`, `MAYA_WEBHOOK_SECRET`, `MAYA_SANDBOX`.
**admin:** `DATABASE_URL`, `ORIGIN`, `BETTER_AUTH_SECRET`, `NETWORK_CONTROLLER`.
See each app's `.env.example`.
