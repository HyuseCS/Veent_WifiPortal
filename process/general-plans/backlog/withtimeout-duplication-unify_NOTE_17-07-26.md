---
name: note:withtimeout-duplication-unify
description: "Two duplicated withTimeout() implementations (mikrotik.ts, adminAccess.ts) — candidate to unify into one shared @veent/core helper. Deliberately out of scope for router-timeout-sentry-classify."
date: 17-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# withTimeout() duplication — unify into one shared helper

## Why this exists

`router-timeout-sentry-classify_PLAN_17-07-26.md` (completed 17-07-26) explicitly called out
this duplication as a Non-Goal:

> Do NOT unify the two separate `withTimeout()` implementations in `mikrotik.ts` and
> `adminAccess.ts` into one shared helper. That is a real duplication but is out of scope for
> this fix — track as a backlog item if surfaced, don't act on it here.

Both implementations now throw the same `RouterUnreachableError` (from
`packages/core/src/integrations/network/types.ts`), which makes unification cleaner than before
this fix — they only differ in the timeout-message label and the wrapped promise.

## What to do

1. Extract a single `withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T>`
   helper in `packages/core/src/` (e.g. a small `utils.ts` or alongside `RouterUnreachableError`
   in `integrations/network/types.ts` if it stays network-scoped).
2. Update `packages/core/src/integrations/network/mikrotik.ts` and
   `packages/core/src/services/adminAccess.ts` to import and use the shared helper.
3. Re-run `mikrotik.spec.ts` and any `adminAccess` timeout tests to confirm behavior-identical
   (same message text, same `RouterUnreachableError` instance, same timing).

## Pointers

- `packages/core/src/integrations/network/mikrotik.ts` (`withTimeout`, lines ~221-236 pre-fix)
- `packages/core/src/services/adminAccess.ts` (`withTimeout`, lines ~105-119 pre-fix)
- `packages/core/src/integrations/network/types.ts` (`RouterUnreachableError`)
- Originating plan (completed): `process/general-plans/completed/router-timeout-sentry-classify_17-07-26/router-timeout-sentry-classify_PLAN_17-07-26.md`
