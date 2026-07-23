---
name: plan:finance-timestamptz-migration
description: "Migrate 13 finance/session timestamp columns from bare wall-clock to timestamptz with per-column correction; period.ts rewrite ships atomically with the migration"
date: 23-07-26
feature: none
---

# Finance / Session Timestamptz Migration — PLAN

Date: 23-07-26
Status: PLAN DRAFTED — awaiting VALIDATE
Complexity: COMPLEX (schema migration, billing-path, atomic cross-package change-set)
**SPEC:** `process/general-plans/active/finance-timestamptz-migration_23-07-26/finance-timestamptz-migration_SPEC_23-07-26.md` (locked)
**Migration count at PLAN time:** 52 files (`0000`–`0051`), newest `0051_powerful_rachel_grey.sql`. Expected new migration: **`0052_<drizzle-kit-name>.sql`**. Re-verify this count immediately before EXECUTE (`ls packages/db/drizzle/*.sql | wc -l`) — if it has moved past 52, the expected number shifts accordingly; do not hardcode `0052` if drift is found.

## Overview

This plan implements the locked SPEC: migrate 13 finance/session timestamp columns across
`credit_ledger`, `points_ledger`, `payment_transactions`, `payment_checkouts`, `network_sessions`,
and `customer_profile` from bare `timestamp` (ambiguous wall-clock) to `timestamptz` (real
instants), with a per-column `USING` correction cast matched to each column's actual write
convention (Manila-wall vs UTC-wall — see SPEC Background). `apps/admin/src/lib/server/period.ts`'s
boundary-construction logic ships in the same atomic change-set, replacing its interim
wall-clock-spelling workaround with real Manila-day → UTC-instant math. Context loaded per
`process/context/all-context.md` routing (see `database/all-database.md`, `tests/all-tests.md`)
and `process/context/tests/all-tests.md` for gate ordering. This is a high-risk billing-path schema
change (see `all-context.md` §Gotchas — Maya payment paths / money math require extra rigor); the
Ordered EXECUTE Checklist below encodes every safety gate as a literal checkable item, not prose.

## Acceptance Criteria

Carried verbatim from the locked SPEC (9 ACs, each with `proven by:`/`strategy:` — see Verification
Evidence table below for the gate-to-criterion mapping):

1. Round-trip instant correctness for every in-scope column (pre- and post-migration writes read
   back as the identical instant). Strategy: Hybrid.
2. Finance date filters (`/finance/transactions`, overview, CSV export) include all same-day rows
   across all five Unified Transactions sources. Strategy: Hybrid.
3. `listUnifiedTransactions` windows session/free-time rows correctly against money-source rows in
   the same real day. Strategy: Hybrid.
4. `reconcilePayments` age-boundary logic (min-age/max-age skip, polling throttle) is correct
   post-migration. Strategy: Fully-Automated.
5. No dashboard live-feed (`pg_notify` trigger) regression. Strategy: Agent-Probe.
6. KPI/revenue numbers unchanged (byte-identical) for data that was already correctly windowed
   pre-migration. Strategy: Hybrid.
7. Pre-migration timezone preflight is a hard precondition, confirmed per environment before any
   apply. Strategy: Agent-Probe.
8. Migration is reproducible: `db:generate` scaffold, hand-edited/verified `USING` clauses, direct
   DDL apply verified against dev DB. Strategy: Agent-Probe.
9. No unrelated behavior change — full existing gate suite stays green. Strategy: Fully-Automated.

## Phase Completion Rules

This is a single-plan COMPLEX change-set, not a multi-phase program — there is one phase. It is
`CODE DONE` when the Ordered EXECUTE Checklist sections 0–3 are complete with all `[GATE]` items
passed and recorded. It is `VERIFIED` only after section 4 (agent-probe/manual gates, including the
prod safety sequence) completes with recorded evidence AND section 5 close-out items are done — code
completion alone (dev-only) is never sufficient to call this `VERIFIED` given the billing-path risk
class. Do not mark `✅ VERIFIED` without both the dev evidence (sections 0–3) and the prod
confirmation (section 4.3 steps 1-6) recorded, or an explicit user-accepted deferral of the prod
step with a stated reason — and never without explicit user confirmation that the migration is
working correctly in the target environment (user says so, or user-confirmed browser/app check).

## Locked Decisions (from INNOVATE — do not re-litigate)

1. Single migration file, one atomic transaction, covering every in-scope column across all three tables/columns groups.
2. Produced via `drizzle-kit generate` (scaffold), then **hand-edited** — every `USING` clause is manually verified/rewritten per the per-column convention map. Drizzle-kit output is a draft only.
3. Per-column `USING` map (verbatim — apply exactly):
   - **Manila-wall → `USING col AT TIME ZONE 'Asia/Manila'`**: `credit_ledger.created_at`, `points_ledger.created_at`, `payment_transactions.created_at`, `payment_checkouts.created_at`
   - **UTC-wall → `USING col AT TIME ZONE 'UTC'`**: `network_sessions.started_at`, `network_sessions.bound_at`, `network_sessions.last_seen_at`, `network_sessions.expires_at`, `payment_checkouts.settled_at`, `payment_checkouts.last_polled_at`, `customer_profile.last_free_session_at`, `customer_profile.access_expires_at`, `customer_profile.access_paused_at`
   - `payment_checkouts` gets a per-column `USING` split within ONE `ALTER TABLE` statement (created_at Manila; settled_at/last_polled_at UTC) — never a table-wide cast.
   - Drizzle schema (`packages/db/src/schema/customer.ts`) is updated in the same change-set: every in-scope column becomes `timestamp('col_name', { withTimezone: true })` (some also carry `.notNull().defaultNow()` — preserve existing not-null/default modifiers, only add `withTimezone: true`).
