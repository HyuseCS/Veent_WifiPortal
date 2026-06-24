# Security & Code-Quality Review

> Generated 2026-06-24 from a multi-reviewer pass over the monorepo (auth/access,
> payments/money, API/secrets/network, code quality). **Re-verified 2026-06-24** against
> the current tree after the `origin/staging` backend-hardening merge — every finding
> below carries a **Status** line confirmed against the live code (line numbers updated
> where the merge moved them).
>
> **Excluded by design:** "any signed-in admin can block/kick/hard-delete customers"
> (no owner gate on `users` actions) is intentional and is **not** tracked here.

**Good baseline:** no real secrets are committed (only `.env.example` placeholders);
webhook authenticity uses an authoritative Maya re-fetch; `addCredits` is idempotent
on the gateway txn id; the conditional balance UPDATE prevents double-spend.

**What the `origin/staging` hardening already covered** (so it's not re-listed as open):
grant atomicity (spend+session+grant in one tx), a shared `rateLimit()` helper (admin
login, grant, CSV export, webhook flood cap, SSE count), the optional `CRON_IP_ALLOWLIST`
gate on the customer crons, `validateEnv()` boot fail-fast, and an explicit DB pool max.
None of these touched the payments-correctness (D–H, M–O, Q) or quality (P, R, S) items.

## Status at a glance (verified 2026-06-24)

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| A | Customer email/password signup bypass | 🔴 | ✅ Fixed |
| B | Disabled admin keeps access | 🔴 | ✅ Fixed |
| C | `/api/network/grant` MAC validation | 🔴 | ✅ Fixed |
| D | Credited amount not bound to amount paid | 🟠 | ⬜ Open |
| E | Legacy `u:p` split credits with no checkout row | 🟠 | ⬜ Open |
| F | Re-fetch reference→checkout not ownership-bound | 🟠 | ⬜ Open |
| G | Cron secret compared with non-timing-safe `!==` | 🟡 | ⬜ Open |
| H | Claim + credit not in one transaction | 🟡 | ⬜ Open |
| I | OTP rate-limit double-consumes phone+MAC | 🟡 | ⬜ Open — teammate-owned |
| J | Rate-limit / cron-IP keyed on spoofable IP | 🟡 | ◐ Partially mitigated |
| K | Network-health no unique constraint on `name` | 🟡 | ⬜ Open |
| L | Serialized router revokes strand the sweep | 🟡 | ⬜ Open (moved) |
| M | `PAYMENT_CANCELLED` recorded as `PAYMENT_FAILED` | 🟢 | ⬜ Open |
| N | `verifyWebhook` populates no detail fields | 🟢 | ⬜ Open |
| O | Upsert `set{}` drops detail on transition | 🟢 | ⬜ Open |
| P | Finance period bounds not calendar-aligned | 🟢 | ⬜ Open |
| Q | Float vs fixed-decimal money columns | 🟢 | ◐ Partially fixed |
| R | `listNetworkHealth` global LIMIT starves APs | 🟢 | ⬜ Open |
| S | Maintainability (Lucide cast, mikrotik dup, docs, polling) | 🟢 | ◐ Mixed |

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
- **Status (verified 2026-06-24): ⬜ Open.** `creditCheckoutIfUnsettled`
  (`reconcilePayments.ts`) still credits `pkg.creditsProvided` from the checkout's
  `packageId`; `CreditArgs` carries no amount, so the paid amount is never compared.

### E. Legacy `userId:packageId` reference-split path credits with no checkout binding
- **Where:** `packages/core/src/services/reconcilePayments.ts:48-58`;
  webhook `+server.ts:58-62` (the `ref.includes(':')` fallback).
- **Risk:** When no `paymentCheckouts` row matches, crediting still proceeds, relying
  only on `addCredits` idempotency. The nonce→checkout binding (the whole safety model)
  is bypassed; a forged paid event carrying a crafted `requestReferenceNumber` could
  credit an arbitrary package.
- **Fix:** Require a matching `paymentCheckouts` row now that all new checkouts use the
  opaque token; remove or feature-flag the legacy split fallback.
- **Status (verified 2026-06-24): ⬜ Open.** The `ref.includes(':')` fallback is still in
  the webhook handler, and `creditCheckoutIfUnsettled` falls through to crediting when no
  checkout row exists (relying only on `addCredits` idempotency).

### F. Re-fetch reference→checkout binding doesn't verify ownership; `ponytail:` assumptions unconfirmed
- **Where:** `packages/core/src/integrations/payments/maya.ts:59-67, 128-173`.
- **Risk:** The re-fetch model is sound only if the payment-id space is unguessable and
  the reference resolves to a checkout owned by *this* requester. On shared/sandbox keys
  a cross-tenant webhook replay is plausible. The exact Maya webhook auth scheme is still
  an unverified assumption (`ponytail:` comment).
- **Fix:** Confirm the real Maya webhook auth in the dashboard before prod. Verify the
  re-fetched payment's `requestReferenceNumber` maps to a checkout owned by the resolved
  user, with a matching amount (ties into D/E).
- **Status (verified 2026-06-24): ⬜ Open.** Webhooks are server-to-server (no end-user
  session), so attribution is by-reference only — the real exposure is E (no required
  checkout row) + D (no amount check). The `ponytail:` payment-id-field assumption
  remains in `maya.ts` `getCheckoutStatus`. Fix by collapsing into E/D.

---

## 🟡 Medium

### G. Cron secret compared with non-timing-safe `!==`
- **Where:** `apps/customer/src/routes/api/network/revoke/+server.ts:20`;
  `apps/customer/src/routes/api/payments/reconcile/+server.ts:24`;
  `apps/admin/src/routes/api/network/health/refresh/+server.ts:21`.
- **Fix:** Use length-checked `crypto.timingSafeEqual` (already used in `otp.ts` /
  `wipe-verification.ts`); factor into one shared `verifyCronSecret(event)` helper.
- **Status (verified 2026-06-24): ⬜ Open.** All three endpoints still use `secret !==
  env.CRON_SECRET`. The merge added `rateLimit.ts` with `cronIpAllowed` but no
  timing-safe secret helper.

### H. Claim + credit run in two separate transactions (settled-but-uncredited window)
- **Where:** `packages/core/src/services/reconcilePayments.ts:42-92`.
- **Risk:** A crash/connection drop between the pending→settled claim and `addCredits`
  leaves the checkout `settled` with no ledger row; the cron only reprocesses
  `pending`, so the payment is permanently lost. (Doc comment claims atomicity — it
  isn't.)
- **Fix:** Wrap the claim + `addCredits` in a single `db.transaction` and pass `tx`
  through; drop the manual revert dance.
- **Status (verified 2026-06-24): ⬜ Open.** Still two separate statements with a
  catch-only `revert()` (a crash bypasses it). The doc comment in `reconcilePayments.ts`
  still falsely claims "Everything runs inside a transaction."

### I. OTP rate-limit double-consumes phone + MAC quota
- **Where:** `apps/customer/src/lib/server/otpRateLimit.ts:35-47` (`Promise.all`
  consumes both unconditionally).
- **Risk:** Blocked attempts on one identifier burn the other's budget; can lock out a
  legitimate phone.
- **Fix:** Check-without-consume, or only consume after both are confirmed allowed.
- **Status (verified 2026-06-24): ⬜ Open — teammate-owned.** Behaviour unchanged
  (`enforceOtpSendLimit` still `Promise.all`s both consumes). CLAUDE.md marks
  `otpRateLimit.ts` teammate-owned ("do not touch") — flagged for the owner, not for us.

### J. Rate-limit / cron-IP keyed on spoofable client address
- **Where:** `apps/customer/src/lib/server/rateLimit.ts` (`clientIp` →
  `event.getClientAddress()`; `cronIpAllowed` returns `true` when allowlist unset).
- **Risk:** If the adapter trusts `X-Forwarded-For`, an attacker can rotate apparent IP
  to bypass the per-IP webhook flood cap and the optional `CRON_IP_ALLOWLIST`.
  Defense-in-depth — `CRON_SECRET` still gates cron.
- **Fix:** Only honor XFF from known proxy hops; keep the IP allowlist as a secondary
  control; require `CRON_SECRET` in prod (already fail-closed if missing).
- **Status (verified 2026-06-24): ◐ Partially mitigated.** The merge added
  `CRON_IP_ALLOWLIST` wired into the two customer crons (revoke, reconcile), but the admin
  `health/refresh` endpoint has **no** IP gate, and there's still no trusted-proxy / XFF
  config, so `clientIp()` (rate-limit + allowlist key) remains spoofable behind a bad proxy.

### K. Network-health: select-then-insert per sample, no unique constraint
- **Where:** `packages/core/src/services/networkHealth.ts:24-43`; `network_health.name`
  has no unique index.
- **Risk:** N+1 round-trips; concurrent sweeps can create duplicate AP rows.
- **Fix:** Add a unique constraint on `name`; use `onConflictDoUpdate`.
- **Status (verified 2026-06-24): ⬜ Open.** `networkHealth.ts` still does select-then-
  insert per sample; no migration ever added a unique index on `network_health.name`.

### L. Serialized router revokes in cron loops; one failure strands the rest
- **Where:** `packages/core/src/services/sessions.ts:309-317` (`expireDueSessions`),
  `361-383` (`revokeUserSessions`); `accounts.ts:48`.
- **Risk:** Each loop awaits `network.revoke()` then a per-row UPDATE; an unhandled throw
  aborts the sweep, leaving later due sessions `active` (still online).
- **Fix:** try/catch per-MAC; batch the status UPDATE with `inArray(ids)`.
- **Status (verified 2026-06-24): ⬜ Open (moved).** The session model was refactored to
  the account window, so the loops are now `expireDueAccounts` (`sessions.ts` ~672),
  `reconcileGuestBindings` (~712), and `revokeUserSessions` (~738) — all still bare
  `await network.revoke()` with no per-MAC try/catch, while `afterBind` in the same file
  already wraps revoke safely (the pattern to copy).

---

## 🟢 Code Quality / Correctness (mostly undercuts the Finance feature)

### M. `PAYMENT_CANCELLED` recorded as `PAYMENT_FAILED`
- **Where:** `packages/core/src/integrations/payments/maya.ts:49-51` — `mapStatus`
  collapses cancelled into `'failed'` despite a dedicated `'cancelled'` status and
  `STATUS_DB` support. Corrupts the Finance funnel breakdown.
- **Fix:** Add `case 'PAYMENT_CANCELLED': return 'cancelled';`.
- **Status (verified 2026-06-24): ⬜ Open.** `mapStatus` still folds `PAYMENT_CANCELLED`
  into `'failed'`; no `'cancelled'` branch.

### N. `verifyWebhook` never populates the detail fields → Finance columns always NULL
- **Where:** `packages/core/src/integrations/payments/maya.ts:166-172` returns only the
  5 core fields; `fundSourceType`, `fundSourceMasked`, `receiptNo`, `buyerName/Email`,
  `errorCode/Message` are never mapped, so every Finance detail column is always null.
- **Fix:** Extract them from the re-fetched Maya payment (`fundSource`, `receiptNumber`,
  `buyer.firstName/lastName`, `errorCode/errorMessage`) into the `PaymentEvent`.
- **Status (verified 2026-06-24): ⬜ Open.** `verifyWebhook` still returns only the 5
  core fields and doesn't even destructure the detail fields from the Maya response.

### O. Webhook upsert `set{}` drops late-arriving detail on status transition
- **Where:** `apps/customer/src/routes/api/webhooks/payment/+server.ts:113-121` omits
  `referenceNo`, `buyerName`, `buyerEmail` from the `onConflictDoUpdate.set` (the insert
  sets them). Maya's later `SUCCESS` event never backfills them.
- **Fix:** Add those columns to the `set` clause (meaningful once N is fixed).
- **Status (verified 2026-06-24): ⬜ Open.** The `set` block still omits `referenceNo`,
  `buyerName`, `buyerEmail` (and `currency`). Latent until N is fixed (today they're
  always NULL anyway).

### P. Finance period bounds are a rolling-ms window, not calendar-aligned
- **Where:** `apps/admin/src/lib/server/period.ts:12-14` (`from = now − N*24h`,
  `to = now()`) → partial first/last day buckets under-report (the footgun
  `revenueByDay` avoids via `date_trunc`).
- **Fix:** Snap `from` to start-of-day (N−1 days back).
- **Status (verified 2026-06-24): ⬜ Open.** `parsePeriod` still uses
  `to = new Date()` / `from = to − N*24h` with no start-of-day snap.

### Q. Money columns mix float and fixed-decimal; missing amounts collapse to 0
- **Where:** `packages/db/src/schema/customer.ts:64` (`amount: doublePrecision`) vs `:34`
  (`creditBalance numeric(12,2)`); `maya.ts:170,208`
  `Math.round(Number(amount ?? 0) * 100)`.
- **Risk:** Rounding drift; ledger doesn't exactly reconcile to balance; a missing/garbled
  amount silently becomes `0` rather than rejecting.
- **Fix:** Use `numeric` for monetary `amount`/`fiatCost`, integer for credits; guard the
  NaN→0 collapse (will fail the amount-match check from D once added).
- **Status (verified 2026-06-24): ◐ Partially fixed.** The newer `payment_transactions`
  /`payment_checkouts` tables use `numeric`, but `credit_ledger.amount` and
  `packages.fiatCost` are still `doublePrecision`, and the `Math.round(Number(amount ?? 0)
  * 100)` missing→0 collapse remains in `maya.ts`.

### R. `listNetworkHealth` global `LIMIT 400` starves later APs of logs
- **Where:** `apps/admin/src/lib/server/queries.ts:272-301` — one global limit, then
  bucketed 15/AP in JS; a busy AP consumes the whole budget.
- **Fix:** Per-AP `row_number()` window query, or scale the limit to
  `apCount * LOGS_PER_AP`.
- **Status (verified 2026-06-24): ⬜ Open.** Still one global `ORDER BY … LIMIT 400`
  then 15/AP bucketed in JS (`queries.ts`, `LOGS_PER_AP = 15`).

### S. Maintainability

**S1. Lucide → `Component` cast hole.** **◐ Partially fixed.** The customer dashboard no
longer casts (it uses a real `$lib/Icon.svelte`). On the admin side it's now *worse* —
the `(c) => c as Component` helper is copy-pasted into ~9 files (`finance`/`dashboard`/
`networks`/`users`/`staff` `+page.svelte`, `LayoutSwitcher`, `NetworkMap`) plus raw
`as unknown as Component` casts in `nav.ts`, `TransactionsTable`, `UsersTable`,
`StaffTable`. Fix: one shared admin `icon()` helper; remove the per-file copies.

**S2. Dead/duplicated MikroTik connection setup.** **⬜ Open.** `mikrotik.ts` `openConn`
(~343-362) still duplicates the inline connect block in `withConn` (~67-86); only
`provisionWalledGarden` uses `openConn`, so they drift. Fix: route both through one helper.

**S3. Stale `/docs` webhook contract.** **⬜ Open.** `apps/customer/src/routes/docs/+server.ts`
still documents `referenceId = ${userId}:${packageId}` and a `404 Package not found`
response, neither of which matches the current token + `paymentCheckouts`-lookup contract.
(CLAUDE.md itself was refreshed by the merge.) Fix: update the `/docs` spec.

**S4. `RouterLogPanel.svelte` polls every 5s.** **⬜ Open (arguably out of scope).** Still
`onMount` + `setInterval(fetch('/api/router-log'), 5000)`. Business rule #5 targets DB
polling for connected-user updates; this polls an external router-log API, so it's
defensible — but document the exception or move it to SSE for consistency.

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

---

## Closeout — recommended remediation order

**Done:** A, B, C (authorization/identity) — fixed and merged.

**Next, highest value for least effort:**
1. **E + D + F together** (🟠) — require a matching `paymentCheckouts` row before crediting
   and assert the paid amount matches. One change to the credit path closes all three; it's
   the largest remaining money-integrity gap.
2. **M + N + O** (🟢, all in `maya.ts` + the webhook handler) — three small edits that make
   the Finance feature actually record real data instead of NULLs. Cheap, high payoff.
3. **G** (🟡) — swap the three cron `!==` checks for a shared `timingSafeEqual` helper.
4. **H** (🟡) — wrap reconcile claim+credit in one `db.transaction` and correct the comment.
5. **L** (🟡) — per-MAC try/catch in the three revoke sweeps (copy `afterBind`'s pattern).

**Schema-touching (batch into one migration):** K (unique index on `network_health.name`),
Q (`credit_ledger.amount`/`packages.fiatCost` → `numeric`).

**Lower priority / nuanced:** J (trusted-proxy config + IP gate on admin `health/refresh`),
P (calendar-snap Finance periods), R (per-AP log window), S1–S4 (cleanups), I (defer to the
OTP/SMS owner).

**Before prod, independent of the above:** confirm the Maya webhook auth scheme in the Maya
dashboard (the `ponytail:` assumption), per CLAUDE.md.
