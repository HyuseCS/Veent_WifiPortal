---
name: plan:purchase-ap-attribution-spec
description: "Record which AP a customer purchase/grant happened through, durably, for staff review"
date: 21-07-26
feature: general-plans
---

# SPEC — Purchase / Grant AP Attribution

## Summary

Right now, when a guest buys WiFi time or claims free time, the system does not durably
record *which access point (AP)* they were connected through at the moment of that
purchase or grant. Staff cannot answer "how much revenue came through AP-Pabayo?" or
"who got free time on AP-3 last week?" — that information either doesn't exist, exists
only in a place that gets pruned, or exists but isn't shown anywhere. This feature makes
every purchase and every free-time grant carry a permanent, correctly-labeled record of
the AP it happened on, and surfaces that in the admin dashboard so staff can review it —
today and months from now, even after the AP itself has been renamed or removed from the
system.

## User Stories / Jobs To Be Done

- **As** an operations staff member, **I want** to see which AP a Maya top-up, a
  credit/points tier purchase, or a free-time grant happened through, **so that** I can
  understand revenue and usage per site/AP and make decisions about where to invest in
  network improvements.
- **As** an operations staff member, **I want** the AP label on old purchase/grant
  records to stay correct and readable **even after that AP has been renamed or removed
  from the system**, **so that** historical reports remain trustworthy months or years
  later.
- **As** an operations staff member, **I want** free-time grants to carry AP attribution
  just like paid purchases, **so that** I have one consistent picture of "who used which
  AP" instead of a picture with a free-time-shaped hole in it.
- **When** a guest's AP cannot be determined at purchase/grant time (e.g. the signal is
  missing or ambiguous), **I want to** see that record clearly marked as "unattributed"
  rather than silently blank or wrong, **so I can** trust that what IS labeled is
  accurate.

## What The User Wants (Behavioral Outcomes)

- Every successful Maya top-up, every credit/points-funded tier purchase, and every
  free-time grant results in a record that durably identifies the AP the guest was
  connected through — or explicitly records "unattributed" when it truly could not be
  determined.
- That AP identity does not degrade over time: if the AP is later renamed, or removed
  from the system entirely (a stale/decommissioned AP gets pruned), the record still
  shows a correct, human-readable label — either the AP's current friendly name (if it
  still exists) or the original raw identifier the AP was known by at the time of the
  purchase/grant (if it no longer exists).
- AP attribution is best-effort context for staff review, never a gate on the purchase or
  grant itself. A guest's payment succeeding, or their free-time claim succeeding, must
  never be blocked, delayed, or rolled back because AP information couldn't be resolved.
- Staff can see AP attribution for purchases/grants in the admin dashboard (existing
  Finance area and/or Users area) without needing to cross-reference logs or ask an
  engineer.
- The behavior for Maya top-ups (which already show a per-AP revenue breakdown in admin
  Finance today) is preserved and folded into the same durable-labeling approach, so all
  three purchase/grant paths behave consistently going forward.

## Flow / State Diagram

```
Guest action                 AP identity signal              Durable record written
────────────────────────────────────────────────────────────────────────────────────
Maya top-up          →  circuit-id resolved at checkout  →  payment_checkouts /
                          (existing 5-fallback resolver)      payment_transactions
                                                               carries durable AP fact
                                                               (already partially works
                                                                via network_health.id;
                                                                needs durable-string
                                                                upgrade)

Credit/points tier    →  circuit-id resolved at buy time  →  credit_ledger /
buy ("buyTier")           (today: none — resolved only        points_ledger row
                           post-hoc onto network_sessions,     needs durable AP fact
                           async, best-effort)                 (currently MISSING)

Free-time grant        →  circuit-id resolved at claim     →  no ledger row exists;
("startFreeAccess...")     time (today: same post-hoc,         the network_sessions
                            async, best-effort pattern as       row for this grant
                            paid tier buy)                      needs the durable AP
                                                                 fact attached
                                                                 (currently: network_
                                                                 health.id only, no
                                                                 durable string, and
                                                                 not surfaced to staff)

                     ┌─────────────────────────────────────────────────────┐
                     │  At READ time (admin dashboard):                    │
                     │  durable circuit-id string                         │
                     │     │                                               │
                     │     ├─ AP still exists (network_health.apCircuitId │
                     │     │  match found) → show friendly AP name        │
                     │     │                                               │
                     │     └─ AP no longer exists / no match → show the   │
                     │        raw circuit-id string as-is                 │
                     │                                                     │
                     │  AP could not be resolved at purchase/grant time   │
                     │     → show "Unattributed"                          │
                     └─────────────────────────────────────────────────────┘
```

