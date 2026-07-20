---
name: note:ap-name-retry-transaction-tripwire
description: "No automated guard prevents a future caller from wrapping refreshNetworkHealth in db.transaction, which would invalidate the E3 standalone-statement retry design for the AP name-collision fix. JSDoc-only tripwire today."
date: 20-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# AP name-collision retry: no automated transaction-wrapping guard

## Why this exists

`ap-name-collision-retry_PLAN_20-07-26.md` (completed 20-07-26) implemented the once-retry
on `network_health_name_key` collisions as a **standalone statement + try/catch** — the E3
constraint's cheaper branch, valid only because `refreshNetworkHealth` is never called inside a
wrapping `db.transaction` (verified by grep at both PLAN-validate and EXECUTE time, zero matches).

If a future change wraps either call site —
`apps/admin/src/routes/(app)/networks/+page.server.ts:55` or
`apps/admin/src/routes/api/network/health/refresh/+server.ts:29` — in a `db.transaction(tx)`
(e.g. to make the refresh atomic with some other write), the try/catch retry becomes wrong: a
Postgres transaction aborts on the first error and every subsequent statement inside it fails
with `current transaction is aborted`, silently breaking the retry AND poisoning any other write
in that transaction. E3 anticipated this exact failure mode and specified the fallback (a
savepoint), but nothing enforces it — the only tripwire is a JSDoc comment on
`isNameUniqueViolation`/`upsertApRow` in `networkHealth.ts`.

This is a latent correctness trap, not a coverage gap: the code is correct today and will fail
silently-in-effect (wrong error propagation, not a crash) the moment someone innocently adds a
`db.transaction` wrapper without knowing about E3.

## What to do

One of:
1. Add a runtime guard: if `db` passed into `refreshNetworkHealth`/`refreshAccessPoints` is
   already inside a transaction context, throw or warn (requires a way to detect "currently in a
   tx" with the current drizzle+postgres.js setup — worth a short feasibility check first).
2. Add a lint/grep-based CI check (once CI exists — repo currently has none, see
   `all-context.md` §Team and Workflow) asserting no `db.transaction` wraps either call site.
3. At minimum, strengthen the JSDoc on both call sites (not just the service function) so an
   editor touching `+page.server.ts` or `health/refresh/+server.ts` sees the constraint before
   adding a transaction wrapper.

Low urgency — no evidence anyone is about to add this wrapper. File this so it isn't silently
lost; do not action reflexively.

## Pointers

- `packages/core/src/services/networkHealth.ts` — `isNameUniqueViolation`, `upsertApRow` JSDoc
- `apps/admin/src/routes/(app)/networks/+page.server.ts:55`
- `apps/admin/src/routes/api/network/health/refresh/+server.ts:29`
- Originating plan (completed): `process/general-plans/completed/ap-name-collision-retry_20-07-26/ap-name-collision-retry_PLAN_20-07-26.md` — see constraint E3 in the parent plan `per-ap-visibility_16-07-26/per-ap-visibility_PLAN_16-07-26.md` line 373.
