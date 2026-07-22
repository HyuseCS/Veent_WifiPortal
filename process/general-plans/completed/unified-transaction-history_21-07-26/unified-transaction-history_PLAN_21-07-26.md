---
name: plan:unified-transaction-history
description: "Replace Finance's split payments table + grant-attribution section with one merged, deduped, chronological activity list (admin-only, display-only)"
date: 21-07-26
feature: general
status: active
complexity: SIMPLE
---

# PLAN — Unified Transaction / Activity History (Admin Finance)

**Complexity**: SIMPLE (single-session, one plan artifact, no phase program). Risk class: **LOW**
(read-only display change, no schema/migration/billing writes) — no risk-evidence pack required.

**Date**: 21-07-26
**Status**: active

**SPEC:** `process/general-plans/active/unified-transaction-history_21-07-26/unified-transaction-history_SPEC_21-07-26.md`
**Locked INNOVATE decision:** app-side merge (generalizing the existing `listRecentGrantAttribution`
pattern) across 5 sources into one superset row type, feeding a new `listUnifiedTransactions`
function that **supersedes and retires** `listRecentGrantAttribution`. `listTransactions` and all
KPI/breakdown queries (`financeKpis`, `revenueByAp`, `revenueByPeriod`, `paymentMethodBreakdown`)
stay untouched and Maya-only (AC7). CSV export gains an opt-in `?scope=unified` toggle, default
stays `maya` (unchanged CSV behavior).

---

## Overview

Today `apps/admin/src/routes/(app)/finance/transactions/+page.server.ts` loads two independent
query results — `listTransactions` (paginated Maya `payment_transactions`, `TransactionRow[]`) and
`listRecentGrantAttribution` (an app-side `Promise.all` merge of credit spends + points spends +
free-time grants, capped at `limit`, no period filter, `GrantAttributionRow[]`) — and the page
renders them as two disconnected UI blocks (a `<TransactionsTable>` plus a collapsed `<details>`
grant-attribution table). This plan replaces that split with **one new query function,
`listUnifiedTransactions`**, that merges Maya payments + standalone credit top-ups + credit spends
+ points spends + free-time grants into a single superset-row list, applies the period filter
uniformly, dedupes Maya-mirrored top-ups by the shared payment-id join key, and annotates
points-earn as a badge on the originating Maya row (never a standalone row). The page collapses to
one table. CSV export gains a `?scope=unified|maya` toggle (default unchanged).

## Goals

- One chronological, deduped activity list replacing the current 2-block Finance transactions UI.
- Zero change to KPI/revenue math (AC7 stays Maya-only, untouched).
- Zero schema/migration change — all needed columns already exist.
- Full automated test coverage for every SPEC acceptance criterion (AC1–AC8), including a
  negative-control dedupe test.

## Scope

In scope: `listUnifiedTransactions` (new), retiring `listRecentGrantAttribution`, the superset row
type, the Finance transactions page + table component, the CSV export scope toggle.

Out of scope (verbatim from SPEC): KPI/revenue-by-AP/revenue-by-period/payment-method-breakdown
math; the inherited `?period=` timezone bug; any schema/migration; making AP attribution
"server-authoritative"; the locator/customer apps; any change to how a purchase/grant is *written*
(`addCreditsTx`, `earnPointsTx`, `reconcilePayments.ts`, free-time grant logic).

---

## Touchpoints

