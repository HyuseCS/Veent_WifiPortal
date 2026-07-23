---
phase: finance-timestamptz-migration
date: 2026-07-23
status: COMPLETE_WITH_GAPS
feature: none
plan: process/general-plans/active/finance-timestamptz-migration_23-07-26/finance-timestamptz-migration_PLAN_23-07-26.md
---

# Finance / Session Timestamptz Migration — EXECUTE Report (DEV-SIDE)

**Scope executed: dev-side only.** All checklist items 0 → 3 complete + AC5 static (Item 4.1) done.
Prod gates (4.2, 4.3), E4 risk-evidence-pack, and dev live-feed browser smoke deliberately NOT run
— they await the manual operator handoff / human verification per the hard scope boundary.

## What Was Done

- **Item 0.3 GATE (AC7 dev):** `SELECT current_setting('TimeZone')` on dev DB
  (`postgres://root:***@localhost:5432/local`) → **`Asia/Manila`**. Recorded, gate passed.
- **Item 1.1:** `packages/db/src/schema/customer.ts` — added `{ withTimezone: true }` to all 13
  in-scope columns (3 customer_profile, credit_ledger.created_at, points_ledger.created_at,
  payment_transactions.created_at, 3 payment_checkouts, 4 network_sessions). Modifiers
  (`.notNull().defaultNow()`) preserved; out-of-scope columns untouched.
- **Item 1.2:** `db:generate` → `0052_pink_maginty.sql` (+ `meta/0052_snapshot.json`, journal entry).
- **Item 1.3 GATE:** As the E-gate predicted, drizzle-kit emitted **no `USING` clauses** (bare
  `SET DATA TYPE`, which would implicit-cast in session TZ — wrong for UTC-wall columns).
  Hand-edited the SQL to add explicit per-column `USING` casts matching Locked Decision 3 exactly.
  Cell-by-cell audit passed (all 13 correct).
- **Item 1.4:** One file, **6 grouped `ALTER TABLE` statements** (payment_checkouts is a per-column
  split — created_at Manila, settled_at/last_polled_at UTC — in ONE ALTER TABLE, never table-wide).
- **Item 1.5:** `apps/admin/src/lib/server/period.ts` `parsePeriod()` rewritten — replaced the
  wall-clock-SPELLING `Date.UTC(...)` trick with real Manila-day → UTC-instant math (fixed −8h,
  documented no-DST). Stale `ponytail: known gap` comment removed (verified gone).
- **Item 1.6 / E2:** `period.spec.ts` — REPLACED the 2 old wall-clock-spelling assertions with real
  instant values (Manila EOD 07-23 → `2026-07-23T15:59:59.999Z`), added 7d/30d/90d boundary cases +
  cross-UTC-midnight edge + `all` passthrough. 5 tests, green.
- **Item 2.1 GATE:** double-apply guard — all 13 columns confirmed still `timestamp without time
  zone` before apply.
- **Item 2.2:** applied `0052_pink_maginty.sql` to dev DB atomically
  (`psql --single-transaction -v ON_ERROR_STOP=1`), exit 0.
- **Item 2.3 GATE:** all 13 columns now `timestamp with time zone`.
- **Item 2.4:** spot-check — credit_ledger.created_at `2026-07-22 14:47:03` (Manila-wall) →
  UTC-instant `06:47:03Z` (Manila-render preserved 14:47); network_sessions.started_at
  `2026-07-22 05:49:11` (UTC-wall) → UTC-instant `05:49:11Z` (Manila-render 13:49). Both plausible
  daytime, both conventions cast correctly.
- **Item 3.1 GATE (AC1):** `packages/core/src/services/timestamptz-roundtrip.integration.spec.ts`
  (new) — two-phase (chain excl. 0052 → raw seed → apply 0052 DDL). Manila-wall → 06:00Z, UTC-wall
  → 14:00Z, NULL cases stay NULL. Green.
- **Item 3.2 GATE (AC2/AC3):** `apps/admin/src/lib/server/queries.spec.ts` extended — same-real-day
  cross-convention windowing (Maya money row + free-time session both in one Manila-day window) +
  next-Manila-day boundary exclusion. 12 tests total, green.
- **Item 3.3 GATE (AC4):** `packages/core/src/services/reconcilePayments.integration.spec.ts` (new,
  no prior spec existed) — minAge/maxAge select + aged-out expire + lastPolledAt throttle (stale /
  hot / NULL) against migrated timestamptz columns. Green.
- **Item 3.4 (AC6):** folded into the AC1 spec — `date_trunc('day', ...)` of the Manila-wall revenue
  column is byte-identical (same `2026-07-21` bucket) across the migration.
- **Item 3.5:** `bun run check` → exit 0 (all 3 apps, 0 errors). packages/core `tsc --noEmit` clean.
- **Item 3.6 / E1:** lint scoped to touched files (baseline-diff, not literal exit-0 — repo has 297
  pre-existing prettier-drift files). All 6 touched TS files: `prettier --check` clean, `eslint` no
  errors. Zero added to the drift count.
- **Item 3.7:** `bun run test` (vitest fan-out) — **@veent/core 88 / locator 6 / customer 131 /
  admin 166 = 391 tests, 0 failures.** AC9 regression PASS.
- **Item 4.1 GATE (AC5 static):** all dashboard notify triggers are `FOR EACH STATEMENT`, function
  body only `pg_notify('dashboard', '')`, zero in-scope column references. Static half passed.