4. **`period.ts` rewrite ships in the SAME change-set as the migration.** Neither may land without the other — the Manila-anchored `Date.UTC` wall-clock-spelling trick in `parsePeriod()` becomes wrong once columns are real instants; it must be replaced by real Manila-day → UTC-instant boundary math (Manila has no DST, so this is a fixed −8h offset from the Manila Y/M/D extracted via `Intl.DateTimeFormat`, same extraction helper `manilaYmd()` already in the file — reuse it, just change what the boundaries mean).
5. **NO code change** to `packages/core/src/services/sessions.ts` or `packages/core/src/services/reconcilePayments.ts`. Both write timestamps via `new Date()` (or `.defaultNow()`), which `postgres.js`/Drizzle bind as real instants regardless of column type — `timestamp` (bare) silently drops the tz info on write and forces session-tz interpretation on read; `timestamptz` stores the real instant natively. Both write paths already produce a correct real instant at write time (JS `Date` is always a real instant); the BUG was only ever in how the bare column stored/reinterpreted it, and in `period.ts`'s boundary-spelling workaround. Once the column is `timestamptz`, these write paths self-heal with zero code changes. EXECUTE must NOT touch these files.
6. **Rollback = restore from pre-apply snapshot backup.** This is NOT a reverse/down migration — the original ambiguous bare-timestamp value is unrecoverable once corrected (the correction is lossy in the sense that "which wall-clock convention wrote this" is discarded on cast). If migration is found wrong post-apply, the only safe recovery is restoring the environment from its pre-migration snapshot and re-planning.
7. **Standing scope assumption:** `revenueByDay`'s `date_trunc('day', ...)` bucketing (in `queries.ts`) operates in the Postgres session TimeZone post-migration too (timestamptz values are always rendered/truncated in session TZ) — this is correct only while session TZ = Asia/Manila for the querying connection. This is the same assumption the AC7 preflight gate is already checking; no separate gate is added, but EXECUTE must confirm `revenueByDay`'s output is unaffected as part of AC6 (KPI byte-identical check).

## Touchpoints

