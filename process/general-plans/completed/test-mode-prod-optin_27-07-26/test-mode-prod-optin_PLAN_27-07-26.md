---
name: plan:test-mode-prod-optin
description: Add ALLOW_TEST_MODE_IN_PROD second opt-in flag so TEST_MODE can run in a production build for staging, fail-safe by default
date: 27-07-26
feature: general
---

# Plan — TEST_MODE prod opt-in (`ALLOW_TEST_MODE_IN_PROD`)

**TL;DR:** Add a second explicit env flag `ALLOW_TEST_MODE_IN_PROD` to the customer app's
`validateEnv()` gate. When `TEST_MODE` is truthy in a production build (`!dev`), boot still THROWS
by default (fail-safe); it only PROCEEDS (with a loud staging warning) when the second flag is also
truthy. Parses truthiness with the exact same helper `isTestMode()` uses. Documented in both env
examples; compose passthrough verified. Customer-app scoped (user explicitly authorized).

Complexity: SIMPLE.

## Context / Problem

The staging VM runs the production Docker build (`compose.prod.yaml` → `node build`), so
`dev === false`. The user needs TEST_MODE (on-device OTP instead of SMS) on staging. Today
`validateEnv()` hard-throws whenever TEST_MODE is truthy and `!dev`, which crash-loops the customer
container. We need a deliberate, explicit escape hatch that keeps a real prod deploy safe (still
crashes if the operator forgets the flag).

## Touchpoints

| File | Change |
|---|---|
| `apps/customer/src/lib/server/otp.ts` | Add exported `allowTestModeInProd()` reusing the same truthy parser as `isTestMode()` (or extract a shared parser). |
| `apps/customer/src/lib/server/validateEnv.ts` | In the `isTestMode()` prod branch, throw only when the second flag is NOT set; warn + proceed when it is. |
| `apps/customer/src/lib/server/validateEnv.spec.ts` | Add: throws when flag unset in prod; warns+proceeds when flag set in prod; dev path unchanged; TEST_MODE off unchanged. |
| `apps/customer/.env.example` | Document `ALLOW_TEST_MODE_IN_PROD` right after the `TEST_MODE` block. |
| `.env.prod.example` (repo root) | Document the new var in the customer/SMS/Maya-adjacent section near TEST_MODE. |
| `compose.prod.yaml` | Verify/annotate passthrough (see Decision below — `env_file: .env` already carries it). |

## Public Contracts

- **New env var:** `ALLOW_TEST_MODE_IN_PROD` (truthy = `1`/`true`/`yes`/`on`, matching `isTestMode`).
  Read only by the customer app boot gate. No API/schema/auth surface. Admin/locator ignore it.
- **`validateEnv()` behavior change (customer only):** the truth table below. No signature change.

| `dev` | TEST_MODE truthy | ALLOW_TEST_MODE_IN_PROD truthy | Outcome |
|---|---|---|---|
| true | — | — | warn "allowed in dev only", proceed (unchanged) |
| false | no | — | proceed normally (unchanged) |
| false | yes | no | **THROW** (unchanged fail-safe default) |
| false | yes | yes | warn loudly (staging opt-in), **proceed** (new) |

## Blast Radius

- Packages: `apps/customer` only. 2 source files + 1 spec + 2 env docs + 1 compose doc-check.
- Risk class: **auth/identity-adjacent** — TEST_MODE surfaces the OTP on-device instead of sending
  SMS, so weakening the gate is a security-sensitive change. Mitigation: default stays fail-closed
  (throws in prod unless a SECOND explicit flag is set), warning names the staging intent loudly,
  and no OTP-flow code (`otp.ts sendOtp`/`isTestMode`) behavior changes.

## Decision (compose passthrough)

The customer service in `compose.prod.yaml` uses `env_file: .env`, which injects EVERY var in the
root `.env` into the container by name. `TEST_MODE` is NOT listed in the explicit `environment:`
block today — it reaches the container purely via `env_file: .env`. Therefore `ALLOW_TEST_MODE_IN_PROD`
reaches the container the SAME way once placed in `.env`. **No functional compose edit is required**
(rung-3 native-platform feature — env_file already does it). The compose touchpoint is a one-line
clarifying comment near the customer service pointing operators at the staging opt-in pair; the
authoritative operator documentation lives in `.env.prod.example`.

Rejected alternative: adding explicit `TEST_MODE: ${TEST_MODE}` / `ALLOW_TEST_MODE_IN_PROD: ${...}`
entries to the customer `environment:` block. Rejected because it introduces redundant indirection
(env_file already carries them), is asymmetric with how TEST_MODE flows today, and adds diff for no
behavior gain.

## Implementation Checklist

1. **`apps/customer/src/lib/server/otp.ts`** — add an exported helper for the second flag that reuses
   the truthy parser. Minimal approach: extract the parse into a tiny local `function truthyEnv(name)`
   used by both `isTestMode()` and a new `allowTestModeInProd()`; OR add `allowTestModeInProd()` that
   inlines the identical parse. Prefer the shared-parser extraction (one source of truth for
   `1/true/yes/on`). Keep `isTestMode()`'s public behavior identical.
2. **`apps/customer/src/lib/server/validateEnv.ts`** — in the `if (isTestMode())` block, change the
   `if (!dev) throw` branch to:
   - `!dev && !allowTestModeInProd()` → `throw new Error(m)` (fail-safe default, unchanged message
     or extended to mention the opt-in flag).
   - `!dev && allowTestModeInProd()` → `console.warn` a LOUD staging message naming
     `ALLOW_TEST_MODE_IN_PROD` as a deliberate staging opt-in, then proceed.
   - `dev` → existing dev warn (unchanged).
   Import `allowTestModeInProd` alongside the existing `isTestMode` import.
