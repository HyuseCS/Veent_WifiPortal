# Security & Code-Quality Review

> Generated 2026-06-24 from a multi-reviewer pass over the monorepo (auth/access,
> payments/money, API/secrets/network, code quality). Findings are read-only
> observations — nothing here has been fixed yet. Severities are the reviewers'
> assessments; confirm the "reported" ones against current behaviour before acting.
>
> **Excluded by design:** "any signed-in admin can block/kick/hard-delete customers"
> (no owner gate on `users` actions) is intentional and is **not** tracked here.

**Good baseline:** no real secrets are committed (only `.env.example` placeholders);
webhook authenticity uses an authoritative Maya re-fetch; `addCredits` is idempotent
on the gateway txn id; the conditional balance UPDATE prevents double-spend.

---

## 🔴 High — Authorization / Identity

> **Status: A, B, C fixed 2026-06-24.** See each entry's "✅ Fixed" note.

### A. Customer email+password signup is enabled — bypasses phone+OTP entirely
- **Where:** `apps/customer/src/lib/server/auth.ts:24` — `emailAndPassword: { enabled: true }`
- **Risk:** Exposes `POST /api/auth/sign-up/email`, letting anyone create a fully
  authenticated, Free-Time-eligible account with no phone, no OTP, and none of the SMS
  rate-limiting the OTP design enforces. Contradicts the intended phone-only model.
- **Fix:** Set `emailAndPassword.disableSignUp: true`, or remove `emailAndPassword`
  entirely if unused. Phone+OTP should be the only customer entry.
- **✅ Fixed:** `apps/customer/src/lib/server/auth.ts` now sets
  `emailAndPassword: { enabled: true, disableSignUp: true }` — public email sign-up is
  closed; the `phoneNumber` plugin still creates accounts via `signUpOnVerification`.

### B. Disabled admin keeps full access until session expiry
- **Where:** `apps/admin/src/routes/(app)/+layout.server.ts:11-19` (guard checks session
  presence + role, never `status`); `status` only checked at `login/+page.server.ts:42`.
- **Risk:** Disabling a staff member does not invalidate their live session; admin
  sessions have no pinned `expiresIn` (better-auth default ~7 days). A disabled admin
  stays fully functional for up to a week. (`remove` cascade-deletes sessions, so only
  `disable` has the gap.)
- **Fix:** Re-check `status` in the `(app)` layout guard and redirect/sign-out if not
  `active`; call `auth.api.revokeUserSessions` inside the disable action. Consider
  pinning a shorter admin `session.expiresIn`.
- **✅ Fixed:** `apps/admin/src/hooks.server.ts` now re-checks `getStaffStatus` on every
  request and only populates `event.locals.user` when status is `active`. A disabled
  member's live session is treated as unauthenticated immediately — across pages **and**
  `/api` — instead of lingering until cookie expiry. (Pinning a shorter admin
  `session.expiresIn` is still worth doing as defence-in-depth.)

### C. IDOR — `/api/network/grant` trusts an arbitrary `macAddress`
- **Where:** `apps/customer/src/routes/api/network/grant/+server.ts:29` (only checks
  presence, no format validation — unlike the dashboard action which uses `MAC_RE`).
- **Risk:** An authenticated guest can grant/extend internet for any device's MAC on
  their own credits, or pump junk/oversized values into `network_sessions` and the
  RouterOS bindings (`mikrotik.ts` `?mac-address=` words — query pollution, not shell
  injection).
- **Fix:** Validate `body.macAddress` against `MAC_RE`
  (`/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/`) and reject with 400 before any DB/router
  call; ideally enforce inside `startSession` and as a controller-level guard in
  `mikrotik.ts`.
- **✅ Fixed:** Added a shared `MAC_ADDRESS_RE` / `isValidMac()` to
  `packages/core/src/config.ts`; `apps/customer/src/routes/api/network/grant/+server.ts`
  now rejects a malformed `macAddress` with 400 before any DB/router call.
  **Residual:** format validation does not bind the MAC to the caller's own device
  (the captive path legitimately supplies it), so cross-device grant on one's own
  credits is still possible — same trust model as the dashboard action.

---

## 🟠 High — Payments / Money integrity

### D. Credited amount is decoupled from the amount actually paid
- **Where:** `packages/core/src/services/reconcilePayments.ts:70-87`;
  `apps/customer/src/routes/api/webhooks/payment/+server.ts` crediting path.
- **Risk:** Credits = `pkg.creditsProvided` resolved from the checkout's `packageId`,
  but `evt.amountMinor` (what Maya actually charged) is never compared to
  `paymentCheckouts.amount` / `fiatCost`. Underpayment, partial capture, or a `fiatCost`
  edited while a stale checkout settles → full credits regardless of what was paid.
