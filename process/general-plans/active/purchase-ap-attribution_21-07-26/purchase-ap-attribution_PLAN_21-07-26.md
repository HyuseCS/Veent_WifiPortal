---
name: plan:purchase-ap-attribution
description: "Durable per-purchase/grant AP attribution across Maya top-ups, credit/points tier buys, and free-time grants, surfaced in admin Finance/Users"
date: 21-07-26
feature: general-plans
---

# PLAN — Purchase / Grant AP Attribution

Date: 21-07-26
Status: ⏳ PLANNED
Complexity: Complex

**Complexity: COMPLEX** (multi-package, schema migration, billing/credits ledger surface, 4
touchpoint packages). **Risk class: HIGH_RISK** (billing/credits ledger writes + schema
migration — see §Risk Notes).

**SPEC:** `process/general-plans/active/purchase-ap-attribution_21-07-26/purchase-ap-attribution_SPEC_21-07-26.md`
(locked, AC1–AC8, all read and incorporated below).

**INNOVATE decision (locked, not re-decided here):**
- Fork 1 — storage: one new nullable `ap_circuit_id` TEXT column on 5 tables
  (`payment_checkouts`, `payment_transactions`, `credit_ledger`, `points_ledger`,
  `network_sessions`). Migration **50** (by count — see VALIDATE correction on the exact
  generated filename below). Additive-only. Existing `networkId` INT columns and
  behavior are UNCHANGED.
