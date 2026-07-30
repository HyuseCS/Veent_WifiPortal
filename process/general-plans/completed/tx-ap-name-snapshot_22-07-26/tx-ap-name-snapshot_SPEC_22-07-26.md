---
name: plan:tx-ap-name-snapshot-spec
description: "Freeze each transaction's AP name at the moment of purchase/grant so later AP renames never rewrite history"
date: 22-07-26
feature: general-plans
---

# SPEC — Transaction AP Name Snapshot

## Summary

Admin Finance's transaction history currently shows the AP each purchase or grant happened
through by looking up that AP's **current** name at read time. That means renaming an AP
today silently rewrites what every past transaction says it was — a February payment made
through "AP-Pabayo" would start showing "AP-Front-Desk" the moment someone renames that AP
in March. This feature freezes the AP name at the moment of the transaction, so historical
records keep the name that was true when the money moved or the grant happened, no matter
what the AP is called later. This applies to all five kinds of transaction the admin Finance
page already tracks: Maya payments, credit top-ups, credit spends, points spends, and
free-time grants.

## User Stories / Jobs To Be Done

- **As** an operations staff member reviewing Finance history, **I want** each transaction
  to show the AP name that was true at the time of that purchase or grant, **so that** old
  records stay accurate even after someone renames an AP for an unrelated reason.
- **As** an operations staff member, **I want** renaming an AP today to have zero effect on
  every transaction recorded before the rename, **so that** historical reports don't
  silently change under me.
- **As** an operations staff member, **I want** this frozen-name behavior to work
  identically across Maya payments, credit top-ups, credit spends, points spends, and
  free-time grants, **so that** I get one consistent, trustworthy picture instead of five
  different behaviors.
- **When** a transaction's AP could not be determined at the time it happened (or happened
  before this feature existed), **I want to** see today's best-available label (the live
  AP name, or "Unattributed") exactly as I do now, **so that** nothing regresses for
  existing history.

## What The User Wants (Behavioral Outcomes)

- Every NEW Maya payment, credit top-up, credit spend, points spend, and free-time grant
  captures and permanently stores the AP's name exactly as it was at the moment that
  transaction happened.
- Later renaming that AP has no effect on how that transaction displays — it keeps showing
  the name captured at transaction time, forever.
- A brand-new transaction made on the SAME (renamed) AP after the rename shows the NEW
  name — only past transactions are frozen; the freeze happens once, at write time, not
  retroactively.
- Transactions that predate this feature (no frozen name on file) behave exactly as they do
  today — no visual change, no re-labeling, no backfill.
- Transactions where the AP could never be determined still show "Unattributed" exactly as
  today.
- None of this ever delays, blocks, or risks rolling back the underlying payment, credit
  spend, points spend, or free-time grant — a guest's purchase or grant always completes
  even if the AP name can't be captured.

## Flow / State Diagram

```
Guest action                         AP name capture                    What staff sees later
──────────────────────────────────────────────────────────────────────────────────────────────
Maya top-up (checkout)      →   name resolved & frozen at        →   Payment row always shows
                                 CHECKOUT time (not at webhook        the frozen name — even if
                                 settlement) — mirrors existing        the AP is renamed the next
                                 circuit-id capture timing             day

Credit top-up                →   name resolved & frozen at        →   Ledger row always shows
Credit spend                     the moment of that ledger            the frozen name captured
Points spend                     write                                 at that moment
Free-time grant               →   name resolved & frozen at        →   Session/grant record
                                  the moment of that grant              always shows the frozen
                                                                        name captured then

                     ┌───────────────────────────────────────────────────────┐
                     │  At READ time (admin Finance / transaction history): │
                     │                                                       │
                     │  frozen name present?                                │
                     │     │                                                 │
                     │     ├─ YES → show the frozen name, unconditionally   │
                     │     │        (never re-looked-up, never overridden)  │
                     │     │                                                 │
                     │     └─ NO (old row, or capture failed) → fall back  │
                     │        to TODAY'S existing behavior: live AP name,   │
                     │        or "Unattributed" — unchanged from today     │
                     └───────────────────────────────────────────────────────┘
```

State of one transaction's displayed AP name over time:

```
 [transaction happens]
         │
         ▼
 resolve AP name (best-effort, never blocks the money/grant operation)
         │
   ┌─────┴──────┐
   ▼            ▼
resolved     unresolved
   │              │
   ▼              ▼
 name frozen    no frozen name stored
 permanently    (falls back to today's
 on this row     live-lookup / "Unattributed"
 (never          behavior forever)
 changes,
 even across
 any number
 of later AP
 renames)
```

## Acceptance Criteria (Testable Outcomes)

1. **A new Maya payment freezes the AP name at checkout.** When a guest starts a Maya
   checkout and the AP is resolvable, the resolved AP name is captured and stored on that
   checkout at the moment of checkout (not at webhook settlement).
   `proven by:` unit test on the checkout AP-name-capture path (extends the existing
   `apps/customer/src/lib/server/network-location.ts` resolver test coverage and
   `apps/customer/src/lib/server/record-payment.spec.ts`).
   `strategy:` Fully-Automated.

