---
name: plan:unified-transaction-history-spec
description: "Merge admin Finance's split payment table + grant-attribution section into one unified activity history, with Maya-mirror dedupe"
date: 21-07-26
feature: general
---

# SPEC — Unified Transaction / Activity History (Admin Finance)

## Summary

Today, staff looking at the admin Finance page see two disconnected lists: a paginated table of
Maya card/e-wallet payments, and a separate small "Grant attribution" section listing recent
credit spends, points spends, and free-time grants. To see the full picture of what happened on
an account or at a site, staff have to mentally merge two tables with different columns and no
shared timeline. This feature replaces that split view with **one list** — every kind of
customer-facing money/points/access event, in one place, each row clearly labeled with what it
was, sorted by time, with the AP it happened at. It is a display-only change: no money math, no
schema, and no KPI numbers change.

## User Stories / Jobs To Be Done

- As a **finance/support staffer**, I want to see a single chronological activity feed covering
  Maya payments, credit top-ups, credit spends, points earns, points spends, and free-time
  grants, so that I can understand everything that happened on an account or at an AP without
  cross-referencing two separate tables.
- As a **finance/support staffer**, I want every row to clearly say what kind of event it is
  (e.g. "Maya payment", "Credit top-up", "Credit spend", "Points earned", "Points spent", "Free
  time granted"), so that I never mistake a wallet-load for a spend or vice versa.
- As a **finance/support staffer**, I want a Maya payment that also created a matching credit
  top-up to show as ONE row, not two, so that the list isn't misleading about how many separate
  events actually happened.
- As a **finance/support staffer**, I want the same date-range filter I already use on Finance to
  apply to every row type (not just Maya payments), so that "last 7 days" means the same thing
  for the whole list.
- As a **finance/support staffer**, I want every row to show which AP it happened at (using the
  existing durable AP label), so that I can spot problems tied to a specific site.

## What The User Wants (Behavioral Outcomes)

- The Finance page's current two-section layout (payments table + "Grant attribution" section)
  is replaced by one combined, chronologically-sorted list/table.
- Every row carries: a type/funding-source label, an amount (or points/description for
  non-money events), the customer, the AP, a timestamp, and — where applicable — a status.
- A Maya payment that produced a linked credit top-up (same payment, mirrored into the credit
  ledger) appears once, labeled as the Maya payment; it does NOT also appear as a second
  "Credit top-up" row.
- A credit top-up that did NOT come from a Maya payment (e.g. a manual/promo grant with no
  linked payment) DOES appear, labeled clearly as a standalone credit load.
- Points earned as a side effect of a Maya payment are visibly connected to that payment (not
  presented as an independent purchase event) — see Open Questions for the exact display
  treatment, to be resolved by INNOVATE.
- The existing date-range filter (`?period=`) narrows the WHOLE unified list, not just the Maya
  rows.
- The existing Finance KPI cards/charts at the top of the page (`financeKpis`, `revenueByAp`,
  `revenueByPeriod`, `paymentMethodBreakdown`) are visually and numerically unchanged.
- The existing per-AP Maya revenue breakdown is unchanged.

## Flow / State Diagram

Data-source merge (conceptual, not implementation):

```
                         ┌─────────────────────────┐
                         │   Finance page load       │
                         │   (?period= filter)       │
                         └────────────┬───────────────┘
                                      │
        ┌────────────────┬───────────┼───────────────┬─────────────────┐
        ▼                ▼           ▼                ▼                 ▼
 payment_transactions credit_ledger credit_ledger  points_ledger   network_sessions
   (Maya payments)     (topup)       (spend)      (earn / spend)   (free-time grants,
                                                                     packageId = null)
        │                │             │              │                 │
        │        ┌───────┘             │              │                 │
        │        │  DEDUPE: topup row  │              │                 │
        │        │  with a matching    │              │                 │
        │        │  externalTransactionId  │          │                 │
        │        │  → suppressed        │              │                 │
        │        │  (folded into the    │              │                 │
        │        │  Maya row it mirrors)│              │                 │
        │        ▼                     │              │                 │
        └──────► merge, label by type ◄─────────────────────────────────┘
                       │
                       ▼
              sort newest → oldest
                       │
                       ▼
          ONE unified activity list
        (type label · amount/detail · customer
           · AP label · timestamp · status)
```

Row-type labeling (happy path):

```
Maya payment (settled)         → "Maya payment"      [status: shown]
Maya payment → mirrored topup  → suppressed (folded into the Maya payment row above)
Standalone credit load         → "Credit top-up"      [status: n/a, always succeeded]
Credit spend                   → "Credit spend"
Points earn (from a payment)   → linked/annotated on the source payment row (exact
                                   treatment: open question, INNOVATE)
Points spend                   → "Points spent"
Free-time grant                → "Free time granted"
```

## Acceptance Criteria (Testable Outcomes)

1. **All activity types appear in one list.** The Finance page shows Maya payments, credit
   top-ups, credit spends, points earns, points spends, and free-time grants together in a
   single chronological list, not in separate sections.
   - proven by: new/updated unit test on the unified query function asserting all six event
     kinds are represented in the merged result set for a seeded fixture covering each kind.
   - strategy: Fully-Automated

2. **Every row is clearly typed.** Each row displays a human-readable type/funding-source label
   that distinguishes a wallet-load event from a spend/access-granting event (no ambiguous or
   blank type field).
   - proven by: unit test asserting every row in the merged result carries a non-empty,
     kind-appropriate label; UI snapshot/e2e check that the label renders visibly per row.
   - strategy: Fully-Automated

3. **No double-counting of a Maya-funded top-up.** A settled Maya payment that produced a
   mirrored `credit_ledger` `topup` row (linked via the shared external-transaction id) appears
   as exactly ONE row in the unified list — the Maya payment row — not two.
   - proven by: negative-control unit test (per the project's negative-control testing pattern):
     seed a Maya payment + its mirrored topup row sharing an external-transaction id, assert the
     unified query returns exactly one row for that id; then break the dedupe condition and
     confirm the test fails for the expected reason (two rows), before restoring it.
   - strategy: Fully-Automated

4. **Standalone credit/points loads still show.** A credit-ledger `topup` row with NO linked
   external-transaction id (e.g. manual/promo grant) appears in the unified list as its own row,
   labeled as a standalone load — it is never silently dropped by the dedupe logic.
   - proven by: unit test seeding a topup row with a null external-transaction id, asserting it
     is present and correctly labeled in the merged result.
   - strategy: Fully-Automated

5. **Period filter applies to every row type.** Changing the Finance page's date-range filter
   narrows Maya payments, credit events, points events, and free-time grants uniformly — no row
   type ignores the filter.
   - proven by: unit test on the unified query asserting a narrow date range excludes
     out-of-range rows across all six event kinds, not just Maya payments.
   - strategy: Fully-Automated

6. **AP attribution shown per row.** Every row displays the durable AP circuit label (current
   friendly name, "AP #<id>" fallback, raw circuit-id if pruned, or "Unattributed") using the
   existing shared label-resolution logic — unchanged from today's behavior on both the Maya
   table and the grant-attribution section.
   - proven by: existing/extended unit test coverage on the label resolver already in
     `queries.spec.ts`, re-asserted against the unified row shape.
   - strategy: Fully-Automated

7. **KPIs and revenue math are unaffected.** The Finance page's KPI cards, per-AP revenue
   breakdown, revenue-by-period, and payment-method breakdown continue to read from
   Maya-payments-only sources and produce identical numbers before and after this change.
   - proven by: existing KPI unit tests re-run unchanged and passing; explicit assertion that no
     KPI query was modified to include ledger/session data.
   - strategy: Fully-Automated

8. **Existing single-source behaviors are preserved.** Status badges (Maya only), receipt
   numbers (Maya only), and buyer-email display (Maya only) continue to render correctly for
   Maya rows in the unified list; non-Maya rows correctly show these fields as not-applicable
   rather than blank/misleading.
   - proven by: unit test on row mapping asserting Maya-specific fields are populated only for
     Maya-sourced rows and are explicitly null/n-a for other kinds.
   - strategy: Fully-Automated

## Out Of Scope

- Any change to Finance KPI math, `revenueByAp`, `revenueByPeriod`, or
  `paymentMethodBreakdown` — these remain Maya-only per the locked decision.
- Fixing the pre-existing `?period=` timezone bug (upper-bound `new Date()` vs no-tz
  `timestamp` columns hiding same-day recent rows) — this is an inherited, documented
  constraint, not something this feature introduces or is responsible for fixing.
- Any schema change or migration — all needed columns (`ap_circuit_id`, `external_transaction_id`
  on both `payment_transactions` and `credit_ledger`/`points_ledger`) already exist.
- Making the client-supplied AP attribution "server-authoritative" beyond its current durable
  label-resolution behavior.
- The public locator app or any customer-facing surface — this is admin-only.
- Any change to how a purchase/grant is created or recorded (`addCreditsTx`, `earnPointsTx`,
  `reconcilePayments.ts`, free-time grant logic) — this feature only changes what staff SEE, not
  how events are written.
- CSV export scope — whether `finance/export` should also unify is an open question routed to
  INNOVATE (see below), not decided here.

## Constraints

- **Read-only, display-only feature.** No writes to `payment_transactions`, `credit_ledger`,
  `points_ledger`, or `network_sessions`. Risk class: LOW.
- **No double-counting.** A Maya payment and its mirrored credit topup must never both appear as
  separate rows representing the same money — this is a hard functional requirement, not a nice
  to have (see Acceptance Criteria 3).
- **Must build on already-shipped AP attribution work.** All relevant tables already carry
  `ap_circuit_id`; the existing `apCircuitLabelOf` / `resolveApCircuitLabels` label-resolution
  helpers in `apps/admin/src/lib/server/queries.ts` must be reused, not reimplemented.
- **Inherited known-gap:** the `?period=` upper-bound timezone issue (documented in
  `process/context/all-context.md`) is a pre-existing constraint on this data. The unified list
  inherits it; INNOVATE should note whether the unified default period choice makes this more or
  less visible to staff, but fixing it is out of scope.
- **Existing UI/design system conventions apply** — reuse `apps/admin/src/lib/components/ui/`
  primitives (per `process/context/uxui/all-uxui.md`), don't introduce new visual patterns for
  this table.
- **Test coverage:** every acceptance criterion must be provable by an automated unit/integration
  test (per repo convention — Vitest server-project tests, no new e2e spec required unless
  INNOVATE decides UI behavior needs one). No acceptance criterion here relies on a live
  external provider or is otherwise infeasible to automate.

## Open Questions

All of the following are explicitly deferred to INNOVATE as open forks — they are product-facing
enough to flag here, but resolving them requires weighing implementation tradeoffs, so they are
NOT blocking SPEC completion:

1. **Column/row model shape.** Should the unified row use one superset row type covering all
   nullable source-specific fields (status, receipt, buyer email, package name), or a
   discriminated union with a shared "core" shape plus per-kind detail? — Owner: INNOVATE.
2. **Pagination approach.** A single SQL `UNION ALL` query (true DB-level pagination + one
   accurate `total`) vs. generalizing today's app-side 3-way merge to all six sources (simpler
   code, but each source independently capped, risking pagination starvation on page 2+)? —
   Owner: INNOVATE.
3. **CSV export scope.** Should `finance/export` (`apps/admin/src/routes/(app)/finance/export/`)
   also become unified, or stay Maya-only for now? — Owner: INNOVATE (recommend: flag as
   follow-up if out of budget for this pass).
4. **Points-earn display treatment.** Points earned as a side effect of a Maya payment (same
   `externalTransactionId`) — show as an annotation/badge on the originating payment row, a
   collapsed/expandable sub-row, or omit from the default view with a way to drill in? — Owner:
   INNOVATE. (Do not display it as an independent purchase event — that would misrepresent a
   points-earning event as new inbound money.)

These are deferred, not unresolved-blocking — none of them prevent PLAN from starting once
INNOVATE picks a direction. `## Open Questions` is otherwise empty of blocking product-intent
gaps.

## Background / Research Findings

- **Current split implementation:** `listTransactions` (`apps/admin/src/lib/server/queries.ts:711`)
  is a paginated SQL query, Maya-only (`payment_transactions`), respects `?period=` via
  `rangeWhere`. `listRecentGrantAttribution` (`queries.ts:787`) is an app-side merge of three
  separate queries (credit spends, points spends, free-time grants — `packageId IS NULL`
  sessions), capped at `limit` (default 50) total, with NO pagination/total and NO period filter
  applied today.
- **Confirmed double-write (the crux of AC3):** every settled Maya payment writes BOTH a
  `payment_transactions` row AND a mirrored `credit_ledger` row with `type: LEDGER_TYPE.topup`
  (`packages/core/src/services/reconcilePayments.ts:290-296`, inside `addCreditsTx`), sharing the
  same `externalTransactionId` value the payment was settled with
  (`packages/core/src/services/reconcilePayments.ts:295`). Both `payment_transactions` and
  `credit_ledger` have a unique `external_transaction_id` text column
  (`packages/db/src/schema/customer.ts`) — this is the confirmed dedupe join key.
- **Confirmed points-earn is also a payment side effect:** in the same transaction, every
  qualifying settled Maya payment also calls `earnPointsTx` with the SAME
  `externalTransactionId` (`reconcilePayments.ts:298-310`) — `points_ledger` also has a unique
  `external_transaction_id` column. Points-earn rows are not shown anywhere in the admin UI
  today (`listRecentGrantAttribution` only queries `points_ledger` where `type = 'spend'`).
- **Row shape heterogeneity:** `TransactionRow` (Maya) carries `status`/`statusTone`/`receiptNo`/
  `buyerEmail`/`fundSourceType`/`packageName`; `GrantAttributionRow` (credit/points/free-time)
  carries only `kind`/`who`/`detail`/`apCircuitLabel`/`createdAt` — no status (grants always
  succeed), no receipt, and credit/points spends don't currently surface `packageName`.
  (`apps/admin/src/lib/types.ts:239-276`.)
- **AP attribution already solved:** `apCircuitId` exists on `payment_transactions`,
  `credit_ledger`, `points_ledger`, and `network_sessions`; the shared
  `resolveApCircuitLabels`/`apCircuitLabelOf` helpers (used by both current queries) already
  produce a durable label. This feature reuses that machinery as-is.
- **Period-filter gap:** `listTransactions` applies `rangeWhere(opts)`; `listRecentGrantAttribution`
  ignores period entirely. The unified list must close this gap (AC5) since all four source
  tables carry a usable timestamp (`createdAt`/`startedAt`).
- **Pre-existing timezone bug (inherited, documented in `all-context.md`):** the `?period=` upper
  bound (`new Date()`) compared against no-timezone `timestamp` columns can hide same-day recent
  rows; `?period=all` sidesteps it. Not caused by, or fixed by, this feature.
- **Consumers:** `finance/export/+server.ts` (CSV export, pageSize 10,000) currently calls
  `listTransactions` only (Maya rows) — flagged as Open Question 3 for INNOVATE.
- **Test coverage baseline:** `queries.spec.ts` covers `listRecentGrantAttribution` label/fallback
  behavior but has no existing negative-control test proving topup/earn rows are excluded or
  deduped — this SPEC requires that negative control be added (AC3), per the project's
  negative-control testing convention (`feedback_negative-control-pattern.md`): break the dedupe
  condition, confirm the test fails for the expected reason, then restore it.
- **User's explicit product intent (this session):** show ALL activity types including
  wallet-load events (top-ups), not just access-granting events, because staff need visibility
  into money loads as well as spends — but this must never come at the cost of double-counting
  the same settled payment.