- Fork 2 — resolution timing: resolve the durable circuit-id STRING BEFORE `db.transaction(...)`
  opens, from cheap signals only (portal `ap` param → `network_health.apCircuitId` for the
  resolved AP row → cached last-known circuit-id per MAC via `network_client_attribution` →
  active-session AP's circuit-id). NEVER a live MikroTik call inside a transaction. Threaded as a
  plain string param into `spendCreditsTx` / `spendPointsTx` and into `bindMacTx` (for
  `network_sessions.apCircuitId`). Wired at both grant entrypoints
  (`startPaidAccessAndBindDevice`, `startFreeAccessAndBindDevice`). For Maya: captured alongside
  `resolveCheckoutNetworkId` at checkout → `payment_checkouts.apCircuitId`, copied to
  `payment_transactions.apCircuitId` at webhook/reconcile time. The existing async
  `afterBind`/`resolveNetworkIdForMac` → `network_sessions.networkId` post-hoc path is completely
  UNTOUCHED.
- Fork 3 — read-time label resolver: one new shared function in
  `packages/core/src/services/networkHealth.ts` — circuit-id string → current friendly name (join
  `network_health.apCircuitId`), else raw circuit-id string, else `"Unattributed"`. Admin
  `apps/admin/src/lib/server/queries.ts` calls it for the new Finance/Users display surfaces. The
  existing `apLabel()`/`revenueByAp()` (networkId-based) stays UNCHANGED (AC8).

---

## Overview

Every guest purchase (Maya top-up) and grant (credit/points tier buy, free-time claim) must
durably record which AP the guest was on — as a raw circuit-id STRING that survives that AP being
renamed or pruned from `network_health` later. Today: Maya top-ups have a *live-reference*
version of this (`networkId` int, degrades on prune); credit/points ledger entries have NO AP
field at all; free-time grants have no ledger row and only get AP async/post-hoc on
`network_sessions.networkId`. This plan adds the durable string alongside every one of those,
without touching money-math or grant atomicity, and surfaces it in admin.

## Goals

1. Add nullable `ap_circuit_id` TEXT columns (migration 50) to the 5 tables in scope.
2. Resolve the circuit-id string BEFORE any money-moving/access-granting transaction opens; thread
   it as a plain param into the existing atomic call sites; never let AP resolution block, delay,
   or roll back a purchase/grant (AC6).
3. Add a shared read-time label resolver in `@veent/core` and wire it into two new admin display
   surfaces (Finance transactions list, Users detail) without touching the existing `revenueByAp`
   Maya-only breakdown (AC8).
4. Prove AC1–AC8 with Fully-Automated/Hybrid test gates per the SPEC's `proven by:`/`strategy:`
   lines.

## Scope

In scope: `packages/db` (migration 50), `packages/core` (resolver + label function + threading
into `sessions.ts`/`credits.ts`/`points.ts`), `apps/customer` (checkout capture + webhook/reconcile
copy), `apps/admin` (display wiring). Out of scope: everything listed in SPEC §Out Of Scope
(per-AP live traffic reporting, locator app, RouterOS/AP-detection config, retroactive backfill,
making attribution security-relevant, Phase B/Fatap AP API).

---

## Touchpoints

| File | Change |
|---|---|
| `packages/db/src/schema/customer.ts` | add `apCircuitId: text('ap_circuit_id')` to `paymentCheckouts` (~line 238, next to `networkId`), `paymentTransactions` (~line 189), `creditLedger` (~line 107-134), `pointsLedger` (~line 136-162), `networkSessions` (~line 251-289) |
| `packages/db/drizzle/0049_*.sql` **(VALIDATE correction — verified 21-07-26: 49 migration files exist today, zero-indexed `0000`–`0048`, so `bun run db:generate` will emit a file prefixed `0049_`, not `0050_` — "migration 50" is the correct COUNT/label to use in prose, but do not hardcode `0050_*.sql` as the literal filename; use whatever `db:generate` actually outputs)** | new migration, 5x `ALTER TABLE ... ADD COLUMN ap_circuit_id text` (nullable, no default, no FK) — generated via `bun run db:generate`, applied to dev DB via direct DDL (push-managed-DB gotcha) |
| `packages/core/src/services/networkHealth.ts` | new export `resolveApCircuitLabel(db, circuitId: string \| null): Promise<string>` (join `network_health.apCircuitId` → friendly name; else raw string; else `'Unattributed'`); new export `resolveCircuitIdForMac(db, network, macAddress): Promise<string \| null>` — cheap-signal circuit-id resolver reusing the existing cache-then-router-lookup shape already in `resolveNetworkIdForMac` (lines ~514-548, VERIFIED — never throws, wrapped in try/catch internally, returns null on any failure), but returning the circuit-id STRING instead of the AP row id (avoids a second live MikroTik call) |
| `apps/customer/src/lib/server/network-location.ts` | `resolveCheckoutNetworkId` (line 205-273, VERIFIED against source) gains a sibling return of the resolved circuit-id string — refactor into `resolveCheckoutLocation(event, userId): Promise<{ networkId: number \| null; apCircuitId: string \| null }>` that returns BOTH from the SAME 5-fallback chain (source of the circuit-id at each fallback: step 1 `ctx.ap` → look up `network_health.apCircuitId` for the resolved row; step 2 device-MAC → `network.resolveApForMac` AP name → same `network_health.apCircuitId` lookup; step 3/4 active-session/last-known → `network_sessions`/`customer_profile` don't carry circuit-id today, so these fallbacks return `networkId` only with `apCircuitId: null` for v1 — acceptable per SPEC "best-effort, never blocks"); keep the old `resolveCheckoutNetworkId` name as a thin wrapper for any caller not yet updated, OR update the one call site directly (see next row) |
| `apps/customer/src/routes/top-up/+page.server.ts` (line 180, VERIFIED) | swap `resolveCheckoutNetworkId` call for `resolveCheckoutLocation`; pass `apCircuitId` into the `paymentCheckouts` insert alongside existing `networkId` |
| `packages/core/src/services/reconcilePayments.ts` | `PaymentAttribution` interface (line 20-24, VERIFIED) gains `apCircuitId: string \| null`; `recordPaymentTransaction` (line 35-120ish, VERIFIED) writes it into the `row` object (INSERT-only, same as `networkId` — never in the update set); both `reconcilePendingPayments` (line ~338-380, VERIFIED) and `reconcileCheckout` (line ~416-456, VERIFIED) select `paymentCheckouts.apCircuitId` alongside `networkId` and pass it through to `recordPaymentTransaction` |
| `apps/customer/src/lib/server/paymentWebhook.ts` (line ~95-136, VERIFIED) | select `paymentCheckouts.apCircuitId` alongside `networkId`; pass `apCircuitId: co?.apCircuitId ?? null` into `recordPaymentTransaction` |
| `packages/core/src/services/credits.ts` | `spendCreditsTx` (line 155-188, VERIFIED) input type gains `apCircuitId?: string \| null`; the `tx.insert(creditLedger).values({...})` call (line ~180) includes `apCircuitId: input.apCircuitId ?? null` |
| `packages/core/src/services/points.ts` | `spendPointsTx` (line 92-125, VERIFIED) input type gains `apCircuitId?: string \| null`; the `tx.insert(pointsLedger).values({...})` call (line ~117) includes `apCircuitId: input.apCircuitId ?? null` |
| `packages/core/src/services/sessions.ts` | `bindMacTx` (line 56-182, VERIFIED) gains `apCircuitId?: string \| null` in opts; the update-existing (line ~121-130) and insert-new (line ~154-167) `networkSessions` write paths include `apCircuitId: opts.apCircuitId ?? null`; `startPaidAccessAndBindDevice` (line 329-415, VERIFIED — already resolves `now`/`maxDevicesPerAccount` pre-tx at lines 353-355, confirming the pre-tx pattern is precedented here) resolves `apCircuitId` via `resolveCircuitIdForMac` **wrapped in try/catch** BEFORE `db.transaction(...)` opens (line 357), passes it into both the `spendCreditsTx`/`spendPointsTx` call and the `bindMacTx` call inside the same tx; `startFreeAccessAndBindDevice` (line 685-761, VERIFIED, same pre-tx pattern at line 693) does the same — resolve (try/catch-wrapped) before `db.transaction`, thread into `bindMacTx` — see §Risk Notes for why the try/catch is mandatory, not optional |
| `apps/admin/src/lib/server/queries.ts` | `listTransactions` (line 685-750, VERIFIED) select adds `apCircuitId: paymentTransactions.apCircuitId`; row mapper adds a new field `apCircuitLabel` computed via `resolveApCircuitLabel` (batched — resolve unique circuit-ids once per page, not per row, to avoid N+1 network_health lookups). **VALIDATE finding — see §Risk Notes "Section 5 has no existing surface to extend":** there is currently NO per-user/per-grant detail query or route anywhere in `apps/admin` for credit/points/free-time records (`apps/admin/src/routes/(app)/users/` has only a single list page backed by `listUsers`; `credit_ledger`/`points_ledger` are read nowhere in `apps/admin` except aggregate KPI counts in `dashboardSnapshot`/`revenueByDay`). A new minimal query + display section must be added — see the concrete recommendation in Section 5 of the Implementation Checklist below. `apLabel()`/`revenueByAp()` (line 654-682) are NOT touched (AC8) |
| `apps/admin/src/routes/(app)/finance/+page.svelte` and/or `apps/admin/src/routes/(app)/finance/transactions/+page.svelte` | render the new `apCircuitLabel` column/badge next to (or in place of) the current `apName` column for Maya transactions; **new** minimal section/table for credit/points/free-time grant AP attribution (see Section 5 recommendation) — likely 1 new small component or an addition to the transactions page, not a wholly new route |

## Public Contracts

- New `packages/core` exports: `resolveApCircuitLabel(db, circuitId)`, `resolveCircuitIdForMac(db, network, macAddress)`, `resolveCheckoutLocation(event, userId)` (customer-app-local, not core).
- `spendCreditsTx`/`spendPointsTx`/`bindMacTx` input shapes gain one new OPTIONAL field
  (`apCircuitId?: string | null`) — backward compatible, no existing caller breaks.
- `PaymentAttribution` interface gains one new REQUIRED field (`apCircuitId: string | null`) —
  all 3 call sites of `recordPaymentTransaction` (webhook, `reconcilePendingPayments`,
  `reconcileCheckout`) must be updated in the same change or TypeScript will fail to compile
  (this is intentional — a required field forces every call site to be touched, preventing a
  silently-missed attribution path). **This interface is internal to `packages/core` (no external
  consumer outside this repo), so "REQUIRED" here is a compile-time forcing function, not a
  breaking public-API change — VALIDATE confirms this classification.**
- New DB columns are nullable with no default — no migration-time backfill, no NOT NULL
  constraint, no FK. Fully additive; no existing query, index, or constraint is touched.

## Blast Radius

- **Packages touched:** `packages/db` (schema + migration), `packages/core` (services:
  networkHealth, sessions, credits, points, reconcilePayments), `apps/customer` (network-location,
  top-up route, paymentWebhook), `apps/admin` (queries, Finance page(s)).
- **Risk class:** billing/credits ledger (HIGH_RISK) + schema migration (HIGH_RISK). Per project
  rule, treat with the same rigor as auth/billing surfaces generally.
- **File count:** ~11-13 files touched (VALIDATE revision: +1-2 over the original ~11 estimate to
  cover the new Section 5 credit/points/free-time display surface, which does not extend an
  existing view — see Risk Notes), ~4 packages, 1 migration. No deletions, no destructive
  writes, no changes to existing indexes/constraints/FKs.
- **Not touched:** RouterOS/MikroTik config, `apps/locator`, existing `networkId` columns/behavior
  on any of the 5 tables, `apLabel()`/`revenueByAp()`, any auth/session-cookie logic, any existing
  migration.

## Risk Notes (for VALIDATE risk-evidence pack)

- **AC6 is the load-bearing atomicity guarantee.** AP-circuit resolution MUST happen and complete
  (success or fail-to-null) strictly BEFORE `db.transaction(...)` opens in
  `startPaidAccessAndBindDevice` / `startFreeAccessAndBindDevice`. If a future edit moves it inside
  the transaction, a slow/failed MikroTik circuit lookup could stall or roll back a paid grant —
  this is the exact class of bug `grant-atomic.spec.ts` exists to catch for the money seam, and the
  same pattern applies here. VALIDATE must require an explicit atomicity test (see Verification
  Evidence AC6 row) plus a source-level check (grep/AST) that no `resolveCircuitIdForMac` call
  appears inside a `db.transaction(` callback body — mirror the existing static tripwire pattern in
  `networkHealth.transaction-tripwire.spec.ts`.
- **VALIDATE finding — the pre-tx `resolveCircuitIdForMac` call MUST be wrapped in `try/catch` at
  both call sites (not merely "resolved before the transaction").** `resolveCircuitIdForMac` is
  designed to mirror `resolveNetworkIdForMac`, which never throws (internal try/catch, returns
  `null` on any failure) — but the plan's own AC6 test (Section 4 step 20) deliberately forces this
  call to throw/reject to prove the grant still completes. If `startPaidAccessAndBindDevice` /
  `startFreeAccessAndBindDevice` do NOT wrap the call in `try/catch`, a forced (or genuinely
  unexpected) throw propagates out of the function BEFORE `db.transaction` is ever called — the
  whole grant fails, which VIOLATES AC6 ("never blocks or fails a purchase/grant"). This is now an
  explicit, mandatory checklist item (Section 4, steps 16-17), not an implicit assumption.
- **VALIDATE finding — the static tripwire (Section 4 step 21) needs a DIFFERENT design than its
  cited precedent, not a literal copy.** `networkHealth.transaction-tripwire.spec.ts` works by
  asserting a whole FILE contains no `db.transaction(` at all — valid there because those two call
  sites never wrap `refreshNetworkHealth` in a transaction anywhere in the file. `sessions.ts`
  legitimately contains MANY unrelated `db.transaction(` calls (`bindMacToAccount`,
  `startPaidAccessAndBindDevice`, `pauseAccountAccess`, `startFreeAccessAndBindDevice`,
  `expireDueAccounts`), so a whole-file "no `db.transaction(`" check is inapplicable and would
  immediately false-fail. The new tripwire must instead: (1) extract the source slice for each of
  `startPaidAccessAndBindDevice` and `startFreeAccessAndBindDevice` (from their
  `export async function <name>(` header to the next `export async function` boundary, or EOF);
  (2) within each slice, find the line index of `resolveCircuitIdForMac(` and the line index of
  that function's own `db.transaction(`; (3) assert the `resolveCircuitIdForMac(` call's line index
  is STRICTLY LESS than the `db.transaction(` call's line index (i.e. textually appears before it
  in source order) — this is sufficient to prove pre-tx placement without needing full brace-depth
  parsing, and is simpler/more robust than trying to match closing braces.
- **`PaymentAttribution.apCircuitId` as REQUIRED (not optional)** is a deliberate compile-time
  forcing function so no call site can silently skip it — flag this design choice explicitly in
  VALIDATE so it isn't "simplified" back to optional during EXECUTE.
- **VALIDATE finding — Section 5 (admin display) has no existing surface to extend for
  credit/points/free-time grants.** Confirmed by source inspection (21-07-26): `apps/admin/src/lib/
  server/queries.ts` has no per-user/per-grant detail query, and `apps/admin/src/routes/(app)/
  users/` has exactly one route (`+page.server.ts` + `+page.svelte`) backed by `listUsers`, an
  aggregate row-per-account list with no drill-down. `credit_ledger`/`points_ledger` are read
  NOWHERE in `apps/admin` today except for aggregate KPI/day-bucket counts
  (`dashboardSnapshot`/`revenueByDay`) — there is no per-record display of credit/points spends,
  and free-time grants (`network_sessions` rows with no `packageId`) are not surfaced individually
  either. This means Section 5 step 23's original phrasing ("extend the existing Users detail query
  shape") described something that does not exist. **Concrete recommendation for EXECUTE:** the
  cheapest compliant path is a NEW, small, read-only query (e.g. `listRecentGrantAttribution(db,
  opts)`) that UNIONs `credit_ledger` (type=spend rows) + `points_ledger` (type=spend rows) +
  `network_sessions` rows with `packageId IS NULL` (free-time grants), each already carrying
  `apCircuitId` after this plan's schema change, resolved via the batched `resolveApCircuitLabel`
  call — surfaced as a small new section/table on the EXISTING Finance transactions page (reusing
  its layout/route, not a new route) rather than building a new Users-detail page from scratch. This
  keeps the SPEC's "and/or" wording satisfied via the Finance surface alone and avoids inventing new
  UI navigation. EXECUTE may choose a different minimal design, but must not silently skip AC7 for
  the credit/points/free-time paths on the grounds that "no surface exists" — document whichever
  minimal surface is built.
- **MAC-trust residual applies unchanged** — the `?mac=` / AP signals used to resolve the
  circuit-id remain client-influenceable, not server-authoritative (per existing project finding).
  This feature must not describe AP attribution as tamper-proof anywhere (docs, UI copy, code
  comments).
- **`resolveCheckoutLocation` fallback asymmetry is an accepted v1 gap, not a bug**: fallback tiers
  3/4 (active-session / last-known-AP) return `networkId` but `apCircuitId: null` because
  `network_sessions`/`customer_profile` don't durably cache circuit-id today (only
  `network_client_attribution` does, keyed by MAC, used in tier 2 — VERIFIED against
  `resolveCheckoutNetworkId`'s actual 5-tier fallback chain in `network-location.ts`). This means a
  checkout resolved via tiers 3/4 will show `networkId`-only attribution in the OLD live-reference
  sense but `apCircuitId: null` → "Unattributed" in the new durable sense once the old field
  eventually degrades. Document this explicitly as a known-gap in the Test Infra Improvement Notes;
  do not silently "fix" it by adding new schema to `network_sessions`/`customer_profile` beyond
  what's in scope (SPEC's Out Of Scope: no scope creep into new persistent per-account circuit-id
  caching not already asked for). If EXECUTE finds a cheap 1-line fix using EXISTING columns, take
  it; if not, leave as known-gap.

