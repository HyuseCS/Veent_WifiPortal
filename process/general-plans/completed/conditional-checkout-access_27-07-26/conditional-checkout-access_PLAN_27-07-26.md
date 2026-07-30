---
name: plan:conditional-checkout-access
description: "Dedicated per-device full-internet primitive during Maya checkout: device-scoped IP-layer walled-garden allow, revoked on payment resolution with a ~6-min backstop TTL sweep, plus a deviceMac column on payment_checkouts"
date: 27-07-26
feature: general-plans
---

> **⛔ LIVE FINDING 27-07-26 — APPROACH INVALIDATED. Do not resume this plan as-is.**
> On real hardware the core primitive breaks checkout: `openFullAccessForDevice` adds an IP-layer
> `dst-address=0.0.0.0/0 accept` the instant the buyer taps Pay, which lets the OS connectivity
> probe (`/generate_204`) succeed → Android marks the device "connected" → the captive browser (CNA)
> where the payment is happening is torn down → **the buyer can no longer complete the top-up.**
> The host-layer probe-DENY rules (`connectivitycheck.gstatic.com` etc.) do NOT save it: they live
> in `/ip hotspot walled-garden` (HTTP/SNI layer) while the catch-all lives in
> `/ip hotspot walled-garden ip` (firewall layer), which bypasses the hotspot before the deny ever
> applies (confirmed: deny had 3867 hits yet the device still went "connected"). There is no
> router-config carve-out — `/ip walled-garden ip` only takes `dst-address` (not `dst-host`), and the
> probe hosts are anycast IPs shared with reCAPTCHA/Google Pay, so they can't be denied without
> breaking the payment page. **Root truth: a device-wide `0.0.0.0/0` allow and a captive device are
> mutually exclusive** — any reachable success endpoint satisfies the OS captive detector.
>
> The feature commit (`29f70e5`) was reset out of the branch; the code no longer exists. This
> PLAN + SPEC are kept only as the design record. **Redesign direction for the next RESEARCH cycle:**
> do the payment OUTSIDE the captive session — hand the buyer to the system browser via the existing
> CNA→browser handoff (`/auth/handoff`), where the device is a normal client and can reach unbounded
> 3DS/CDN domains without any captive-portal grant. Do NOT re-attempt a walled-garden catch-all.

# Conditional Full Internet Access During Maya Checkout — PLAN (COMPLEX)

**Date**: 27-07-26
**Status**: ACTIVE — PLAN written, VALIDATE pending (required; no skip — schema/payments surface)
**Complexity**: COMPLEX (schema + payments + network, multi-package, HIGH-RISK class)
**Feature:** general-plans
**SPEC:** `process/general-plans/active/conditional-checkout-access_27-07-26/conditional-checkout-access_SPEC_27-07-26.md`
**Context loaded:** `process/context/all-context.md`, `process/context/tests/all-tests.md`,
`process/context/database/all-database.md`, `process/context/planning/all-planning.md`

## TL;DR

Add a NEW dedicated full-access primitive (separate from the existing 3-host reCAPTCHA
`openCheckoutAccess`) that grants ONE paying device a device-scoped IP-layer catch-all walled-garden
allow (`dst-address=0.0.0.0/0 src-address=<device-ip>`) at checkout-open, then revokes it the moment
the payment resolves (webhook + reconcile), with a ~6-minute backstop TTL sweep for abandoned
checkouts. Store `deviceMac` on `payment_checkouts` (additive nullable column, migration `0053`) so
the resolution path can target the correct device. ~10 files, schema + payments + network → HIGH-RISK
(schema-migration + payments/billing). Live-hardware verification (AC1-3, AC5 network effect) is a
mandatory manual human gate — not automatable.

---

## Overview

Guests paying via Maya sometimes cannot finish: card 3-D Secure redirects to unbounded issuing-bank
domains and GCash/Alipay's cashier pulls dozens of CDN domains, none practically pre-listable in the
hostname walled garden. This plan gives the paying device temporary, device-scoped, time-bounded FULL
internet during the checkout window only, revoked on resolution. It reuses the proven live-tested
mechanism (device-scoped IP-layer allow) but as a NEW primitive with its OWN tag prefix and TTL —
deliberately NOT sharing code with the shipped reCAPTCHA flash-fix (`openCheckoutAccess`).

Chosen design is INNOVATE **Approach B (new dedicated full-access primitive)** — locked, not
re-litigated here.

## Goals

- Any Maya payment method (card+3DS, GCash/Alipay, Maya wallet, QRPH, Billease, Google Wallet)
  completes without walled-garden dead-ends.
- Access is scoped to the single paying device (by `src-address` = device LAN IP), never network-wide.
- Access is revoked the moment the checkout resolves (success OR failure), with a ~6-min backstop TTL
  for abandoned checkouts.
- OS connectivity-probe hosts stay denied (device stays captive); no session/grant created at
  checkout-open; existing 20/window checkout rate limit unchanged.

## Scope

IN scope: new NetworkController methods + mikrotik impl + stub; new sibling service functions; a
nullable `deviceMac` column on `payment_checkouts` (migration `0053`); best-effort grant at
checkout-open; revoke wiring in webhook + reconcile; backstop sweep in the revoke cron.

OUT of scope (from SPEC): admin UI for these rules; Maya method enable/disable; productionizing/removing
the manual GCash IP allow (operator step); SMS toast feature; any change to post-payment grant logic;
the cosmetic Android stale-connected-icon quirk.

---

## Acceptance Criteria

(Mirrors the locked SPEC AC1-8; each names its proving gate + strategy per REQ-TEST-LINK. Full
gate↔criterion mapping in Verification Evidence below.)

1. **AC1** — Card+3DS bank redirect completes without connection error, any issuing bank.
   `proven by:` LIVE device probe (card 3DS). `strategy:` Agent-Probe (manual human gate — issuing-bank
   domains unbounded, not code-testable).
2. **AC2** — GCash/Alipay cashier + all CDN domains load without connection error.
   `proven by:` LIVE device probe (GCash). `strategy:` Agent-Probe (manual human gate).
3. **AC3** — Maya wallet/credit, QRPH, Billease, Google Wallet each complete without walled-garden failure.
   `proven by:` LIVE device probe per method. `strategy:` Agent-Probe (manual human gate).
