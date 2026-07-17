---
name: note:observability-test-helper-builderrorevent
description: "Optional test helper buildErrorEvent(error, opts) for realistic ErrorEvent construction in observability.test.ts beforeSend tests — surfaced during router-timeout-sentry-classify."
date: 17-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# Optional observability test helper: `buildErrorEvent(error, opts)`

## Why this exists

While adding the `beforeSend` classification test cases (Cases A/B/C) for
`router-timeout-sentry-classify_PLAN_17-07-26.md` (completed 17-07-26), each test case
hand-constructed its own `ErrorEvent`/`EventHint` stub inline. As more `beforeSend`
classification rules get added to `packages/core/src/observability.ts` over time, this
repeated stub-construction will get noisier.

## What to do (low priority, only if observability test cases grow further)

1. Add a small test-only helper in `packages/core/src/observability.test.ts` (or a shared test
   util file) — `buildErrorEvent(error: Error, opts?: { level?: SeverityLevel; message?: string })`
   that returns a minimal-but-realistic `ErrorEvent` stub plus matching `EventHint`.
2. Refactor Cases A/B/C (and the PII-scrub assertions) in `observability.test.ts` to use it.
3. Not required for current coverage — only worth doing if a 4th+ classification rule is added.

## Pointers

- `packages/core/src/observability.test.ts` (`describe('sentryOptions', ...)` block)
- `packages/core/src/observability.ts` (`beforeSend` in `sentryOptions()`)
- Originating plan (completed): `process/general-plans/completed/router-timeout-sentry-classify_17-07-26/router-timeout-sentry-classify_PLAN_17-07-26.md`
