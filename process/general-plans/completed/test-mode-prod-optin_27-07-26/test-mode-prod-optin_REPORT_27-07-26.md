---
phase: test-mode-prod-optin
date: 2026-07-27
status: COMPLETE
feature: general
plan: process/general-plans/completed/test-mode-prod-optin_27-07-26/test-mode-prod-optin_PLAN_27-07-26.md
---

# EXECUTE Report — TEST_MODE prod opt-in (`ALLOW_TEST_MODE_IN_PROD`)

## What Was Done

1. `apps/customer/src/lib/server/otp.ts` — extracted a shared `truthyEnv(name)` parser (`1/true/yes/on`);
   `isTestMode()` now delegates to it; added exported `allowTestModeInProd()` using the same parser.
   `isTestMode()` public contract unchanged. No OTP-flow code touched.
2. `apps/customer/src/lib/server/validateEnv.ts` — imported `allowTestModeInProd`; split the `!dev`
   branch: throws (with an extended message naming the opt-in flag) when the flag is unset; loud
   `STAGING OPT-IN` warn + proceed when set; dev warn unchanged.
3. `apps/customer/src/lib/server/validateEnv.spec.ts` — added two cases (prod+flag-unset throws;
   prod+flag-set warns+proceeds with `STAGING OPT-IN`/`ALLOW_TEST_MODE_IN_PROD` wording). Existing
   dev + TEST_MODE-off + prod-throw cases retained. 5 tests total, all green.
4. `apps/customer/.env.example` — documented `ALLOW_TEST_MODE_IN_PROD=""` after the `TEST_MODE=""` block.
5. `.env.prod.example` — documented the staging opt-in pair (`TEST_MODE` + `ALLOW_TEST_MODE_IN_PROD`)
   in the customer section.
6. `compose.prod.yaml` — one-line comment near the `customer:` service noting both flags travel via
   `env_file: .env` (no `environment:` entry added).

## What Was Skipped or Deferred

Real staging deployment / boot verification (prod build boots with both `TEST_MODE` +
`ALLOW_TEST_MODE_IN_PROD` set) remains pending — not runnable in this environment; proven by unit
test of the gate logic only (consistent with the Closeout Packet "Unverified" note below).

## Test Gate Outcomes

- `bunx vitest run src/lib/server/validateEnv.spec.ts` (run from `apps/customer/`) — PASS, 5/5 tests.
  Note: the plan's repo-root form `bunx vitest run apps/customer/src/lib/server/validateEnv.spec.ts`
  fails on `$lib` alias resolution (no root vitest config resolves the SvelteKit alias); the
  app-directory invocation is the correct one and is how per-app vitest configs resolve `$lib`.
- `bun run check` — PASS, 0 errors / 0 warnings across all three apps (customer 2137 files, 0 errors).

## Plan Deviations

- Within-blast-radius: `.env.prod.example` did not previously list `TEST_MODE`. Added `TEST_MODE=""`
  alongside `ALLOW_TEST_MODE_IN_PROD=""` so the opt-in comment ("alongside TEST_MODE truthy") is
  self-contained. No behavior impact — documentation only.
- Test gate command form corrected from repo-root to app-dir (see Test Gate Outcomes). No scope change.

## Test Infra Gaps Found

None.

## Closeout Packet

- Selected plan: `process/general-plans/completed/test-mode-prod-optin_27-07-26/test-mode-prod-optin_PLAN_27-07-26.md`
- Finished: all 7 checklist items.
- Verified: both automated gates green (vitest 5/5, `bun run check` clean).
- Unverified: real staging deploy behavior (prod build boots with both flags set) — not runnable in
  this environment; proven by unit test of the gate logic only.
- Remaining: user commit; optional UPDATE PROCESS archival.
- Best next state: Keep in active/testing until staging boot is user-confirmed, then archive.

## Forward Preview

- **Test Infra Found:** per-app vitest configs resolve `$lib`; run customer specs from `apps/customer/`.
- **Blast Radius Changes:** `apps/customer` only (2 source + 1 spec + 2 env docs + 1 compose comment).
- **Commands to Stay Green:** `cd apps/customer && bunx vitest run src/lib/server/validateEnv.spec.ts`; `bun run check`.
- **Dependency Changes:** none.
