---
name: plan:ap-name-collision-retry
description: "Complete per-ap-visibility checklist 2.6 / constraint E3: catch the network_health_name_key unique violation on the AP upsert and retry once with the MAC-tail-suffixed name. Concurrency-hardening fix in packages/core/src/services/networkHealth.ts plus integration + unit specs. SIMPLE plan."
date: 20-07-26
feature: general-plans
---

# AP Name-Collision Retry — Plan (SIMPLE)

**Date**: 20-07-26
**Status**: VERIFIED — checklist 1-8 implemented, all 6 ACs proven by independently re-run gates (EVL confirmation run), committed as `9988faf`
**Complexity**: SIMPLE

## Phase Completion Rules

Single-phase plan. Completion states: `PLANNED` → `CODE DONE` (checklist 1-7 implemented, gates not yet independently confirmed) → `VERIFIED` (checklist 8 green via spawned vc-tester EVL run). Code-only completion is `CODE DONE`, never `VERIFIED`. Context routing per `process/context/all-context.md` (tests group loaded).

**TL;DR:** The per-AP visibility work shipped only the pre-check half of checklist 2.6; a concurrent refresh can still claim an AP's name between the SELECT and the INSERT (TOCTOU), making the whole `refreshAccessPoints` cycle throw on `network_health_name_key`. This plan adds the specified second layer: catch that specific unique violation on the AP upsert and retry ONCE with `${base} (${mac.slice(-5).replace(':','')})`, propagating everything else unchanged. `packages/core` only — no schema change, no new dependency.

## Overview

Origin: `process/general-plans/active/per-ap-visibility_16-07-26/per-ap-visibility_PLAN_16-07-26.md`
— checklist **2.6** (line 171, authoritative retry spec) and execute constraint **E3** (line 373).
What shipped (`packages/core/src/services/networkHealth.ts`): `resolveApName` (~line 394) does a
pre-check SELECT and suffixes on a known clash; the AP upsert (~line 308-331) is
`onConflictDoUpdate({ target: networkHealth.mac })`. A `name` unique violation is NOT covered by
that conflict target and propagates unhandled — `refreshAccessPoints` throws, and the caller
degrades to interface-only for that cycle.

Prose discrepancy note: risk R2 (plan line 137) says "last-4-of-MAC"; 2.6 says
`mac.slice(-5).replace(':','')` (5 chars incl. colon → 4 hex chars after replace). Shipped code
follows 2.6. **2.6 is authoritative**; R2's prose is imprecise, not a conflict.

## Goals

1. TOCTOU-harden the AP name write: a concurrent name claim between pre-check and insert no longer aborts the AP refresh cycle.
2. Satisfy E3: retry mechanics do not poison any enclosing transaction (verified: there is none — standalone statement + try/catch is compliant).
3. Assert the retry path in the integration suite (or record an honest known-gap if PGlite cannot raise it) — silent coverage claims forbidden.
4. Correct the misleading `resolveApName` docstring that implies the pre-check replaced the retry.

## Scope