State of a purchase/grant record's AP field (conceptual):

```
   [created]
       │
       ▼
 resolve AP (best-effort, never blocks the transaction)
       │
   ┌───┴────┐
   ▼        ▼
resolved   unresolved
   │            │
   ▼            ▼
durable      "Unattributed"
circuit-id      (permanent state —
string          never retried)
stored
(permanent —
 never changes,
 even if the AP
 is renamed/
 removed later)
```

## Acceptance Criteria (Testable Outcomes)

1. **Maya top-up carries a durable AP fact.** A successful Maya payment (checkout →
   webhook → `payment_transactions` row) durably records the AP identity in a form that
   survives that AP being renamed or removed later — not only a reference that breaks
   when the AP row is pruned.
   `proven by:` unit test on the checkout/webhook AP-resolution + persistence path
   (extends the existing pattern covered by
   `apps/customer/src/lib/server/record-payment.spec.ts` and the checkout
   `network-location.ts` resolver tests).
   `strategy:` Fully-Automated.

2. **Credit/points tier purchase carries a durable AP fact.** A tier bought with credits
   or points results in a `credit_ledger` / `points_ledger` entry (or an equally
   queryable durable record tied 1:1 to that purchase) that durably records the AP
   identity at time of purchase, or explicit "unattributed" if none could be resolved.
   `proven by:` new unit test(s) covering `buyTier` / `spendCreditsTx` / `spendPointsTx`
   AP-capture behavior in `packages/core/src/services/{sessions,credits,points}.ts`.
   `strategy:` Fully-Automated.

3. **Free-time grant carries a durable AP fact.** A free-time claim
   (`startFreeAccessAndBindDevice`) results in a durable, queryable record of the AP
   identity at time of grant — even though no money moves and no ledger row exists
   today for free time.
   `proven by:` new unit test covering the free-access grant path in
   `packages/core/src/services/sessions.ts`.
   `strategy:` Fully-Automated.

4. **AP identity survives AP rename.** When the AP a past purchase/grant references is
   later renamed in `network_health`, the historical record's displayed label updates to
   the AP's new friendly name (because the join key — the raw circuit-id string — did not
   change).
   `proven by:` unit test asserting the read-time label-resolution function returns the
   *current* friendly name after a simulated rename, using the same durable circuit-id.
   `strategy:` Fully-Automated.

5. **AP identity survives AP removal/pruning.** When the AP a past purchase/grant
   references is later removed from `network_health` entirely (pruned/reseeded by the
   health sweep), the historical record still displays a correct, human-readable label —
   falling back to the originally-stored raw circuit-id string rather than becoming blank,
   erroring, or showing a meaningless numeric id.
   `proven by:` unit test simulating AP-row deletion and asserting the fallback label
   renders the stored circuit-id string.
   `strategy:` Fully-Automated.

6. **AP resolution never blocks or fails a purchase/grant.** When AP resolution fails,
   times out, or returns nothing, the underlying payment, tier purchase, or free-time
   grant still completes successfully, with the record marked unattributed.
   `proven by:` unit test that forces AP resolution to fail/throw and asserts the
   purchase/grant transaction still commits and the guest is not blocked — extending the
   existing atomicity coverage pattern in
   `apps/customer/src/lib/server/grant-atomic.spec.ts`.
   `strategy:` Fully-Automated.