| File | Change |
|---|---|
| `apps/admin/src/lib/server/queries.ts` | Add `listUnifiedTransactions` (new function, placed after `listRecentGrantAttribution`, ~line 866). Delete `listRecentGrantAttribution` (lines 780-866) — fully superseded, zero other consumers (confirmed by VALIDATE: `grep -rn "import.*queries['\"]"` across `apps/admin/src` shows exactly one non-spec consumer, `+page.server.ts`). Reuse `resolveApCircuitLabels`/`apCircuitLabelOf` (lines 49-67) and `peso` (line 68) AS-IS — these are already generic (take a circuit-id array / a number), no changes needed. Do **NOT** literally call the existing `rangeWhere` (line 572) for the 4 non-Maya source queries — see "Range predicate — do not literally reuse `rangeWhere()`" below (VALIDATE finding, corrected here). Do NOT touch `listTransactions` (lines 711-778) or any KPI/breakdown function (598-708). |
| `apps/admin/src/lib/types.ts` | Replace `TransactionRow` (lines 239-261) + `GrantAttributionRow` (lines 265-276) with one superset `UnifiedTransactionRow` interface. Keep `ApRevenueSlice`/`Kpi`/`PaymentMethodSlice`/`RevenuePoint` untouched. |
| `apps/admin/src/routes/(app)/finance/transactions/+page.server.ts` | Replace the `listTransactions` + `listRecentGrantAttribution` dual-load with one `listUnifiedTransactions(db, { from, to, page: 1, pageSize: 50 })` call. |
| `apps/admin/src/routes/(app)/finance/transactions/+page.svelte` | Remove the `<details>` grant-attribution block; render one `<TransactionsTable>` over the unified rows. |
| `apps/admin/src/lib/components/feature/TransactionsTable.svelte` | Render the superset row shape: existing Maya columns (status/method/receipt) show `n/a` for non-Maya rows; add a `Kind` column/label; render `pointsEarned` as a small badge in the Amount cell when present. **Null-safety requirement (VALIDATE finding):** the current sort comparators (`amountNum(a.amount)`, `a.fundSourceType.localeCompare(...)`, `toneRank[a.statusTone]`, `a.buyerName.localeCompare(...)`) and the search filter all assume non-null strings — in `UnifiedTransactionRow`, `amount`/`status`/`statusTone`/`fundSourceType` are `null` on non-Maya-money kinds (points-spend, free-time, credit-spend/topup rows have `amount` money-formatted but `status`/`statusTone`/`fundSourceType` null). Every comparator and the search-filter template string MUST null-guard (e.g. `a.amount ? amountNum(a.amount) : 0`, `(a.fundSourceType ?? '').localeCompare(...)`, `a.statusTone ? toneRank[a.statusTone] : -1`) — an unguarded `.localeCompare`/array-index on `null` throws and crashes the Finance page's clickable-header sort, which is browser-visible and would break AC1/AC2 rendering. Also rename `buyerName` references to `who` (the unified row's field name) throughout the component. |
| `apps/admin/src/routes/(app)/finance/export/+server.ts` | Add `?scope=unified|maya` (default `maya`, validated against the 2-value allowlist — same defensive pattern as `parsePeriod`). `scope=unified` calls `listUnifiedTransactions`; add a `Kind` CSV column; Maya-only columns render `''` for non-Maya rows. |
| `apps/admin/src/routes/(app)/finance/transactions/+page.svelte` (or a shared Finance header control) | Add a `ui/Select` (or toggle) next to the existing Export link, wired to `?scope=`. |
| `apps/admin/src/lib/server/queries.spec.ts` | Delete the 2 existing `listRecentGrantAttribution` tests (lines 39-75) — migrate their attribution-label assertions into new `listUnifiedTransactions` tests. Add new tests for AC1–AC5, AC8, and the AC3 negative-control dedupe test. |

## Public Contracts

