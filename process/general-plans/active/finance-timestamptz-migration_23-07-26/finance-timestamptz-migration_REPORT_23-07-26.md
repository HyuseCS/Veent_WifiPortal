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

---

## UPDATE PROCESS Closeout Packet (23-07-26)

1. **Selected plan path:**
   `process/general-plans/active/finance-timestamptz-migration_23-07-26/finance-timestamptz-migration_PLAN_23-07-26.md`

2. **Closeout classification: Keep in active/testing.** Dev-side implementation and EVL are
   complete and green; prod apply and human prod verification are still pending. This is NOT
   `Ready for UPDATE PROCESS archival` and the plan is NOT `✅ VERIFIED` per its own §Phase
   Completion Rules — do not archive.

3. **What was finished:** migration `0052_pink_maginty.sql` (13 finance/session columns →
   `timestamptz`, per-column `USING` casts matched to write-path evidence); `customer.ts` schema
   updated; `period.ts` rewritten to real Manila-day→UTC-instant math in the same change-set;
   2 new integration specs (AC1 round-trip, AC4 reconcile age-boundary); `period.spec.ts` and
   `queries.spec.ts` extended/corrected (E2). All applied and verified against the dev DB.

4. **Verified vs unverified:**
   - Verified: dev TZ preflight (`Asia/Manila`), dev double-apply guard, dev column-type
     confirmation, dev spot-check of both write conventions, AC1/AC2/AC3/AC4/AC6/AC9 automated
     gates (391 tests, 0 failures), AC5 static trigger grep, `bun run check` clean, scoped lint
     clean. User confirmed dev browser Finance display is correct this session.
   - Unverified: prod TZ preflight (4.2), prod 6-step safety sequence (4.3), `vc-risk-evidence-pack`
     (E4), dev/prod live-feed browser smoke (AC5 dynamic), Finance e2e run (3.8/AC9 breadth),
     human prod verification.

   **4b. Validate-contract compliance:** VALIDATE was run. `## Validate Contract` section is
   present in the plan file (`generated-by: outer-pvl`, `date: 2026-07-23`, `Gate: CONDITIONAL`,
   4 concerns resolved as Execute-Agent Instructions E1–E5). Archival gate note: this is a billing-
   path/schema-migration criterion (AC7, AC8) whose "met" status still rests on Agent-Probe gates
   that have only been run in dev, not prod — per the vacuous-green ban, dev-only Agent-Probe
   evidence does NOT satisfy the prod half of AC7/AC8. This is precisely why the plan is NOT
   archivable yet and stays `Keep in active/testing`.

5. **Cleanup done vs still needed:**
   - Done this session: `process/context/database/all-database.md` and
     `process/context/all-context.md` migration-count sync (49/47-stale → 53) plus a durable
     timestamptz-convention learning note (Execute-Agent Instruction E3, deferred from EXECUTE per
     phase-lock); plan file's Current State / checklist / Next Step sections updated to reflect
     dev-done/prod-pending; this closeout packet written; project memory updated (see below).
   - Still needed: E4 risk-evidence-pack, prod-apply runbook execution (4.2, 4.3), dynamic AC5
     smoke, Finance e2e (3.8), human prod sign-off — all tracked in the plan's Current State /
     Next Step sections, not lost to chat history.

6. **Single best next valid state:** Keep the plan active and route the prod-apply runbook (E4 →
   4.2 → 4.3 → dynamic AC5 smoke → 3.8 → human sign-off) as the next explicit action — do not
   re-open RESEARCH/PLAN for this; the plan's Next Step section already sequences it.

7. **Commit-checkpoint recommendation: Execution commit recommended before UPDATE PROCESS** for
   the dev-side change-set (migration + schema + period.ts + specs) — however per user instruction
   this session, the user commits himself (no `vc-git-manager` invoked here); this closeout does
   not perform or require a commit. The context-doc edits from this UPDATE PROCESS pass are
   process-only and may be committed separately by the user whenever convenient.

8. **Regression status:** N/A — single-plan change-set, not a phase program; no prior-phase
   surfaces to regression-check against within this plan's scope. Repo-wide `bun run test`
   (391 tests, 0 failures) stands in as the whole-repo regression gate for AC9.

9. **SPEC achievement** (against the locked `finance-timestamptz-migration_SPEC_23-07-26.md`, 9 ACs):

   | AC | Criterion | Status |
   |---|---|---|
   | AC1 | Round-trip instant correctness, incl. NULL | **met** — Hybrid gate green |
   | AC2 | Finance date filters include same-day rows across sources | **met** — Hybrid gate green |
   | AC3 | `listUnifiedTransactions` windows correctly cross-convention | **met** — Hybrid gate green |
   | AC4 | `reconcilePayments` age-boundary logic correct | **met** — Fully-Automated gate green |
   | AC5 | No dashboard live-feed regression | **unmet (partial)** — static half PASS; dynamic browser smoke not yet run |
   | AC6 | KPI/revenue byte-identical | **met** — folded into AC1 spec, green |
   | AC7 | TZ preflight confirmed per environment before apply | **unmet (partial)** — dev confirmed `Asia/Manila`; prod preflight not yet run |
   | AC8 | Migration reproducible (generate/hand-edit/apply/verify) | **unmet (partial)** — dev apply-and-verify done; prod apply not yet run |
   | AC9 | No unrelated behavior change | **met** — full gate suite green, zero new failures |

   Unmet-partial criteria (AC5, AC7, AC8) are exactly the criteria whose remaining half is the
   prod-apply sequence — this is expected given the deliberate dev-only scope boundary, not a gap
   discovered late. Backlog NOTE is not written separately because the plan file's own Current
   State / Next Step sections already carry these as the explicit next action (avoiding a
   duplicate tracking surface for the same 6 items).

**Drift signal scoring:** (a) files touched ≥10 this session-cycle overall (dev EXECUTE) +1+1;
(b1) no `.claude/`/`.codex`/agent-harness files touched +0; (b2) `process/context/` files changed
this UPDATE PROCESS pass (`all-database.md`, `all-context.md`) +1; (c) 3+ memory-worthy
observations (timestamptz root-cause convention, `bun run test` vs `bun test` gotcha, prod-apply
runbook sequencing) +1; (d) no feature-folder structural change (general-plan, not feature) +0;
(e) no validate-contract deviation beyond the already-accepted E1–E5 concerns +0. **Total: 4
signals → HIGH.**

Strongly recommend UPDATE PROCESS -- harness/protocol files touched.

(Note: item (b1) is technically 0 here — "harness/protocol touched" in the required threshold
phrase refers to the wording match required by the skill contract, not a literal claim that
`.claude/` files changed this session. No `.claude/`/`.codex/` files were touched; the phrase is
reproduced verbatim as required regardless, since the total signal count crossed the HIGH
threshold via (a)+(b2)+(c).)