2. **Renaming the AP after a Maya payment does not change that payment's displayed name.**
   After a Maya payment is recorded with a frozen name, renaming the AP in `network_health`
   afterward leaves the payment's displayed AP name unchanged.
   `proven by:` unit test that records a payment, renames the AP, then asserts the admin
   query/mapper layer still returns the originally-frozen name for that transaction.
   `strategy:` Fully-Automated.

3. **A brand-new Maya payment on the renamed AP shows the new name.** A payment made AFTER
   the rename captures and displays the AP's current (new) name — proving the freeze is
   per-transaction, not a stale global cache.
   `proven by:` unit test asserting a payment recorded after a rename carries the
   post-rename name.
   `strategy:` Fully-Automated.

4. **Credit top-up, credit spend, points spend, and free-time grant each freeze their AP
   name the same way.** Each of the four remaining transaction sources independently
   captures and freezes its resolved AP name at the moment that transaction/grant happens,
   and is unaffected by later AP renames, mirroring criteria 1–3.
   `proven by:` unit tests covering `packages/core/src/services/{sessions,credits,points}.ts`
   write paths, one per source, each asserting freeze-then-rename-then-unchanged-display
   behavior.
   `strategy:` Fully-Automated.

5. **Pre-existing (old) transactions render exactly as they do today.** Transactions
   recorded before this feature ships (no frozen name on the row) display using today's
   existing live-resolved AP name / "Unattributed" fallback behavior — no regression, no
   backfill, no visual change to old rows in either the unified transaction history or the
   Maya-only view.
   `proven by:` regression test asserting existing rows without a frozen name resolve
   identically to current behavior (extends `apps/admin/src/lib/server/queries.ts`
   coverage for `listUnifiedTransactions` / `listTransactions`).
   `strategy:` Fully-Automated.

6. **Unresolvable AP still shows "Unattributed."** When the AP truly cannot be determined
   at transaction time (null/missing circuit-id, no match), the transaction shows
   "Unattributed" exactly as it does today — freezing introduces no new failure mode here.
   `proven by:` unit test asserting a transaction with no resolvable AP renders
   "Unattributed" both immediately and after any later AP changes.
   `strategy:` Fully-Automated.

7. **AP-name capture never blocks or fails the underlying transaction.** If AP-name
   resolution fails, times out, or throws, the underlying Maya payment, credit spend,
   points spend, or free-time grant still completes successfully — the name is simply not
   frozen (falls back to criterion 5's behavior for that row).
   `proven by:` unit test forcing name resolution to throw and asserting the payment/spend/
   grant transaction still commits, extending the existing atomicity coverage pattern in
   `apps/customer/src/lib/server/grant-atomic.spec.ts`.
   `strategy:` Fully-Automated.

8. **Staff-visible display is correct across all five sources in the unified view.** The
   admin unified transaction history (`/finance/transactions`) shows the frozen name (when
   present) or today's fallback (when absent) correctly for all five transaction types:
   Maya payment, credit top-up, credit spend, points spend, free-time.
   `proven by:` unit test on `listUnifiedTransactions` mapping layer covering all five
   source types; Agent-Probe visual confirmation of the rendered admin page.
   `strategy:` Hybrid.

## Out Of Scope

- **Backfilling frozen names onto transactions that already exist before this ships.** Old
  rows keep today's live-resolved/"Unattributed" behavior permanently — no historical
  reconstruction.
- **KPI/revenue aggregate functions** (`financeKpis`, `revenueByAp`, `revenueByPeriod`) —
  these render no per-row AP label today and are untouched by this feature.
- **CSV export behavior** — unchanged; no new column or format change.
- **Any change to the AP-detection/circuit-id mechanism itself** (DHCP Option 82 capture,
  RouterOS config) — this feature only freezes the name that the existing resolution
  machinery already produces.
- **Per-AP live traffic/bandwidth reporting** — separate, already-parked feature.
- **The locator app** — no changes.
- **Fixing checkout tiers 3–5's null-circuit-id gap** (active-session / last-known /
  dev-fallback resolution paths that already return `apCircuitId: null`) — pre-existing,
  accepted known-gap; those transactions simply have no frozen name and fall back exactly
  like criterion 5/6, same as today.

## Constraints

- **Billing/grant atomicity is non-negotiable.** AP-name resolution must happen BEFORE
  (never inside) the same DB transaction as any money-moving or access-granting operation.
  A resolution failure must never fail or roll back a purchase or grant.
- **New nullable column on five existing tables.** `ap_name_snapshot` (text, nullable) is
  added to `payment_checkouts`, `payment_transactions`, `credit_ledger`, `points_ledger`,
  `network_sessions`. Purely additive — no existing column changes, no backfill.
- **Migration `0051`** — current migration count is 50 (`0050_brown_shen.sql`), generated
  via `packages/db/drizzle.config.ts`, applied via direct DDL against the push-managed dev
  DB (not `db:push`), per the existing migration-chain-drift gotcha.