- **New exported function:** `listUnifiedTransactions(db: DB, opts: DateRange & { page?: number; pageSize?: number }): Promise<{ rows: UnifiedTransactionRow[]; total: number }>` — page-1-only supported (both callers hard-code `page: 1`); this is a documented limitation, not a bug (see Known Limitations below).
- **Retired exported function:** `listRecentGrantAttribution` — deleted. Confirmed (via `grep -rn "listRecentGrantAttribution"` and, independently at VALIDATE, `grep -rn "import.*queries['\"]"`) the only consumers are `+page.server.ts` and `queries.spec.ts`, both updated by this plan.
- **New type:** `UnifiedTransactionRow` (replaces `TransactionRow` + `GrantAttributionRow` in `$lib/types`) — superset shape, per-kind fields nullable. Confirmed at VALIDATE: the two retired types have exactly 3 consumers total (`types.ts`, `queries.ts`, `TransactionsTable.svelte`), all covered by this plan's touchpoints.
- **New CSV param:** `?scope=unified|maya` on `GET /finance/export` — additive, backward compatible (omitting it preserves today's exact Maya-only CSV).
- **Unchanged:** `listTransactions`, `financeKpis`, `revenueByAp`, `revenueByPeriod`, `paymentMethodBreakdown` — signatures and behavior untouched (AC7). Confirmed at VALIDATE by direct read of `queries.ts:598-778`: none of these four KPI/breakdown functions reference `creditLedger`/`pointsLedger`/`networkSessions` — all are `paymentTransactions`-only.

## Blast Radius

- **Packages touched:** `apps/admin` only (single app). No `@veent/core`, no `@veent/db`, no `apps/customer`, no `apps/locator`.
- **Files touched:** 7 (queries.ts, types.ts, +page.server.ts, +page.svelte, TransactionsTable.svelte, export/+server.ts, queries.spec.ts).
- **No new dependency.** No new route. No schema/migration. Risk class: LOW.
- **Browser-visible:** yes — the Finance transactions page UI changes materially (Hybrid tier, needs an agent browser pass + human verification handoff before this can be called done).

---

## Locked Design Detail (from INNOVATE — do not re-decide during EXECUTE)

### Row model (`UnifiedTransactionRow`)

One superset interface, replacing both `TransactionRow` and `GrantAttributionRow`:

```
kind: 'maya-payment' | 'credit-topup' | 'credit-spend' | 'points-spend' | 'free-time'
id: string                      // stable per-row key
createdAt: string               // ISO
who: string                     // buyer/guest display name, '—' if none
apCircuitLabel: string          // via existing resolveApCircuitLabels/apCircuitLabelOf
amount: string | null           // pre-formatted peso string for money kinds, null for points/free-time
detail: string                  // human-readable amount/points/description per kind
pointsEarned?: number           // badge value, ONLY set on maya-payment rows with a matching earn row
// Maya-only fields — populated ONLY on kind: 'maya-payment', otherwise explicitly null (never blank):
status: string | null
statusTone: StatusTone | null
receiptNo: string | null
buyerEmail: string | null
fundSourceType: string | null
fundSourceMasked: string | null
packageName: string | null
```

Non-Maya rows MUST set every Maya-only field to `null` explicitly (not omitted) — AC8 requires
"not-applicable rather than blank/misleading" rendering; the UI renders `null` as `n/a`, never
blank.

### Source queries + merge algorithm

Five parallel queries via `Promise.all`, each capped at `pageSize`, newest-first, each applying the
SAME range-filter *style* (see the range-predicate note directly below — do not literally call
`rangeWhere()` outside the Maya query):

1. **Maya payments** — reuse the existing `paymentTransactions` query shape from `listTransactions`
   (status/receipt/buyerEmail/packageName/fundSource included), `WHERE user_id IS NOT NULL AND
   [range]` (this is the one source that DOES call the existing `rangeWhere()` as-is — it's already
   `paymentTransactions`-shaped), `ORDER BY created_at DESC LIMIT pageSize`.
2. **Standalone credit top-ups** — `creditLedger WHERE type = LEDGER_TYPE.topup AND [range] AND NOT
   EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.id =
   credit_ledger.external_transaction_id)` — the anti-join is the AC3 dedupe, join key confirmed at
   VALIDATE (see "Dedupe verification note" below — this predicate is now CONFIRMED, not just
   flagged). A `topup` row with `external_transaction_id IS NULL` always passes the `NOT EXISTS` (no
   match) → always shown (AC4).
3. **Credit spends** — `creditLedger WHERE type = LEDGER_TYPE.spend AND [range]` (same as
   today's `listRecentGrantAttribution` credits leg).
4. **Points spends** — `pointsLedger WHERE type = 'spend' AND [range]` (same as today).
5. **Free-time grants** — `networkSessions WHERE package_id IS NULL AND [range]` (same as today,
   using `startedAt` as the range column — same as `listRecentGrantAttribution`).

**Range predicate — do not literally reuse `rangeWhere()` (VALIDATE finding, corrected here):**
`rangeWhere(range: DateRange): SQL[]` (`queries.ts:572`) is NOT a generic helper — it hardcodes
`paymentTransactions.userId`/`paymentTransactions.createdAt` and bakes in the Maya-specific
"attributed transactions only" business rule (`isNotNull(paymentTransactions.userId)`). Calling
`rangeWhere(opts)` verbatim against a `creditLedger`/`pointsLedger`/`networkSessions` select would
build a WHERE clause referencing `payment_transactions` columns that aren't in that query's
FROM/JOIN — this fails at query-build/type-check time, not silently. Sources 2–5 above MUST use
their OWN inline range condition against their own timestamp column (e.g. `gte(creditLedger.createdAt,
range.from)`, `lte(networkSessions.startedAt, range.to)`) — a small per-column condition array, not
a call to `rangeWhere()`. `rangeWhere()` itself stays byte-for-byte unchanged (still used by
`listTransactions`/`financeKpis`/`revenueByPeriod`/`paymentMethodBreakdown`/`revenueByAp`, none of
which this plan touches — AC7).

Merge: concatenate all 5 result arrays → map each row to `UnifiedTransactionRow` (kind label +
per-source field mapping) → sort `createdAt` desc → `.slice(0, pageSize)`.

**Total count** — `Promise.all` of 5 `count(*)` queries (one per source, same predicate as its
list query, same `NOT EXISTS` dedupe on the topup count). Sum the 5 counts. Points-earn is NEVER
counted (badges are not rows).

### Points-earn badge

One extra query: `pointsLedger WHERE type = 'earn' AND external_transaction_id IS NOT NULL AND
[range]`, build `Map<externalTransactionId, number>`. After building the merged row list, for every
row with `kind === 'maya-payment'`, look up its `id` (the Maya payment id, i.e.
`payment_transactions.id` — CONFIRMED at VALIDATE against `reconcilePayments.ts:46` (`id:
evt.externalTransactionId` on insert) and `:295`/`:308` (`addCreditsTx`/`earnPointsTx` both called
with the SAME `args.externalTransactionId`), so `payment_transactions.id`,
`credit_ledger.external_transaction_id`, and `points_ledger.external_transaction_id` are always the
same value for one settled payment) against the map; if found, set `pointsEarned`. Points-earn rows
themselves NEVER appear as standalone rows in the merge.

**Known-gap (1-line, do not solve):** an `earn` row with a NULL `external_transaction_id` is
currently unreachable by the write path (`earnPointsTx` only fires inside a settled-payment
transaction, per SPEC Background) — if one ever existed, it would silently not surface as a badge.
Document in code comment; do not add handling for it.

### Dedupe verification note (AC3 — CONFIRMED at VALIDATE, read before writing the anti-join)

**Confirmed by direct read of `packages/db/src/schema/customer.ts` and
`packages/core/src/services/reconcilePayments.ts` during VALIDATE (21-07-26):**
`payment_transactions` has NO `external_transaction_id` column — its primary key `id` (text) IS the
Maya gateway's own transaction id ("Maya's tx id (payload.id)", schema comment at
`customer.ts:177`). `credit_ledger.external_transaction_id` (unique text, `customer.ts:123`) and
`points_ledger.external_transaction_id` (unique text, `customer.ts:157`) are both written from the
SAME value: `reconcilePayments.ts:46` inserts `payment_transactions.id = evt.externalTransactionId`;
`reconcilePayments.ts:290-296` calls `addCreditsTx({ ..., externalTransactionId:
args.externalTransactionId })` (same `evt.externalTransactionId`, threaded through
`claimAndCredit`/webhook and reconcile-poll call sites at `:392`/`:472`); `reconcilePayments.ts:304-310`
calls `earnPointsTx` with the identical value. **The exact anti-join predicate is:**
```sql
NOT EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.id = credit_ledger.external_transaction_id)
```
(join on `payment_transactions.id`, never a same-named column — `payment_transactions` has none).
This is now a confirmed fact, not an open verification item — EXECUTE implements it as specified
above without re-deriving it, though re-reading `reconcilePayments.ts:290-310` before writing the
query remains good practice per checklist step 1.

### CSV export scope toggle

- New URL param `scope`, validated `['unified', 'maya'].includes(scope) ? scope : 'maya'` (mirrors
  `parsePeriod`'s defensive-default pattern named in SPEC Constraints).
- `scope=maya` (default, or invalid value): existing behavior, byte-for-byte unchanged.
- `scope=unified`: calls `listUnifiedTransactions(db, { from, to, page: 1, pageSize: 10_000 })`,
  CSV header gains a leading `Kind` column; Maya-only columns (`Status`, `Fund Source`, `Masked`,
  `Receipt No`, `Email`, `Package`) render `''` for non-Maya rows via `?? ''`.
- UI: a `ui/Select` (2 options: "Maya payments" / "All activity") next to the existing `<a
  download>` Export link, updating the link's `?scope=` query param (no new route).

---

## Acceptance Criteria (mirrors SPEC AC1-AC8, testable)

1. All 6 activity kinds (Maya payment, standalone credit top-up, credit spend, points spend,
   free-time grant, points-earn badge) appear in one merged, chronologically sorted list.
2. Every row carries a non-empty, kind-appropriate type label, visibly rendered.
3. A Maya payment with a mirrored credit-ledger top-up (shared join key) renders as exactly ONE
   row — never two.
4. A standalone credit top-up (no linked payment) still renders as its own row.
5. The period filter narrows all 6 kinds uniformly, not just Maya rows.
6. AP circuit label (friendly name / raw fallback / "Unattributed") renders correctly per row via
   the existing shared resolver.
7. `financeKpis`, `revenueByAp`, `revenueByPeriod`, `paymentMethodBreakdown` are byte-for-byte
   unchanged (Maya-only, untouched by this plan).
8. Maya-only fields (`status`, `receiptNo`, `buyerEmail`, `fundSourceType`, `packageName`) are
   populated only on Maya rows and explicitly `null` (rendered `n/a`) elsewhere.

## Phase Completion Rules

This is a SIMPLE single-session plan (no phase program) — "done" means: all Implementation
Checklist items complete, all Verification Evidence gates green (checked inline per checklist
step 11, per repo convention of fixing failures before moving to the next section), the agent
browser pass for the Finance transactions page + CSV toggle completed and flagged for human
verification handoff, and `bun run check` clean. Do not mark this plan `VERIFIED` until the
human verification handoff for the browser-visible change (checklist step 12) is acknowledged —
code-complete is not the same as verified per repo convention (interactive/browser-only changes
need both an agent browser pass AND a human verification handoff).

## Implementation Checklist

1. **Confirm the AC3 join predicate** (`payment_transactions.id` vs `external_transaction_id`) by
   re-reading `packages/core/src/services/reconcilePayments.ts:290-310` and
   `packages/db/src/schema/customer.ts` credit_ledger/points_ledger/payment_transactions column
   definitions. **Already confirmed at VALIDATE (21-07-26) — see "Dedupe verification note" above.**
   Re-reading is a good sanity check but the predicate is locked: `NOT EXISTS (SELECT 1 FROM
   payment_transactions pt WHERE pt.id = credit_ledger.external_transaction_id)`.
2. Add `UnifiedTransactionRow` interface to `apps/admin/src/lib/types.ts`, replacing `TransactionRow`
   + `GrantAttributionRow`. Update the `import type {...} from '$lib/types'` list in `queries.ts`.
3. Write `listUnifiedTransactions(db, opts)` in `apps/admin/src/lib/server/queries.ts`:
   a. 5 parallel `Promise.all` list queries (Maya payments, standalone topups via anti-join, credit
      spends, points spends, free-time), each `LIMIT pageSize`. The Maya query applies the existing
      `rangeWhere(opts)` as-is; the other 4 apply their OWN inline range condition against their own
      timestamp column (`creditLedger.createdAt`, `pointsLedger.createdAt`, `networkSessions.startedAt`)
      — do NOT call `rangeWhere()` for these 4 (see "Range predicate" note above).
   b. 5 parallel `count(*)` queries with matching predicates for `total`.
   c. 1 points-earn query building the `Map<id, number>` badge lookup.
   d. Map each source's rows into `UnifiedTransactionRow` (explicit `null` for inapplicable fields).
   e. Merge, sort desc by `createdAt`, slice to `pageSize`, attach `pointsEarned` badges.
   f. Batch-resolve AP labels via existing `resolveApCircuitLabels`/`apCircuitLabelOf` across ALL
      merged rows' `apCircuitId`s in one call (not per-source) to avoid N+1.
4. Delete `listRecentGrantAttribution` (queries.ts:780-866).
5. Update `apps/admin/src/routes/(app)/finance/transactions/+page.server.ts`: replace the
   `listTransactions` + `listRecentGrantAttribution` dual-load with the single
   `listUnifiedTransactions(db, { from, to, page: 1, pageSize: 50 })` call; update the returned
   `load()` shape (`transactions`, `total`, `period` — drop `grantAttribution`).
6. Update `apps/admin/src/routes/(app)/finance/transactions/+page.svelte`: remove the `<details>`
   grant-attribution block entirely; keep the single `<TransactionsTable>` + "N more — narrow the
   period or export" hint.
7. Update `apps/admin/src/lib/components/feature/TransactionsTable.svelte`:
   a. Accept `UnifiedTransactionRow[]` instead of `TransactionRow[]`.
   b. Add a `Kind` header/column (human label per `kind`, e.g. "Maya payment" / "Credit top-up" /
      "Credit spend" / "Points spent" / "Free time").
   c. Render `status`/`receiptNo`/`fundSourceType`/`buyerEmail`/`packageName` as `n/a` (not blank)
      when `null`.
   d. Render `pointsEarned` as a small badge next to the Amount cell when present (e.g. "+N pts").
   e. Update `filtered`/`sorted` derived logic and the `SortKey` union for the new row shape
      (drop `apName`-vs-`apCircuitLabel` duplication if applicable — verify against current sort
      keys at `TransactionsTable.svelte`). **Null-guard every comparator and the search filter** —
      `amount`/`status`/`statusTone`/`fundSourceType` are `null` on non-Maya/non-money kinds; an
      unguarded `.localeCompare`/array-index on `null` throws at click-time (see Touchpoints note).
      Rename `buyerName` field references to `who`.
8. Update `apps/admin/src/routes/(app)/finance/export/+server.ts`:
   a. Read + validate `?scope=` (default `'maya'`).
   b. Branch: `scope === 'unified'` → `listUnifiedTransactions`, new CSV header with leading `Kind`
      column, `?? ''` for Maya-only fields on non-Maya rows.
   c. `scope !== 'unified'` → existing `listTransactions` path, byte-for-byte unchanged.
9. Add the export-scope `ui/Select` control next to the existing Export link (page or shared Finance
   header control — confirm exact location during EXECUTE by re-reading the current Topbar/
   FinanceHeaderControls composition).
10. Update `apps/admin/src/lib/server/queries.spec.ts`:
    a. Delete the 2 existing `listRecentGrantAttribution` tests.
    b. Add unit tests per the Verification Evidence table below (AC1, AC2, AC3 + negative-control,
       AC4, AC5, AC8).
11. Run gates per section (see Verification Evidence) — fix inline before moving to the next
    checklist item, per repo convention.
12. Agent browser pass on the Finance transactions page (unified list renders, Kind labels visible,
    points badge visible, export toggle works) — flag for human verification handoff (this is a
    Hybrid-tier item, cannot be fully proven by unit tests alone).

## Known Limitations (carried forward from SPEC, not to be "fixed" here)

- **Page-1-only.** Both callers (`+page.server.ts`, CSV export) hard-code `page: 1`. This plan does
  NOT build true multi-source offset pagination — each source is independently capped at
  `pageSize`, so a hypothetical page 2 would risk starvation. Documented, not solved.
- **Inherited `?period=` timezone bug** — the `new Date()` upper bound vs no-tz `timestamp` columns
  issue is pre-existing and out of scope (SPEC).
- **Points-earn with NULL `external_transaction_id`** — unreachable by the current write path;
  silently un-badged if it ever existed. Documented in code, not handled.

---

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| New Vitest: `listUnifiedTransactions` returns all 6 kinds for a seeded fixture (Maya payment, standalone topup, credit spend, points spend, free-time, points-earn badge) — `bunx vitest run src/lib/server/queries.spec.ts` (from `apps/admin/`) | Fully-Automated | AC1 |
| New Vitest: every merged row has a non-empty, kind-appropriate label — `bunx vitest run src/lib/server/queries.spec.ts` | Fully-Automated | AC2 |
| New Vitest: agent browser pass confirms the Kind label renders visibly per row on the Finance transactions page | Hybrid | AC2 (UI half) |
| New Vitest **negative-control**: seed a Maya payment + a mirrored topup row sharing the join key (`credit_ledger.external_transaction_id = payment_transactions.id`) → assert exactly ONE row for that payment; then temporarily break the anti-join condition, confirm the test fails for the expected reason (two rows returned), then restore it — `bunx vitest run src/lib/server/queries.spec.ts` | Fully-Automated | AC3 |
| New Vitest: topup row with NULL `external_transaction_id` → present, labeled as standalone credit top-up — `bunx vitest run src/lib/server/queries.spec.ts` | Fully-Automated | AC4 |
| New Vitest: narrow date range excludes out-of-range rows across all 6 kinds (not just Maya) — `bunx vitest run src/lib/server/queries.spec.ts` | Fully-Automated | AC5 |
| Existing Vitest (re-asserted against unified row shape): AP circuit label resolution across friendly/raw-fallback/Unattributed — `bunx vitest run src/lib/server/queries.spec.ts` | Fully-Automated | AC6 |
| Existing KPI tests re-run unchanged and green; explicit code review confirms `financeKpis`/`revenueByAp`/`revenueByPeriod`/`paymentMethodBreakdown` were NOT modified — `bunx vitest run src/lib/server/queries.spec.ts` + `git diff` review of those 4 functions | Fully-Automated | AC7 |
| New Vitest: Maya-specific fields (`status`, `receiptNo`, `buyerEmail`, `fundSourceType`, `packageName`) populated only on `kind: 'maya-payment'` rows, explicitly `null` on all other kinds | Fully-Automated | AC8 |
| Agent browser pass: CSV export toggle — `scope=maya` byte-identical to pre-change CSV; `scope=unified` includes all kinds with a `Kind` column and `''` for Maya-only fields on non-Maya rows | Hybrid | Locked CSV design decision (INNOVATE) |
| `bun run check` (svelte-check, from repo root) | Fully-Automated | General type-safety regression gate |
| `bun run lint` (prettier + eslint) — note: repo-wide lint currently fails on 297 pre-existing drift files (tracked backlog); scope this run to the touched files only if the full command fails on unrelated drift | Fully-Automated (scoped) | General style regression gate |

## Test Infra Improvement Notes

(none identified yet)

---

## Validate Contract

Status: PASS
Date: 21-07-26
date: 2026-07-21
generated-by: outer-pvl

Parallel strategy: sequential
Rationale: 7-signal score 1/7 (only S7 "5+ files in blast radius" present — 7 files touched; no
multi-package scope, no schema/API/auth surface, no 3+ competing directions, not a phase program,
no explicit depth request, no high-risk class). LOW-risk, single-app, single-session SIMPLE plan —
Layer 1 + Layer 2 fan-out performed by the validate-agent directly against source/schema (no
sub-agent spawn warranted at this score).

Test gates (C3 5-column table):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1 | `listUnifiedTransactions` returns all 6 activity kinds for a seeded fixture | Fully-Automated | `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` (new test) | A |
| AC2-data | every merged row carries a non-empty, kind-appropriate label | Fully-Automated | `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` (new test) | A |
| AC2-UI | Kind label renders visibly per row on the Finance transactions page | Agent-Probe | agent browser pass on `/finance/transactions` (part of checklist step 12) | A |
| AC3 | a Maya payment + its mirrored credit-ledger topup render as exactly ONE row (negative-control: break anti-join → 2 rows → restore) | Fully-Automated | `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` (new negative-control test) | A |
| AC4 | a standalone topup (`external_transaction_id IS NULL`) still renders as its own row | Fully-Automated | `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` (new test) | A |
| AC5 | narrow date range excludes out-of-range rows across all 6 kinds, not just Maya | Fully-Automated | `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` (new test) | A |
| AC6 | AP circuit label (friendly/raw-fallback/Unattributed) resolves correctly on the unified row shape | Fully-Automated | `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` (migrated/extended existing test) | A |
| AC7 | `financeKpis`/`revenueByAp`/`revenueByPeriod`/`paymentMethodBreakdown` byte-for-byte unchanged | Fully-Automated | `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` (existing KPI tests, unchanged) + `git diff -- apps/admin/src/lib/server/queries.ts` reviewed to confirm zero diff on lines 598-708 | A |
| AC8 | Maya-only fields (`status`/`receiptNo`/`buyerEmail`/`fundSourceType`/`packageName`) populated only on `kind: 'maya-payment'` rows, explicit `null` elsewhere | Fully-Automated | `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` (new test) | A |
| CSV toggle (INNOVATE decision) | `scope=maya` byte-identical to pre-change CSV; `scope=unified` adds `Kind` column + `''` for Maya-only fields on non-Maya rows | Agent-Probe | agent browser pass on `/finance/export?scope=maya` and `?scope=unified` (checklist step 12) | A |
| Type safety | no new TypeScript errors across the touched files | Fully-Automated | `bun run check` (repo root) | A |
| Style | no new lint violations on touched files | Fully-Automated (scoped) | `bun run lint`, scoped to touched files if repo-wide fails on the pre-existing 297-file drift (tracked: `process/features/incident-management/backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md`) | D |

gap-resolution legend:
- A — proven now (gate passes in this cycle)
- B — fixed in this plan (gate added by this plan's checklist)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

Legacy line form (retained so existing validate-contract consumers still parse):
- AC1–AC8, CSV toggle: `bunx vitest run src/lib/server/queries.spec.ts` (from `apps/admin/`) for all Fully-Automated rows above | Agent browser pass on `/finance/transactions` + `/finance/export` for the two Agent-Probe/Hybrid rows (Kind-label rendering, CSV scope toggle) | `bun run check` + scoped `bun run lint` for general regression gates.

Failing stub (Fully-Automated rows only — copy verbatim into `queries.spec.ts` as the TDD red-first starting point):

```
test("should return all 6 activity kinds for a seeded fixture", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: listUnifiedTransactions returns all 6 activity kinds for a seeded fixture")
})
test("should give every merged row a non-empty, kind-appropriate label", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: every merged row carries a non-empty, kind-appropriate label")
})
test("should render a Maya payment with a mirrored topup as exactly one row (negative-control)", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: AC3 dedupe — break anti-join, confirm 2 rows, restore")
})
test("should still render a standalone topup with NULL external_transaction_id as its own row", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: AC4 standalone topup not suppressed by anti-join")
})
test("should narrow all 6 kinds uniformly under a date-range filter", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: AC5 period filter applies to every source query")
})
test("should resolve AP circuit label (friendly/raw-fallback/Unattributed) on the unified row shape", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: AC6 label resolution re-asserted on UnifiedTransactionRow")
})
test("should leave financeKpis/revenueByAp/revenueByPeriod/paymentMethodBreakdown byte-for-byte unchanged", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: AC7 KPI/breakdown functions untouched")
})
test("should populate Maya-only fields only on maya-payment rows, explicit null elsewhere", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: AC8 Maya-only field nullability by kind")
})
```

Dimension findings:
- Infra fit: PASS — single app (`apps/admin`), no container/infra/runtime/new-dependency/new-route surface; CSV scope is an additive query param on an existing route.
- Test coverage: PASS — all 8 SPEC ACs map to a runnable gate (7 Fully-Automated + AC2-UI/CSV-toggle as Agent-Probe); negative-control test for AC3 is present and non-vacuous (break → observe expected failure → restore, per `feedback_negative-control-pattern.md`); no developed behavior rests on Known-Gap alone (net-gate vacuous-green check: every row-kind and every UI behavior has at least one Fully-Automated or Agent-Probe gate).
- Breaking changes: PASS — confirmed via `grep -rn "import.*queries['\"]"` that `listRecentGrantAttribution` has exactly one non-spec consumer (`+page.server.ts`, updated by this plan) and `TransactionRow`/`GrantAttributionRow` have exactly 3 consumers total, all in this plan's touchpoints. CSV `?scope=` param is additive/backward-compatible (default preserves byte-identical old behavior).
- Security surface: PASS — read-only, no new writes to `payment_transactions`/`credit_ledger`/`points_ledger`/`network_sessions`; export route's existing auth (`event.locals.user` + mandatory 2FA) + rate limit (`finance_export`, 20/window) untouched; no new PII exposure (buyerEmail already shown in today's Maya CSV). LOW risk classification confirmed accurate — no risk-evidence pack required (auto-stop rule from `vc-risk-evidence-pack` does not apply; none of the 6 high-risk classes are touched).
- Section — `queries.ts` (listUnifiedTransactions + retirement): CONCERN → RESOLVED IN PLAN. Two mechanical-feasibility gaps found and fixed directly in the plan text at this VALIDATE pass: (1) the AC3 anti-join predicate as originally stated in "Source queries" item 2 was internally inconsistent with the plan's own "Dedupe verification note" — corrected to `pt.id = credit_ledger.external_transaction_id`, and independently re-confirmed against `reconcilePayments.ts:46,290-310` + `customer.ts` schema; (2) the Touchpoints table implied literal reuse of `rangeWhere()` across all 5 source queries, but that function hardcodes `paymentTransactions` columns — corrected to require an inline per-column range condition for the 4 non-Maya sources, with `rangeWhere()` itself left untouched (protects AC7). Both fixes are now in the "Source queries + merge algorithm" section and checklist steps 1/3a.
- Section — `types.ts`: PASS — line numbers for `TransactionRow`(239-261)/`GrantAttributionRow`(265-276) confirmed exact by direct read.
- Section — `+page.server.ts` / `+page.svelte`: PASS — current dual-load shape confirmed exactly as described; replacement is mechanical.
- Section — `TransactionsTable.svelte`: CONCERN → RESOLVED IN PLAN. Sort comparators and the search filter assume non-null `amount`/`status`/`statusTone`/`fundSourceType`/`buyerName`, which are `null` (or renamed to `who`) on non-Maya/non-money kinds in `UnifiedTransactionRow` — an unguarded comparator throws on click, a browser-visible crash risk. Null-guard requirement + field rename now documented in the Touchpoints table and checklist step 7e.
- Section — `export/+server.ts`: PASS — current implementation confirmed; additive scope-toggle design is backward-compatible as described.
- Section — `queries.spec.ts`: PASS — existing 2 tests (lines 39-75) confirmed migratable per checklist step 10a/b.

Open gaps: none blocking. Carried-forward known-gaps (accepted, not "NEW PLAN REQUIRED" — see What This Coverage Does NOT Prove below): points-earn row with NULL `external_transaction_id` (confirmed unreachable by the current write path — `earnPointsTx` is only ever invoked from `reconcilePayments.ts:304` inside the same settled-payment transaction with a non-null `externalTransactionId`); the page-1-only pagination limitation; the inherited `?period=` timezone bug (pre-existing, out of scope per SPEC).

What this coverage does NOT prove:
- The AC3/AC4/AC5/AC8 Vitest gates prove the query-layer merge/dedupe/filter logic against seeded fixtures (no real DB) — they do NOT prove the Finance page renders correctly end-to-end in a browser (covered separately by the AC2-UI/CSV-toggle Agent-Probe gates, which in turn do not exercise every row-kind combination, only a representative pass).
- `bun run check` proves type-safety, not runtime correctness of the merge/sort logic.
- No test proves behavior under real production data volume/shape (page-1-only limitation is documented, not load-tested).
- Points-earn badge display for an `earn` row with NULL `external_transaction_id` is never exercised — this path is believed unreachable by the current write path (see Open gaps) but that belief is not itself tested.
- The `?period=` timezone edge case (same-day recent rows potentially hidden) is inherited and not covered by any gate in this plan (pre-existing, out of scope per SPEC).

Gate: PASS (no FAILs; the 2 CONCERNs found during Layer 2 review were fixed directly in the plan text during this VALIDATE pass — see Dimension findings above — leaving 0 unresolved CONCERNs)
Accepted by: N/A — Gate is PASS (no CONDITIONAL concerns to accept; the 2 CONCERNs found during Layer 2 review were resolved by direct plan-text fixes at this VALIDATE pass, not deferred for user acceptance)

---

## Autonomous Goal Block

SESSION GOAL: Ship the unified admin Finance transaction/activity history (replace split payments + grant-attribution UI with one deduped, chronological list; SPEC/INNOVATE/PLAN/VALIDATE complete)
Charter + umbrella plan: N/A — single SIMPLE plan, no phase program
Autonomy: standard RIPER-5 gates apply (no standing /goal for this task); EXECUTE requires explicit "ENTER EXECUTE MODE"; EVL confirmation run (vc-tester) is mandatory even if execute-agent reports all gates green
Hard stop conditions / safety constraints:
- Never touch `financeKpis`, `revenueByAp`, `revenueByPeriod`, `paymentMethodBreakdown`, or `listTransactions` (AC7) — any diff on `queries.ts` lines 598-778 is a plan violation
- Never write to `payment_transactions`, `credit_ledger`, `points_ledger`, or `network_sessions` — this is a read-only display feature
- Never call `rangeWhere()` against a non-`paymentTransactions` query — use the per-column inline condition specified in "Range predicate" above
- The AC3 anti-join predicate is locked: `pt.id = credit_ledger.external_transaction_id` — do not re-derive or substitute a different join key
- Browser-visible change: code-complete is not "done" — requires an agent browser pass AND a human verification handoff (checklist step 12) before archival
Next phase: EXECUTE — `process/general-plans/active/unified-transaction-history_21-07-26/unified-transaction-history_PLAN_21-07-26.md`
Validate contract: inline in plan (`## Validate Contract` section above), Gate: PASS
Execute start: `cd apps/admin && bunx vitest run src/lib/server/queries.spec.ts` (red-first TDD stubs above) → implement checklist steps 1-10 → `bun run check` → scoped `bun run lint` → agent browser pass (checklist step 12) → human verification handoff | high-risk pack: no (LOW risk, no evidence pack required)

---

## Resume and Execution Handoff

1. **Selected plan file path:** `process/general-plans/active/unified-transaction-history_21-07-26/unified-transaction-history_PLAN_21-07-26.md`
2. **Last completed phase or step:** VALIDATE complete (21-07-26) — Gate: PASS. Two Layer 2 CONCERNs found (AC3 join-predicate text inconsistency; TransactionsTable.svelte null-safety on sort/search) were fixed directly in the plan text during this VALIDATE pass — see `## Validate Contract` above.
3. **Validate-contract status:** written — `Gate: PASS`, `generated-by: outer-pvl`, date 21-07-26.
4. **Supporting context files loaded:** `process/context/all-context.md`, `process/context/database/all-database.md`, `process/context/tests/all-tests.md`, plus direct reads of `apps/admin/src/lib/server/queries.ts`, `apps/admin/src/lib/types.ts`, `packages/db/src/schema/customer.ts`, `packages/core/src/services/reconcilePayments.ts`, `apps/admin/src/routes/(app)/finance/transactions/+page.server.ts`, `+page.svelte` (referenced, not re-read this pass), `TransactionsTable.svelte`, `apps/admin/src/routes/(app)/finance/export/+server.ts`, `apps/admin/src/lib/server/queries.spec.ts`.
5. **Next step for a fresh agent picking up mid-execution:** Say `ENTER EXECUTE MODE` for this plan. A fresh EXECUTE agent should start at Implementation Checklist step 1 (the AC3 join predicate and the range-predicate generalization are now locked in the plan text — no re-derivation needed) and proceed through steps 2-12 in order, running the Verification Evidence gates inline per step 11.

---

## Related Active Plans (noted, not touched)

`process/general-plans/active/purchase-ap-attribution_21-07-26/` — the AP-attribution work this
plan builds on (already shipped per `apps/admin` git log `0d13023`). No overlap in files changed
beyond both reading `resolveApCircuitLabels`/`apCircuitLabelOf` — read-only reuse, no conflict.