4. **AC4** — Only the initiating device receives expanded access (scoped to `src-address`/device id, not
   network-wide). `proven by:` unit test asserting grant is device-scoped. `strategy:` Fully-Automated.
5. **AC5** — Access ends on resolution (a) AND via ~6-min backstop for abandoned checkouts (b), no
   residual. `proven by:` (a) unit revoke-by-deviceMac test; (b) unit grant→TTL-sweep→verify-removed
   test; plus LIVE probe of real removal effect. `strategy:` Hybrid (Fully-Automated lifecycle +
   Agent-Probe network effect).
6. **AC6** — OS connectivity-probe hosts stay denied while access is active (device stays captive).
   `proven by:` integration/static test that probe-deny rules are unaffected by / precede the new allow.
   `strategy:` Fully-Automated.
7. **AC7** — Starting a checkout never creates a session/grant; only successful payment does.
   `proven by:` integration test asserting no session/grant record at checkout-open. `strategy:` Fully-Automated.
8. **AC8** — Existing 20/window checkout rate limit applies unchanged.
   `proven by:` existing rate-limit test still passes with feature enabled. `strategy:` Fully-Automated.

---

## Touchpoints

Files this plan reads or changes:

| # | File | Change |
|---|---|---|
| 1 | `packages/db/src/schema/customer.ts` | Add nullable `deviceMac: text('device_mac')` to `paymentCheckouts` |
| 2 | `packages/db/drizzle/0053_*.sql` | NEW migration: `ALTER TABLE payment_checkouts ADD COLUMN device_mac text` |
| 3 | `packages/core/src/integrations/network/types.ts` | Add 3 OPTIONAL methods to `NetworkController`: `openFullAccessForDevice`, `revokeFullAccessForDevice`, `sweepFullAccess` |
| 4 | `packages/core/src/integrations/network/mikrotik.ts` | Implement the 3 methods (new `FULL_CHECKOUT_TAG`, reuse `currentHotspotIpForMac`) |
| 5 | `packages/core/src/integrations/network/stub.ts` | Add no-op impls of the 3 methods |
| 6 | `packages/core/src/services/checkoutFullAccess.ts` (NEW) | Sibling service: `openFullAccess`, `revokeFullAccessForCheckout`, `sweepFullAccess`; own tag + `FULL_ACCESS_TTL_MINUTES = 6` |
| 7 | `packages/core/src/services/index.ts` (or barrel) | Export the new sibling service |
| 8 | `apps/customer/src/routes/top-up/+page.server.ts` | Persist `deviceMac`; call `openFullAccess` after checkout-create, gated on resolved MAC, best-effort |
| 9 | `apps/customer/src/lib/server/paymentWebhook.ts` | Select `deviceMac` on `co`; call revoke on ANY resolved status, best-effort |
| 10 | `packages/core/src/services/reconcilePayments.ts` | Thread `NetworkController` into `reconcilePendingPayments` / `reconcileCheckout`; revoke on `markUnpaid` + credit resolution |
| 11 | `apps/customer/src/routes/api/network/revoke/+server.ts` | Wire `sweepFullAccess(network)` into the cron alongside `sweepCheckoutAccess` |
| 12 | `packages/core/src/services/checkoutFullAccess.spec.ts` (NEW) | Unit tests (mock controller): open/revoke/sweep + MAC-tag match |
| 13 | `apps/customer/src/routes/api/payments/reconcile/+server.ts` | *(VALIDATE-added, P1)* Pass `network` into `reconcilePendingPayments` (caller of the reconcile signature change) |
| 14 | `apps/customer/src/routes/top-up/processing/+page.server.ts` | *(VALIDATE-added, P1)* Pass `network` into `reconcileCheckout` (caller of the reconcile signature change) |

Read-for-context only: `packages/core/src/services/checkoutAccess.ts` (pattern precedent — DO NOT
modify), `apps/admin/scripts/setup-router.ts` (`PAYMENT_HOSTS` — see Deprecation & Cleanup).

## Public Contracts

New OPTIONAL `NetworkController` surface (additive — existing controllers/consumers unaffected):

```
openFullAccessForDevice?(input: { macAddress: string }): Promise<{ ipAddress: string | null }>
revokeFullAccessForDevice?(input: { macAddress: string }): Promise<{ removed: number }>
sweepFullAccess?(input?: { maxAgeMs?: number }): Promise<number>
```

