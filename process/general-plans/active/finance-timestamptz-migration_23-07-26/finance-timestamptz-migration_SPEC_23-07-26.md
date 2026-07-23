---
name: plan:finance-timestamptz-migration-spec
description: "Migrate finance/session timestamp columns from bare wall-clock to real timestamptz instants, fixing three same-root-cause date-window bugs in Finance"
date: 23-07-26
feature: none
---

# Finance / Session Timestamptz Migration — SPEC

## Summary

Right now, when the system records "when did this happen" for money and session events (a
top-up, a credit spend, a free-time grant, a payment webhook), it stores a clock reading with
no timezone attached — and two different parts of the code write that clock reading in two
different timezones (some in Manila local time, some in UTC) without saying so. The database
column type can't tell the difference, so a value that *looks* like "2026-07-23 14:00" might
mean 2pm Manila or 2pm UTC (which is 10pm Manila) depending on which code path wrote it. This
already caused one visible bug (Finance date filters dropping same-day rows) and this session's
research found two more of the same root cause, one of them live in the just-shipped Unified
Transactions feed. This work fixes the actual cause once: every affected column becomes a real,
timezone-aware instant (`timestamptz`), migrated with a per-column correction so every existing
historical row keeps meaning the same real moment it always meant. Once that's true, all three
bugs disappear because the comparisons become "instant vs instant" instead of "ambiguous
wall-clock vs ambiguous wall-clock."

This is a billing-adjacent schema change — it touches the tables Finance and revenue reporting
read from, and a wrong per-column correction during backfill would permanently shift historical
revenue timestamps by 8 hours. The SPEC below defines what "done and safe" means before any
migration SQL is written.

## User Stories / Jobs To Be Done

- As a **Finance staff member**, I want the date filters on the Finance overview, the
  `/finance/transactions` page, and the CSV export to show every transaction that happened on
  the day I selected — including free-time/session grants — so that daily revenue and activity
  reports are trustworthy and I don't have to manually cross-check for missing rows.

- As a **Finance staff member using the Unified Transactions feed**, I want free-time and
  session-grant rows to appear in the same day-window as the money transactions that happened
  alongside them, so the merged activity list tells one consistent story of what happened on a
  given day.

- As an **operator relying on automatic payment reconciliation**, I want the reconcile job's
  "is this checkout too old to retry / too new to check yet" age logic to compare real elapsed
  time correctly, so that pending payments are neither reconciled too early nor abandoned too
  late because of a timezone miscalculation.

- As **whoever operates this database in production**, I want a documented, verified migration
  path (with a rollback story and a timezone preflight) so that a billing-adjacent schema change
  doesn't silently corrupt historical revenue timestamps.

## What The User Wants (Behavioral Outcomes)

- Every timestamp column in scope (see Background) stores a real point in time, not an ambiguous
  wall-clock reading. Reading the same real-world moment back — no matter which code path wrote
  it — gives the same instant.
- The Finance overview, `/finance/transactions` (including CSV export), and the Unified
  Transactions feed all use one consistent definition of "today" / "this date range" across every
  row type they show (Maya payments, credit/points ledger entries, free-time/session grants).
- The payment-reconciliation job's age-based decisions (skip-too-new / give-up-too-old / throttle
  polling) are based on correct elapsed real time, not a wall-clock subtraction that silently
  assumes both sides are in the same timezone.
- Nothing else about how Finance looks or behaves changes. This is a correctness fix under the
  hood — the UI, the CSV shape, the KPI/revenue numbers (for transactions that were already
  correctly windowed), and every other timestamp column outside this scope are untouched.
- The fix is safe to run against the real production database: someone can verify, before running
  it for real, that the correction applied to historical rows is the right one for that
  environment's actual clock setting.

## Flow / State Diagram

**Today (the bug):**

```
Write path A (.defaultNow())        Write path B (new Date() in JS)
   e.g. credit_ledger.created_at        e.g. network_sessions.started_at
   stores: DB-session-local wall-clock  stores: UTC wall-clock
        │                                      │
        ▼                                      ▼
   column type: timestamp (no tz) ────────────┘
        │
        ▼
   Finance reads a date-range filter (Manila-anchored boundaries)
        │
        ├─▶ compares against path-A columns  → correct (same convention)
        └─▶ compares against path-B columns  → WRONG (8h offset, rows silently
                                                 missing or shown on wrong day)
```

**After migration (the fix):**

```
Write path A (.defaultNow())        Write path B (new Date() in JS)
        │                                      │
        ▼                                      ▼
   column type: timestamptz  ◀── per-column USING cast converts each
        │                        historical row to the SAME real instant
        ▼                        it always represented, regardless of
   Finance reads a date-range      which convention wrote it
   filter (any timezone-aware
   boundary)
        │
        └─▶ compares against ANY in-scope column → correct (instant vs instant)
```