---

## Implementation Checklist

**Section 1 — Migration**
1. Add `apCircuitId: text('ap_circuit_id')` column to `paymentCheckouts`, `paymentTransactions`,
   `creditLedger`, `pointsLedger`, `networkSessions` in `packages/db/src/schema/customer.ts`
   (nullable, no default, no index — attribution is read rarely enough that a sequential scan on a
   50-token table during Finance queries is fine; do not add an index speculatively).
2. Run `bun run db:generate` (filtered to `@veent/db`) to produce the migration file (expect
   `0049_*.sql` per the VALIDATE correction above — do not hardcode the name, use whatever
   `db:generate` actually outputs; record the real filename in the phase report).
3. Apply the migration DDL directly to the local dev DB (5x `ALTER TABLE ... ADD COLUMN`) per the
   push-managed-dev-DB gotcha — do NOT run `db:push` or `db:migrate`.
4. **Test gate:** `bunx vitest run` has no schema-level test in this repo (packages/db has no test
   script) — verify via `psql \d <table>` per table, or a quick `db:studio` check. Not a Fully-
   Automated gate; this is the Agent-Probe tier (manual/agent verification step in the resume
   handoff), not a Known-Gap — the columns ARE verifiable, just not by an automated script.

**Section 2 — Read-time label resolver (`@veent/core`)**
5. Add `resolveApCircuitLabel(db, circuitId: string | null): Promise<string>` to
   `packages/core/src/services/networkHealth.ts` — joins `network_health.apCircuitId`, falls back
   to the raw string, falls back to `'Unattributed'` when `circuitId` is null. Pure/no side effects.