- **Fix:** Assert `evt.amountMinor === Math.round(checkout.amount * 100)` and currency
  match before crediting; reject/flag mismatches. `paymentCheckouts.amount` is already
  persisted.

### E. Legacy `userId:packageId` reference-split path credits with no checkout binding
- **Where:** `packages/core/src/services/reconcilePayments.ts:48-58`;
  webhook `+server.ts:58-62` (the `ref.includes(':')` fallback).
- **Risk:** When no `paymentCheckouts` row matches, crediting still proceeds, relying
  only on `addCredits` idempotency. The nonce→checkout binding (the whole safety model)
  is bypassed; a forged paid event carrying a crafted `requestReferenceNumber` could
  credit an arbitrary package.
- **Fix:** Require a matching `paymentCheckouts` row now that all new checkouts use the
  opaque token; remove or feature-flag the legacy split fallback.

### F. Re-fetch reference→checkout binding doesn't verify ownership; `ponytail:` assumptions unconfirmed
- **Where:** `packages/core/src/integrations/payments/maya.ts:59-67, 128-173`.
- **Risk:** The re-fetch model is sound only if the payment-id space is unguessable and
  the reference resolves to a checkout owned by *this* requester. On shared/sandbox keys
  a cross-tenant webhook replay is plausible. The exact Maya webhook auth scheme is still
  an unverified assumption (`ponytail:` comment).
- **Fix:** Confirm the real Maya webhook auth in the dashboard before prod. Verify the
  re-fetched payment's `requestReferenceNumber` maps to a checkout owned by the resolved
  user, with a matching amount (ties into D/E).

---

## 🟡 Medium

### G. Cron secret compared with non-timing-safe `!==`
- **Where:** `apps/customer/src/routes/api/network/revoke/+server.ts:20`;
  `apps/customer/src/routes/api/payments/reconcile/+server.ts:24`;
  `apps/admin/src/routes/api/network/health/refresh/+server.ts:21`.
- **Fix:** Use length-checked `crypto.timingSafeEqual` (already used in `otp.ts` /
  `wipe-verification.ts`); factor into one shared `verifyCronSecret(event)` helper.