7. **Staff can see AP attribution in the admin dashboard.** Purchase/grant history in the
   admin dashboard (Finance transactions and/or the relevant Users detail view) displays
   the resolved AP label (friendly name, fallback raw circuit-id string, or
   "Unattributed") for Maya top-ups, credit/points tier buys, and free-time grants alike.
   `proven by:` unit test on the admin query/mapper layer (`apps/admin/src/lib/server/
   queries.ts` or equivalent) asserting the AP label appears correctly for all three
   purchase/grant types; Agent-Probe visual confirmation of the rendered admin page.
   `strategy:` Hybrid.

8. **No behavior change to existing Maya per-AP Finance breakdown.** The existing admin
   Finance "payments by AP" breakdown (which already groups `payment_transactions` by AP)
   continues to work at least as well as it does today after the durable-storage change —
   no regression in the numbers shown.
   `proven by:` existing/extended test coverage on
   `apps/admin/src/lib/server/queries.ts` payment-breakdown function.
   `strategy:` Fully-Automated.

## Out Of Scope

- **Per-AP live traffic/bandwidth reporting** — a separate, already-parked feature
  (distinct from purchase/grant attribution). Not touched here.
- **The locator app** (`apps/locator/`) — no changes.
- **Any change to MikroTik/RouterOS configuration, auth, or the underlying AP-detection
  mechanism** (DHCP Option 82 / circuit-id capture itself). This feature only records and
  displays what the existing AP-detection machinery already resolves.
- **Retroactively backfilling AP identity for purchases/grants that happened BEFORE this
  feature ships.** Old records without an AP fact stay "Unattributed" — no historical
  reconstruction attempt.
- **Making AP attribution authoritative or security-relevant in any way.** It remains
  best-effort/advisory data for staff reporting, never used to gate access, pricing, or
  fraud decisions.
- **Phase B (Fatap AP API)** attribution source — this feature works with whatever AP
  identity signal (circuit-id) is available today; it is not tied to a specific future
  attribution source.

## Constraints

- **Billing/grant atomicity is non-negotiable.** AP resolution must never happen inside
  the same DB transaction as a money-moving or access-granting operation in a way that
  could fail or roll back that operation. This mirrors the existing "money math and grant
  atomicity are high-risk, treat with rigor" project rule.
- **Durable storage, not a live reference.** The AP identity fact must be stored as the
  raw circuit-id STRING (an immutable fact), not solely as a `network_health.id`
  reference — because `network_health` rows are pruned/reseeded by the health sweep and a
  reference-only design would silently degrade historical labels (this is the explicit,
  already-locked product decision).
- **Free time is in scope despite writing no ledger row today.** The SPEC must be
  satisfied even though free-time grants currently have no `credit_ledger`/
  `points_ledger`-equivalent entry — some durable record tied to the grant (most likely
  `network_sessions` or an equivalent) must carry the AP fact.
- **`?mac=` / AP signals remain client-influenceable, not server-authoritative.** Per the
  existing MAC-trust residual finding, AP attribution derived from these signals is
  advisory only — never treat it as tamper-proof.
- **Migration discipline.** Any new schema (new column(s) on `credit_ledger`,
  `points_ledger`, `network_sessions`, and/or elsewhere) is migration #50 (current count:
  49), generated via `packages/db/drizzle.config.ts` and applied via direct DDL against
  the push-managed dev DB (not `db:push`), per the existing migration-chain-drift gotcha.
- **No cross-app boundary violations.** Customer-side capture and admin-side display
  communicate only through `@veent/db` / `@veent/core`, per the existing no-direct-import
  cross-app rule.

## Open Questions

