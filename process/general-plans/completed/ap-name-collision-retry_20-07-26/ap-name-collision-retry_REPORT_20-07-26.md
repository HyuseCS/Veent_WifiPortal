---
phase: ap-name-collision-retry
date: 2026-07-20
status: COMPLETE
feature: general-plans
plan: process/general-plans/active/ap-name-collision-retry_20-07-26/ap-name-collision-retry_PLAN_20-07-26.md
---

# EXECUTE Report — AP Name-Collision Retry

**TL;DR:** Checklist 1–8 implemented. All gates green locally (60/60 core suite, tsc clean). One
within-blast-radius test-staging deviation (G-NC1 split into two legs — see `## Plan Deviations`).
Nothing committed; changes unstaged.

## What Was Done

| # | Item | Outcome |
|---|---|---|
| 1 | F1 hard gate re-verified | **PASS** — zero `db.transaction` matches (evidence below). E3 standalone branch confirmed; no savepoint needed. |
| 2 | `isNameUniqueViolation` helper | Added. Bounded 3-deep cause-chain walk collecting `code` + `constraint_name`/`constraint`. JSDoc records F2 mac-absorption + the `network_health_pkey` exclusion (E-3). |
| 3 | `upsertApRow` extraction + once-retry | Behaviour-preserving move (`trafficBytes` COALESCE ternary and both `sinceTransitionSet` SQL values passed through as params). Retry in `refreshAccessPoints` recomputes `${vals.name} (${mac.slice(-5).replace(':','')})`, keeps `target: mac` on both attempts, rethrows every non-matching error, and does NOT catch the second attempt. No new timestamp SQL (E-1 satisfied by construction). |
| 4 | Prune bookkeeping fix | `names.push(name)` removed from before the upsert; `names.push(writtenName)` now runs after it, recording the name actually written. Comment states the failure mode it prevents. |
| 5 | Integration tests | 4 new tests (G-NC1a, G-NC1b, G-NC2 leg 1, G-NC2 leg 2). Seeds carry mac **and** latitude per E-6 — latitude also keeps them out of the AC6 prune assertion in G-NC1b. Leg 2 pre-seeds all three names as specified; fallback known-gap protocol NOT needed. |
| 6 | Unit matrix | New `networkHealth.spec.ts` (E-1), 10 cases: bare `constraint_name`, bare `constraint`, wrapped, doubly-wrapped, mac-key, pkey, code-only, non-23505, random Error, null/undefined. |
| 7 | Docstring fix | `resolveApName` doc rewritten: pre-check is the first layer, the upsert-level once-retry is the second covering the TOCTOU window. "pre-check rather than try/catch" framing removed. |
| 8 | Gates | Green — see below. |

**AC4 evidence (Hybrid gate, recorded per contract):**
```
$ grep -rn "db\.transaction\|\.transaction(" packages/core/src/services/networkHealth.ts \
    "apps/admin/src/routes/(app)/networks/+page.server.ts" \
    apps/admin/src/routes/api/network/health/refresh/+server.ts
(no output — exit 1)
```
Full `refreshNetworkHealth` reference sweep confirms only two real callers (`+page.server.ts:55`,
`health/refresh/+server.ts:29`); all other hits are specs, comments, or the import lines.
`Sentry.withMonitor` is not a DB transaction.

Files touched (all unstaged, nothing committed):
- `packages/core/src/services/networkHealth.ts`
- `packages/core/src/services/networkHealth.integration.spec.ts`
- `packages/core/src/services/networkHealth.spec.ts` (new)

No barrel edited (E-2); both new exports are JSDoc-marked test-only internals.

## What Was Skipped or Deferred

Nothing. The checklist-5 PGlite fallback did not fire — PGlite raised a real 23505 that
`isNameUniqueViolation` recognises (asserted in G-NC1a, not assumed).

## Test Gate Outcomes

| Gate | Command | Result |
|---|---|---|
| AC1/AC6/AC2 | `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` | **PASS** — 17/17 (13 pre-existing + 4 new) |
| AC3 | `cd packages/core && bunx vitest run src/services/networkHealth.spec.ts` | **PASS** — 10/10 |
| AC4 | transaction grep (above) | **PASS** — zero matches |
| AC5 | `cd packages/core && bun run test` | **PASS** — 6 files / 60 tests, outage regression included |
| extra | `bunx tsc --noEmit` in `packages/core` | **PASS** — exit 0 |

Runner discipline honoured: `bunx vitest run` throughout, never `bun test <file>`.

## Plan Deviations

**D1 — G-NC1 split into two legs (within blast radius, test staging only).**
The plan's G-NC1 text says "call `upsertApRow` directly … assert the function resolves and a row
exists with the suffixed name". That is not reachable as written: checklist 3 places the retry in
`refreshAccessPoints`, **not** inside `upsertApRow`, so a direct call to `upsertApRow` on a clash
can only reject. Implemented instead, preserving every assertion the plan asked for:
- **G-NC1a** — direct `upsertApRow` call raises the real 23505 and `isNameUniqueViolation(err)` is
  `true` (this is the plan's "empirically record the error shape" requirement).
- **G-NC1b** — the retry is exercised through the production path (`refreshNetworkHealth`, two
  pre-seeded names): asserts the suffixed row exists with the new mac, the seeds are untouched, and
  — the AC6 point — the written row **survives the same cycle's prune**, which is only true because
  `names` holds the post-retry name. Testing AC6 through the public flow proves the prune
  bookkeeping end-to-end; a direct `upsertApRow` call would not exercise the prune at all.
No production-code deviation. Scope, files, and blast radius unchanged.

## Test Infra Gaps Found

None. The PGlite harness applies real migrations, so `network_health_name_key` exists and the
violation is genuinely raised.

## Closeout Packet

- **Selected plan:** `process/general-plans/active/ap-name-collision-retry_20-07-26/ap-name-collision-retry_PLAN_20-07-26.md`
- **Finished:** checklist 1–8; all six ACs have a green proving gate.
- **Verified:** all Fully-Automated gates + the AC4 Hybrid grep, run locally by this agent.
- **Still unverified:** independent EVL re-run (vc-tester) not yet performed — these are my own
  claims. Also unproven (carried from the contract, unchanged): true two-writer concurrency, the
  live postgres.js driver path, and any future caller wrapping `refreshNetworkHealth` in a
  transaction (JSDoc tripwire only).
- **Remaining cleanup:** commit (user-owned — deliberately not staged; do not entangle with the
  unrelated uncommitted per-AP work on `feat/multi-controller`), then UPDATE PROCESS archival.
- **Classification:** `Keep in active/testing` — code-complete (`CODE DONE`), promotes to
  `VERIFIED` only after the spawned vc-tester EVL confirmation run.

## Forward Preview

- **Test Infra Found:** PGlite harness raises catchable 23505 with `{ code, constraint }` at
  `.cause` depth 1 — matches the PVL probe exactly. Reusable for future constraint-violation tests.
- **Blast Radius Changes:** none beyond plan — `packages/core` only, 3 files.
- **Commands to Stay Green:** `cd packages/core && bun run test`
- **Dependency Changes:** none.