### H. Claim + credit run in two separate transactions (settled-but-uncredited window)
- **Where:** `packages/core/src/services/reconcilePayments.ts:42-92`.
- **Risk:** A crash/connection drop between the pending→settled claim and `addCredits`
  leaves the checkout `settled` with no ledger row; the cron only reprocesses
  `pending`, so the payment is permanently lost. (Doc comment claims atomicity — it
  isn't.)
- **Fix:** Wrap the claim + `addCredits` in a single `db.transaction` and pass `tx`
  through; drop the manual revert dance.

### I. OTP rate-limit double-consumes phone + MAC quota
- **Where:** `apps/customer/src/lib/server/otpRateLimit.ts:35-47` (`Promise.all`
  consumes both unconditionally).
- **Risk:** Blocked attempts on one identifier burn the other's budget; can lock out a
  legitimate phone.
- **Fix:** Check-without-consume, or only consume after both are confirmed allowed.

### J. Rate-limit / cron-IP keyed on spoofable client address
- **Where:** `apps/customer/src/lib/server/rateLimit.ts` (`clientIp` →
  `event.getClientAddress()`; `cronIpAllowed` returns `true` when allowlist unset).
- **Risk:** If the adapter trusts `X-Forwarded-For`, an attacker can rotate apparent IP
  to bypass the per-IP webhook flood cap and the optional `CRON_IP_ALLOWLIST`.
  Defense-in-depth — `CRON_SECRET` still gates cron.
- **Fix:** Only honor XFF from known proxy hops; keep the IP allowlist as a secondary
  control; require `CRON_SECRET` in prod (already fail-closed if missing).

### K. Network-health: select-then-insert per sample, no unique constraint
- **Where:** `packages/core/src/services/networkHealth.ts:24-43`; `network_health.name`
  has no unique index.
- **Risk:** N+1 round-trips; concurrent sweeps can create duplicate AP rows.
- **Fix:** Add a unique constraint on `name`; use `onConflictDoUpdate`.

### L. Serialized router revokes in cron loops; one failure strands the rest
- **Where:** `packages/core/src/services/sessions.ts:309-317` (`expireDueSessions`),
  `361-383` (`revokeUserSessions`); `accounts.ts:48`.
- **Risk:** Each loop awaits `network.revoke()` then a per-row UPDATE; an unhandled throw
  aborts the sweep, leaving later due sessions `active` (still online).
- **Fix:** try/catch per-MAC; batch the status UPDATE with `inArray(ids)`.

---

## 🟢 Code Quality / Correctness (mostly undercuts the Finance feature)

### M. `PAYMENT_CANCELLED` recorded as `PAYMENT_FAILED`
- **Where:** `packages/core/src/integrations/payments/maya.ts:49-51` — `mapStatus`
  collapses cancelled into `'failed'` despite a dedicated `'cancelled'` status and
  `STATUS_DB` support. Corrupts the Finance funnel breakdown.
- **Fix:** Add `case 'PAYMENT_CANCELLED': return 'cancelled';`.

### N. `verifyWebhook` never populates the detail fields → Finance columns always NULL
- **Where:** `packages/core/src/integrations/payments/maya.ts:166-172` returns only the
  5 core fields; `fundSourceType`, `fundSourceMasked`, `receiptNo`, `buyerName/Email`,
  `errorCode/Message` are never mapped, so every Finance detail column is always null.
- **Fix:** Extract them from the re-fetched Maya payment (`fundSource`, `receiptNumber`,
  `buyer.firstName/lastName`, `errorCode/errorMessage`) into the `PaymentEvent`.

### O. Webhook upsert `set{}` drops late-arriving detail on status transition
- **Where:** `apps/customer/src/routes/api/webhooks/payment/+server.ts:113-121` omits
  `referenceNo`, `buyerName`, `buyerEmail` from the `onConflictDoUpdate.set` (the insert
  sets them). Maya's later `SUCCESS` event never backfills them.
- **Fix:** Add those columns to the `set` clause (meaningful once N is fixed).

### P. Finance period bounds are a rolling-ms window, not calendar-aligned
- **Where:** `apps/admin/src/lib/server/period.ts:12-14` (`from = now − N*24h`,
  `to = now()`) → partial first/last day buckets under-report (the footgun
  `revenueByDay` avoids via `date_trunc`).
- **Fix:** Snap `from` to start-of-day (N−1 days back).

### Q. Money columns mix float and fixed-decimal; missing amounts collapse to 0
- **Where:** `packages/db/src/schema/customer.ts:64` (`amount: doublePrecision`) vs `:34`
  (`creditBalance numeric(12,2)`); `maya.ts:170,208`
  `Math.round(Number(amount ?? 0) * 100)`.
- **Risk:** Rounding drift; ledger doesn't exactly reconcile to balance; a missing/garbled
  amount silently becomes `0` rather than rejecting.
- **Fix:** Use `numeric` for monetary `amount`/`fiatCost`, integer for credits; guard the
  NaN→0 collapse (will fail the amount-match check from D once added).

### R. `listNetworkHealth` global `LIMIT 400` starves later APs of logs
- **Where:** `apps/admin/src/lib/server/queries.ts:272-301` — one global limit, then
  bucketed 15/AP in JS; a busy AP consumes the whole budget.
- **Fix:** Per-AP `row_number()` window query, or scale the limit to
  `apCount * LOGS_PER_AP`.

### S. Maintainability
- **Lucide → `Component` cast hole** duplicated 4+ places (`finance/+page.svelte:16`,
  `dashboard/+page.svelte:22`, `TransactionsTable.svelte:111`, `nav.ts`) — extract one
  `icon()` helper.
- **Dead/duplicated MikroTik connection setup** — `mikrotik.ts:328-343` (`openConn`)
  duplicates the inline block in `withConn:67-85`.
- **Stale docs** — `apps/customer/src/routes/docs/+server.ts:99,123-124` and CLAUDE.md
  still describe the old HMAC / `userId:packageId` webhook contract; current code uses
  the token + re-fetch model.
- **`RouterLogPanel.svelte:26,40-46`** polls an API route every 5s
  (`onMount` + `setInterval(fetch)`) against business rule #5 (use SSE) — defensible for
  an external router log; document the exception.

---

## Checked and found sound (not findings)
- `/staff` owner-only enforcement (load gate + per-mutation `requireOwner` + DB-level
  owner-row guards + self-removal block).
- OTP pending cookie (signed HMAC-SHA256, `timingSafeEqual`, httpOnly, expiry-checked).
- Wipe step-up verification (single-use, TTL, attempt-capped, constant-time compare).
- Customer/admin auth isolation (distinct cookie prefixes + separate schemas).
- `addCredits` idempotency (`UNIQUE external_transaction_id` + `onConflictDoNothing`).
- `spendCredits` double-spend prevention (conditional `balance >= amount` UPDATE).
- No raw SQL / string-built queries (all Drizzle-parameterized); no `child_process`.
- No secrets/tokens/PII logged outside `dev`-gated blocks.