6. Add `resolveCircuitIdForMac(db, network, macAddress): Promise<string | null>` to the same file —
   mirrors `resolveNetworkIdForMac`'s cache-then-router-lookup shape (VERIFIED: lines 514-548,
   internal try/catch on both the cache lookup and the router-lookup fallback, never throws) but
   returns the circuit-id string (from `networkClientAttribution.circuitId` on cache hit, or
   `networkHealth.apCircuitId` for the AP resolved via the router-lookup fallback) instead of the AP
   row id.
7. **Test gate (AC4, AC5 — Fully-Automated):** new unit tests in
   `packages/core/src/services/networkHealth.spec.ts` (extend existing file) — (a) AP renamed after
   label was first resolved: same circuit-id, second call returns new friendly name; (b) AP row
   deleted/pruned: same circuit-id, call falls back to raw string, no throw, no null; (c)
   `circuitId: null` input → `'Unattributed'`. Command: `cd packages/core && bunx vitest run
   src/services/networkHealth.spec.ts`.

**Section 3 — Maya top-up path (checkout → webhook/reconcile → payment_transactions)**
8. In `apps/customer/src/lib/server/network-location.ts`, add `resolveCheckoutLocation(event,
   userId): Promise<{ networkId: number | null; apCircuitId: string | null }>` reusing the existing
   5-fallback chain in `resolveCheckoutNetworkId`; tiers 1-2 also resolve `apCircuitId` via the new
   `resolveApCircuitLabel`'s sibling raw-lookup (or inline `network_health.apCircuitId` select);
   tiers 3-4-5 return `apCircuitId: null` (documented known-gap, see Risk Notes). Keep
   `resolveCheckoutNetworkId` exported unchanged (thin wrapper `=> (await
   resolveCheckoutLocation(...)).networkId`) so nothing else in the codebase breaks.
9. Update `apps/customer/src/routes/top-up/+page.server.ts` (line ~180) to call
   `resolveCheckoutLocation` and pass `apCircuitId` into the `paymentCheckouts` insert.