3. **`apps/customer/src/lib/server/validateEnv.spec.ts`** — add cases (reuse `configureValidProdEnv`):
   - prod + TEST_MODE truthy + flag UNSET → `.toThrow(/TEST_MODE is enabled/)` (keep existing test or
     ensure it still holds).
   - prod + TEST_MODE truthy + `ALLOW_TEST_MODE_IN_PROD='true'` → NOT throw, warn called with a
     string containing the staging/opt-in wording.
   - dev + TEST_MODE truthy → unchanged (already covered).
   - prod + TEST_MODE off → unchanged (already covered).
4. **`apps/customer/.env.example`** — add an `ALLOW_TEST_MODE_IN_PROD=""` block after line 71
   (`TEST_MODE=""`) explaining it is the staging opt-in that lets TEST_MODE run in a prod build; blank
   by default; only set on staging.
5. **`.env.prod.example`** — add `ALLOW_TEST_MODE_IN_PROD=""` in the customer section with a comment
   that it is required (alongside TEST_MODE truthy) for the staging on-device-OTP deploy.
6. **`compose.prod.yaml`** — add a one-line comment near the `customer:` service noting TEST_MODE +
   ALLOW_TEST_MODE_IN_PROD travel via `env_file: .env` (staging opt-in). No `environment:` entry.
7. Run test gates (below); confirm green.

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `cd apps/customer && bunx vitest run src/lib/server/validateEnv.spec.ts` — prod + flag unset throws | Fully-Automated | Fail-safe default preserved: real prod deploy without the flag still crashes |
| Same suite — prod + flag set warns + proceeds | Fully-Automated | Staging opt-in works: TEST_MODE runs in prod build when second flag set |
| Same suite — dev path + TEST_MODE-off path | Fully-Automated | No regression to existing gate behavior |
| `bun run check` (customer app typecheck) | Fully-Automated | New import + helper typecheck clean |

Runner note: use `bunx vitest run`, never `bun test` (bun's native runner no-ops fake timers).

## Test Infra Improvement Notes

(none identified yet)

## Resume and Execution Handoff

1. Selected plan file: `process/general-plans/completed/test-mode-prod-optin_27-07-26/test-mode-prod-optin_PLAN_27-07-26.md`
2. Last completed step: PLAN written; VALIDATE run inline (see Validate Contract below).
3. Validate-contract status: written (see below).
4. Context loaded: `validateEnv.ts`, `validateEnv.spec.ts`, `otp.ts`, `compose.prod.yaml` (customer
   service), `apps/customer/.env.example`, `.env.prod.example`, `all-context.md`.
5. Next step for a fresh agent: on "ENTER EXECUTE MODE", apply checklist items 1–7 in order, then run
   both test gates.

## Validate Contract

generated-by: outer-pvl
date: 2026-07-27

### Net Gate Derivation

**Layer 1 dimensions**

| Dimension | Status |
|---|---|
| Infra fit | PASS — env_file passthrough is the correct, existing mechanism; no compose functional change needed |
| Test coverage | PASS — deterministic vitest spec covers all 4 truth-table rows; runner pinned to `bunx vitest run` |
| Breaking changes | PASS — new var is additive; default behavior unchanged (prod still throws without the flag) |
| Security surface | CONCERN — weakens a security-sensitive boot gate (on-device OTP). Mitigated: fail-closed default retained, second explicit flag required, loud staging warning, no OTP-flow change |

**Layer 2 sections**

| Section | Status |
|---|---|
| otp.ts helper (shared truthy parser) | PASS — `isTestMode` parser is present and uniquely matchable; extract is mechanical |
| validateEnv.ts gate branch | PASS — target `if (!dev) throw new Error(m)` at line 30 is unique and matchable |
| validateEnv.spec.ts cases | PASS — `configureValidProdEnv` + `state.env` flip pattern reused; no new mock infra needed |
| env docs (2) + compose comment | PASS — insertion points identified (`.env.example` L71, compose customer service L48) |

**Totals: 0 FAILs / 1 CONCERN / 8 PASSes**

**→ Net Gate: CONDITIONAL** — the single CONCERN is the inherent security-sensitivity of loosening
the gate. It is accepted-by-design: the whole point of the task is a deliberate, explicit,
fail-closed-by-default escape hatch. No further mitigation required beyond what the plan already
specifies.

### Execute-Agent Instructions

| # | Instruction | Trigger |
|---|---|---|
| E1 | Keep the fail-safe default: prod + TEST_MODE truthy + flag UNSET MUST still throw. Do not invert the guard. | validateEnv.ts edit |
| E2 | The second flag MUST reuse the exact `1/true/yes/on` parse from `isTestMode()` — do not hand-roll a different truthy check. | otp.ts edit |
| E3 | Do NOT touch `sendOtp`, `isTestMode`'s return contract, or any OTP flow. Gate-only change. | otp.ts / all |
| E4 | Make the prod opt-in warning LOUD and name `ALLOW_TEST_MODE_IN_PROD` + "staging" explicitly. | validateEnv.ts edit |

### Test Gates

1. `cd apps/customer && bunx vitest run src/lib/server/validateEnv.spec.ts` — must exit 0, all cases green.
2. `bun run check` (customer app) — 0 type errors.

Runner: `bunx vitest run` only (never `bun test` — fake-timer no-op gotcha).

### Resume

Gate CONDITIONAL (accepted known-concern: intentional security-gate loosening, fail-closed default).
Ready for EXECUTE on explicit approval.