**Migration state machine (safety path, not an implementation plan):**

```
[preflight: confirm session TimeZone per environment]
        │
        ▼
[dry-run: verify per-column USING cast against a copy/sample of real data]
        │
        ▼
[apply migration: ALTER COLUMN ... TYPE timestamptz USING <per-column expr>]
        │
        ▼
[round-trip verify: write via both conventions, read back, confirm same instant]
        │
        ▼
[app-level verify: Finance filters, Unified Transactions, reconcile age logic]
        │
        ▼
        DONE (or roll back if any step fails)
```

## Acceptance Criteria (Testable Outcomes)

1. **Round-trip instant correctness.** For every in-scope column, a value written before the
   migration and a value written after the migration, both representing the same real-world
   instant, read back as the identical instant (not off by 8 hours or any other offset).
   `proven by:` a Hybrid PGlite integration test (same pattern as
   `packages/core/src/services/outage.integration.spec.ts` /
   `networkHealth.integration.spec.ts` — real migration chain applied, real Postgres semantics)
   asserting pre- and post-migration writes/reads round-trip to the same instant for each
   in-scope column.
   `strategy:` Hybrid

2. **Finance date filters include all same-day rows, including free-time/session grants.** The
   Finance overview, `/finance/transactions` list, and CSV export, when filtered to a given day,
   include every transaction that happened that day across all five Unified Transactions sources
   (Maya payments, standalone credit top-ups, credit spends, points spends, free-time grants) —
   not just the `.defaultNow()`-written sources.
   `proven by:` extends `apps/admin/src/lib/server/queries.spec.ts` (real-Postgres PGlite
   integration suite already covering `listUnifiedTransactions`) with a same-day
   cross-write-convention case (a free-time/session row and a Maya payment row on the same real
   day, migrated from opposite pre-migration conventions).
   `strategy:` Hybrid

3. **`listUnifiedTransactions` windows session rows correctly.** A `network_sessions` free-time
   row and a `credit_ledger`/`points_ledger` row created at the same real instant fall in the same
   date-range window when queried with the same `from`/`to` boundary.
   `strategy:` Hybrid — same test as AC2 (`queries.spec.ts` extension), asserted at the query
   level rather than the UI level.

4. **Reconcile age-boundary logic is correct against the migrated columns.** `reconcilePayments`'s
   min-age/max-age skip logic and the polling throttle compare real elapsed time correctly
   post-migration (no silent 8-hour miscalculation).
   `proven by:` existing/extended unit-or-integration coverage for `reconcilePayments.ts`
   (age-boundary branches), run against the migrated column type.
   `strategy:` Fully-Automated

5. **No dashboard live-feed regression.** The `pg_notify` triggers backing the admin dashboard
   live feed (0006 migration, `FOR EACH STATEMENT`, no column reference) continue to fire
   correctly after the column type change.
   `proven by:` manual/agent-probe confirmation that the trigger definitions do not reference the
   altered columns (static check) plus a smoke check that the live feed still updates after
   migration in a dev environment.
   `strategy:` Agent-Probe

6. **KPI / revenue numbers are unchanged for correctly-windowed data.** Existing KPI and revenue
   query outputs for date ranges that were already correct pre-migration (i.e., all-`.defaultNow()`
   sources) produce byte-identical results post-migration.
   `proven by:` a before/after snapshot comparison run against representative seeded data
   (`apps/admin/scripts/seed-test-data.ts` or equivalent) for at least one KPI/revenue query.
   `strategy:` Hybrid

7. **Pre-migration timezone preflight is a hard precondition, not an assumption.** Before the
   migration is applied to any environment (dev or prod), the actual Postgres session `TimeZone`
   setting for that environment is confirmed (`SHOW TIMEZONE` or equivalent) and matches the
   assumption the per-column `USING` cast is built on.
   `proven by:` a documented preflight step with recorded output per environment, checked before
   migration apply (not a code-level test — a required manual/agent-probe gate).
   `strategy:` Agent-Probe

8. **Migration is reproducible and generated for the record.** `db:generate` produces a committed
   migration file under `packages/db/drizzle/`, and the actual applied DDL (which may require
   hand-editing beyond what `drizzle-kit generate` emits) is verified to match what was applied to
   the local dev DB before being treated as ready to run against prod.
   `proven by:` direct DDL application + verification against the local (drifted, push-managed)
   dev DB per the existing migration-verification convention in `process/context/database/all-database.md`.
   `strategy:` Agent-Probe

9. **No unrelated behavior changes.** No out-of-scope column, table, or Finance/KPI computation
   changes behavior as a result of this migration.
   `proven by:` full existing test suite (`bun run check` → `bun run lint` → `bun test` → admin
   `test:e2e` finance-related specs) stays green with no new failures introduced by this change.
   `strategy:` Fully-Automated