- `openFullAccessForDevice` — resolves device IP via `currentHotspotIpForMac` (hotspot host table
  only, so a stale MAC can't scope to a reused IP); adds
  `/ip/hotspot/walled-garden/ip add dst-address=0.0.0.0/0 src-address=<ip> action=accept
  comment=veent-checkout-full:<MAC>:<epoch>`; refresh-not-stack for the same device. Returns the IP
  scoped to, or null when the device isn't a current hotspot client (nothing added). Best-effort.
- `revokeFullAccessForDevice` — removes `veent-checkout-full:` rows whose comment MAC-segment matches
  `macAddress` (MAC-in-comment match — NOT live-IP re-resolution, NOT a stored-IP snapshot). Returns
  count removed. Idempotent (0 when none). Best-effort.
- `sweepFullAccess` — removes `veent-checkout-full:` rows older than `maxAgeMs` (epoch parsed from the
  comment's trailing segment). Self-describing on the router; survives app restart. Returns count.

**VALIDATE comment-encoding note (E1, mandatory):** the comment `veent-checkout-full:<MAC>:<epoch>`
contains a colon-format MAC (`AA:BB:CC:DD:EE:FF`), so a naive `split(':')` or
`slice(TAG.length+1)` parse (as `sweepHostAccess` does for the colon-free `veent-checkout:<epoch>`)
is AMBIGUOUS and WRONG here — see the Validate Contract E1/E2 instructions before implementing the
tag or the parse.

New sibling service `checkoutFullAccess.ts`:

```
FULL_ACCESS_TAG = 'veent-checkout-full'          // distinct from checkoutAccess's veent-checkout
FULL_ACCESS_TTL_MINUTES = 6                        // distinct from CHECKOUT_ACCESS_TTL_MINUTES = 15
openFullAccess(network, { macAddress }): Promise<{ ok, ipAddress }>
revokeFullAccessForCheckout(network, { deviceMac }): Promise<{ removed }>   // no-op when deviceMac null
sweepFullAccess(network, ttlMinutes = FULL_ACCESS_TTL_MINUTES): Promise<number>
```

Schema: `payment_checkouts.device_mac` — nullable `text`, additive, no FK, no index (mirrors the
loose-link rationale of `networkId`/`apCircuitId`).

Reconcile signature change (internal contract): `reconcilePendingPayments(db, ...)` and
`reconcileCheckout(db, ...)` gain a `NetworkController` parameter (or accept the network via the
existing options object). This is an internal-caller contract — the cron routes that call them must
pass `network`. **VALIDATE-confirmed callers (both MUST be updated — Touchpoints 13 & 14):**
`apps/customer/src/routes/api/payments/reconcile/+server.ts` (→ `reconcilePendingPayments`) and
`apps/customer/src/routes/top-up/processing/+page.server.ts` (→ `reconcileCheckout`).

## Blast Radius

- ~12 changed files + 1 new migration + 1 new test file across 3 packages (`@veent/db`,
  `@veent/core`, `apps/customer`). (Count rose from ~10 → ~12 at VALIDATE: the reconcile
  signature change adds 2 caller routes — Touchpoints 13 & 14.)
- Risk class: **schema-migration** (additive nullable column) + **payments/billing** (revoke wired
  into webhook + reconcile resolution paths). Both are named HIGH-RISK classes →
  `vc-risk-evidence-pack` manual-first evidence handoff required before finalize (see below).
- The additive nullable column and OPTIONAL controller methods keep backward compatibility: old
  checkout rows have `device_mac = NULL` → revoke is a no-op for them (backstop TTL still applies to
  any live rule). The stub omits all 3 methods → dev/e2e unaffected.
- Payment-money paths (`creditCheckoutIfUnsettled`, grant logic) are NOT modified — revoke is an
  additive best-effort side-effect around them, never inside the atomic claim.

---

## Implementation Checklist (Dependency-Ordered)

Ordered so each step is independently verifiable and nothing depends on a later step.

**Phase 1 — Schema (foundation)**

1. In `packages/db/src/schema/customer.ts`, add `deviceMac: text('device_mac')` to the
   `paymentCheckouts` table definition (nullable, after `apNameSnapshot`, with a comment: "Paying
   device MAC captured best-effort at checkout-open — used ONLY to target full-access revoke on
   resolution; NOT authoritative, fallback-resolved MACs are not verified bindings").
2. Generate the migration: `bun run db:generate` → produces `packages/db/drizzle/0053_*.sql`
   (`ALTER TABLE "payment_checkouts" ADD COLUMN "device_mac" text;`). Migration count 53 → 54 files
   (`0000`–`0053`). Per the push-managed-dev-DB gotcha (see `database/all-database.md`): generate the
   file for the record; dev applies the DDL directly (`db:push` or direct `psql`), do NOT rely on
   `db:migrate` (journal drift). Verify: `grep -c device_mac packages/db/drizzle/0053_*.sql` ≥ 1.

**Phase 2 — Controller methods (network primitive)**

3. In `packages/core/src/integrations/network/types.ts`, add the 3 OPTIONAL methods to
   `NetworkController` with the doc-comments from Public Contracts above (emphasize: NOT
   `ip-binding type=bypassed`; probe-deny rules must win; MAC-in-comment revoke match).
4. In `packages/core/src/integrations/network/mikrotik.ts`:
   - Add `const FULL_CHECKOUT_TAG = 'veent-checkout-full';`.
   - **Comment encoding (E1/E2, mandatory):** store the MAC colon-free in the comment
     (`veent-checkout-full:AABBCCDDEEFF:<epoch>`) OR use a non-colon delimiter — do NOT emit a
     raw colon-format MAC between two colon delimiters. Parse defensively: tag = first segment,
     epoch = LAST segment, MAC = the remainder — never `split(':')[1]`.
   - `openFullAccessForDevice`: resolve `ip` via existing `currentHotspotIpForMac(conn, mac)`; return
     `{ ipAddress: null }` when null; comment per the encoding above; refresh-not-stack (remove prior
     `FULL_CHECKOUT_TAG` rows for this src-ip before adding — match by `src-address == ip` AND
     own-tag, mirroring `openHostAccessForDevice`'s B3.6 own-tag guard); add on the IP-layer table
     `/ip/hotspot/walled-garden/ip/add` with `=action=accept =dst-address=0.0.0.0/0 =src-address=${ip}
     =comment=${comment}`. NOTE: this exact table + `=action=accept =dst-address= =comment=` triple is
     already proven in-repo at `mikrotik.ts:1104` (`provisionWalledGarden` ip block); `=src-address=`
     is a standard sibling field, live-CLI-confirmed this session. Distinct from the `dst-host`
     table `openHostAccessForDevice` uses.
   - `revokeFullAccessForDevice`: print `FULL_CHECKOUT_TAG` rows; match rows whose comment MAC part
     (reconstructed per the encoding above) equals the input MAC (normalized to the SAME case/format
     the open path wrote — uppercase, colon-free if that encoding is chosen); remove each; return
     count. Idempotent. Exact-match on the reconstructed MAC (never substring/`includes`).
   - `sweepFullAccess`: parse trailing epoch (LAST segment), remove rows older than `maxAgeMs`
     (default 6*60_000), skip unparseable, return count. Confirm the epoch parse survives the
     colon-MAC comment (this is the AC5b latent-bug guard — see E2).
5. In `packages/core/src/integrations/network/stub.ts`, add no-op impls:
   `openFullAccessForDevice → { ipAddress: null }`, `revokeFullAccessForDevice → { removed: 0 }`,
   `sweepFullAccess → 0`.

**Phase 3 — Sibling service**

6. Create `packages/core/src/services/checkoutFullAccess.ts` with `FULL_ACCESS_TAG`,
   `FULL_ACCESS_TTL_MINUTES = 6`, and the 3 functions from Public Contracts. Each guards the optional
   controller method (`if (!network.openFullAccessForDevice) return {...}`) exactly like
   `checkoutAccess.ts`. `revokeFullAccessForCheckout` returns `{ removed: 0 }` when `deviceMac` is
   null/empty (no-op).
7. Export the new service from the core services barrel (`packages/core/src/services/index.ts`) —
   match how `openCheckoutAccess`/`sweepCheckoutAccess` are exported so `apps/customer` can import
   from `@veent/core`.

**Phase 4 — Wire checkout-open (grant + persist deviceMac)**

8. In `apps/customer/src/routes/top-up/+page.server.ts`:
   - Add `deviceMac: mac ?? null` to the `db.insert(paymentCheckouts).values({...})` object (~line
     212; the `mac` is the one already resolved at line ~150 via `resolveMacForUser`). Best-effort —
     inside the existing try/catch, never blocks checkout.
   - After the existing `openCheckoutAccess` call (or immediately after checkout-create, gated on a
     resolved `mac`), add a best-effort `openFullAccess(network, { macAddress: mac })` in its own
     try/catch → `captureHandled(e, { level: 'warning', tags: { area: 'network', scope:
     'checkout-full-access' } })`. NEVER throw into the checkout flow. (`network` is already imported
     at line 14.)
   - Keep the existing `openCheckoutAccess` call UNTOUCHED (both run; do not merge).

**Phase 5 — Wire revoke on resolution (webhook + reconcile)**

9. In `apps/customer/src/lib/server/paymentWebhook.ts`:
   - Add `deviceMac: paymentCheckouts.deviceMac` to the `co` select projection (~line 98-105).
   - **Placement + terminal-status gate (E3, mandatory):** call
     `revokeFullAccessForCheckout(network, { deviceMac: co?.deviceMac ?? null })` AFTER
     `recordPaymentTransaction` (~line 135) but BEFORE the `if (evt.status !== 'paid') return`
     early-return (~line 144), so failed/expired/cancelled are covered — NOT just paid. Gate the
     revoke on a TERMINAL status set `{paid, failed, expired, cancelled}` — it must NOT fire on
     intermediate/pending webhook events (that would cut the device's internet mid-3DS and break the
     payment). Best-effort in its own try/catch (`captureHandled` warning). Import `network` from
     `$lib/server/network` (NOT currently imported in this file — add it).
   - Placement: OUTSIDE the money/claim path — revoke is a side-effect, must not affect
     `creditCheckoutIfUnsettled` or the 200-ack behavior.
10. In `packages/core/src/services/reconcilePayments.ts`:
    - Thread a `NetworkController` into `reconcilePendingPayments` and `reconcileCheckout` (add a
      `network` param). In each resolution branch — after `markUnpaid(...)` (failed/expired/cancelled,
      branches ~404/406 and ~486/487) AND after a successful credit claim — call
      `revokeFullAccessForCheckout(network, { deviceMac: <checkout row deviceMac> })` best-effort.
      Select `deviceMac` on the checkout rows these functions already read.
    - `markUnpaid` is private and takes no network; do the revoke at the call sites rather than inside
      `markUnpaid`, so the private helper stays money-only.
    - Guard every revoke in try/catch so a router hiccup never breaks reconcile crediting.
    - **Update both callers (P1 — Touchpoints 13 & 14):** `api/payments/reconcile/+server.ts` (line
      ~30, `reconcilePendingPayments(db, payments)` → pass `network`) and
      `top-up/processing/+page.server.ts` (line ~33, `reconcileCheckout(db, payments, attempt)` →
      pass `network`). Both import `network` from `$lib/server/network`. (Alternatively make the
      `network` param OPTIONAL so the callers need no change and revoke no-ops when absent — either
      is acceptable, but the chosen approach must not leave a caller passing the wrong arity.)

**Phase 6 — Wire backstop sweep**

11. In `apps/customer/src/routes/api/network/revoke/+server.ts`, add
    `const sweptFullAccess = await sweepFullAccess(network);` alongside the existing
    `sweepCheckoutAccess(network)` call inside the `Sentry.withMonitor('customer-network-revoke')`
    block; include `sweptFullAccess` in the JSON response. Import `sweepFullAccess` from
    `@veent/core`. This is the AC5(b) abandoned-checkout backstop.

**Phase 7 — Tests + gates**

12. Create `packages/core/src/services/checkoutFullAccess.spec.ts` (see Verification Evidence for the
    scenario matrix). MUST include: (a) device-scoped grant assertion; (b) revoke-by-deviceMac using a
    real COLON-FORMAT MAC round-trip (open→revoke removes exactly that row); (c) idempotent
    double-revoke = `{ removed: 0 }`; (d) TTL sweep of an aged colon-MAC row + negative controls
    (fresh row NOT swept, unparseable skipped); (e) best-effort no-throw when the controller method is
    absent. Run `bunx vitest run` from INSIDE `packages/core` (per the cwd/bunx gotcha).
13. Run the full gate order: `cd packages/core && bunx tsc --noEmit` (packages/core is NOT in
    `bun run check`) → `bun run check` (apps) → `bun run lint` (scope to touched files) → `bun test`.
    Fix in-blast-radius failures inline.
14. Assemble the `vc-risk-evidence-pack` artifacts (see below) and hand off for the manual LIVE
    verification leg (AC1-3, AC5 network effect) — this is a human gate, NOT automatable.

---

## Phase Completion Rules

- A checklist Phase is **CODE DONE** when its steps are implemented and its in-blast-radius unit/
  typecheck gates pass. It is NOT `VERIFIED`.
- The whole plan is **CODE DONE** after Phase 7 step 13 (packages/core typecheck + all of
  `bun run check` / `bun run lint` / `bun test` green).
- The plan is **VERIFIED** only after: (a) all Fully-Automated + Hybrid-automated gates green in an
  EVL confirmation run, AND (b) the `vc-risk-evidence-pack` artifacts (including the operator-signed
  LIVE verification log for AC1-3 + AC5 network effect) are present, AND (c) explicit user
  confirmation of the live loop on real hardware. Code-only completion never counts as VERIFIED.
- The manual LIVE leg is a CONDITIONAL/known-gap at automated-gate time: it cannot be proven by the
  test double and must be carried as a documented human gate, not silently dropped.

---

## Data Flow

1. Guest taps Pay → `top-up` action resolves `mac` (best-effort, may be fallback/null) →
   `createCheckout` → insert `payment_checkouts` row WITH `deviceMac = mac`.
2. If `mac` resolved: `openFullAccess(network, { macAddress: mac })` → mikrotik resolves current
   hotspot IP → adds device-scoped `dst-address=0.0.0.0/0` allow tagged
   `veent-checkout-full:<MAC>:<epoch>`. Device now has full internet (probe-deny rules still win →
   still captive).
3. Guest completes payment → Maya webhook lands → `handlePaymentWebhook` records the transaction,
   reads `co.deviceMac`, calls `revokeFullAccessForCheckout` → mikrotik removes rows matching that MAC
   in-comment. Device loses full internet immediately.
4. If webhook never lands: reconcile cron polls Maya → on resolved status, same revoke by `deviceMac`.
5. If checkout abandoned (never resolves): `sweepFullAccess` in the revoke cron removes any
   `veent-checkout-full:` row older than ~6 min. No residual access.

## Failure Modes & Edge Cases

(Informed by `vc-scenario` on the highest-risk checklist items — webhook/reconcile revoke.)

- **Out-of-order webhook events** (late FAILED after SUCCESS): revoke is idempotent and by MAC-tag —
  a second revoke for an already-removed rule is a harmless no-op (`removed: 0`). No money impact
  (revoke is outside the claim).
- **Intermediate/non-terminal webhook event** (e.g. pending/authenticating): revoke MUST NOT fire —
  gated on the terminal-status set (E3). Firing on a non-terminal event would cut internet mid-3DS.
- **`deviceMac` NULL** (mac unresolved at checkout, or legacy row): `revokeFullAccessForCheckout`
  no-ops; the ~6-min backstop TTL is the safety net. Documented, acceptable — no rule was granted for
  a null mac anyway (grant is gated on resolved mac).
- **Device IP reused by another guest between grant and revoke**: revoke matches by MAC-in-comment,
  not by live IP, so it removes exactly the rows this checkout created — cannot revoke another
  device's access. (This is the explicit reason the design revokes by MAC-tag, not live-IP.)
- **Router unreachable at revoke time**: best-effort try/catch → `captureHandled` warning; backstop
  TTL sweep still reclaims the rule within ~6 min. No revenue leak beyond the backstop window.
- **Re-checkout by same device**: `openFullAccess` refresh-not-stack renews the timestamp instead of
  accumulating duplicate rules (mirrors `openHostAccessForDevice`).
- **Stub/dev controller**: all 3 methods omitted → service functions no-op; checkout flow unaffected.

---

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| Unit: `openFullAccess` calls controller with resolved mac; no-op when method absent | Fully-Automated | AC4 (device-scoped grant) |
| Unit: grant rule is scoped to the originating device (mock asserts `src-address`/MAC passed, not network-wide) | Fully-Automated | AC4 |
| Unit: `revokeFullAccessForCheckout` matches + removes rows by `deviceMac` in-comment (COLON-FORMAT MAC round-trip); no-op when `deviceMac` null; idempotent double-revoke | Fully-Automated | AC5(a) resolve-triggers-revoke |
| Unit: `sweepFullAccess` removes rows older than TTL (colon-MAC epoch parse), skips fresh + unparseable | Fully-Automated | AC5(b) backstop |
| Unit/integration: no session/grant record created at checkout-open (only at payment-success) | Fully-Automated | AC7 (no auth from checkout) |
| Integration/static: probe-deny rules unaffected by / evaluated ahead of the new allow (assert new rule is `walled-garden/ip accept`, probe denies are separate top `dst-host` denies) | Fully-Automated | AC6 (device stays captive) |
| Existing checkout rate-limit test still passes with feature enabled | Fully-Automated | AC8 (rate limit unchanged) |
| Schema/migration check: `0053` adds `device_mac`; `packages/core` typecheck + `bun run check` 0 errors | Fully-Automated | Constraint: schema touch present |
| `cd packages/core && bunx tsc --noEmit` + `bun run check` + `bun run lint` + `bun test` all green | Fully-Automated | Regression safety |
| LIVE device: card+3DS bank redirect completes without connection error | Agent-Probe (MANUAL human gate) | AC1 |
| LIVE device: GCash/Alipay cashier + all CDN domains load | Agent-Probe (MANUAL human gate) | AC2 |
| LIVE device: Maya wallet/credit, QRPH, Billease, Google Wallet each complete | Agent-Probe (MANUAL human gate) | AC3 |
| LIVE device: removed rule actually blocks browsing (real network effect of revoke) | Agent-Probe (MANUAL human gate) | AC5 network effect |

**Why the LIVE leg is a human gate:** the router's real ambiguity (hotspot host table, NAT, unbounded
3DS/CDN domains) is not reproducible by the test-double controller — per project convention (see
`ap-session-binding-circuitid-first` known-gap and `mac-trust-grant-fix` live-verify handoff). The
unit suite proves the SQL/branch logic and MAC-tag matching; only real hardware proves the network
effect.

### TDD failing stubs (Fully-Automated rows — for the validate-contract Test Gates)

```
test("openFullAccess passes resolved mac to controller, scoped not network-wide", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: device-scoped grant (AC4)")
})
test("revokeFullAccessForCheckout removes rows matching a colon-format deviceMac in-comment; no-op on null; idempotent", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: resolve-triggers-revoke (AC5a)")
})
test("sweepFullAccess removes rows older than TTL (colon-MAC epoch parse), skips fresh and unparseable", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: backstop TTL sweep (AC5b)")
})
```

---

## Deprecation & Cleanup

RULE: never remove an old payment-path allow in the SAME change that introduces the replacement.
Remove only AFTER live verification. NOTHING below is scheduled for removal in THIS changeset.

| Item | What it is | Why it becomes redundant | Disposition | Removal trigger |
|---|---|---|---|---|
| Manual `gcash-test` Akamai IP allow on the router | Temporary operator-added `/ip hotspot walled-garden ip` allow for GCash HTTPS | The device-scoped catch-all allow reaches GCash/Alipay CDN without hostname/IP curation | REMOVE-IN-FOLLOWUP (operator step, not code) | After AC2 live-verified on real hardware |
| `PAYMENT_HOSTS` hostname whitelist in `apps/admin/scripts/setup-router.ts` | Curated per-hostname walled-garden allow for payment domains | Full-access covers the same reachability during checkout | KEEP-NOW (belt-and-suspenders through rollout); flag for follow-up | After AC1-3 live-verified AND a rollout window with no dead-ends |
| 3-host reCAPTCHA `openCheckoutAccess`/`sweepCheckoutAccess` | Shipped flash-fix for reCAPTCHA hosts | Full-access superset covers reCAPTCHA hosts too | KEEP-NOW UNTOUCHED (avoid regressing the shipped flash-fix) | Evaluate for retirement post-verification (separate decision) |
| Backlog `gcash-walled-garden-ip-productionize_NOTE_23-07-26.md` | Note to productionize the GCash IP allow | This feature makes hostname/IP curation for GCash unnecessary | Mark SUPERSEDED at UPDATE PROCESS | This plan reaching VERIFIED |

---

## vc-risk-evidence-pack (mandatory — HIGH-RISK: schema-migration + payments/billing)

Per `orchestration.md §High-Risk Execution Handoff`, this feature requires a manual-first evidence
handoff BEFORE it is treated as ready for finalize/review closure. Assemble at EXECUTE/EVL into the
task folder's `harness/` subdir (`process/general-plans/active/conditional-checkout-access_27-07-26/harness/`):

1. **Change manifest** — the ~12 touched files + migration `0053`, with the additive/nullable +
   OPTIONAL-method backward-compat argument stated.
2. **Migration safety note** — `ALTER ... ADD COLUMN device_mac text` is additive, nullable, no
   default backfill, no lock-heavy rewrite; old rows read NULL → revoke no-ops; rollback = drop
   column (no data dependency). Dev applies DDL directly (push-managed gotcha); prod-apply is a
   separate operator step.
3. **Money-path isolation proof** — evidence that revoke is OUTSIDE `creditCheckoutIfUnsettled`'s
   atomic claim and cannot alter crediting or the webhook 200-ack (code diff + the AC7 test).
4. **Revenue-leak boundary** — evidence both revoke paths (resolve-trigger + backstop TTL) remove the
   rule, with the ~6-min TTL as the worst-case exposure bound; MAC-tag revoke cannot cut another
   device.
5. **Live verification log** — the AC1-3 + AC5-network-effect human-gate results on real hardware
   (operator-signed), since the test double cannot reproduce router ambiguity.

Auto-stop rule: do not mark VERIFIED until artifact 5 (live log) is present and signed off.

---

## Test Infra Improvement Notes

- `packages/core` is NOT in the `bun run check` fan-out (only `apps/*` are — see `all-tests.md`), so
  the new `mikrotik.ts`/`checkoutFullAccess.ts` code is NOT typechecked by the standard gate. This
  plan adds an explicit `cd packages/core && bunx tsc --noEmit` step (Phase 7 step 13). A durable
  fix (wiring a `check` script for `packages/core`) is a separate backlog candidate, not in scope.

---

## Resume and Execution Handoff

1. **Selected plan file:**
   `process/general-plans/active/conditional-checkout-access_27-07-26/conditional-checkout-access_PLAN_27-07-26.md`
2. **Last completed step:** VALIDATE (validate-contract written, first-pass CONDITIONAL) — next is a
   PVL supplement cycle (orchestrator-routed) OR EXECUTE if the CONDITIONAL is accepted.
3. **Validate-contract status:** WRITTEN below — Gate: CONDITIONAL (0 FAILs; concerns + mandatory
   live-hardware human gate on record).
4. **Supporting context loaded:** `process/context/all-context.md` (Maya payments, MikroTik/RouterOS,
   Gotchas), `process/context/tests/all-tests.md`, `checkoutAccess.ts`, `mikrotik.ts` (network
   methods incl. the proven `/ip/hotspot/walled-garden/ip/add` block at :1104), `network/types.ts`,
   `network/stub.ts`, `top-up/+page.server.ts`, `paymentWebhook.ts`, `reconcilePayments.ts` (+ both
   callers), `customer.ts` schema, `revoke/+server.ts`.
5. **Next step for a fresh agent:** address the PVL supplement items (E1/E2/E3 + P1 already folded
   into the checklist/Touchpoints above), then EXECUTE the dependency-ordered checklist Phase 1 → 7.
   Follow the test-failure escalation ladder for out-of-scope failures.

**MAC-trust caveat (durable — do not violate):** the `mac` resolved at checkout via
`resolveMacForUser` is best-effort and MAY be a fallback-resolved MAC — it is NOT a verified binding
(see `mac-trust-grant-fix`, `all-context.md` §Gotchas). `deviceMac` on `payment_checkouts` is
best-effort provenance for targeting revoke ONLY. Do NOT treat it as authoritative, do NOT gate any
grant/session/auth decision on it, and do NOT entrench it as a verified identity.

---

## Next Step

Plan validated (CONDITIONAL). Address the supplement items (folded in above), then say
**ENTER EXECUTE MODE** to implement Phase 1 → 7.

## Validate Contract

Status: CONDITIONAL
Date: 27-07-26
date: 2026-07-27
generated-by: outer-pvl

Parallel strategy: parallel-subagents (fan-out); EXECUTE recommendation: sequential (single opus vc-execute-agent)
Rationale: Signal score 4/7 (S1 multi-package, S2 schema/payments surface, S6 high-risk class, S7 5+ files). VALIDATE ran a two-layer fan-out (4 Layer-1 dimensions + 7 Layer-2 per-phase feasibility checks, independent, no cross-talk). EXECUTE is sequential because the checklist is strictly dependency-ordered with one implementer and no independent parallel workstreams — high-risk implementation is safest single-threaded.

Test gates (C3 5-column table — ADDITIVE; legacy line form below it):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC4 | grant is device-scoped (src-address/MAC, not network-wide) | Fully-Automated | `checkoutFullAccess.spec.ts`: openFullAccess passes resolved mac; mock asserts src-scoped, not network-wide; no-op when method absent | B |
| AC5a | resolve-triggers-revoke by deviceMac in-comment; no-op on null; idempotent | Fully-Automated | spec: revoke removes rows matching a COLON-FORMAT deviceMac (open→revoke round-trip); double-revoke = `{removed:0}` | B |
| AC5b | backstop TTL sweep removes aged rows | Fully-Automated | spec: sweepFullAccess removes rows older than TTL (colon-MAC epoch parse); negative controls: fresh not swept, unparseable skipped | B |
| AC6 | probe-deny wins / device stays captive | Fully-Automated | integration/static: new rule is `walled-garden/ip accept`; probe denies are separate top `dst-host` denies (unaffected) | B (A: live-settled fact #4 corroborates) |
| AC7 | no session/grant record at checkout-open | Fully-Automated | integration: assert no session/grant row created at checkout-open, only at payment-success | B |
| AC8 | existing 20/window checkout rate limit unchanged | Fully-Automated | existing checkout rate-limit test passes with feature enabled | A |
| schema-0053 | migration adds device_mac; consumers typecheck | Fully-Automated | `grep -c device_mac packages/db/drizzle/0053_*.sql` ≥1; `cd packages/core && bunx tsc --noEmit` + `bun run check` 0 errors | B |
| regression | full gate order green | Fully-Automated | `cd packages/core && bunx tsc --noEmit` → `bun run check` → `bun run lint` → `bun test` | A |
| AC1 | card+3DS bank redirect completes | Agent-Probe | LIVE device probe (card 3DS) — operator-signed | D |
| AC2 | GCash/Alipay cashier + CDN load | Agent-Probe | LIVE device probe (GCash) — operator-signed | D |
| AC3 | Maya wallet/QRPH/Billease/Google Wallet complete | Agent-Probe | LIVE device probe per method — operator-signed | D |
| AC5-net | removed rule actually blocks browsing | Agent-Probe | LIVE probe of revoke network effect — operator-signed | D |

gap-resolution legend: A — proven now; B — fixed in this plan (gate added by checklist); C — deferred to later phase; D — backlog test-building stub / named residual (keep-active; continue).

C-4 reconciliation: `strategy` column carries only the 3 proving strategies (Fully-Automated / Agent-Probe here). Known-Gap is never a strategy — the AC1-3 + AC5-net live legs are named residuals (gap-resolution D), captured via risk-evidence-pack artifact 5 (operator-signed live log), auto-stop before VERIFIED.

Failing stubs (Fully-Automated rows):

AC4:
```
test("openFullAccess passes resolved mac to controller, scoped not network-wide", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: device-scoped grant (AC4)")
})
```
AC5a:
```
test("revokeFullAccessForCheckout removes rows matching a colon-format deviceMac in-comment; no-op on null; idempotent", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: resolve-triggers-revoke (AC5a)")
})
```
AC5b:
```
test("sweepFullAccess removes rows older than TTL (colon-MAC epoch parse), skips fresh and unparseable", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: backstop TTL sweep (AC5b)")
})
```
AC6:
```
test("new full-access rule is a walled-garden/ip accept and does not alter the top probe-deny rules", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: probe-deny wins (AC6)")
})
```
AC7:
```
test("starting a checkout creates no session/grant record (only payment-success does)", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: no auth from checkout (AC7)")
})
```

Legacy line form (retained so existing validate-contract consumers still parse):
- checkoutFullAccess service: Fully-automated: `cd packages/core && bunx vitest run src/services/checkoutFullAccess.spec.ts`
- core typecheck: Fully-automated: `cd packages/core && bunx tsc --noEmit`
- consumer + regression: Fully-automated: `bun run check && bun run lint && bun test`
- schema: Fully-automated: `grep -c device_mac packages/db/drizzle/0053_*.sql`
- payment methods (AC1-3): agent-probe: operator LIVE device probe — known-gap for automated tier (risk-pack artifact 5)
- revoke network effect (AC5-net): agent-probe: operator LIVE probe — known-gap for automated tier (risk-pack artifact 5)

Dimension findings:
- Infra fit: PASS — the IP-layer table `/ip/hotspot/walled-garden/ip/add` with `=action=accept =dst-address= =comment=` is already proven in-repo at `mikrotik.ts:1104`; `=src-address=` is a standard sibling field, live-CLI-confirmed; the four live-hardware facts are settled; stub omits all 3 methods so dev/e2e is unaffected. No feasibility probe needed.
- Test coverage: CONCERN — Fully-Automated unit suite is realistic (mirrors `checkoutAccess.ts`, mock controller, vitest); MUST add a colon-format-MAC round-trip test + TTL-sweep-of-colon-MAC test with negative controls; `packages/core` is NOT in `bun run check`, so an explicit `bunx tsc --noEmit` gate was added; live-hardware leg is an unavoidable documented human gate.
- Breaking changes: CONCERN — the reconcile signature change (new `NetworkController` param) has TWO callers not in the original Touchpoints (`api/payments/reconcile/+server.ts`, `top-up/processing/+page.server.ts`) — now added as Touchpoints 13 & 14. Additive nullable column + OPTIONAL controller methods are backward-compatible; internal-contract change is safe once both callers are updated (or the param is made optional).
- Security surface: CONCERN — deliberate scoped full-internet grant on a payments path (high-risk by nature) but bounded and sound: NOT `ip-binding type=bypassed` (device stays untrusted, honors SPEC constraint), `deviceMac` non-authoritative (honors mac-trust caveat), revoke targets only this checkout's own MAC-tagged rows (cannot cut another device), exposure bounded by resolve-revoke + ~6-min TTL + existing 20/window rate limit. `vc-risk-evidence-pack` (5 artifacts, auto-stop before VERIFIED) is mandatory. Sound conditional on the revoke-correctness fix (Section 2 / E1-E2).
- Section 1 (Schema) feasibility: PASS — additive nullable `device_mac text`, migration 0053 (count 53→54), push-managed-dev-DB gotcha respected, no timestamptz concern (text column). Highest-risk edit: none.
- Section 2 (Controller methods) feasibility: CONCERN (HIGHEST) — MAC-in-comment revoke + TTL sweep carry a colon-ambiguity latent bug: comment `veent-checkout-full:<MAC>:<epoch>` with a colon-format MAC breaks a naive `split(':')`/`slice(TAG.length+1)` parse (mirroring `sweepHostAccess`) → revoke mis-parse AND sweep NaN-skip (TTL never reclaims → AC5b failure / revenue leak). Highest-risk edit: fix via unambiguous encoding (colon-free MAC or non-colon delimiter) + parse tag=first / epoch=last / MAC=remainder; prove with a colon-format-MAC round-trip test (E1/E2).
- Section 3 (Sibling service) feasibility: PASS — mirrors `checkoutAccess.ts` optional-method guard + null-`deviceMac` no-op; barrel export straightforward.
- Section 4 (Wire checkout-open) feasibility: PASS — `mac` from `resolveMacForUser` (line 40/150), insert at ~212, `network` imported (line 14), best-effort try/catch pattern already present. Highest-risk edit: keep the grant strictly best-effort (never throw into checkout).
- Section 5 (Wire revoke: webhook + reconcile) feasibility: CONCERN — webhook revoke must be placed AFTER `recordPaymentTransaction` (~135) but BEFORE the `status!=='paid'` early-return (~144) AND gated on a TERMINAL status set (E3) — firing on an intermediate/pending event would cut internet mid-3DS and break payment; `network` is not yet imported in `paymentWebhook.ts` (add it). Reconcile: both callers must pass `network` (P1). Highest-risk edit: the terminal-status gate (E3).
- Section 6 (Wire sweep) feasibility: PASS — mirrors `sweepCheckoutAccess` wiring; response field additive.
- Section 7 (Tests + gates) feasibility: CONCERN — the colon-MAC round-trip + TTL-sweep tests and the `packages/core` typecheck gate must be present or AC5a/AC5b are only nominally covered.

Open gaps:
- Live-hardware verification of AC1, AC2, AC3, and AC5 network-effect: known-gap: documented as MANUAL human gate — not automatable (router ambiguity + unbounded 3DS/CDN domains). Carried as risk-evidence-pack artifact 5 (operator-signed live log); auto-stop before VERIFIED. This is the reason the net gate is CONDITIONAL, not PASS.
- E1/E2 (MAC comment colon-ambiguity), E3 (webhook terminal-status gate), and P1 (reconcile caller updates) are execute-agent instructions folded into the checklist/Touchpoints above — the orchestrator SHOULD route one PVL supplement cycle to confirm the plan text is tightened before EXECUTE.

What this coverage does NOT prove:
- `checkoutFullAccess.spec.ts` (mock controller): does NOT prove the real RouterOS `/ip/hotspot/walled-garden/ip` add/remove behaves as the mock assumes, does NOT prove the device actually reaches 3DS/GCash/CDN hosts, and does NOT prove a removed rule actually blocks browsing on real hardware — only the SQL/branch/MAC-tag/TTL logic.
- `cd packages/core && bunx tsc --noEmit` + `bun run check`: prove type-correctness of the new code and its consumers; do NOT prove runtime router behavior.
- `bun run lint` / `bun test`: prove regression safety of existing suites with the feature present; do NOT cover the live network effect (no automated tier can).
- `grep -c device_mac ... 0053_*.sql`: proves the migration file contains the column; does NOT prove it was applied to the dev/prod DB (push-managed gotcha — dev applies DDL directly; prod is a separate operator step).
- AC1/AC2/AC3/AC5-net (Agent-Probe): proven ONLY by the operator-signed live-hardware log, not by any automated gate.

Gate: CONDITIONAL — 0 FAILs; multiple CONCERNs (revoke-correctness colon-ambiguity is the highest); the AC1-3 + AC5-network-effect live-hardware leg is a mandatory documented human gate (known-gap by design); `vc-risk-evidence-pack` required before VERIFIED. First-pass CONDITIONAL — routes to a PVL supplement cycle (or explicit user acceptance), NOT directly to EXECUTE.
Accepted by: pending — first-pass CONDITIONAL. Accepted concerns to be recorded on user acceptance or after the supplement cycle: (1) live-hardware AC1-3 + AC5-net as documented manual known-gap; (2) E1/E2 revoke-correctness carried as execute instructions; (3) E3 webhook terminal-status gate; (4) P1 reconcile caller updates; (5) packages/core typecheck gate.

## Autonomous Goal Block

```
SESSION GOAL: Ship conditional full-internet access during Maya checkout — device-scoped IP-layer walled-garden allow at checkout-open, revoked on payment resolution (webhook + reconcile) with a ~6-min backstop TTL sweep, plus a nullable deviceMac column on payment_checkouts (migration 0053).
Charter + umbrella plan: N/A — single plan (process/general-plans/active/conditional-checkout-access_27-07-26/conditional-checkout-access_PLAN_27-07-26.md)
Autonomy: standard RIPER-5 — VALIDATE done (Gate: CONDITIONAL). Not under an active /goal; EXECUTE requires explicit "ENTER EXECUTE MODE". Under any autonomous run: apply per-gate self-decide, but the two hard stops below always surface.
Hard stop conditions / safety constraints:
- HIGH-RISK (schema-migration + payments/billing): do NOT mark VERIFIED until the vc-risk-evidence-pack (5 artifacts) exists AND artifact 5 — the operator-signed LIVE hardware log (AC1-3 + AC5 network effect) — is present. Auto-stop otherwise.
- Revoke MUST target only this checkout's own MAC-tagged rules (exact-match on the reconstructed MAC) and MUST be OUTSIDE the money/claim path — never inside creditCheckoutIfUnsettled, never affecting the webhook 200-ack.
- Webhook revoke fires ONLY on terminal statuses {paid, failed, expired, cancelled} — never on intermediate/pending events (would cut internet mid-3DS).
- Grant is strictly best-effort — it must NEVER block or fail a checkout.
- Do NOT treat deviceMac as authoritative; do NOT gate any grant/session/auth decision on it (mac-trust caveat).
Next phase: EXECUTE (after PVL supplement cycle or explicit CONDITIONAL acceptance) — plan path above. Recommended strategy: sequential, single opus vc-execute-agent (dependency-ordered checklist, one implementer).
Validate contract: inline in plan (## Validate Contract) — Gate: CONDITIONAL.
Execute start: implement checklist Phase 1→7. Fully-auto gates: `cd packages/core && bunx tsc --noEmit`; `cd packages/core && bunx vitest run src/services/checkoutFullAccess.spec.ts`; `grep -c device_mac packages/db/drizzle/0053_*.sql`; `bun run check`; `bun run lint`; `bun test`. Live probe (MANUAL human gate): AC1-3 payment methods + AC5 revoke network effect on real hardware. High-risk pack: YES (mandatory before VERIFIED).
```

---

## Closeout — NOT-PLANNED (30-07-26)

Closed NOT-PLANNED 30-07-26 — invalidated on live hardware (catch-all `0.0.0.0/0` allow + captive
device are mutually exclusive; the OS connectivity probe succeeds the instant the allow lands,
tearing down the CNA where the payment is happening, so the checkout can never complete). No code
was shipped from this plan; it was reset out of branch. See memory
`project_conditional-checkout-access-invalidated.md` for the full incident trail. The correct
redesign — pay via CNA→browser handoff — is not scoped here.