| File | Change | Why |
|---|---|---|
| `packages/db/src/schema/customer.ts` | 13 columns: add `{ withTimezone: true }` to `timestamp(...)` calls | Drizzle schema must match the post-migration DB type so future `db:generate` diffs stay clean (SPEC constraint) |
| `packages/db/drizzle/0052_<name>.sql` (new) | New migration file, one `BEGIN`/implicit-transaction DDL block with 3 `ALTER TABLE ... ALTER COLUMN ... TYPE timestamptz USING ...` statements (one per table: `credit_ledger`+`points_ledger`+`payment_transactions` are single-column each; `payment_checkouts` is 3-column in one `ALTER TABLE`; `network_sessions` is 4-column in one `ALTER TABLE`; `customer_profile` is 3-column in one `ALTER TABLE`) | The actual schema change (AC8) |
| `packages/db/drizzle/meta/0052_snapshot.json` + `meta/_journal.json` | drizzle-kit-generated snapshot + journal entry | Required for `db:generate` reproducibility record (AC8); dev DB itself is applied via direct DDL per the push-managed-dev-DB convention, but the committed migration+snapshot pair must still exist |
| `apps/admin/src/lib/server/period.ts` | Rewrite `parsePeriod()` boundary construction: replace the `Date.UTC(y, m-1, day, ...)` wall-clock-spelling trick with real Manila-day → UTC-instant math (fixed −8h offset, no DST) | Ships atomically with the migration per Locked Decision 4; the old spelling trick becomes wrong (and unnecessary) once columns are real instants |
| `apps/admin/src/lib/server/period.spec.ts` (new, if none exists — confirm first) | Unit tests for the rewritten boundary math: day-boundary correctness, cross-midnight-UTC edge cases | Fully-Automated regression coverage for the rewritten function (not explicitly an AC row, but required by AC9 "no unrelated behavior change" — this function's behavior changes, so it needs direct coverage) |
| `packages/core/src/services/timestamptz-roundtrip.integration.spec.ts` (new) | AC1: pre/post-migration instant round-trip test for all 13 columns, including NULL-column cases | Proves AC1 |
| `apps/admin/src/lib/server/queries.spec.ts` (extend, not new file) | AC2/AC3: add a same-day cross-write-convention case (free-time/session row + Maya payment row, same real day, opposite pre-migration conventions) to the existing `listUnifiedTransactions` describe blocks | Proves AC2, AC3 |
| `packages/core/src/services/reconcilePayments.spec.ts` (extend if exists, else create `reconcilePayments.integration.spec.ts`) | AC4: age-boundary branch coverage run against the migrated (timestamptz) column type | Proves AC4 |
| `apps/admin/scripts/seed-test-data.ts` (read-only reference, not modified unless snapshot test needs a seed helper) | AC6 baseline data source | Supports the before/after KPI snapshot comparison |

**Confirm-first note:** `period.spec.ts` and a dedicated `reconcilePayments` spec file existence must be confirmed by RESEARCH-equivalent grep at EXECUTE start (see Execute Checklist item 0). If either already exists, extend it; do not create a duplicate.

## Public Contracts

- **Column types** (public within the monorepo — read by `packages/core` and `apps/admin`): 13 columns change from `timestamp` to `timestamptz`. Any other reader of these columns outside the touched files (none found in SPEC research — confirmed no view/materialized-view dependency) is unaffected at the SQL level since `timestamptz` round-trips through `postgres.js`/Drizzle exactly like `timestamp` does for JS `Date` values — only the *stored representation and comparison semantics* change (instant vs ambiguous wall-clock).
- **`period.ts` exports** (`parsePeriod`, `granularityFor`, `Period` type): signature unchanged; only internal boundary-construction logic changes. Callers (`apps/admin/src/routes/(app)/finance/**`) are unaffected by this contract change — same input/output shape, corrected values.
- **No new public API, no new schema fields, no new package.**

## Blast Radius

- **Packages touched:** `packages/db` (schema + migration — schema-authority package), `apps/admin` (period.ts + 2 spec files), `packages/core` (1 new integration spec, 1 extended/new spec — read-only w.r.t. source, tests only).
- **packages/core is read-only for source code** (Locked Decision 5 — `sessions.ts` and `reconcilePayments.ts` are untouched). Only test files are added/extended in `packages/core`.
- **Risk class: HIGH — billing-path schema change.** Touches `credit_ledger`, `points_ledger`, `payment_transactions`, `payment_checkouts` (money tables) plus `network_sessions`, `customer_profile` (session/access tables that gate paid access).
- **File count:** ~9 files (1 schema file, 1 migration + 2 generated meta files, 1 period.ts, 2-3 new/extended spec files, 1 new integration spec). Within COMPLEX-plan bounds but not a phase-program (single atomic change-set, not 3+ independently-gated phases).
- **Irreversibility:** the `USING` cast is a one-way lossy transform on historical data (SPEC Constraints). Rollback path is snapshot restore only (Locked Decision 6), never a down-migration.

## Strategy Note (vc-agent-strategy-compare, run for this PLAN)

Signals present: S2 (schema/auth/billing surface touched) ✓, S6 (high-risk class in plan) ✓, S7 (5+ files in blast radius) ✓ → score 3/7 → MEDIUM band. However this PLAN itself is a single atomic artifact (not a 3+-phase fan-out), so plan creation is Sequential (one plan-agent — this session). The MEDIUM signal is carried forward as a recommendation for **VALIDATE**: recommend parallel Layer-1/Layer-2 dimension fan-out at V2 given the high-risk class, and recommend the EXECUTE step run with heightened scrutiny (manual-first evidence handoff per `orchestration.md` §High-Risk Execution Handoff — this is a schema/migration + billing-path change, both listed high-risk classes).

## Ordered EXECUTE Checklist (Implementation Checklist)

Every safety gate below is a literal, checkable item — EXECUTE must not proceed past a `[GATE]` item until its stated pass condition is met.

### 0. Preflight (confirm-first, before any code)

- [ ] 0.1 Re-run `ls packages/db/drizzle/*.sql | wc -l` — confirm count is still 52 (or record the new count and adjust the expected migration number from `0052`).
- [ ] 0.2 Confirm existence/non-existence of `apps/admin/src/lib/server/period.spec.ts` and a `reconcilePayments` spec file (`grep -rl reconcilePayments packages/core/src/services/*.spec.ts`) — decide extend vs create per Touchpoints table note.
- [ ] 0.3 **[GATE — AC7, dev environment]** Run `SELECT current_setting('TimeZone');` (or `SHOW TIMEZONE;`) against the local dev Postgres connection used by `DATABASE_URL`. **Pass condition:** result is `Asia/Manila`. Record the literal output in the phase report. If it is NOT `Asia/Manila`, STOP — the entire per-column `USING` map assumption is invalid for this environment; return to PLAN/INNOVATE to re-derive the correction map for the actual TZ.

### 1. Schema + migration + period.ts as one atomic change-set (never split across separate commits/PRs)

- [ ] 1.1 Edit `packages/db/src/schema/customer.ts`: add `{ withTimezone: true }` to all 13 in-scope `timestamp(...)` column definitions (preserve `.notNull()`/`.defaultNow()` modifiers exactly as they exist today — only the tz flag changes).
- [ ] 1.2 Run `bun run --filter @veent/db db:generate` to scaffold the draft migration + snapshot/journal entries.
- [ ] 1.3 **[GATE — Constraint: drizzle-kit-generated USING may be unusable]** Open the generated `.sql` file. Inspect every `ALTER COLUMN ... TYPE timestamptz` statement's `USING` clause (or absence of one). **Pass condition:** every one of the 13 columns has an explicit `USING col AT TIME ZONE '<zone>'` clause matching the Locked Decision 3 map exactly (Manila-wall columns → `'Asia/Manila'`; UTC-wall columns → `'UTC'`). If drizzle-kit emitted no `USING` clause, a same-type-name no-op cast, or a table-wide (non-per-column) cast for `payment_checkouts`, hand-edit the SQL file directly to match the map. Do not proceed until every clause is verified correct by manual read-through against Locked Decision 3.
- [ ] 1.4 Confirm the final migration file combines all changes into ONE file with 6 `ALTER TABLE` groupings (credit_ledger, points_ledger, payment_transactions, payment_checkouts [3-col], network_sessions [4-col], customer_profile [3-col]) — not split across multiple migration files.
- [ ] 1.5 Rewrite `apps/admin/src/lib/server/period.ts` `parsePeriod()`: replace the `Date.UTC(y, m-1, day, hh, mm, ss, ms)` boundary construction with real Manila-day → UTC-instant math. Concretely: build the Manila-local wall-clock boundary as a plain object `{y, m, day, hh, mm, ss, ms}` (via the existing `manilaYmd()` extraction, extended to a full timestamp helper), then convert to the equivalent UTC instant by subtracting the fixed Manila offset (UTC+8, no DST — confirm this assumption explicitly in a code comment citing the no-DST fact). Remove the stale `ponytail: known gap` comment block (lines ~17-20) — the gap it documents (`network_sessions.startedAt` skew) is fixed by this migration; replace with a comment explaining the new real-instant boundary math.
- [ ] 1.6 Update/create `apps/admin/src/lib/server/period.spec.ts` with unit tests: day-boundary correctness for `7d`/`30d`/`90d`, a cross-UTC-midnight edge case (Manila day starts at UTC 16:00 the prior day), and `all` period passthrough.

### 2. Dev apply + direct-apply verification (AC8)

- [ ] 2.1 **[GATE]** Before applying, run a query confirming CURRENT column types for all 13 columns are still bare `timestamp` (double-apply guard): `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE column_name IN (...) AND table_name IN (...);`. **Pass condition:** all 13 rows show `timestamp without time zone`. If any already show `timestamp with time zone`, STOP — migration may have partially applied; investigate before re-running.
- [ ] 2.2 Apply the migration DDL directly to the dev DB (`psql "$DATABASE_URL" -f packages/db/drizzle/0052_<name>.sql` or equivalent) per the documented push-managed-dev-DB direct-apply convention — do NOT use `db:migrate` (will fail on pre-existing journal drift per SPEC constraint).
- [ ] 2.3 Re-run the column-type query from 2.1 — **pass condition:** all 13 rows now show `timestamp with time zone`.
- [ ] 2.4 Spot-check 2-3 historical rows per convention group (one Manila-wall table, one UTC-wall table) by hand: read the row's new `timestamptz` value, mentally convert back, confirm it matches the pre-migration bare value's intended real moment (per the SPEC's write-path analysis). Record in phase report.

### 3. Test gates (run in this order; do not skip ahead on failure — fix and re-run)

- [ ] 3.1 **[GATE — AC1]** Write and run `packages/core/src/services/timestamptz-roundtrip.integration.spec.ts` (PGlite pattern per `networkHealth.integration.spec.ts`/`outage.integration.spec.ts`): apply the FULL migration chain including 0052 via PGlite `migrate()`, then for each of the 13 columns: seed a pre-migration-convention value via raw SQL insert (bypassing the typed schema, which now reflects post-migration `timestamptz` types), read it back through Drizzle, assert the instant matches expectation. **Include an explicit NULL-column case** for `settled_at`, `last_polled_at`, `access_paused_at` (and any other nullable in-scope column) — assert `AT TIME ZONE` on NULL returns NULL, not an error or a wrong default. Command: `bunx vitest run packages/core/src/services/timestamptz-roundtrip.integration.spec.ts` (run from `packages/core/`).
- [ ] 3.2 **[GATE — AC2, AC3]** Extend `apps/admin/src/lib/server/queries.spec.ts`: add a same-real-day case with one `network_sessions` free-time row and one `paymentTransactions`/`creditLedger` row, seeded via raw SQL at pre-migration-equivalent conventions before the schema migration is "logically" applied in the test's migration chain, both falling inside one `from`/`to` window. Assert both rows appear in `listUnifiedTransactions` output for that window. Command: `bunx vitest run apps/admin/src/lib/server/queries.spec.ts` (run from `apps/admin/`).
- [ ] 3.3 **[GATE — AC4]** Extend or create `reconcilePayments` spec covering the `minAge`/`maxAge` skip-boundary branches and the `lastPolledAt` throttle branch, run against the PGlite chain with 0052 applied. Command: `bunx vitest run packages/core/src/services/reconcilePayments*.spec.ts` (run from `packages/core/`).
- [ ] 3.4 **[GATE — AC6]** Before/after KPI snapshot: seed representative data via `apps/admin/scripts/seed-test-data.ts` (or an equivalent minimal seed inline in a spec), capture `revenueByDay` (and one other KPI query) output BEFORE the migration is applied to that test's DB instance, apply migration, capture output AFTER, assert byte-identical for date ranges composed entirely of `.defaultNow()`-sourced (Manila-wall, pre-migration-correct) data. This can be folded into the AC1 round-trip spec or a dedicated spec — prefer folding into 3.1's file as an additional `describe` block to avoid a redundant PGlite bootstrap.
- [ ] 3.5 `bun run check` (repo-wide typecheck) — **pass condition:** exit 0.
- [ ] 3.6 `bun run lint` — **pass condition:** exit 0.
- [ ] 3.7 `bun test` (repo-wide, per `tests/all-tests.md` gate order) — **pass condition:** all suites green, zero new failures.
- [ ] 3.8 Admin e2e: run the Finance-touching specs only (`apps/admin/e2e/**finance**`, `**transactions**`, or the full 12-spec suite if scoping is ambiguous — confirm exact spec filenames at EXECUTE time via `ls apps/admin/e2e/`). **Pass condition:** all green.

### 4. Agent-probe / manual gates (AC5, AC7-prod, AC8-prod)

- [ ] 4.1 **[GATE — AC5]** Static check: `grep -n "network_sessions\|credit_ledger\|points_ledger\|payment_transactions\|payment_checkouts\|customer_profile" packages/db/drizzle/0006_*.sql` (or wherever the `pg_notify` triggers live) — confirm trigger definitions are `FOR EACH STATEMENT` with no column reference to any in-scope column. **Pass condition:** no column-level reference found (statement-level triggers only reference table names). Then in dev: perform one action that fires the trigger (e.g. a top-up) and confirm the admin dashboard live feed updates.
- [ ] 4.2 **[GATE — AC7, prod]** Before applying to prod, run the same `SELECT current_setting('TimeZone');` check against the prod Postgres connection. **Pass condition:** `Asia/Manila`. This is a hard precondition — do not proceed to prod apply without a recorded, confirmed-matching result. If prod TZ differs from dev, STOP and escalate — the per-column map must be re-derived for prod's actual TZ before any prod DDL runs.
- [ ] 4.3 **[GATE — Prod safety sequence, non-negotiable order]**:
  1. Snapshot/backup the prod database.
  2. Confirm the backup is restorable (test-restore or equivalent verification — do not skip on "we always back up fine").
  3. Run a SELECT-only preview against a handful of real prod rows per convention group: show old bare value alongside the proposed `AT TIME ZONE` cast result, human-review for plausibility (e.g., does the corrected instant fall in a sane hour-of-day range for a WiFi portal's traffic pattern).
  4. Apply the migration DDL directly to prod (same direct-apply convention as dev, item 2.2).
  5. App-level smoke: load Finance overview, `/finance/transactions`, trigger CSV export, confirm dashboard live feed — all in prod, immediately post-apply.
  6. If ANY step in this sequence fails or produces an implausible result: STOP, do not proceed to the next sub-step, restore from the step-1 snapshot (Locked Decision 6 — this is the ONLY rollback path).

### 5. Close-out

- [ ] 5.1 Confirm AC9 (no unrelated behavior change): full gate suite (3.5-3.8) green with zero new failures beyond the new/extended specs themselves.
- [ ] 5.2 Update `process/context/database/all-database.md` migration count reference (52 → 53) and note the new migration's purpose in the canonical notes (per Context Update Protocol).
- [ ] 5.3 Confirm `period.ts`'s stale `ponytail: known gap` comment (SPEC Background, queries.ts:17-20 area) is removed/updated as part of item 1.5 — do not leave a comment describing a bug that no longer exists.

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| PGlite round-trip test, all 13 columns + NULL cases — `timestamptz-roundtrip.integration.spec.ts` | Hybrid | AC1 |
| `queries.spec.ts` same-day cross-convention extension | Hybrid | AC2, AC3 |
| `reconcilePayments` age-boundary spec against migrated column type | Fully-Automated | AC4 |
| Static trigger-definition grep + dev live-feed smoke check | Agent-Probe | AC5 |
| Before/after KPI/`revenueByDay` byte-identical snapshot (folded into round-trip spec) | Hybrid | AC6 |
| `SELECT current_setting('TimeZone')` recorded per environment (dev item 0.3, prod item 4.2) before apply | Agent-Probe | AC7 |
| `db:generate` scaffold + hand-edit verification + direct-apply-and-verify against dev DB | Agent-Probe | AC8 |
| Full gate suite (`bun run check` → `bun run lint` → `bun test` → admin finance e2e) green, zero new failures | Fully-Automated | AC9 |

## Test Infra Improvement Notes

(none identified yet)

## Resume and Execution Handoff

1. **Selected plan file path:** `process/general-plans/active/finance-timestamptz-migration_23-07-26/finance-timestamptz-migration_PLAN_23-07-26.md`
2. **Last completed phase or step:** VALIDATE complete (Gate: CONDITIONAL — see Validate Contract below).
3. **Validate-contract status:** written 23-07-26, Gate: CONDITIONAL, 4 CONCERNs resolved as Execute-Agent Instructions E1–E5.
4. **Supporting context files loaded during PLAN:** `process/context/database/all-database.md`, `process/context/tests/all-tests.md`, `apps/admin/src/lib/server/period.ts`, `apps/admin/src/lib/server/queries.ts` (lines ~260-300, ~820-860), `packages/db/src/schema/customer.ts`, `packages/core/src/services/reconcilePayments.ts` (age-boundary lines), `packages/core/src/services/networkHealth.integration.spec.ts` (PGlite pattern reference), `apps/admin/src/lib/server/queries.spec.ts` (existing PGlite test scaffold), `packages/db/drizzle.config.ts`, `packages/db/drizzle/meta/_journal.json`, one sample migration (`0050_brown_shen.sql`).
5. **Next step for a fresh agent picking up mid-execution:** re-verify migration count (`ls packages/db/drizzle/*.sql | wc -l`), confirm still 52; VALIDATE has produced Gate: CONDITIONAL — resume at EXECUTE Checklist item 0 (Preflight), applying Execute-Agent Instructions E1–E5 at their noted trigger points. Do not skip the TZ preflight gate even if resuming mid-session.

## Validate Contract

Status: CONDITIONAL
Date: 23-07-26
date: 2026-07-23
generated-by: outer-pvl

Parallel strategy: parallel-subagents (Layer 1: 4 dimension agents; Layer 2: 5 section agents) —
recommended per the plan's own Strategy Note (S2/S6/S7 present, score 3/7, MEDIUM band) and
`orchestration.md` §High-Risk Execution Handoff. Run in this pass as a single-session synthesis
(sequential read-and-assess per dimension/section) since the blast radius is small (~9 files) and
every finding required direct cross-checking against live source (write-path grep, schema grep,
migration-trigger grep) rather than independent parallel investigation — a genuine parallel fan-out
would have re-read the same handful of files 9 times. Recommend true parallel-subagents only if a
future re-validate needs to re-check a materially larger blast radius.

### Empirical de-risking performed this pass (cheap-local PGlite probes, not deferred to EXECUTE)

Per the task brief's Layer 2 guidance, the two genuinely untested-at-plan-time mechanical questions
were resolved empirically now rather than deferred or guessed:

1. **Single-column per-column `USING` cast** (`credit_ledger.created_at` pattern): `ALTER TABLE t
   ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'Asia/Manila'` against a
   bare `timestamp` value `2026-07-23 14:00:00` in a real PGlite instance → produced
   `2026-07-23T06:00:00.000Z`. This is the mathematically correct instant (14:00 Manila = 06:00 UTC,
   UTC+8) — confirms the Locked Decision 3 Manila-wall cast direction and PGlite's ability to run it.
2. **NULL propagation through `AT TIME ZONE`**: a `NULL` bare-timestamp column cast via `... USING
   nullable_at AT TIME ZONE 'UTC'` remained `NULL` after the `ALTER` — confirms AC1's required NULL
   case (settled_at/last_polled_at/access_paused_at) will round-trip correctly, not error or coerce
   to an epoch default.
3. **Multi-column per-column split in ONE `ALTER TABLE`** (the `payment_checkouts` pattern —
   Locked Decision 3's "never a table-wide cast" requirement): a single `ALTER TABLE ... ALTER
   COLUMN created_at ..., ALTER COLUMN settled_at ..., ALTER COLUMN last_polled_at ...` with three
   different per-column `USING` zones in one statement ran cleanly and produced correct,
   independently-converted values for each column.

These three probes directly de-risk the plan's Item 1.3 ("drizzle-kit-generated `USING` may be
unusable — hand-edit and verify") and Item 3.1 (AC1 PGlite round-trip spec): the underlying SQL
mechanism the plan specifies is now proven to work in the exact test harness (PGlite) the plan
already commits to using, not merely assumed. No `VC-FEASIBILITY-PROBE-NEEDED` signal was needed —
resolved directly instead of halting.

### Per-column USING map cross-check against write-path evidence (the single most important check)

Verified by direct grep/read of every write site (not re-derived from the SPEC's prose alone):

| Column | Plan classifies as | Write-path evidence found | Verdict |
|---|---|---|---|
| `credit_ledger.created_at`, `points_ledger.created_at`, `payment_transactions.created_at` | Manila-wall | Schema `.notNull().defaultNow()`, no explicit override at any insert site (`credits.ts:116`, `points.ts:54`, `reconcilePayments.ts:104` `row` object omits `createdAt`) | CONFIRMED |
| `payment_checkouts.created_at` | Manila-wall | `top-up/+page.server.ts:212` insert omits `createdAt` → `.defaultNow()` fires | CONFIRMED |
| `payment_checkouts.settled_at`, `payment_checkouts.last_polled_at` | UTC-wall | `reconcilePayments.ts:240,324` (`settledAt: new Date()`), `:443` (`lastPolledAt: new Date()`) — explicit JS `Date`, schema has no `.defaultNow()` on these two | CONFIRMED |
| `network_sessions.{started_at, bound_at, last_seen_at, expires_at}` | UTC-wall | Schema shows `.notNull().defaultNow()` as a FALLBACK default, but `sessions.ts:189-199` (`bindMacTx`) **always explicitly sets** `startedAt/boundAt/lastSeenAt: now` and `expiresAt: newWindow` at every insert/update — the schema default never actually fires on this write path. No other insert site exists in application code (only `seed-test-data.ts`/`simulate-live.ts` scripts, dev-only). | CONFIRMED — flagged and traced explicitly because the schema-level `.defaultNow()` presence could otherwise mislead a reviewer into misclassifying these as Manila-wall; the write path overrides it every time. |
| `customer_profile.{last_free_session_at, access_expires_at, access_paused_at}` | UTC-wall | `sessions.ts:632` (`accessPausedAt: now`), `:758` (`lastFreeSessionAt: now`), explicit `new Date()` throughout; schema has no `.defaultNow()` on any of the three | CONFIRMED |

**No misclassification found.** All 13 columns' Locked-Decision-3 group assignment matches actual
runtime write behavior. The one column group that could plausibly have been mis-derived from schema
inspection alone (`network_sessions`'s three `.defaultNow()`-default UTC-wall columns) was traced to
its actual call site and confirmed correct — this is exactly the class of "silent data-corruption
path" the task brief asked to rule out, and it is ruled out.

### Layer 1 — Dimension findings

| Layer 1 dimensions | Status |
|---|---|
| Infra fit | PASS |
| Test coverage | CONCERN |
| Breaking changes | PASS |
| Security surface | CONCERN |

- **Infra fit — PASS.** `packages/db` remains the sole migration authority; no new package, port,
  container, or runtime surface. Migration workflow (`db:generate` + direct-apply verify) matches
  the documented push-managed-dev-DB convention in `database/all-database.md`. One informational
  note: that context file's migration-count line is itself stale (shows "47" — actual on-disk count
  today is 52, `0000`–`0051`) — pre-existing drift, not caused by this plan, but worth folding into
  this plan's own close-out step (see Execute-Agent Instruction E3).
- **Test coverage — CONCERN.** The Hybrid/Fully-Automated/Agent-Probe tier assignments are correct
  and the PGlite pattern is confirmed reusable and mechanically sound (see probes above). Two gaps
  found, both resolvable without returning to PLAN — see Execute-Agent Instructions E1 and E2.
- **Breaking changes — PASS.** Public Contracts section is accurate: `parsePeriod`/`granularityFor`
  signatures are unchanged (confirmed by reading all 3 call sites —
  `finance/+page.server.ts`, `finance/export/+server.ts`, `finance/transactions/+page.server.ts` —
  all only destructure `{period, from, to}`, none depend on internal boundary math). No view/
  materialized-view dependency (SPEC-verified via grep, re-confirmed no `CREATE VIEW` anywhere in
  `packages/db/drizzle/`). No new schema field, no new package.
- **Security surface — CONCERN.** No new auth/secret/trust-boundary logic is introduced — this is a
  data-correctness fix, not a new capability. The risk is entirely in the migration's
  irreversibility (Locked Decision 6, correctly framed as snapshot-restore, never a down-migration)
  and the prod-apply sequence (Item 4.3), which the plan already handles well as checklist prose.
  However, this is squarely the "schema/data migration or destructive data mutation" high-risk class
  per `orchestration.md` §High-Risk Execution Handoff, and the plan does not yet produce the formal
  `vc-risk-evidence-pack` 5-artifact record that protocol requires before treating high-risk work as
  ready to finalize — see Execute-Agent Instruction E4.

### Layer 2 — Section findings

| Layer 2 sections | Status |
|---|---|
| Section A — Schema + Migration (customer.ts, 0052 migration, meta files) | PASS |
| Section B — period.ts rewrite | CONCERN |
| Section C — Test gates (round-trip, queries.spec.ts, reconcilePayments spec, check/lint/test/e2e) | CONCERN |
| Section D — Agent-probe / prod safety gates (AC5, AC7, AC8) | PASS |
| Section E — Close-out | PASS |

**Section A — Schema + Migration.** Mechanical feasibility: confirmed — all 13 target columns exist
in `customer.ts` with the exact names/nullability the plan assumes (verified by grep). Per-column
`USING` map verified correct against write-path evidence (table above) and empirically proven
correct in PGlite (probes above), including the `payment_checkouts` 3-column single-`ALTER TABLE`
split. Gaps: none blocking — see E3 (migration-count re-verify) as a minor close-out precision item.
Conflicts: none. Highest-risk edit: the hand-edited `USING` clause in the generated `0052` file —
mitigated by the plan's required manual read-through (Item 1.3), the double-apply guard (Item 2.1),
and the AC1 round-trip test; recommend EXECUTE literally diff the final SQL's `USING` clauses
against the Locked Decision 3 table cell-by-cell in the phase report for auditability.

**Section B — period.ts rewrite.** Mechanical feasibility: confirmed — `parsePeriod`/`manilaYmd`
read in full; the rewrite target is unambiguous. Gap found: the EXISTING `period.spec.ts` (already
on disk, not "new" as the Touchpoints table's parenthetical implies) asserts the OLD wall-clock-
SPELLING values — e.g. its current test expects `to.toISOString() === '2026-07-23T23:59:59.999Z'`
for 10:00 Manila on 07-23. Once `period.ts` is rewritten to real Manila-day→UTC-instant math, the
mathematically correct value for Manila end-of-day 07-23 becomes `2026-07-23T15:59:59.999Z`
(23:59:59.999 Manila − 8h, no DST). Checklist Item 1.6 says "update/create... unit tests" but does
not explicitly flag that the CURRENT assertions must change VALUE, not just gain new cases — a
plan-literal reading could leave the two existing assertions in place and silently lock in wrong
values while looking "extended." See Execute-Agent Instruction E2. Conflicts: none. Highest-risk
edit: the −8h offset sign/magnitude — a flip would silently miscalculate every live Finance filter
boundary, not just historical data; the plan's cross-UTC-midnight edge case (Item 1.6) is a good
catch, reinforced by E2's requirement to assert exact new numeric values.

**Section C — Test gates.** Mechanical feasibility: PGlite pattern (`networkHealth.integration.spec.ts`
referenced correctly, confirmed on disk) and `bunx vitest run <file>` command form (confirmed against
`tests/all-tests.md`) are both correct. `reconcilePayments` spec confirmed absent today (create path
applies, as the plan already anticipates). `queries.spec.ts` and `period.spec.ts` confirmed already
exist (extend path applies — matches the plan's Item 0.2 confirm-first note). Gaps found: (1) Item
3.6 `bun run lint`'s literal "pass condition: exit 0" is currently unachievable repo-wide for reasons
unrelated to this plan — `tests/all-tests.md` §Known Gaps documents a pre-existing 297-file prettier
drift that already blocks `bun run lint` today, before any of this plan's edits. See E1. (2) The
only finance-touching e2e spec matching Item 3.8's glob (`finance-export.e2e.ts`) tests CSV-export
auth gating with `period=all` — it exercises no date-window logic at all, so a green e2e run should
not be read as AC2/AC3 evidence (that proof is entirely the Hybrid `queries.spec.ts` extension). See
E5. Conflicts: none. Highest-risk edit: the AC1 round-trip spec must apply the full migration chain
through `0052` — mechanically proven feasible by this pass's PGlite probes; recommend EXECUTE reuse
the same raw-SQL sanity pattern as a fast fail-first check before writing the full spec.

**Section D — Agent-probe / prod safety gates.** Mechanical feasibility: confirmed directly, not by
paper trust — `packages/db/drizzle/0006_dashboard_notify_triggers.sql` was read in full: all three
triggers are `FOR EACH STATEMENT`, the trigger function body only calls `pg_notify('dashboard', '')`
with zero column references anywhere. Item 4.1's grep-based static check will find no column-level
reference by construction — this is a real, not paper, PASS for the mechanical half of AC5. Gaps:
none. Conflicts: none. Highest-risk edit: the prod-apply step (Item 4.3) — irreversible,
snapshot-restore-only rollback. The 6-step non-negotiable sequence is a genuinely strong mitigation
and matches `orchestration.md`'s High-Risk Execution Handoff intent; the one improvement is
formalizing it as a `vc-risk-evidence-pack` record (E4) rather than plan-prose alone.

**Section E — Close-out.** Mechanical feasibility: fine — cosmetic/doc updates only. Gap: Item 5.2
assumes the count moves "52 → 53"; re-verify the actual on-disk count at EXECUTE time rather than
hardcoding, since `all-database.md`'s router entry is already stale today (see Infra fit note above)
— use this VALIDATE pass's confirmed drift as evidence the router needs a real re-sync, not just an
increment. Conflicts: none. Highest-risk edit: none.

**Totals: 0 FAILs / 4 CONCERNs / 6 PASSes**

**→ Net Gate: CONDITIONAL** — 0 FAILs, 4 CONCERNs, all resolved as Execute-Agent Instructions (no
plan-text rewrite required, no return to PLAN needed). Proceed to EXECUTE with these instructions on
record.

### III. Test Coverage Plan

Test gates (C3 5-column table — ADDITIVE; existing consumers still parse the legacy line form below it):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1 | Every in-scope column round-trips the same real instant pre/post migration, incl. NULL cases | Hybrid | `bunx vitest run packages/core/src/services/timestamptz-roundtrip.integration.spec.ts` (from `packages/core/`) — PGlite, full migration chain incl. 0052 | B |
| AC2, AC3 | Finance date filters / `listUnifiedTransactions` include same-day rows across write conventions | Hybrid | `bunx vitest run apps/admin/src/lib/server/queries.spec.ts` (from `apps/admin/`) — extended with cross-convention same-day case | B |
| AC4 | `reconcilePayments` age-boundary (minAge/maxAge/throttle) logic correct post-migration | Fully-Automated | `bunx vitest run packages/core/src/services/reconcilePayments*.spec.ts` (from `packages/core/`) | B |
| AC5 | `pg_notify` dashboard triggers unaffected by column type change | Agent-Probe | Static grep of `0006_dashboard_notify_triggers.sql` (confirmed clean this pass) + dev live-feed smoke check | B |
| AC6 | KPI/revenue queries byte-identical for already-correct data | Hybrid | Before/after snapshot folded into the AC1 spec file (Item 3.4) | B |
| AC7 | Session `TimeZone` confirmed per environment before apply | Agent-Probe | `SELECT current_setting('TimeZone');` recorded dev (Item 0.3) + prod (Item 4.2) | B |
| AC8 | Migration reproducible: `db:generate` scaffold + hand-edit-verified + direct-apply-verified | Agent-Probe | Item 1.2–1.4 (generate+verify) + Item 2.1–2.4 (dev apply+verify) | B |
| AC9 | No unrelated behavior change | Fully-Automated | `bun run check` → `bun run lint` (scoped per E1) → `bun test` → admin `finance-export.e2e.ts` | B |

gap-resolution legend: A — proven now; B — fixed in this plan (gate added by this plan's checklist);
C — deferred to a named later phase/plan; D — backlog test-building stub. All rows are B: every gate
is a real, named command already in the plan's Ordered EXECUTE Checklist, not yet run (VALIDATE
precedes EXECUTE) — none are deferred out of scope.

C-4 reconciliation: `strategy:` carries only Fully-Automated / Hybrid / Agent-Probe. No row uses
Known-Gap — every in-scope behavior has a named proving gate.

Legacy line form (retained so existing validate-contract consumers still parse):
- Round-trip (13 cols + NULL): Hybrid — `bunx vitest run packages/core/src/services/timestamptz-roundtrip.integration.spec.ts`
- Finance date-window (AC2/AC3): Hybrid — `bunx vitest run apps/admin/src/lib/server/queries.spec.ts`
- Reconcile age-boundary (AC4): Fully-Automated — `bunx vitest run packages/core/src/services/reconcilePayments*.spec.ts`
- Dashboard live-feed (AC5): Agent-Probe — static grep + dev smoke check
- KPI snapshot (AC6): Hybrid — folded into round-trip spec
- TZ preflight (AC7): Agent-Probe — `SHOW TIMEZONE` per environment, dev + prod
- Migration reproducibility (AC8): Agent-Probe — generate + hand-edit-verify + direct-apply-verify
- Regression (AC9): Fully-Automated — `bun run check` → `bun run lint` (scoped) → `bun test` → admin finance e2e

**Failing stub (AC4 — the one row with a genuine new-scenario shape; AC9 is a suite-level regression
gate, not a single new-behavior scenario, so no stub is generated for it):**

```
test("should skip/credit checkouts correctly across minAge/maxAge/lastPolledAt-throttle boundaries against migrated timestamptz payment_checkouts columns", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: reconcilePayments age-boundary logic against timestamptz-migrated payment_checkouts.created_at/last_polled_at")
})
```

### What this coverage does NOT prove

- **AC1 round-trip spec**: does not prove prod's actual historical data was written under the exact
  conventions assumed (Item 4.3 step 3's SELECT-only human-plausibility preview is the only gate for
  that — this is inherently an Agent-Probe, not automatable).
- **`queries.spec.ts` extension (AC2/AC3)**: proves the query layer's windowing is correct for the
  seeded cross-convention case; does not prove the Finance UI's date-picker or CSV-export renders
  those rows correctly (out of scope per SPEC — "no UI redesign").
- **`reconcilePayments` spec (AC4)**: proves the age-boundary branches; does not prove the gateway
  poll itself (`resolvePaymentStatus`) behaves correctly — that is unchanged, non-timestamp logic and
  out of this plan's blast radius.
- **AC5 static grep + smoke check**: proves the trigger DEFINITION is unaffected; does not
  load-test the live-feed under concurrent writes (not an AC5 requirement).
- **AC7/AC8 Agent-Probe gates**: prove the specific environment checked AT THE TIME OF CHECKING;
  do not prove the environment's `TimeZone` GUC cannot change between the preflight check and the
  actual apply (inherent TOCTOU gap in any two-step manual gate — mitigate by running the DDL apply
  immediately after the preflight check, same session, not deferred).
- **`bun run check` / `bun run lint` / `bun test` / e2e (AC9)**: proves no NEW failure was
  introduced; per E1, `bun run lint` does not currently prove a clean baseline (297 pre-existing
  files) — it can only prove no *additional* files were added to that count by this plan's edits.

### IV. Proposed Plan Updates / Execute-Agent Instructions / Backlog Artifacts

No plan-text rewrites proposed — all four CONCERNs are resolved as Execute-Agent Instructions
(none require changing the Ordered EXECUTE Checklist's prose or ordering; all fit inside the
existing checklist items as clarifications/additions).

**Execute-Agent Instructions:**

| # | Instruction | Trigger condition |
|---|---|---|
| E1 | `bun run lint` (Items 3.5–3.6 boundary) has a pre-existing, plan-unrelated repo-wide failure (297 files of prettier drift, per `tests/all-tests.md` §Known Gaps). Do not require literal exit 0. Instead: record the pre-existing failing-file count as a baseline BEFORE touching any file, run `bun run lint` again after the plan's edits, and confirm the failing-file count did not increase and none of the newly-failing files (if any) are files this plan touched. If `prettier --check .` fails before `eslint .` runs (short-circuit), additionally run `eslint .` directly to confirm no new errors on touched files. Document both counts in the phase report. | Item 3.6 |
| E2 | The EXISTING `apps/admin/src/lib/server/period.spec.ts` (on disk today, not new) asserts OLD wall-clock-spelling values. When rewriting per Item 1.6, explicitly recompute and replace the 2 existing boundary assertions with the new real-instant values (Manila EOD 07-23 → `2026-07-23T15:59:59.999Z`, not `23:59:59.999Z`) — do not merely add new test cases alongside the old (now-wrong) assertions. Hand-verify each new expected value against the −8h offset before writing it into the spec. | Item 1.6 |
| E3 | At close-out (Item 5.2), re-run `ls packages/db/drizzle/*.sql \| wc -l` and use the ACTUAL resulting count in `all-database.md`'s update — do not hardcode "52 → 53". This VALIDATE pass confirmed the router's existing count line is already stale (shows 47, actual on-disk count today is 52) — treat this as a real re-sync, not an increment. | Item 5.2 |
| E4 | Before Item 4.3 step 4 (prod DDL apply), produce a `vc-risk-evidence-pack` (5-artifact schema — `risk-gate.json`, `context-snippets.json` citing the per-column `USING` map + write-path evidence table above, `verification.json` covering the round-trip test + backup-restorability test, `review-decision.json` with explicit APPROVE/REJECT) inside this plan's task folder (`.../finance-timestamptz-migration_23-07-26/harness/`), per `orchestration.md` §High-Risk Execution Handoff — this is a "schema/data migration or destructive data mutation" high-risk class. Do not treat the prod apply as ready to finalize without it. | Before Item 4.3 step 4 |
| E5 | Do not read a green `finance-export.e2e.ts` run (Item 3.8) as AC2/AC3 evidence — it tests CSV-export auth gating only (`period=all`), not date-window correctness. State this explicitly in the phase report so the e2e gate's actual (narrow) meaning isn't over-credited. | Item 3.8 |

**Backlog Artifacts:** none — all findings are in-scope execute-agent instructions, not deferred work.

### Open gaps

- E1–E5 above (all carried as Execute-Agent Instructions, not blocking).
- `all-database.md`'s migration-count line is stale independent of this plan (47 vs actual 52) —
  E3 folds the fix into this plan's own close-out step rather than requiring a separate task.

Gate: CONDITIONAL (0 FAILs; 4 CONCERNs, each resolved as a named Execute-Agent Instruction with no
plan-text rewrite required — no fundamental design flaw, no unresolved FAIL, no return to PLAN)
Accepted by: session — per task brief: "A CONDITIONAL is acceptable if gaps are documented; a
BLOCKED returns to PLAN." All 4 concerns (Test coverage, Security surface, Section B, Section C) are
documented above with named Execute-Agent Instructions (E1–E5); none represent a design flaw or an
unresolved correctness question — the highest-risk item (per-column `USING` map correctness) was
independently traced against write-path source and empirically verified in PGlite, not merely
inherited from the plan's own claims.

## Autonomous Goal Block

```
SESSION GOAL: Migrate 13 finance/session timestamp columns (credit_ledger, points_ledger,
payment_transactions, payment_checkouts, network_sessions, customer_profile) from bare
timestamp to timestamptz with per-column USING correction, plus the atomic period.ts rewrite,
fixing 3 same-root-cause Finance date-window bugs.
Charter + umbrella plan: N/A — single plan (no phase-program umbrella exists for this work).
Autonomy: standard /goal autonomous rules — CONDITIONAL findings apply Execute-Agent Instructions
and proceed; BLOCKED items go to backlog; irreversible/outward-facing action without explicit
contract instruction is a hard stop.
Hard stop conditions / safety constraints:
- Never split the migration + period.ts rewrite across separate commits/PRs (Locked Decision 4) —
  either alone reintroduces a bug.
- Never apply to prod without the SHOW TIMEZONE preflight (Item 4.2) confirming Asia/Manila, and
  never skip the 6-step non-negotiable prod safety sequence (Item 4.3: snapshot → verify-restorable
  → SELECT-only preview → apply → app-smoke → stop-and-restore-on-any-failure).
- Rollback is snapshot-restore ONLY (Locked Decision 6) — never attempt a reverse/down migration.
- Do not touch packages/core/src/services/{sessions.ts,reconcilePayments.ts} (Locked Decision 5 —
  these self-heal once the column type changes; editing them is out of scope and unnecessary).
- Produce the vc-risk-evidence-pack (Execute-Agent Instruction E4) before the prod DDL apply step.
Next phase: EXECUTE — process/general-plans/active/finance-timestamptz-migration_23-07-26/finance-timestamptz-migration_PLAN_23-07-26.md
Validate contract: inline in plan (## Validate Contract section, this file) — Gate: CONDITIONAL,
4 concerns resolved as Execute-Agent Instructions E1-E5.
Execute start: dev — Ordered EXECUTE Checklist Item 0 (Preflight) through Item 3 (test gates,
Fully-Automated: bun run check / bun test; Hybrid: PGlite round-trip + queries.spec.ts extension;
Agent-Probe: TZ preflight, trigger grep, migration reproducibility) | e2e spec:
apps/admin/e2e/finance-export.e2e.ts (narrow — auth-gate only, not AC2/AC3 evidence, per E5) |
high-risk pack: yes — E4, required before Item 4.3 step 4 (prod apply)
```

## Next Step

VALIDATE complete — Gate: CONDITIONAL (0 FAILs, 4 CONCERNs, all resolved as Execute-Agent
Instructions E1–E5 above; see Validate Contract). Say **ENTER EXECUTE MODE** to begin the Ordered
EXECUTE Checklist — execute-agent must apply E1–E5 at the trigger points noted in the table above,
in addition to every existing `[GATE]` item. Before EXECUTE reaches Item 4.3 step 4 (prod apply),
confirm E4's risk-evidence-pack exists per `orchestration.md` §High-Risk Execution Handoff.