10. Update `PaymentAttribution` interface + `recordPaymentTransaction` in
    `packages/core/src/services/reconcilePayments.ts` to carry/persist `apCircuitId` (INSERT-only,
    same as `networkId` — never in the onConflict update set, per the existing "location is fixed
    at checkout" comment).
11. Update all 3 `recordPaymentTransaction` call sites (webhook `paymentWebhook.ts`,
    `reconcilePendingPayments`, `reconcileCheckout`) to select and pass `apCircuitId` from
    `paymentCheckouts` alongside `networkId`.
12. **Test gate (AC1 — Fully-Automated):** extend `apps/customer/src/lib/server/record-payment.spec.ts`
    with a case asserting `apCircuitId` is persisted on insert and left untouched on a later
    onConflict update (mirrors the existing `networkId` INSERT-only assertion pattern if one
    exists, else add one for both fields together). Command:
    `cd apps/customer && bunx vitest run src/lib/server/record-payment.spec.ts`.
13. **Test gate (AC1 — Fully-Automated):** extend `apps/customer/src/lib/server/network-location.spec.ts`
    with cases for `resolveCheckoutLocation` circuit-id resolution across the ap-param and
    device-mac fallback tiers, plus the null-fallback tiers explicitly asserting `apCircuitId: null`.
    Command: `cd apps/customer && bunx vitest run src/lib/server/network-location.spec.ts`.

**Section 4 — Credit/points tier buy + free-time grant path**
14. Update `spendCreditsTx` (`packages/core/src/services/credits.ts`) and `spendPointsTx`
    (`packages/core/src/services/points.ts`) input types + ledger inserts to accept and persist
    `apCircuitId`.
15. Update `bindMacTx` (`packages/core/src/services/sessions.ts`) opts + both the update-existing
    and insert-new `networkSessions` write paths to accept and persist `apCircuitId`.
16. Update `startPaidAccessAndBindDevice`: resolve `apCircuitId` via `resolveCircuitIdForMac`
    **wrapped in try/catch** BEFORE `db.transaction(...)` opens (same call site as where `now`/
    `maxDevicesPerAccount` are already resolved pre-tx, line ~353-355) — on any throw/reject, treat
    as unresolved and continue with `apCircuitId: null`; pass it into the `spendCreditsTx`/
    `spendPointsTx` call AND the `bindMacTx` call inside the transaction callback. **The try/catch is
    mandatory per the AC6 finding in Risk Notes — do not rely solely on `resolveCircuitIdForMac`'s
    own internal non-throwing contract.**
17. Update `startFreeAccessAndBindDevice`: same pre-tx resolution, same mandatory try/catch wrapper;
    pass into `bindMacTx` only (no ledger row for free time, per SPEC constraint).
18. **Test gate (AC2 — Fully-Automated):** new unit test(s) in
    `packages/core/src/services/credits.spec.ts` and `points.spec.ts` (new files — colocated in
    `packages/core/src/services/`, following the SIMPLE fake-`tx`-object pattern used in
    `apps/customer/src/lib/server/points.spec.ts` for `spendPointsTx`/`spendCreditsTx` directly —
    NOT the heavier `fakeDb` proxy pattern in `apps/customer/src/lib/server/credit-claim.spec.ts`,
    which tests a different higher-level function. **VALIDATE correction:** the plan originally
    implied these precedent files live in `packages/core/src/services/`; they actually live in
    `apps/customer/src/lib/server/` — read them there for the pattern, but write the new specs
    in `packages/core/src/services/` since that's where `spendCreditsTx`/`spendPointsTx` live)
    asserting `spendCreditsTx`/`spendPointsTx` write `apCircuitId` onto the ledger row when
    provided, and `null` when omitted. Command: `cd packages/core && bunx vitest run
    src/services/credits.spec.ts src/services/points.spec.ts`.
19. **Test gate (AC3 — Fully-Automated):** new unit test in `packages/core/src/services/sessions.spec.ts`
    (create if not present) covering `startFreeAccessAndBindDevice` writing `apCircuitId` onto the
    `network_sessions` row via the fake-tx pattern from `grant-atomic.spec.ts`.
20. **Test gate (AC6 — Fully-Automated, atomicity):** extend
    `apps/customer/src/lib/server/grant-atomic.spec.ts` with a case that forces
    `resolveCircuitIdForMac` to throw/reject and asserts `startPaidAccessAndBindDevice` /
    `startFreeAccessAndBindDevice` STILL complete successfully (spend committed, access granted,
    `apCircuitId` recorded as null) — i.e. AP-circuit resolution failure never blocks or rolls back
    the underlying transaction. This test is the proof that the try/catch added in steps 16-17
    actually works — it must fail red if the try/catch is missing or misplaced. Command: `cd
    apps/customer && bunx vitest run src/lib/server/grant-atomic.spec.ts`.
21. **Test gate (AC6 — Fully-Automated, static tripwire):** new source-text test
    `packages/core/src/services/sessions.transaction-tripwire.spec.ts` — per the Risk Notes design
    (NOT a literal copy of `networkHealth.transaction-tripwire.spec.ts`'s whole-file check): extract
    the `startPaidAccessAndBindDevice` and `startFreeAccessAndBindDevice` source slices, and for
    each, assert the line index of `resolveCircuitIdForMac(` is strictly before the line index of
    that function's own `db.transaction(` call. Positive anchor: each slice must contain both
    tokens (proves the call sites were actually found, non-vacuous). Command: `cd packages/core &&
    bunx vitest run src/services/sessions.transaction-tripwire.spec.ts`.

**Section 5 — Admin display**
22. Update `apps/admin/src/lib/server/queries.ts` `listTransactions` to select `apCircuitId` and
    compute `apCircuitLabel` via a BATCHED call to `resolveApCircuitLabel` (collect unique
    circuit-ids for the page, resolve once, map back) — do not call it once per row (N+1 risk on a
    50-row page).
23. Add a NEW query function (e.g. `listRecentGrantAttribution`, exact name TBD at EXECUTE) that
    surfaces `apCircuitLabel` for credit/points/free-time grant records tied to a user or a recent
    window — **VALIDATE correction: there is no existing "Users detail query" to extend (confirmed
    by source inspection, see Risk Notes); this is NEW read-only surface.** Recommended minimal
    design: UNION `credit_ledger`(type=spend) + `points_ledger`(type=spend) +
    `network_sessions`(packageId IS NULL, i.e. free-time), each with its `apCircuitId`, resolved via
    the batched `resolveApCircuitLabel`; surface as a new small section/table on the EXISTING
    Finance transactions page rather than a new route (see Risk Notes for full rationale). EXECUTE
    may pick a different minimal design but must not skip AC7 coverage for credit/points/free-time.
24. **Test gate (AC7, AC8 — Fully-Automated + Agent-Probe, Hybrid strategy):** new unit test on
    `listTransactions`/the new grant-attribution query asserting `apCircuitLabel` renders correctly
    for all 3 attribution states (friendly name / raw fallback / Unattributed) across the 3
    purchase/grant types. Command: `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts`
    (create if not present). Agent-Probe: render the Finance transactions page (with the new
    credit/points/free-time section) in the admin browser session and visually confirm the new AP
    label appears correctly for a live seeded record of each of the 3 types — **this is the Hybrid
    gate; per project rule it needs BOTH the agent browser pass AND a human verification handoff
    before being considered done.**
25. **Test gate (AC8 — Fully-Automated, regression):** re-run existing `revenueByAp` test coverage
    unchanged and confirm still green (no behavior change) —
    `apps/admin/src/lib/server/queries.ts` `revenueByAp`/`apLabel` are NOT edited by this plan; this
    gate is a pure regression check.

**Section 6 — Full regression pass**
26. Run `bun run check` (typecheck across apps), `bun run lint` (note: `bun run lint` currently
    fails repo-wide on pre-existing `prettier --check` drift unrelated to this plan — see
    `all-tests.md` §Known Gaps; scope this gate to confirming no NEW lint errors were introduced by
    this plan's files, not a clean full-repo pass), `bun test` (root fan-out across all 3 apps +
    core) as the final gate before VALIDATE→EXECUTE handoff closes.

---

## Acceptance Criteria

Mirrors SPEC AC1–AC8 verbatim (see locked SPEC for full `proven by:`/`strategy:` prose); this
plan's Verification Evidence table below maps each to its concrete test gate:

1. Maya top-up carries a durable AP fact (circuit-id string) surviving AP rename/removal.
2. Credit/points tier purchase carries a durable AP fact on its ledger row (or explicit
   "unattributed").
3. Free-time grant carries a durable AP fact on its `network_sessions` row.
4. AP identity survives AP rename (read-time label resolves to current friendly name).
5. AP identity survives AP removal/pruning (read-time label falls back to the raw stored string).
6. AP resolution never blocks, delays, or fails a purchase/grant — proven via forced-failure
   atomicity test.
7. Staff can see AP attribution in the admin dashboard (Finance transactions and/or Users detail)
   for all three purchase/grant types.
8. No behavior change to the existing Maya per-AP Finance `revenueByAp` breakdown.

## Phase Completion Rules

This is a SIMPLE-loop COMPLEX plan (single EXECUTE pass, not a phase program) — "done" means ALL
of the following, not just code-complete:

- All 6 Implementation Checklist sections (Migration → Label resolver → Maya path → Credit/points/
  free-time path → Admin display → Full regression pass) have their listed test gates green.
- The AC6 atomicity test (step 20) AND the AC6 static tripwire (step 21) are BOTH green — either
  alone is insufficient per §Risk Notes.
- The AC7 Hybrid gate has completed BOTH legs: the automated query/mapper unit test AND the agent
  browser pass — and the mandatory human verification handoff (per project rule for
  interactive/browser-visible changes) has been surfaced, not skipped.
- `bun run check`, `bun run lint` (scoped per step 26's note), and `bun test` all pass at the repo
  root (Section 6, step 26).
- A phase/section is `CODE DONE` (implementation written) vs `VERIFIED` (test gates green) — do not
  conflate the two in status reporting during EXECUTE.

---

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `record-payment.spec.ts` extended: `apCircuitId` persisted, INSERT-only | Fully-Automated | AC1 |
| `network-location.spec.ts` extended: `resolveCheckoutLocation` circuit-id resolution per fallback tier | Fully-Automated | AC1 |
| `credits.spec.ts` / `points.spec.ts` (new, in `packages/core/src/services/`): `spendCreditsTx`/`spendPointsTx` persist `apCircuitId` | Fully-Automated | AC2 |
| `sessions.spec.ts` (new): `startFreeAccessAndBindDevice` writes `apCircuitId` on `network_sessions` | Fully-Automated | AC3 |
| `networkHealth.spec.ts` extended: label resolver returns current name after simulated rename | Fully-Automated | AC4 |
| `networkHealth.spec.ts` extended: label resolver falls back to raw string after simulated AP deletion | Fully-Automated | AC5 |
| `grant-atomic.spec.ts` extended: forced circuit-id resolution failure still commits spend + grant | Fully-Automated | AC6 |
| `sessions.transaction-tripwire.spec.ts` (new, per-function line-order design): static check — no circuit-id resolution call after that function's `db.transaction(` | Fully-Automated | AC6 (defense-in-depth) |
| `queries.spec.ts` (new, admin): AP label renders for all 3 attribution states × 3 purchase/grant types (incl. the new credit/points/free-time grant-attribution query) | Hybrid (automated leg) | AC7 |
| Agent browser pass on Finance transactions page (incl. new credit/points/free-time section) + seeded records of all 3 attribution states | Hybrid (agent-probe leg) + mandatory human verification handoff | AC7 |
| Existing `revenueByAp`/`apLabel` test coverage re-run unchanged, still green | Fully-Automated | AC8 |
| `bun run check` / `bun run lint` (scoped) / `bun test` full pass | Fully-Automated | regression / no-break across all 3 apps + core |

## Test Infra Improvement Notes

- **Known-gap (documented, not silently dropped):** `resolveCheckoutLocation` fallback tiers 3
  (active-session AP) and 4 (last-known AP) return `apCircuitId: null` even when a `networkId` was
  resolved, because `network_sessions`/`customer_profile` do not durably cache the circuit-id
  string today (only `network_client_attribution`, keyed by MAC, backs tier 2). This means some
  checkouts will show `apCircuitId: null` → "Unattributed" even though a live AP reference existed
  at the time. Backlog candidate (not in this plan's scope): thread `network_client_attribution`'s
  cache into tiers 3/4 too, OR persist `apCircuitId` onto `network_sessions` at grant time so
  tier-3 checkouts can read it back. Track as a backlog NOTE at UPDATE PROCESS if not closed during
  EXECUTE.
- **`packages/db` has no test script** — the migration itself cannot be Fully-Automated-verified in
  CI; verification is the Agent-Probe tier (`psql \d` / `db:studio`) per Section 1 step 4. This is a
  pre-existing repo-wide gap (see `all-database.md`), not new to this plan.
- No Playwright e2e spec exists for Finance/Users today (confirmed via `all-tests.md`) — the AC7
  admin-display gate is necessarily Hybrid (unit test on the query/mapper layer + Agent-Probe
  visual confirmation), matching the SPEC's own `strategy:` declaration. Do not attempt to force a
  Fully-Automated e2e gate here; that would require standing up new Playwright infra out of scope
  for this plan.
- **Root `bun run lint` currently fails repo-wide on pre-existing prettier drift** (297 files,
  tracked in `process/features/incident-management/backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md`)
  — unrelated to this plan. Section 6 step 26 scopes the lint gate to "no new errors in this plan's
  files," not a clean full-repo pass, so this pre-existing gap does not block this plan's gate.

## Validate Contract

Status: PASS
Date: 21-07-26
date: 2026-07-21
generated-by: outer-pvl

Parallel strategy: sequential (single-agent deep source-verification pass; VALIDATE fan-out signals
scored HIGH — S1 multi-package, S2 schema/billing surface, S6 high-risk class, S7 5+ files — which
would normally recommend parallel-subagent Layer1/Layer2 fan-out; performed here as one continuous
evidence-gathering pass reading all touchpoint files directly rather than spawning parallel
sub-agents, since the validating session had direct file-read access end-to-end and cross-checking
findings against each other benefited from shared context. Recommend true parallel Layer1/Layer2
fan-out for the next HIGH_RISK plan of this size if session context is more constrained.)
Rationale: single continuous deep-read pass; no sub-agent fan-out was actually spawned.

Test gates (5-column table):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1 | Maya checkout persists durable `apCircuitId` (INSERT-only) | Fully-Automated | `cd apps/customer && bunx vitest run src/lib/server/record-payment.spec.ts` | A |
| AC1 | `resolveCheckoutLocation` resolves `apCircuitId` per fallback tier (null on tiers 3-5) | Fully-Automated | `cd apps/customer && bunx vitest run src/lib/server/network-location.spec.ts` | A |
| AC2 | `spendCreditsTx`/`spendPointsTx` persist `apCircuitId` on the ledger row | Fully-Automated | `cd packages/core && bunx vitest run src/services/credits.spec.ts src/services/points.spec.ts` | B |
| AC3 | `startFreeAccessAndBindDevice` writes `apCircuitId` onto `network_sessions` | Fully-Automated | `cd packages/core && bunx vitest run src/services/sessions.spec.ts` | B |
| AC4 | Read-time label resolver returns current friendly name after simulated AP rename | Fully-Automated | `cd packages/core && bunx vitest run src/services/networkHealth.spec.ts` | A |
| AC5 | Read-time label resolver falls back to raw circuit-id string after simulated AP deletion | Fully-Automated | `cd packages/core && bunx vitest run src/services/networkHealth.spec.ts` | A |
| AC6 | Forced `resolveCircuitIdForMac` failure still commits spend + grant (never blocks) | Fully-Automated | `cd apps/customer && bunx vitest run src/lib/server/grant-atomic.spec.ts` | B |
| AC6 (defense-in-depth) | Static per-function line-order tripwire: no `resolveCircuitIdForMac(` after that function's `db.transaction(` | Fully-Automated | `cd packages/core && bunx vitest run src/services/sessions.transaction-tripwire.spec.ts` | B |
| AC7 | AP label (friendly/raw/Unattributed) renders correctly for all 3 grant types (automated leg) | Hybrid | `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` | B |
| AC7 | AP label renders correctly in the live admin UI (agent-probe leg + human handoff) | Hybrid | Agent browser pass on Finance transactions page + new credit/points/free-time section, seeded with all 3 attribution states, THEN human verification handoff | B |
| AC8 | No regression to existing `revenueByAp`/`apLabel` Maya breakdown | Fully-Automated | existing `apps/admin` test coverage on `revenueByAp`/`apLabel`, re-run unchanged | A |
| Section 1 (migration) | 5 nullable `ap_circuit_id` TEXT columns exist, no FK/index/default | Agent-Probe | `psql \d <table>` per table (or `db:studio`) after direct-DDL apply | D |
| regression | No behavior change / no compile break across all 3 apps + core | Fully-Automated | `bun run check && bun run lint && bun test` (lint scoped to no-new-errors per step 26) | A |

gap-resolution legend:
- A — proven now (gate passes in this cycle)
- B — fixed in this plan (gate added by this plan's checklist)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

C-4 reconciliation: the `strategy:` column above carries only Fully-Automated / Hybrid / Agent-Probe. The migration verification row is Agent-Probe (a real, exercisable manual check), not Known-Gap — `packages/db` having no test runner is a pre-existing repo-wide condition, not this plan silently skipping proof.

Legacy line form (retained so existing validate-contract consumers still parse):
- Maya top-up path: Fully-automated: `cd apps/customer && bunx vitest run src/lib/server/record-payment.spec.ts src/lib/server/network-location.spec.ts`
- Credit/points/free-time path: Fully-automated: `cd packages/core && bunx vitest run src/services/credits.spec.ts src/services/points.spec.ts src/services/sessions.spec.ts src/services/sessions.transaction-tripwire.spec.ts`
- AC6 atomicity: Fully-automated: `cd apps/customer && bunx vitest run src/lib/server/grant-atomic.spec.ts`
- Label resolver: Fully-automated: `cd packages/core && bunx vitest run src/services/networkHealth.spec.ts`
- Admin display: hybrid: `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` + agent-probe: browser pass on Finance page + human verification handoff
- Migration: agent-probe: `psql \d <table>` per table after direct DDL apply
- Full regression: fully-automated: `bun run check && bun run lint && bun test`

### Failing stubs (Fully-Automated rows only)

```
test("should persist apCircuitId on payment_transactions insert, INSERT-only on later update", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: Maya checkout persists durable apCircuitId (INSERT-only)")
})
```

```
test("should resolve apCircuitId per fallback tier, null on tiers 3-5", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: resolveCheckoutLocation resolves apCircuitId per fallback tier")
})
```

```
test("should persist apCircuitId onto credit_ledger/points_ledger row when provided, null when omitted", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: spendCreditsTx/spendPointsTx persist apCircuitId")
})
```

```
test("should write apCircuitId onto network_sessions on startFreeAccessAndBindDevice", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: startFreeAccessAndBindDevice writes apCircuitId onto network_sessions")
})
```

```
test("should return current friendly name after simulated AP rename, same circuit-id", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: label resolver returns current friendly name after simulated AP rename")
})
```

```
test("should fall back to raw circuit-id string after simulated AP deletion", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: label resolver falls back to raw string after simulated AP deletion")
})
```

```
test("should still commit spend + grant when resolveCircuitIdForMac throws/rejects", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: forced resolveCircuitIdForMac failure still commits spend + grant")
})
```

```
test("should assert resolveCircuitIdForMac( appears before db.transaction( in each grant function", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: static per-function line-order tripwire for AC6 defense-in-depth")
})
```

```
test("should render correct apCircuitLabel for friendly/raw/Unattributed states across 3 grant types", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: AP label renders correctly for all 3 grant types (automated leg)")
})
```

```
test("should regress-check revenueByAp/apLabel unchanged after schema addition", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: no regression to existing revenueByAp/apLabel Maya breakdown")
})
```

Dimension findings:
- Infra fit: PASS — no container/infra/proxy/runtime surface touched; migration filename
  discrepancy (0050 vs actual 0049) corrected directly in the plan text above.
- Test coverage: PASS — every developed behavior (AC1-AC8 + migration + regression) has a
  Fully-Automated, Hybrid, or Agent-Probe gate; no behavior rests on Known-Gap alone (the one
  Known-Gap — fallback-tier-3/4 `apCircuitId: null` — is a named, justified residual on a FALLBACK
  path, not the primary proving mechanism for any AC). TDD failing stubs attached above for all 10
  Fully-Automated scenario rows.
- Breaking changes: PASS — all 5 new DB columns are additive/nullable/no-default/no-FK/no-index;
  `spendCreditsTx`/`spendPointsTx`/`bindMacTx` gain an OPTIONAL field (non-breaking); the one
  REQUIRED interface field (`PaymentAttribution.apCircuitId`) is internal to `packages/core` with
  exactly 3 known call sites, all updated within this same plan's checklist (steps 10-11) —
  correctly classified as a compile-time forcing function, not a public breaking change.
  `apLabel()`/`revenueByAp()` explicitly unedited (AC8 preserved).
- Security surface: PASS — no auth, secrets, or trust-boundary logic touched; AP attribution
  remains best-effort/advisory per SPEC constraint, never gates access/pricing/fraud decisions; the
  MAC-trust residual is correctly carried forward as an explicit non-claim (not newly introduced,
  not newly obscured).
- Section 1 (Migration) feasibility: PASS — mechanically trivial (5x nullable `ADD COLUMN`,
  precedented by the existing `network_health.apCircuitId` column); filename correction applied.
- Section 2 (Label resolver) feasibility: PASS — `resolveNetworkIdForMac` (verified source,
  packages/core/src/services/networkHealth.ts:514-548) confirms the cache-then-router-lookup shape
  and non-throwing contract the new function is designed to mirror.
- Section 3 (Maya path) feasibility: PASS — all touchpoint files and line ranges verified against
  actual source (`network-location.ts`, `reconcilePayments.ts`, `paymentWebhook.ts`, `top-up/
  +page.server.ts`); the 5-tier fallback chain and its known-gap on tiers 3-5 independently
  confirmed against `resolveCheckoutNetworkId`'s real implementation.
- Section 4 (Credit/points/free-time + AC6 atomicity) feasibility: PASS after plan fixes — the
  pre-tx resolution pattern is precedented (`now`/`maxDevicesPerAccount` already resolved pre-tx in
  both grant functions); the missing try/catch requirement (AC6 finding) and the tripwire's
  incompatible whole-file-check precedent (sessions.ts has legitimate `db.transaction(` calls
  elsewhere) are now both explicit, corrected checklist items (steps 16, 17, 21) rather than
  implicit assumptions. This was the highest-risk section in the plan and required the most VALIDATE
  correction.
- Section 5 (Admin display) feasibility: PASS after plan fixes — VALIDATE found the plan's original
  premise ("extend the existing Users detail query") does not match reality (no such surface
  exists; confirmed via grep — `credit_ledger`/`points_ledger` are read nowhere in `apps/admin`
  except aggregate KPIs). A concrete minimal-scope recommendation (new UNION query surfaced on the
  existing Finance transactions page) is now in the checklist (step 23) so EXECUTE has an
  unambiguous, appropriately-scoped path rather than an open-ended "TBD."
- Section 6 (Full regression) feasibility: PASS — gate commands verified against `all-tests.md`;
  the pre-existing repo-wide lint-drift gap is correctly scoped out of this plan's gate.

Open gaps:
- Known-gap (documented, accepted, does not block PASS): `resolveCheckoutLocation` fallback tiers
  3/4 return `apCircuitId: null` even when `networkId` resolved (network_sessions/customer_profile
  don't durably cache circuit-id). Tracked in Test Infra Improvement Notes; backlog candidate if not
  closed cheaply during EXECUTE.
- Section 5's exact new query/UI shape is intentionally left to EXECUTE's judgment within the
  concrete minimal-scope recommendation given above — not an open risk, but flagged so EXECUTE
  documents whichever shape it lands on in the phase report.

What this coverage does NOT prove:
- The Fully-Automated unit tests (AC1-AC6, AC8, regression) prove logic correctness against mocked/
  fake DB/tx objects — they do NOT prove the real migration applies cleanly against a live prod-like
  Postgres beyond the local dev DB (packages/db has no CI, no prod-mirroring test environment).
- The AC6 static tripwire (line-order check) proves SOURCE STRUCTURE, not RUNTIME behavior in
  production — a determined future refactor could still defeat it by restructuring the function in
  a way that keeps the line-order invariant but changes semantics (e.g., wrapping the whole function
  body in an outer try/catch that changes control flow). The Fully-Automated forced-failure test
  (step 20) is the real runtime proof; the tripwire is defense-in-depth only.
- The AC7 Hybrid gate's automated leg proves the query/mapper layer maps circuit-ids to labels
  correctly; it does NOT prove the actual rendered UI is visually correct or accessible — that is
  exactly what the Agent-Probe leg + human verification handoff cover, and neither is optional.
- No test in this plan proves behavior under concurrent/racing purchases hitting the SAME AP's
  circuit-id resolution simultaneously (out of scope — no new concurrency surface is introduced by
  this plan; `spendCreditsTx`/`spendPointsTx`'s existing conditional-UPDATE concurrency guards are
  untouched and unaffected by adding one more nullable column to their INSERT).
- No test proves the migration's behavior against a genuinely pruned/reseeded `network_health` table
  under real health-sweep timing — the AC5 test simulates deletion via a mocked/fake row removal,
  not a live health-sweep run.

Gate: PASS (no FAILs, plan updated — all identified concerns resolved via direct plan-text
corrections applied during this VALIDATE pass; no residual open concerns)
Accepted by: N/A — Gate: PASS, no unresolved concerns require acceptance. (All findings were
resolved by editing the plan directly during VALIDATE rather than deferred as accepted-CONDITIONAL
gaps; see "Open gaps" above for the two non-blocking residuals.)

**HIGH_RISK note for EXECUTE handoff:** This plan is HIGH_RISK (billing/credits ledger + schema
migration). Per project rule, EXECUTE must produce the manual-first risk-evidence pack (5 artifacts:
`risk-gate.json`, `context-snippets.json`, `verification.json`, `review-decision.json`,
`adversarial-validation.json`) inside this task folder's `harness/` subdirectory before the work is
treated as ready to finalize — see `vc-risk-evidence-pack`. Auto-stop rule applies: do not imply the
work is fully proven until the pack exists and the reviewer decision is recorded.

## Autonomous Goal Block

SESSION GOAL: Ship durable per-purchase/grant AP attribution (Maya top-ups, credit/points tier
buys, free-time grants) as a raw circuit-id string surviving AP rename/prune, surfaced in admin.
Charter + umbrella plan: N/A — single plan (no phase-program umbrella exists for this work).
Autonomy: Standard /goal autonomous execution rules apply (process/development-protocols/
orchestration.md §Autonomy Mode + §Autonomous /goal Phase Program Execution). CONDITIONAL findings
during EXECUTE → apply fixes, proceed without pausing. BLOCKED → backlog note, continue with
remaining checklist items. Irreversible/outward-facing action without explicit contract
instruction → hard stop.
Hard stop conditions / safety constraints:
- AP-circuit resolution must NEVER move inside `db.transaction(...)` in `startPaidAccessAndBindDevice`
  / `startFreeAccessAndBindDevice` — this would reintroduce the exact grant-atomicity risk class
  `grant-atomic.spec.ts` exists to catch. The AC6 static tripwire (step 21) must stay green.
- `PaymentAttribution.apCircuitId` must stay REQUIRED (not optional) — do not "simplify" it back to
  optional during EXECUTE; this is a deliberate compile-time forcing function.
- Never describe AP attribution as tamper-proof or server-authoritative in any code comment, UI
  copy, or doc — the MAC-trust residual is unchanged and this feature adds no new trust boundary.
- Do not retroactively backfill AP identity for pre-existing purchases/grants — explicitly out of
  scope per SPEC.
- Do not expand Section 5's admin display into a full new Users-detail route/page — the recommended
  minimal scope (new section on the existing Finance transactions page) is the ceiling unless the
  user explicitly asks for more.
Next phase: EXECUTE: process/general-plans/active/purchase-ap-attribution_21-07-26/purchase-ap-attribution_PLAN_21-07-26.md
Validate contract: inline in plan (this section)
Execute start: `bun run db:generate` (filtered to `@veent/db`) as the first EXECUTE step, per
Section 1 | e2e spec: none (no Playwright coverage in scope) | probe scenario: Agent browser pass on
Finance transactions page per AC7 Hybrid gate | high-risk pack: yes — required before EXECUTE is
considered finalize-ready, see HIGH_RISK note above.

## Resume and Execution Handoff

1. **Selected plan file path:** `process/general-plans/active/purchase-ap-attribution_21-07-26/purchase-ap-attribution_PLAN_21-07-26.md`
2. **Last completed phase or step:** VALIDATE complete, Gate: PASS. No EXECUTE work started.
3. **Validate-contract status:** written above (this document), `generated-by: outer-pvl`, Gate:
   PASS. HIGH_RISK — the risk-evidence pack (5 artifacts) is required at EXECUTE, not yet produced.
4. **Supporting context files loaded:** `process/context/all-context.md`,
   `process/context/database/all-database.md`, `process/context/tests/all-tests.md`,
   `packages/db/src/schema/customer.ts`, `packages/db/src/schema/admin.ts`,
   `packages/core/src/services/{networkHealth,sessions,credits,points,reconcilePayments}.ts`,
   `apps/customer/src/lib/server/{network-location,paymentWebhook}.ts`,
   `apps/customer/src/routes/top-up/+page.server.ts`, `apps/admin/src/lib/server/queries.ts`,
   `apps/admin/src/routes/(app)/users/+page.server.ts`, the locked SPEC file, existing test files
   (`record-payment.spec.ts`, `grant-atomic.spec.ts`, `network-location.spec.ts`,
   `credit-claim.spec.ts`, `points-redeem.spec.ts`, `points.spec.ts`,
   `networkHealth.transaction-tripwire.spec.ts`).
5. **Next step for a fresh agent:** run `vc-agent-strategy-compare` for EXECUTE (recommend:
   sequential, single vc-execute-agent given this is a single continuous checklist with strict
   ordering dependencies — Migration → Label resolver → Maya path → Credit/points/free-time →
   Admin display → Regression), then invoke `vc-execute-agent` against this plan file starting at
   Section 1 step 1. Produce the risk-evidence pack per the HIGH_RISK note before treating EXECUTE
   as finalize-ready.