## Out Of Scope

- `network_health.{offline_since, online_since, last_sample_at}` — network-ops current-state
  stamps; explicitly excluded per prior project decision, not touched without separate
  justification.
- `admin_issue.*`, `admin_notification_read.*`, `admin_owner_change.*`, better-auth
  session/verification tables, `faqs.*`, `app_settings.updated_at`,
  `admin_profile.last_active_at` — no date-range finance query depends on these; excluded.
- `admin_bypass_device.updated_at` — already `timestamptz`; referenced only as a pattern example,
  not touched.
- Any UI redesign, new filter feature, or new Finance capability. This is a data-correctness fix
  only — the Finance UI's visible behavior changes ONLY in that previously-missing rows now
  appear; no new controls, columns, or views are added.
- Choosing the actual migration SQL / per-column `USING` expressions and the execution order —
  that belongs to INNOVATE/PLAN, not this SPEC.
- Reconciling the pre-existing dev-DB migration journal drift — out of scope; use the documented
  direct-apply-to-verify workaround, not a chain reconciliation.

## Constraints

- **Billing-path change — high-risk class.** Treat with the rigor `process/context/all-context.md`
  §Gotchas requires for Maya payment paths: money math and grant atomicity are high-risk; this
  migration touches the tables that feed that math.
- **Irreversibility of backfill.** A wrong per-column `USING` cast permanently shifts historical
  revenue timestamps by 8 hours with no way to recover the original ambiguous value. Round-trip
  verification (AC1) is mandatory before the migration is considered safe to apply to prod.
- **Session TimeZone is not pinned anywhere in the repo.** No `TZ=`, `SHOW TIMEZONE`, or
  Postgres `timezone` config was found in `packages/db/src/client.ts`, `compose.yaml`, or any
  `.env.example`. The per-column `USING` cast's correctness depends entirely on the actual
  session `TimeZone` GUC of each environment's Postgres instance at write time — this must be
  confirmed empirically (AC7), not assumed from code.
- **Dev DB is push-managed; `db:migrate` fails on journal drift.** New migration SQL must still
  be `db:generate`'d for the record, then applied directly (e.g. `psql`/`postgres` one-liner) to
  verify locally — per `process/context/database/all-database.md` Canonical Notes. Do not attempt
  to reconcile the journal drift as part of this work.
- **`drizzle-kit generate` may not emit a usable `USING` clause for a type-changing `ALTER
  COLUMN` on a populated table.** This is the first ALTER-on-populated-column type change in this
  repo (per RESEARCH). PLAN must treat the generated migration file as a draft requiring manual
  verification/editing, not as usable output as-is.
- **`payment_checkouts` needs a per-column cast, not a table-wide one.** `created_at` is
  Manila-wall; `settled_at` and `last_polled_at` are UTC-wall — confirmed by write-path
  inspection (`reconcilePayments.ts` uses `new Date()` for both; the column has no `.defaultNow()`
  default).
- Migration count at SPEC time: 52 files (`0000`–`0051`), newest `0051_powerful_rachel_grey.sql`.
  Re-verify the count at PLAN/EXECUTE time.
- No schema/migration authority other than `packages/db` — this remains the sole migration source
  for all three apps (per `all-context.md`).
- Follow the existing Hybrid/PGlite round-trip test pattern already used in
  `packages/core/src/services/outage.integration.spec.ts` /
  `networkHealth.integration.spec.ts` / `apps/admin/src/lib/server/queries.spec.ts` rather than
  inventing a new test infrastructure pattern.

## Open Questions

None — the five items flagged for this session were resolved during SPEC research:

1. **`payments.ts` / `paymentWebhook.ts` write-path convention — RESOLVED.** `paymentWebhook.ts`
   never sets `createdAt` explicitly; it calls `recordPaymentTransaction` (in
   `packages/core/src/services/reconcilePayments.ts`), which does
   `.insert(paymentTransactions).values(row)` with no `createdAt` override — so
   `payment_transactions.created_at` is always written via the column's `.defaultNow()` (Manila
   session-local wall-clock). `payments.ts` itself only constructs the payment provider client; it
   writes no timestamps. This confirms `payment_transactions.created_at` belongs to the
   Manila-wall write-path group.

2. **View/materialized-view dependency check — RESOLVED.** `grep -rn "CREATE.*VIEW\|MATERIALIZED
   VIEW" packages/db/drizzle/` returned no matches. No view depends on any in-scope column's type.