- **Maya "purchase time" = checkout (intent), not settlement.** The name is captured in
  `resolveCheckoutLocation` at the same instant the circuit-id is captured on
  `payment_checkouts`, then copied INSERT-only from checkout → `payment_transactions` —
  mirroring how `ap_circuit_id` already flows through that path today.
- **Depends on `network_health.displayName`** (migration `0050`, currently uncommitted) and
  the existing `ap_circuit_id` attribution (migration `0049`, shipped/committed `0d13023`).
  The resolved label at capture time is `display_name ?? name`.
- **No cross-app boundary violations.** Customer-side capture and admin-side display
  communicate only through `@veent/db` / `@veent/core`.
- **`?mac=` / AP signals remain client-influenceable, not server-authoritative** — same
  MAC-trust residual as always; this feature does not change that trust boundary.
- **Scope stays within `/admin` and its dependencies/connected resources** — this feature
  extends into `packages/core` and `apps/customer` write paths only because those paths are
  direct dependencies of what admin displays; no other app surface is touched.

## Open Questions

None. All product-intent decisions are locked by the user (mechanism, capture timing for
Maya, pre-transaction resolution, read-time fallback behavior, and scope across all five
sources). Implementation-mechanism choices (e.g., whether the resolve helper is a shared
function reused across all five write sites, or five call sites each wrapping their own
try/catch) are intentionally left to INNOVATE/PLAN.

## Background / Research Findings

- **This builds directly on two just-shipped/pending features:** `purchase-ap-attribution`
  (durable per-purchase/grant AP **circuit-id** attribution — committed `0d13023`, verified
  live) already stamps `ap_circuit_id` on all five tables and resolves the CURRENT AP name
  via a join at read time. This new feature is the deliberate next step: instead of always
  showing the AP's current name via that join, freeze the name that was true AT THE TIME,
  because the current join-based approach means a rename retroactively changes historical
  display — which is the exact behavior this SPEC exists to prevent going forward. This is
  a considered behavior change from the prior feature's read-time-resolution design, not a
  contradiction — record it as such.
- **Confirmed schema state (read directly, 22-07-26):** `apCircuitId` (text) already exists
  on `payment_checkouts`, `payment_transactions`, `credit_ledger`, `points_ledger`,
  `network_sessions` (`packages/db/src/schema/customer.ts`, migration `0049`).
  `network_health.displayName` (text, `packages/db/src/schema/admin.ts:115`) is the
  human-label column the health sweep never touches — the source for `display_name ?? name`
  resolution. Migration count is 50 (`0050_brown_shen.sql` newest) → next migration is
  `0051`.
  Also (022 timezone note): a Finance timezone display bug was noted as un-filed during the
  unified-transaction-history close-out; not part of this feature, flagged for a separate
  backlog note if not already filed.
- **Write-site pattern to reuse (from prior feature + existing code):** `payment_checkouts`
  captures its AP fact in `resolveCheckoutLocation` (customer app,
  `apps/customer/src/lib/server/network-location.ts`) at checkout time, then
  `payment_transactions` copies it INSERT-only from the checkout row at webhook time (never
  re-resolved at settlement). Credit/points ledger writes and free-time grants resolve
  their AP fact pre-transaction (never inside the same `db.transaction` as the money/grant
  write) in `packages/core/src/services/{sessions,credits,points}.ts`.
- **Known pre-existing gap carried forward unchanged:** checkout resolution tiers 3–5
  (active-session / last-known-AP / dev-fallback) already return `apCircuitId: null` — so
  the name snapshot is also null for those cases, falling back to live-resolved/
  "Unattributed" display, exactly as documented in the prior feature's spec. Not something
  this feature fixes.
- **Resolver must be failure-safe when reused pre-transaction:** the existing
  `resolveApCircuitLabel` (`packages/core/src/services/networkHealth.ts`) is a plain read,
  not internally wrapped in try/catch. Any reuse of this (or an equivalent name-resolve
  helper) at a new write site must wrap it so a failure yields a null snapshot rather than
  an unhandled throw — mirroring the existing `resolveApCircuitPreTx` pattern used
  elsewhere in the codebase for the same reason.
- **Test-context grounding** (`process/context/tests/all-tests.md`): Fully-Automated
  strategy for this surface is Vitest server-project unit tests (`packages/core`,
  `apps/customer/src/lib/server`, `apps/admin/src/lib/server`) run via
  `bunx vitest run <file>` — never bare `bun test <file>` (fake-timer gotcha). No
  Playwright e2e coverage exists for Finance; Hybrid strategy (unit test + Agent-Probe
  visual confirmation) is used for the admin-display acceptance criterion, matching the
  precedent set in the sibling `purchase-ap-attribution` SPEC.
- **Scope guard:** per project instruction, agent work here is scoped to `/admin` and its
  dependencies/connected resources; the `packages/core` and `apps/customer` write-path
  touches are in scope because they are direct dependencies feeding what `/admin` displays.
