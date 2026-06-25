# Security & Code-Quality Review

> Generated 2026-06-24 from a multi-reviewer pass over the monorepo (auth/access,
> payments/money, API/secrets/network, code quality). **Re-verified 2026-06-24** against
> the current tree after the `origin/staging` backend-hardening merge — every finding
> below carries a **Status** line confirmed against the live code (line numbers updated
> where the merge moved them).
>
> **Remediation pass 2026-06-25:** D, E, F, G, H, K, L, M, N, O, P fixed; J improved (admin
> IP gate); Q half-fixed (NaN guard; column-type deferred). See the closeout at the bottom.
> Remaining open: Q column-type, J (XFF), R, S1–S4, I (teammate-owned).
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
| D | Credited amount not bound to amount paid | 🟠 | ✅ Fixed |
| E | Legacy `u:p` split credits with no checkout row | 🟠 | ✅ Fixed |
| F | Re-fetch reference→checkout not ownership-bound | 🟠 | ✅ Fixed (via D+E) |
| G | Cron secret compared with non-timing-safe `!==` | 🟡 | ✅ Fixed |
| H | Claim + credit not in one transaction | 🟡 | ✅ Fixed |
| I | OTP rate-limit double-consumes phone+MAC | 🟡 | ⬜ Open — teammate-owned |
| J | Rate-limit / cron-IP keyed on spoofable IP | 🟡 | ◐ Improved (admin gate added; XFF open) |
| K | Network-health no unique constraint on `name` | 🟡 | ✅ Fixed |
| L | Serialized router revokes strand the sweep | 🟡 | ✅ Fixed |
| M | `PAYMENT_CANCELLED` recorded as `PAYMENT_FAILED` | 🟢 | ✅ Fixed |
| N | `verifyWebhook` populates no detail fields | 🟢 | ✅ Fixed |
| O | Upsert `set{}` drops detail on transition | 🟢 | ✅ Fixed |
| P | Finance period bounds not calendar-aligned | 🟢 | ✅ Fixed |
| Q | Float vs fixed-decimal money columns | 🟢 | ◐ NaN→0 guard fixed; column-type deferred |
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
- **✅ Fixed 2026-06-25.** `CreditArgs` now carries `amountMinor`; `creditCheckoutIfUnsettled`
  (`reconcilePayments.ts`) asserts it equals the claimed checkout's recorded `amount`
  (`Math.round(Number(checkout.amount) * 100)`) before crediting. A mismatch keeps the claim
  settled (so it can't be retried into a credit) but returns `reason: 'amount_mismatch'` and
  logs a warning — never credits. All three callers (webhook + both reconcile paths) pass
  `evt.amountMinor`. Currency is PHP-only and not stored per-checkout, so amount is the
  authoritative check.

### E. Legacy `userId:packageId` reference-split path credits with no checkout binding
- **Where:** `packages/core/src/services/reconcilePayments.ts:48-58`;
  webhook `+server.ts:58-62` (the `ref.includes(':')` fallback).
- **Risk:** When no `paymentCheckouts` row matches, crediting still proceeds, relying
  only on `addCredits` idempotency. The nonce→checkout binding (the whole safety model)
  is bypassed; a forged paid event carrying a crafted `requestReferenceNumber` could
  credit an arbitrary package.
- **Fix:** Require a matching `paymentCheckouts` row now that all new checkouts use the
  opaque token; remove or feature-flag the legacy split fallback.
- **✅ Fixed 2026-06-25.** The `ref.includes(':')` credit-attribution fallback was removed from
  the webhook handler, and `creditCheckoutIfUnsettled` no longer credits when no checkout row
  exists — the atomic claim returns nothing → `reason: 'no_checkout'`, no credit. A paid event
  with no matching checkout is still recorded for Finance (unattributed), just never credited.
  Crediting now strictly requires the per-attempt-nonce checkout row.

### F. Re-fetch reference→checkout binding doesn't verify ownership; `ponytail:` assumptions unconfirmed
- **Where:** `packages/core/src/integrations/payments/maya.ts:59-67, 128-173`.
- **Risk:** The re-fetch model is sound only if the payment-id space is unguessable and
  the reference resolves to a checkout owned by *this* requester. On shared/sandbox keys
  a cross-tenant webhook replay is plausible. The exact Maya webhook auth scheme is still
  an unverified assumption (`ponytail:` comment).
- **Fix:** Confirm the real Maya webhook auth in the dashboard before prod. Verify the
  re-fetched payment's `requestReferenceNumber` maps to a checkout owned by the resolved
  user, with a matching amount (ties into D/E).
- **✅ Fixed 2026-06-25 (via D+E).** The real exposure (no required checkout row + no amount
  check) is closed by E and D above: crediting now requires a matching checkout row whose
  amount equals the gateway charge. The `ponytail:` payment-id-field assumption still rides in
  `maya.ts` `getCheckoutStatus` but is used only for tracing, never for the credit decision.
  The live Maya webhook auth scheme should still be confirmed in the dashboard before prod.

---

## 🟡 Medium

### G. Cron secret compared with non-timing-safe `!==`
- **Where:** `apps/customer/src/routes/api/network/revoke/+server.ts:20`;
  `apps/customer/src/routes/api/payments/reconcile/+server.ts:24`;
  `apps/admin/src/routes/api/network/health/refresh/+server.ts:21`.
- **Fix:** Use length-checked `crypto.timingSafeEqual` (already used in `otp.ts` /
  `wipe-verification.ts`); factor into one shared `verifyCronSecret(event)` helper.
- **✅ Fixed 2026-06-25.** Added a shared `requireCron(event)` helper (`$lib/server/cron.ts`
  in both apps) that does the IP allowlist + a length-checked `timingSafeEqual` on
  `x-cron-secret`, fail-closed when `CRON_SECRET` is unset. All three endpoints
  (revoke, reconcile, admin `health/refresh`) now call it; the non-timing-safe `!==` checks
  are gone.

### H. Claim + credit run in two separate transactions (settled-but-uncredited window)
- **Where:** `packages/core/src/services/reconcilePayments.ts:42-92`.
- **Risk:** A crash/connection drop between the pending→settled claim and `addCredits`
  leaves the checkout `settled` with no ledger row; the cron only reprocesses
  `pending`, so the payment is permanently lost. (Doc comment claims atomicity — it
  isn't.)
- **Fix:** Wrap the claim + `addCredits` in a single `db.transaction` and pass `tx`
  through; drop the manual revert dance.
- **✅ Fixed 2026-06-25.** `creditCheckoutIfUnsettled` now runs the pending→settled claim and
  the credit in ONE `db.transaction` (new `addCreditsTx(tx, …)` core shared with `addCredits`).
  A throw between them rolls the claim back, so the next pass retries — never settled-but-
  uncredited. The manual `revert()` dance is gone and the doc comment now matches the code.

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
- **Status (2026-06-25): ◐ Improved.** The admin `health/refresh` IP gate is now closed —
  `cronIpAllowed` was added to the admin `rateLimit.ts` and the endpoint goes through the
  shared `requireCron` (IP allowlist + timing-safe secret), matching the customer crons. Still
  open: there's no trusted-proxy / XFF config, so `clientIp()` (rate-limit + allowlist key)
  remains spoofable behind a misconfigured proxy. `CRON_SECRET` still gates cron either way.

### K. Network-health: select-then-insert per sample, no unique constraint
- **Where:** `packages/core/src/services/networkHealth.ts:24-43`; `network_health.name`
  has no unique index.
- **Risk:** N+1 round-trips; concurrent sweeps can create duplicate AP rows.
- **Fix:** Add a unique constraint on `name`; use `onConflictDoUpdate`.
- **✅ Fixed 2026-06-25.** Added a `uniqueIndex('network_health_name_key')` on
  `network_health.name` (schema + idempotent migration `0023`, verified on a throwaway DB);
  `refreshNetworkHealth` now does a single `onConflictDoUpdate` per sample instead of
  select-then-insert, so concurrent sweeps can't create duplicate AP rows.

### L. Serialized router revokes in cron loops; one failure strands the rest
- **Where:** `packages/core/src/services/sessions.ts:309-317` (`expireDueSessions`),
  `361-383` (`revokeUserSessions`); `accounts.ts:48`.
- **Risk:** Each loop awaits `network.revoke()` then a per-row UPDATE; an unhandled throw
  aborts the sweep, leaving later due sessions `active` (still online).
- **Fix:** try/catch per-MAC; batch the status UPDATE with `inArray(ids)`.
- **✅ Fixed 2026-06-25.** `expireDueAccounts`, `reconcileGuestBindings`, `revokeUserSessions`
  (`sessions.ts`) and `revokeActiveMacs` (`accounts.ts`) now wrap each `network.revoke()` in a
  per-MAC try/catch (copying `afterBind`'s pattern) — one router error no longer strands the
  rest of the sweep. `expireDueAccounts`/`revokeUserSessions` also batch the status UPDATE with
  `inArray(ids)` instead of one-per-row. A missed revoke is swept next pass by
  `reconcileGuestBindings`.

---

## 🟢 Code Quality / Correctness (mostly undercuts the Finance feature)

### M. `PAYMENT_CANCELLED` recorded as `PAYMENT_FAILED`
- **Where:** `packages/core/src/integrations/payments/maya.ts:49-51` — `mapStatus`
  collapses cancelled into `'failed'` despite a dedicated `'cancelled'` status and
  `STATUS_DB` support. Corrupts the Finance funnel breakdown.
- **Fix:** Add `case 'PAYMENT_CANCELLED': return 'cancelled';`.
- **✅ Fixed 2026-06-25.** `mapStatus` now has a dedicated `case 'PAYMENT_CANCELLED': return
  'cancelled';` branch (split out from `'failed'`), so the Finance funnel separates
  user-cancelled from gateway-failed. Covered by the webhook spec.

### N. `verifyWebhook` never populates the detail fields → Finance columns always NULL
- **Where:** `packages/core/src/integrations/payments/maya.ts:166-172` returns only the
  5 core fields; `fundSourceType`, `fundSourceMasked`, `receiptNo`, `buyerName/Email`,
  `errorCode/Message` are never mapped, so every Finance detail column is always null.
- **Fix:** Extract them from the re-fetched Maya payment (`fundSource`, `receiptNumber`,
  `buyer.firstName/lastName`, `errorCode/errorMessage`) into the `PaymentEvent`.
- **✅ Fixed 2026-06-25.** A `mapDetail()` helper extracts `fundSource.type` /
  `fundSource.details.last4|masked`, `receiptNumber`, `buyer.firstName/lastName`,
  `buyer.contact.email`, and `errorCode/errorMessage` from the re-fetched Maya payment;
  `verifyWebhook` spreads them (plus `referenceNo`) into the `PaymentEvent`. Best-effort —
  a missing field is `undefined`, never throws. Covered by a new webhook spec case.

### O. Webhook upsert `set{}` drops late-arriving detail on status transition
- **Where:** `apps/customer/src/routes/api/webhooks/payment/+server.ts:113-121` omits
  `referenceNo`, `buyerName`, `buyerEmail` from the `onConflictDoUpdate.set` (the insert
  sets them). Maya's later `SUCCESS` event never backfills them.
- **Fix:** Add those columns to the `set` clause (meaningful once N is fixed).
- **✅ Fixed 2026-06-25.** `recordPaymentTransaction`'s `onConflictDoUpdate.set` now includes
  `currency`, `referenceNo`, `buyerName`, `buyerEmail` (alongside the existing fund-source /
  receipt / error fields), so a later status transition (e.g. PENDING→SUCCESS) backfills the
  detail. `networkId` and the `userId`/`packageId` attribution stay INSERT-only by design.

### P. Finance period bounds are a rolling-ms window, not calendar-aligned
- **Where:** `apps/admin/src/lib/server/period.ts:12-14` (`from = now − N*24h`,
  `to = now()`) → partial first/last day buckets under-report (the footgun
  `revenueByDay` avoids via `date_trunc`).
- **Fix:** Snap `from` to start-of-day (N−1 days back).
- **✅ Fixed 2026-06-25.** `parsePeriod` now snaps `from` to local start-of-day of the
  `N−1`-days-back date (`setDate(-(N-1))` + `setHours(0,0,0,0)`), so a range covers N whole
  calendar days instead of a rolling-ms window — the first/last `date_trunc` buckets are no
  longer partial.

### Q. Money columns mix float and fixed-decimal; missing amounts collapse to 0
- **Where:** `packages/db/src/schema/customer.ts:64` (`amount: doublePrecision`) vs `:34`
  (`creditBalance numeric(12,2)`); `maya.ts:170,208`
  `Math.round(Number(amount ?? 0) * 100)`.
- **Risk:** Rounding drift; ledger doesn't exactly reconcile to balance; a missing/garbled
  amount silently becomes `0` rather than rejecting.
- **Fix:** Use `numeric` for monetary `amount`/`fiatCost`, integer for credits; guard the
  NaN→0 collapse (will fail the amount-match check from D once added).
- **Status (2026-06-25): ◐ NaN→0 guard fixed; column-type deferred.** The money-correctness
  half is done: a new `toMinor()` in `maya.ts` returns **NaN** (never a silent 0) for a
  missing/garbled amount, so the new D amount-check refuses to credit instead of crediting
  against a bogus 0; `recordPaymentTransaction` writes 0 (not `'NaN'`) for that anomaly while
  still refusing the credit. **Deferred:** converting `credit_ledger.amount` and
  `packages.fiatCost` from `doublePrecision` → `numeric`. That's a wide blast radius (numeric
  reads as a string, so every insert/read site in `credits.ts` + the dashboard/top-up pages +
  several dev seed scripts must wrap in `String()`/`Number()`), for the review's lowest-severity
  item, and per CLAUDE.md needs a throwaway-DB migration check. Batch it deliberately, not
  rushed in with the security pass.

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

**Done (2026-06-24):** A, B, C (authorization/identity) — fixed and merged.

**Done (2026-06-25), this pass:**
1. **E + D + F** (🟠) — crediting now requires a matching `paymentCheckouts` row AND an amount
   that equals the gateway charge (`creditCheckoutIfUnsettled`); the legacy `u:p` split credit
   path is gone. Closed the largest money-integrity gap.
2. **M + N + O** (🟢) — `maya.ts` maps `cancelled` distinctly, populates all Finance detail
   fields, and the upsert `set{}` backfills them on transition. Finance records real data now.
3. **G** (🟡) — shared `requireCron()` helper: IP allowlist + timing-safe `x-cron-secret` on
   all three cron endpoints (incl. the admin gate that J flagged).
4. **H** (🟡) — reconcile claim+credit run in one `db.transaction` (`addCreditsTx`); revert
   dance removed, comment corrected.
5. **L** (🟡) — per-MAC try/catch + batched `inArray` UPDATE in all four revoke sweeps.
6. **K** (🟡) — unique index on `network_health.name` + `onConflictDoUpdate` (idempotent
   migration `0023`, verified on a throwaway DB).
7. **P** (🟢) — Finance periods snap `from` to start-of-day (calendar-aligned buckets).
8. **Q (partial)** — the `maya.ts` NaN→0 money-correctness guard (ties into D).

**Still open / deliberately deferred:**
- **Q (column-type)** — `credit_ledger.amount`/`packages.fiatCost` → `numeric`. Wide blast
  radius (numeric→string read/write sites across core + seed scripts); batch separately.
- **J (XFF)** — trusted-proxy / `X-Forwarded-For` config so `clientIp()` isn't spoofable
  behind a bad proxy (the admin IP-gate half is done). `CRON_SECRET` still gates cron.
- **R** (per-AP log window), **S1–S4** (Lucide cast, mikrotik dup, stale `/docs`, router-log
  polling), **I** (OTP phone+MAC double-consume — teammate-owned, do not touch).

**Before prod, independent of the above:** confirm the Maya webhook auth scheme in the Maya
dashboard (the `ponytail:` assumption), per CLAUDE.md.