- **In:** `packages/core/src/services/networkHealth.ts` (AP upsert in `refreshAccessPoints`, `resolveApName` docstring), `packages/core/src/services/networkHealth.integration.spec.ts`, one small pure error-identification helper + its unit spec (same file family).
- **Out:** schema, migrations, `resolveApName` logic (pre-check STAYS — the retry is the second layer), mac-keyed identity, `trafficBytes` COALESCE, since-transitions, apps/*, any retry loop beyond ONE retry.

## Key Design Facts (established during planning research)

**F1 — No wrapping transaction (E3 verified).** `refreshNetworkHealth` is called from
`apps/admin/src/routes/(app)/networks/+page.server.ts:55` and
`apps/admin/src/routes/api/network/health/refresh/+server.ts:29` (inside `Sentry.withMonitor`,
which is not a DB transaction). Neither call site nor `refreshAccessPoints` itself opens a
`db.transaction`. Therefore E3's "standalone statement + try/catch" branch applies — **no
savepoint needed**. EXECUTE must re-confirm this with a fresh grep before implementing (E3
requires the savepoint branch if a wrapping transaction ever appears).

**F2 — Error identification.** drizzle-orm wraps driver errors in `DrizzleQueryError`; the
SQLSTATE lives on the bounded `cause` chain. The repo's canonical pattern is
`packages/core/src/services/reconcilePayments.ts:104-112` (`err.code ?? err.cause?.code ??
err.cause?.cause?.code`), unit-tested in `apps/customer/src/lib/server/record-payment.spec.ts`.
Constraint name field differs by driver shape: postgres.js `PostgresError` exposes
`constraint_name`; PGlite/node-postgres-shaped errors expose `constraint`. Check both on the same
cause-chain walk. **Discriminator logic:** on THIS insert, `onConflictDoUpdate(target: mac)`
already absorbs `network_health_mac_key` conflicts, so a 23505 escaping the upsert can only come
from another unique index — `network_health_name_key` is the only other one the statement can hit.
Rule: retry iff `code === '23505'` AND (constraint field, when present on the chain, equals
`network_health_name_key`; when absent, code alone suffices given the mac-target absorption).
Never substring-match the error message. EXECUTE verifies the actual field shape empirically in
the PGlite spec (log/assert the caught error's fields) rather than assuming.

**F3 — Retry idempotency / terminal behavior.** The retried insert keeps
`onConflictDoUpdate(target: mac)` unchanged. A second 23505 is possible only if a DIFFERENT row
already holds the suffixed name `${base} (${tail})` — vanishingly rare but possible. 2.6 says
retry ONCE: a second violation propagates, `refreshAccessPoints` throws, and
`refreshNetworkHealth`'s existing catch degrades that cycle to interface-only (AP rows untouched,
prune restricted to `mac IS NULL`). That existing degradation IS the terminal behavior — no loop,
no swallow.

**F4 — Test-path reachability.** The TOCTOU window cannot be provoked through
`refreshNetworkHealth`'s public flow: `resolveApName` and the insert are adjacent with no
controller callback between them. Honest retry-path assertion requires extracting the upsert+retry
into a directly-testable internal function and testing it against a pre-seeded row that already
holds the target name under a different MAC — the first insert then genuinely violates
`network_health_name_key`. PGlite is real Postgres (WASM) and raises unique violations as
catchable errors with SQLSTATE; the E3 caveat concerned abort-on-violation *transaction*
semantics, which do not apply here (F1: no transaction). If EXECUTE finds PGlite's raised error
lacks a usable `code`/`constraint` field, fall back per checklist 5 (known-gap protocol).

## Touchpoints

| File | Change |
|---|---|
| `packages/core/src/services/networkHealth.ts` | Extract AP upsert (~308-331) into internal `upsertApRow(...)` (exported for tests, e.g. via existing test-export convention or a named export documented as internal); wrap its insert in the once-retry; add small `isNameUniqueViolation(e)` helper (cause-chain walk per F2); fix `resolveApName` docstring (~389-393) |
| `packages/core/src/services/networkHealth.integration.spec.ts` | New tests G-NC1/G-NC2 (retry path, second-collision propagation) |
| `packages/core/src/services/networkHealth.ts` unit surface (existing spec file or co-located) | Unit tests for `isNameUniqueViolation` with fabricated bare/wrapped/doubly-wrapped errors (record-payment.spec.ts style), incl. a postgres.js-shaped error with `constraint_name` |

## Public Contracts

None changed. `refreshNetworkHealth(db, network): Promise<number>` signature, return contract, and
degradation behavior are untouched. New exports are test-only internals (document as such). No
schema, API, auth, or billing surface.

## Blast Radius

- **Files:** 2-3 (`networkHealth.ts`, its integration spec, possibly one unit spec file). Package: `packages/core` only.
- **Risk class:** none of the high-risk classes (no auth/billing/schema/API/deploy/secret surface). Concurrency-correctness fix on an internal telemetry write path; failure mode both before and after is a degraded (interface-only) refresh cycle — never data corruption.

## Implementation Checklist

- [ ] **1. Re-verify F1 (E3 branch).** Grep for `db.transaction` in `networkHealth.ts` and both `refreshNetworkHealth` call sites. Confirm no wrapping transaction. If one exists → STOP, plan must be revised to the savepoint branch of E3.
- [ ] **2. Error-identification helper.** In `networkHealth.ts`, add `isNameUniqueViolation(e: unknown): boolean` implementing F2: bounded cause-chain walk (self, `.cause`, `.cause.cause` — mirroring reconcilePayments.ts) collecting `code` and the constraint field (`constraint_name` OR `constraint`); return true iff code `'23505'` and (constraint === `'network_health_name_key'` when a constraint field was found anywhere on the chain, else true on code alone per F2's mac-target-absorption argument). JSDoc must state the F2 reasoning.
- [ ] **3. Retry in the AP upsert.** Extract the current insert+`onConflictDoUpdate(target: mac)` block into `upsertApRow(db, vals, currBytes, offlineSinceOnUpdate, onlineSinceOnUpdate)` (exact param shape at EXECUTE's discretion — must carry everything the current block uses, unchanged). In `refreshAccessPoints`, call it inside `try/catch`: on `isNameUniqueViolation(e)`, recompute `name = \`${base} (${mac.slice(-5).replace(':','')})\`` — where base is the name that just failed — update `vals.name`/set.name, push the SUFFIXED name into the prune `names` array (replacing the failed one), and call `upsertApRow` once more WITHOUT a catch (second failure propagates, F3). Any non-matching error rethrows immediately. **E1 constraint:** no new timestamp SQL — the retry reuses the already-built `vals` + `sinceTransitionSet` outputs verbatim; if any new `sql` template touches timestamps it must interpolate `nowIso`, never a `Date`.
- [ ] **4. Prune-name correctness check.** Verify the `names.push(name)` bookkeeping: the name actually written must be the one in the prune set. Adjust so the pushed name reflects the retry outcome (push after successful upsert, or replace on retry).
- [ ] **5. Integration tests (PGlite)** in `networkHealth.integration.spec.ts`:
  - **G-NC1 (retry path):** pre-seed a `network_health` row holding name `X` with a different (or null) mac; call `upsertApRow` directly with `vals.name = 'X'` and a new mac → first insert raises the real `network_health_name_key` violation → assert the function resolves and a row exists with the suffixed name and the new mac; assert the pre-seeded row is untouched. Additionally assert (or log-and-assert) the caught error's `code`/constraint field shape so PGlite's behavior is empirically recorded, not assumed.
  - **G-NC2 (terminal behavior), leg 1 — direct:** pre-seed rows holding BOTH `X` and `X (tail)` under other identities → call `upsertApRow` directly with `vals.name = 'X'` → it rejects (second 23505 propagates).
  - **G-NC2 leg 2 — public flow degradation:** pre-seed all THREE names — `X`, `X (tail)`, AND `X (tail) (tail)` — under other identities; then assert via `refreshNetworkHealth` with a fake controller that the cycle degrades to interface-only without throwing outward (existing catch), AP rows untouched. **Why three seeds:** the public flow's `resolveApName` pre-check already consumes the first collision — with only two seeds it resolves the new AP's name to `X (tail)` upfront, the first insert's 23505 triggers the once-retry which writes `X (tail) (tail)` and SUCCEEDS, so the cycle completes normally and the degradation assertion fails. Seeding `X (tail) (tail)` forces the retry's recomputed name to collide too, so the second 23505 propagates through `refreshAccessPoints` into the interface-only degradation catch. Do NOT "simplify" back to two seeds.
  - **Fallback (honest known-gap protocol):** if PGlite's raised error genuinely lacks a usable SQLSTATE (not expected — it is real Postgres), do NOT fake coverage: keep the unit-level tests (checklist 6) as the proof of retry logic, mark G-NC1's PGlite leg as a known-gap in this plan's Test Infra Improvement Notes + Verification Evidence, and file a backlog note `ap-name-retry-pglite-gap_NOTE_20-07-26.md` in this task folder.
- [ ] **6. Unit tests for `isNameUniqueViolation`** (record-payment.spec.ts style, no DB): bare `{code:'23505', constraint_name:'network_health_name_key'}` → true; drizzle-wrapped (`cause.code`) → true; doubly-wrapped → true; `23505` with `constraint_name:'network_health_mac_key'` → false; non-23505 → false; code-only 23505 with NO constraint field anywhere → true (F2 rule); random Error → false.
- [ ] **7. Docstring fix.** Rewrite `resolveApName`'s doc (~389-393): pre-check is the FIRST layer (cheap, avoids most collisions); the upsert-level once-retry (2.6/E3) is the second layer covering the TOCTOU window. Remove the "pre-check rather than try/catch" framing.
- [ ] **8. Gate.** `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` green, then full `cd packages/core && bun run test` green (outage regression included). NEVER `bun test <file>` (fake-timer no-op gotcha, `process/context/tests/all-tests.md`).

## Acceptance Criteria

| ID | Criterion | proven by / strategy |
|---|---|---|
| AC1 | A `network_health_name_key` violation on the AP upsert is caught and retried exactly once with `${base} (${mac.slice(-5).replace(':','')})`; retried insert keeps `target: mac` | proven by: G-NC1 — strategy: Fully-Automated |
| AC2 | A second collision (suffixed name also taken) propagates; cycle degrades to interface-only via the existing catch; no retry loop | proven by: G-NC2 — strategy: Fully-Automated |
| AC3 | Only the name-key violation triggers retry; every other error (incl. mac-key-shaped 23505, non-23505) propagates unchanged | proven by: unit suite (checklist 6) — strategy: Fully-Automated |
| AC4 | E3 compliance: no wrapping `db.transaction` anywhere in the call chain (else savepoint required) | proven by: checklist 1 grep evidence recorded in EXECUTE report — strategy: Hybrid (code-inspection precondition) |
| AC5 | `resolveApName` pre-check behavior and docstring-corrected intent unchanged; existing G1-G15 integration tests stay green | proven by: full `packages/core` suite (checklist 8) — strategy: Fully-Automated |
| AC6 | Prune name-set contains the name actually written (suffixed on retry) | proven by: G-NC1 assertion on prune bookkeeping (or a targeted sub-assertion) — strategy: Fully-Automated |

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| G-NC1: pre-seeded name clash → real 23505 → single retry writes suffixed row, pre-seeded row untouched, error shape recorded (`cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts`) | Fully-Automated | AC1, AC6 |
| G-NC2: both base and suffixed names taken → second 23505 propagates → `refreshNetworkHealth` degrades to interface-only without throwing (same command) | Fully-Automated | AC2 |
| Unit: `isNameUniqueViolation` matrix — bare / wrapped / doubly-wrapped / wrong-constraint / code-only / non-23505 (`cd packages/core && bunx vitest run <unit spec file>`) | Fully-Automated | AC3 |
| Call-chain transaction grep (`grep -rn "db.transaction" packages/core/src/services/networkHealth.ts` + both caller files) recorded in EXECUTE evidence | Hybrid (precondition: manual code inspection, deterministic once run) | AC4 |
| Full regression: `cd packages/core && bun run test` green | Fully-Automated | AC5 |

Failing stub (G-NC1): `test("G-NC1: name_key violation retries once with MAC-tail suffix", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G-NC1") })`
Failing stub (G-NC2): `test("G-NC2: second collision propagates; cycle degrades to interface-only", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G-NC2") })`
Failing stub (unit): `test("isNameUniqueViolation matrix per AC3", () => { throw new Error("NOT IMPLEMENTED — TDD stub: AC3 matrix") })`

No Known-Gap tier is assigned to any developed behavior. The only conditional known-gap is the
checklist-5 fallback (PGlite lacking SQLSTATE), which — if it fires — must be recorded here, backed
by the unit suite, and filed as a backlog note; it may not silently PASS.

## Risks

- **R-A: PGlite error-shape mismatch** (low): PGlite is real Postgres and raises 23505; worst case the constraint FIELD is absent → F2's code-only rule still fires (correctly, per mac-absorption). Mitigation: G-NC1 empirically records the shape; checklist-5 fallback protocol.
- **R-B: prune bookkeeping drift** (low): retry changes the written name after `names.push` in current code shape. Checklist 4 + AC6 pin it.
- **R-C: behavior regression on the hot upsert path** (low): extraction must be a pure move — the full G1-G15 suite (AC5) is the guard.

## Dependencies

None external. Builds on shipped per-AP visibility Section 2 code (committed on `feat/multi-controller`, per-AP work itself still uncommitted per memory — EXECUTE must not entangle this change with unrelated staged work).

## Test Infra Improvement Notes

(none identified yet — checklist-5 fallback would add a PGlite-SQLSTATE gap note here if it fires)

## Resume and Execution Handoff

**CLOSED 20-07-26 — this is a completed record, not open work.** EXECUTE + independent EVL confirmation both ran; all 6 acceptance criteria proven by the gates in the Test Gate Outcomes table of `ap-name-collision-retry_REPORT_20-07-26.md`. Source committed as `9988faf` ("fix(core/network): retry AP upsert on name-key collision"). The origin checklist item (`per-ap-visibility` 2.6 / E3) has been ticked and pointed back at this folder.

1. **Selected plan file:** `process/general-plans/completed/ap-name-collision-retry_20-07-26/ap-name-collision-retry_PLAN_20-07-26.md`
2. **Last completed phase:** UPDATE PROCESS (archival). RESEARCH folded into planning (origin plan + code + call chain + repo 23505 patterns read).
3. **Validate-contract status:** written (20-07-26, Gate: PASS after 1 PVL supplement cycle) — see `## Validate Contract` below.
4. **Context loaded:** `process/context/tests/all-tests.md` (runner rules, PGlite facts), origin plan lines 137/171/373, `packages/core/src/services/networkHealth.ts` (126-404), `reconcilePayments.ts` 23505 pattern, both `refreshNetworkHealth` call sites.
5. **Known gaps carried forward (not fixed here, judged as acceptable residuals — see UPDATE PROCESS report):** no true two-writer concurrency test; discriminator only unit-tested against fabricated errors, never the live postgres.js driver (both accepted, low-value to chase further); no automated guard against a future caller wrapping `refreshNetworkHealth` in a `db.transaction` (JSDoc tripwire only) — tracked as a backlog note: `process/general-plans/backlog/ap-name-retry-transaction-tripwire_NOTE_20-07-26.md`.

## Validate Contract

Status: PASS
Date: 20-07-26
date: 2026-07-20
generated-by: outer-pvl
supersedes: 2026-07-20 (outer-pvl) — cycle-1 CONDITIONAL contract; G-NC2 leg-2 staging gap closed by PVL supplement cycle 1, re-validated from V1

Parallel strategy: sequential
Rationale: 1/7 signals (S5 requested-depth only) — single package, 2-3 files, no high-risk class; fan-out and EXECUTE both run sequentially.

Validation evidence highlights (recorded so EXECUTE does not re-derive):
- Live PGlite probe (repo's actual `@electric-sql/pglite` + drizzle versions, 20-07-26): a name-key
  23505 escaping `onConflictDoUpdate(target: mac)` surfaces as `DrizzleQueryError` → `.cause` at
  depth 1 with `{ code: '23505', constraint: 't_name_key' }` — on BOTH the fresh-insert path and
  the DO-UPDATE-renames-to-taken-name path. F4 is verified, not assumed; checklist-5 fallback is
  not expected to fire.
- postgres.js 3.4.9 maps wire field `n` → `constraint_name` (src/connection.js:46, types:221);
  PGlite exposes `constraint`. F2's both-fields rule is necessary and confirmed.
- Constraint inventory: `network_health` 23505 sources are exactly `network_health_name_key`,
  `network_health_mac_key` (absorbed by conflict target), and theoretically `network_health_pkey`
  (only under sequence drift; `packages/db/src/seed.ts:116` inserts without explicit ids, and both
  drivers attach the constraint field, so a pkey 23505 would correctly NOT retry).
- F1 re-verified fresh: `grep` for `db.transaction` in `networkHealth.ts` + both callers → zero
  matches. The extra `refreshNetworkHealth` references (`outage.integration.spec.ts`,
  `queries.ts:751`, `packages/db/src/network-health.ts:4`) are tests/comments, not callers.
- Prune bug (checklist 4) confirmed real: unfixed, a retried cycle deletes the freshly-written
  suffixed AP row in the SAME cycle's prune (name not in `names`, latitude NULL, apScanRan=true),
  destroying offline/online debounce state and the trafficBytes basis. The plan's fix closes it.
- PGlite harness applies the real migrations (`migrate(raw, { migrationsFolder })`), so
  `network_health_name_key` exists in the test DB — G-NC1/G-NC2 are stageable.

Test gates (C3 5-column table — ADDITIVE; legacy line form below):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1 | name-key 23505 on AP upsert caught, retried exactly once with `${base} (${mac.slice(-5).replace(':','')})`, `target: mac` kept | Fully-Automated | `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` — G-NC1 | B |
| AC6 | prune name-set contains the name actually written (suffixed on retry) | Fully-Automated | same command — G-NC1 prune sub-assertion | B |
| AC2 | second collision propagates; cycle degrades to interface-only via existing catch; no loop | Fully-Automated | same command — G-NC2 (staging per supplement: three pre-seeded names) | B |
| AC3 | only name-key violations trigger retry; all other errors propagate unchanged | Fully-Automated | `cd packages/core && bunx vitest run src/services/networkHealth.spec.ts` (new co-located unit spec — no existing unit spec file for networkHealth) | B |
| AC4 | no wrapping `db.transaction` in the call chain (E3 standalone branch) | Hybrid | `grep -rn "db.transaction" packages/core/src/services/networkHealth.ts "apps/admin/src/routes/(app)/networks/+page.server.ts" apps/admin/src/routes/api/network/health/refresh/+server.ts` — precondition: run + record in EXECUTE report | B |
| AC5 | extraction is behavior-preserving; G1-G15 + outage regression green | Fully-Automated | `cd packages/core && bun run test` | A |

Failing stub (AC1/AC6 row): `test("G-NC1: name_key violation retries once with MAC-tail suffix", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G-NC1") })`
Failing stub (AC2 row): `test("G-NC2: second collision propagates; cycle degrades to interface-only", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G-NC2") })`
Failing stub (AC3 row): `test("isNameUniqueViolation matrix per AC3", () => { throw new Error("NOT IMPLEMENTED — TDD stub: AC3 matrix") })`

Legacy line form:
- AP retry path: [Fully-automated: `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts`]
- Error discriminator: [Fully-automated: `cd packages/core && bunx vitest run src/services/networkHealth.spec.ts`]
- E3 transaction check: [hybrid: grep for `db.transaction` in service + both callers + precondition: record output in EXECUTE report]
- Full regression: [Fully-automated: `cd packages/core && bun run test`]

Dimension findings:
- Infra fit: PASS — packages/core only; PGlite harness applies real migrations; commands match tests/all-tests.md runner rules (cwd inside packages/core, never `bun test <file>`).
- Test coverage: PASS — all 6 ACs gated (5 Fully-Automated, 1 Hybrid); no Known-Gap on developed behavior; probe evidence retires the R-A risk.
- Breaking changes: PASS — no public contract change; note: `services/index.ts:10` does `export * from './networkHealth'`, so new exports auto-flow into `@veent/core` — JSDoc-mark them internal, do NOT edit any barrel.
- Security surface: PASS — no auth/billing/schema/API/secret/trust-boundary surface; retry reduces the collision-abort DoS surface; parameterized SQL throughout; not a high-risk class (no risk-evidence-pack required).
- Section A (error identification, checklist 2+6): PASS — cause-chain pattern verified verbatim at reconcilePayments.ts:110-111; both driver field names empirically confirmed.
- Section B (retry + extraction, checklist 1+3): PASS — proposed `upsertApRow` signature enumerates all loop-local closure state (`vals`, `currBytes` COALESCE ternary, both `sinceTransitionSet` expressions); E1 satisfied by construction (no new timestamp SQL; existing templates interpolate `nowIso`).
- Section C (prune bookkeeping, checklist 4): PASS — bug confirmed real and more consequential than the originating race (same-cycle row deletion + debounce/traffic-basis destruction feeding the outage sweep); plan's fix + AC6 close it.
- Section D (integration tests, checklist 5): PASS — cycle-1 CONCERN closed by the three-seed supplement, re-verified against source this pass: pre-check consumes seed 1 (resolves `X (tail)`), first insert's 23505 vs seed 2 triggers the once-retry (`X (tail) (tail)`), retry's 23505 vs seed 3 propagates uncaught through `refreshAccessPoints` into `refreshNetworkHealth`'s existing catch (networkHealth.ts:179) → `apScanRan=false` → interface-only degradation genuinely reached. Per-test TRUNCATE (spec beforeEach) isolates the third seed from G1-G15 and leg 1. Checklist 5 and the AC2 gate row are now consistent.
- Section E (docstring + gate, checklist 7+8): PASS — misleading framing confirmed at networkHealth.ts:390-392; gate commands exact per test context.

Execute-agent instructions:
- E-1: AC3 unit matrix goes in a NEW co-located file `packages/core/src/services/networkHealth.spec.ts` (no existing unit spec for networkHealth; `outage.spec.ts` is the in-dir precedent).
- E-2: Do not edit `services/index.ts` or any barrel — `export * from './networkHealth'` already propagates new exports; JSDoc-mark `upsertApRow` and `isNameUniqueViolation` as test-only internals.
- E-3: `isNameUniqueViolation` JSDoc must note the theoretical `network_health_pkey` 23505 source (sequence drift only; excluded because both drivers attach the constraint field — probe evidence above) alongside the F2 mac-absorption reasoning.
- E-4: Retry with an already-suffixed failed name produces `X (tail) (tail)` — expected, bounded (one retry), and integral to the corrected G-NC2 staging. Name it in a test comment.
- E-5: The DO-UPDATE path (existing mac row renamed to a taken name — AP hostname change) also raises name_key through the same statement and is covered by the same catch (probe Case 2). No extra code needed; a comment or assertion is welcome.
- E-6: G-NC2 leg-2 seed rows must be staged with a mac set (distinct per row) or a latitude set — the degraded cycle still runs the prune with the `mac IS NULL AND latitude IS NULL` predicate, and seeds matching it would be deleted mid-test, confusing assertions. Seed tails must match the NEW AP's uppercased mac (`mac.slice(-5).replace(':','')`).

Open gaps: none

What this coverage does NOT prove:
- G-NC1/G-NC2 provoke the violation via pre-seeding, not true two-writer concurrency — a real simultaneous-refresh race is never executed.
- The unit matrix proves the discriminator against FABRICATED postgres.js-shaped errors; no live postgres.js integration run exists (mitigated by the wire-field source check + PGlite probe, but the prod driver path is not executed end-to-end).
- AC4's grep proves transaction absence at EXECUTE time only — a future caller wrapping `refreshNetworkHealth` in `db.transaction` re-opens the E3 savepoint requirement with no automated guard (JSDoc is the only tripwire).
- Full-suite regression covers PGlite semantics, not a live MikroTik-fed lease table (live-router behavior belongs to the separate on-site verification track).
- `resolveApName` pre-check logic itself is unchanged and only covered to its existing extent.

Gate: PASS (0 FAILs, 0 CONCERNs — cycle-1 concern closed and re-verified; plan and contract consistent)
Accepted by: n/a — Gate is PASS (no accepted concerns; PVL cycle 1 recorded in results.tsv)

## Autonomous Goal Block

SESSION GOAL: TOCTOU-harden the AP name write in packages/core networkHealth — catch the network_health_name_key 23505 on the AP upsert and retry once with the MAC-tail suffix (completes per-ap-visibility checklist 2.6 / constraint E3).
Charter + umbrella plan: N/A — single plan
Autonomy: per orchestration.md §Autonomy Mode — CONDITIONAL findings: apply fixes, proceed; BLOCKED: backlog note + continue; approval pauses removed only, subagent delegation stays mandatory.
Hard stop conditions / safety constraints:
- Checklist 1 is a hard gate: if a wrapping db.transaction is found around refreshNetworkHealth, STOP — the plan must be revised to E3's savepoint branch before any code is written.
- packages/core only. No schema change, no migration, no new dependency. resolveApName's pre-check stays — the retry is a second layer, not a replacement.
- Existing AP behavior must not regress: mac-keyed identity, trafficBytes COALESCE, since-transitions (full-suite gate AC5).
- Never run `bun test <file>` — always `cd packages/core && bunx vitest run <file>` (bun's native runner silently no-ops vitest mocks).
- Any new timestamp SQL must interpolate nowIso strings, never a JS Date (E1).
- Do not commit — the user commits himself; do not entangle with unrelated uncommitted per-AP work on feat/multi-controller.
Next phase: EXECUTE: process/general-plans/active/ap-name-collision-retry_20-07-26/ap-name-collision-retry_PLAN_20-07-26.md (Gate: PASS — terminal after 1 recorded PVL supplement cycle)
Validate contract: inline in plan (## Validate Contract above)
Execute start: cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts | e2e spec: none (PGlite integration tier) | probe scenario: none | high-risk pack: no