3. **`expires_at` and `customer_profile.*` column conventions — RESOLVED.**
   `network_sessions.expires_at`, `customer_profile.access_expires_at`, and
   `customer_profile.access_paused_at` are all written exclusively via explicit `new Date()` calls
   in `packages/core/src/services/sessions.ts` (no `.defaultNow()` default on any of these three
   columns in the schema) — confirmed UTC-wall, same group as `network_sessions.{started_at,
   bound_at, last_seen_at}`. `customer_profile.last_free_session_at` is likewise written via
   `.set({ lastFreeSessionAt: now })` where `now = new Date()` (`sessions.ts`) — UTC-wall.

4. **Whether `drizzle-kit generate` emits a usable `USING` clause — noted, not resolved (by
   design).** Per the task brief, this is correctly deferred as a PLAN-time verification step, not
   a SPEC-blocking question. Captured as a Constraint above.

5. **Prod session TimeZone confirmation — noted, not resolved (by design).** Cannot be verified
   from source code. Captured as AC7 (a required pre-migration precondition/gate), not a SPEC
   blocker.

## Background / Research Findings

**Root cause (established empirically this session).** Finance/session columns are
`timestamp WITHOUT time zone` — a bare wall-clock reading with no timezone anchor. Two different
write conventions exist for the same kind of "when did this happen" fact:

- **Manila-wall writers** (Drizzle `.defaultNow()`, which defers to the Postgres session
  `TimeZone`, empirically Asia/Manila in dev): `credit_ledger.created_at`,
  `points_ledger.created_at`, `payment_transactions.created_at`, `payment_checkouts.created_at`.
- **UTC-wall writers** (explicit JS `new Date()`, which `postgres.js` binds via
  `toISOString()`): `network_sessions.{started_at, bound_at, last_seen_at, expires_at}`,
  `payment_checkouts.{settled_at, last_polled_at}`, `customer_profile.{last_free_session_at,
  access_expires_at, access_paused_at}`.

`payment_checkouts` is split WITHIN one table — `created_at` is Manila-wall, `settled_at` and
`last_polled_at` are UTC-wall — confirming that any migration needs a per-column, not per-table,
correction.

**Three same-root-cause bugs found this session:**

1. **Finance date filters drop same-day rows** (the originally reported bug). An interim
   app-side mitigation already shipped in `apps/admin/src/lib/server/period.ts`
   (Manila-anchored boundaries for the money sources) — this SPEC's migration is the permanent
   fix that removes the need for that workaround.
2. **`listUnifiedTransactions` mis-windows session/free-time rows.** Confirmed by reading
   `apps/admin/src/lib/server/queries.ts` (~lines 837–850): the function filters
   `networkSessions.startedAt` (UTC-wall) using the same `opts.from`/`opts.to` boundaries applied
   to `creditLedger.createdAt`/`pointsLedger.createdAt` (Manila-wall) — an 8-hour mismatch. This
   is a NEW finding, live in the just-shipped Unified Transactions feature
   (`process/general-plans/completed/unified-transaction-history_21-07-26/`).
3. **`reconcilePayments.ts` age-boundary math is timezone-naive.** Confirmed:
   `.where(and(lte(paymentCheckouts.createdAt, minAge), gt(paymentCheckouts.createdAt,
   maxAge)))` and the `lastPolledAt` throttle compare a Manila-wall/UTC-wall column against
   JS-built `Date` boundaries with no timezone correction.

**Existing test infrastructure to reuse (not invent).** Two Hybrid/PGlite real-Postgres
integration tests already establish the pattern this migration's verification should follow:
`packages/core/src/services/outage.integration.spec.ts` and
`packages/core/src/services/networkHealth.integration.spec.ts` (apply the real migration chain
via PGlite, no external DB needed, genuinely enforce committed constraints). `apps/admin/src/lib/server/queries.spec.ts`
already covers `listUnifiedTransactions` with the same real-Postgres pattern and is the natural
extension point for AC2/AC3.

**Migration/database conventions (from `process/context/database/all-database.md`):** `packages/db`
is the sole migration authority; dev DB is push-managed (`db:migrate` fails on journal drift —
apply new migration DDL directly via `psql`/`postgres` to verify locally, still run `db:generate`
for the committed record); migration count is a snapshot, re-check
`ls packages/db/drizzle/*.sql | wc -l` (52 as of this SPEC, `0000`–`0051`).

**Test conventions (from `process/context/tests/all-tests.md`):** all apps + `packages/core` use
Vitest 4 with `requireAssertions: true`; `packages/db` itself has no test script (zero tests);
scope single-file runs with `bunx vitest run <file>` from inside the target package (never `bun
test <file>` — silently no-ops fake timers). Recommended gate order:
`bun run check` → `bun run lint` → `bun test` → admin `test:e2e` (Finance-touching specs) last.

**User-approved locked decision (this session):** full root-cause fix — migrate all in-scope
columns to `timestamptz` with correct per-column `USING` casts in one migration, resolving all
three bugs above at once, rather than patching each symptom independently.