None — the two product decisions that would otherwise be open (free-time scope; durable
string vs. live reference) are already locked by the user. The exact table(s)/column(s)
used to carry the durable circuit-id string for the credit/points tier-buy and free-time
paths, and whether `buyTier` resolves AP synchronously (like Maya) or keeps the async
post-hoc pattern, are intentionally left to INNOVATE/PLAN — these are implementation
mechanism choices, not open product-intent questions.

## Background / Research Findings

- **AP identity signal (confirmed live on-site 21-07-26):** the DHCP-lease
  `agent-circuit-id` / PON port (e.g. `"OLT-9 xpon 0/1/0/4"` = AP-Pabayo) is the join key.
  `network_health.apCircuitId` (`packages/db/src/schema/admin.ts:166`) already stores this
  for live AP rows; `network_client_attribution` (`admin.ts:221-225`) already caches
  last-known circuit-id per client MAC to tolerate DHCP renewal gaps.
- **Maya top-ups already resolve and stamp AP at initiation:**
  `payment_checkouts.networkId` (`packages/db/src/schema/customer.ts:238`) set by
  `resolveCheckoutNetworkId()` (`apps/customer/src/lib/server/network-location.ts`,
  5-fallback chain: portal `ap` param → device MAC→AP → active session AP → account
  last-known AP → dev seed), copied onto `payment_transactions.networkId`
  (`customer.ts:189`) at webhook time. **However this is a live `network_health.id`
  reference, not the durable string the user has asked for** — it degrades on AP
  prune today (existing fallback in admin renders `AP #<id>` for a pruned AP, not the
  original name).
- **Admin Finance ALREADY has a per-AP payment breakdown** —
  `apps/admin/src/lib/server/queries.ts:649-742` groups `payment_transactions` by
  `networkId`, joins `network_health`, and falls back to `AP #<id>` when the AP row no
  longer exists. This is the closest existing analog to acceptance criterion 7/8 and the
  main precedent to extend/preserve, not replace.
- **The gaps this SPEC closes:**
  - `credit_ledger` / `points_ledger` (`packages/db/src/schema/customer.ts` ~107-154)
    have NO AP column at all.
  - Credit/points-funded tier buys and free-time grants both stamp AP only on
    `network_sessions.networkId`, and only **post-hoc, asynchronously, best-effort** —
    confirmed in `packages/core/src/services/sessions.ts`: `bindMacTx` (line 56) commits
    the transaction, then `afterBind` (line 188) runs `resolveNetworkIdForMac` (line 273)
    and updates `network_sessions.networkId` (line 275) *after* the transaction has
    already committed. `startPaidAccessAndBindDevice` (line 329) and
    `startFreeAccessAndBindDevice` (line 685) both go through this same path. This is a
    live `network_health.id` reference, not a durable string, and it is never surfaced to
    admin (Finance/Users queries select no networkId from ledger tables today because
    there is nothing to select).
- **Atomicity precedent already exists** in `apps/customer/src/lib/server/
  grant-atomic.spec.ts` and the money-critical single-`db.transaction` pattern — any new
  AP-capture logic must fit inside or alongside this without becoming a point of failure
  for the transaction itself.
- **Migration count is 49** (newest: `0048_lying_firedrake.sql`); a new column is
  migration 50, applied via direct DDL per the push-managed-dev-DB gotcha (not
  `db:push`), matching how `network_health.apCircuitId` itself was added in Phase A.
- **Test-context grounding (`process/context/tests/all-tests.md`):** the repo's
  Fully-Automated strategy for this surface is Vitest server-project unit tests
  (`packages/core`, `apps/customer/src/lib/server`, `apps/admin/src/lib/server`) using
  `bunx vitest run <file>` (never bare `bun test <file>` — fake-timer gotcha). No
  Playwright e2e specs exist yet for Finance/Users; a Hybrid strategy (unit test on the
  query/mapper layer + Agent-Probe visual confirmation) is the appropriate proof for the
  admin-display acceptance criterion given the current harness maturity.