- **Locked Decision 5 confirmed:** `sessions.ts` / `reconcilePayments.ts` NOT touched — both write
  via JS `Date` (a real instant), which `postgres.js` binds correctly to timestamptz; the bug was
  only the bare column's storage/reinterpretation + period.ts's boundary spelling. Both self-heal
  with zero code change (proven by AC4 spec running unmodified reconcile code against the migrated
  columns, all green).

## New migration file + hand-edited USING SQL

`packages/db/drizzle/0052_pink_maginty.sql` (migration #53, `0000`–`0052`). USING map applied:
- Manila-wall `AT TIME ZONE 'Asia/Manila'`: credit_ledger.created_at, points_ledger.created_at,
  payment_transactions.created_at, payment_checkouts.created_at
- UTC-wall `AT TIME ZONE 'UTC'`: payment_checkouts.settled_at/last_polled_at,
  network_sessions.started_at/bound_at/last_seen_at/expires_at,
  customer_profile.last_free_session_at/access_expires_at/access_paused_at

## What Was Skipped or Deferred

- **Item 4.2, 4.3 (prod TZ preflight + 6-step prod safety sequence):** NOT run — prod apply awaits
  the manual operator handoff (hard scope boundary).
- **E4 (vc-risk-evidence-pack):** NOT run — this is the orchestrator/operator step before the manual
  prod apply, not a dev-side execute step.
- **Item 3.8 (finance e2e):** NOT run as a gate — per E5, `finance-export.e2e.ts` only tests CSV
  auth-gating (`period=all`), NOT date-windowing, so it is not AC2/AC3 evidence. EVL owns the e2e
  confirmation run.
- **Item 4.1 dev live-feed browser smoke (AC5 dynamic half):** deferred to human verification —
  browser-visible, requires a running app + top-up action.
- **Item 5.2 / E3 (`all-database.md` migration-count re-sync 47→53):** deferred to UPDATE PROCESS —
  EXECUTE phase-lock forbids editing `process/context/`. On-disk count is now **53**; the router
  line is stale (shows 47) and must be re-synced in UPDATE PROCESS.

## Test Gate Outcomes

| Gate | Result |
|---|---|
| AC1 round-trip (incl. NULL) — timestamptz-roundtrip.integration.spec.ts | PASS |
| AC2/AC3 same-day cross-convention — queries.spec.ts | PASS |
| AC4 reconcile age-boundary — reconcilePayments.integration.spec.ts | PASS |
| AC5 static trigger grep | PASS (dynamic smoke deferred) |
| AC6 KPI bucket byte-identical | PASS |
| AC7 dev TZ preflight | PASS (Asia/Manila) |
| AC8 db:generate + hand-edit + dev direct-apply-verify | PASS |
| AC9 bun run check / lint(scoped) / bun run test | PASS (391 tests, 0 fail) |

## Plan Deviations

1. **`bun test` → `bun run test`.** Item 3.7 names `bun test`; the bare `bun test` invokes bun's
   NATIVE runner (documented gotcha in `tests/all-tests.md` — no-ops `vi.mock`/`$env`, produces
   spurious failures). Used the documented vitest fan-out `bun run test` instead. Within-scope
   tooling clarification, not a behavior change.
2. **Item 5.2/E3 deferred to UPDATE PROCESS** (EXECUTE cannot edit `process/context/`). Documented above.
3. **`0052` migration hand-edited** (expected by plan Item 1.3 — drizzle emitted no USING). The
   committed `.sql` diverges from the raw drizzle scaffold by design; snapshot/journal (which track
   schema, not SQL text) are unaffected and consistent.

## Test Infra Gaps Found

- None new. Confirmed the existing `bun test` native-runner gotcha applies to the repo-wide gate —
  `bun run test` is the correct invocation.

## Closeout Packet

- **Selected plan:** `process/general-plans/active/finance-timestamptz-migration_23-07-26/finance-timestamptz-migration_PLAN_23-07-26.md`
- **Finished (verified):** dev-side schema + migration + period.ts rewrite as one change-set; all
  automated gates green (391 tests); dev DB migrated + verified (all 13 columns timestamptz,
  round-trip instant-correct).
- **Unverified / remaining:** prod apply (manual operator, gated by 4.2/4.3 + E4 risk pack); dev
  live-feed browser smoke (AC5 dynamic); finance e2e (EVL); `all-database.md` count re-sync (UPDATE
  PROCESS); user browser/app confirmation.
- **Best next state:** `Keep in active/testing` — code-complete + dev-verified, but prod apply and
  human verification pending. Do NOT archive; do NOT mark VERIFIED (billing-path risk class requires
  prod confirmation or an explicit user-accepted deferral).

## Forward Preview

### Test Infra Found
- PGlite full-chain migrator + two-phase (journal-truncation) pattern works for migration-DDL tests.
- `bun run test` (not `bun test`) is the repo-wide vitest gate.

### Blast Radius Changes
- `packages/db/src/schema/customer.ts` (13 cols), new `0052_pink_maginty.sql` + snapshot/journal,
  `apps/admin/src/lib/server/period.ts` + `period.spec.ts` + `queries.spec.ts`, 2 new `packages/core`
  integration specs. `packages/core` source (sessions.ts/reconcilePayments.ts) untouched.

### Commands to Stay Green
- `bun run check` · `bun run test` · scoped `bunx prettier --check`/`eslint` on touched files.

### Dependency Changes
- None. (`@electric-sql/pglite` already a devDependency in admin + core.)
