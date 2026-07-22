---
name: plan:router-timeout-sentry-classify
description: "Classify router-unreachable timeouts as Sentry warnings (not errors) without breaking the cron withMonitor check-in"
date: 17-07-26
feature: general
---

# Router Timeout → Sentry Classification — PLAN

**Date**: 17-07-26
**Status**: Validated — Gate PASS
**Complexity**: SIMPLE

## Overview

The router-unreachable timeout thrown during `/api/network/revoke` (and other network-controller
timeout paths) currently lands in Sentry's error Issues stream as an unhandled error. This creates
noise: the timeout is an EXPECTED, already-alerted-on condition (the `Sentry.withMonitor(
'customer-network-revoke')` cron check-in already goes red when the sweep fails), not a code bug.

This plan introduces a typed `RouterUnreachableError`, throws it from the two `withTimeout()`
helpers that currently throw a generic `Error`, and classifies it in the shared `beforeSend` hook
to `warning` level instead of `error` level — WITHOUT dropping the event and WITHOUT touching the
cron monitor's red/green signal.

## Goals

1. Add `RouterUnreachableError extends Error` to `packages/core/src/integrations/network/types.ts`,
   mirroring the existing `RetryablePaymentError` pattern in
   `packages/core/src/integrations/payments/types.ts`.
2. Throw `RouterUnreachableError` (not generic `Error`) from both `withTimeout()` implementations
   that currently reject with a router-timeout message.
3. Classify `RouterUnreachableError` events in the shared `beforeSend` (`packages/core/src/observability.ts`
   `sentryOptions()`) to `event.level = 'warning'` — downgrade, never drop, and PII scrub must run
   on every branch (matched and unmatched).
4. Preserve the cron check-in (`Sentry.withMonitor('customer-network-revoke')`) failure signal
   completely unchanged — the throw must still propagate to `withMonitor`.

## Non-Goals (explicit — do NOT do these)

- Do NOT add try/catch around `sweepCheckoutAccess`, `sweepAdminAccess`, or `sweepAdminBindings`
  (or their callers). A local catch would swallow the throw before it reaches `withMonitor` and
  destroy the cron-red signal that already exists. This is a deliberate no-touch.
- Do NOT unify the two separate `withTimeout()` implementations in `mikrotik.ts` and
  `adminAccess.ts` into one shared helper. That is a real duplication but is out of scope for this
  fix — track as a backlog item if surfaced, don't act on it here.
- Do NOT change the timeout error MESSAGE TEXT in either helper (`"${label} timed out after
  ${ms}ms"` / `"resolveMacByIp timed out after ${ms}ms"`) — an existing test
  (`mikrotik.spec.ts` line 83) asserts `.rejects.toThrow(/timed out/)` and must keep passing
  unmodified in behavior, only strengthened with an `instanceof` assertion.

## Acceptance Criteria

1. `RouterUnreachableError` is exported from `packages/core/src/integrations/network/types.ts` and mirrors the `RetryablePaymentError` constructor shape (message + optional `ErrorOptions`, `this.name` set).
2. Both `withTimeout()` implementations (`mikrotik.ts`, `adminAccess.ts`) throw `RouterUnreachableError` instead of a generic `Error`, with message text byte-identical to today.
3. The shared `beforeSend` in `packages/core/src/observability.ts` sets `event.level = 'warning'` for any event whose `hint.originalException instanceof RouterUnreachableError` OR `event.exception.values[0].type === 'RouterUnreachableError'`, and calls `scrubEvent(event)` on every branch (matched and unmatched) before returning.
4. A normal (non-router) `Error` passed through `beforeSend` is NOT downgraded — its level is left as Sentry's default/input value.
5. `Sentry.withMonitor('customer-network-revoke')` cron check-in behavior is unchanged — no try/catch was added around `sweepCheckoutAccess`/`sweepAdminAccess`/`sweepAdminBindings` or their callers.
6. All Verification Evidence gate commands pass (see table below).

## Phase Completion Rules

This is a SIMPLE single-session plan — no phase split. The plan is considered CODE DONE when all Implementation Checklist items (1–8) are complete and all Verification Evidence gates are green. It is considered VERIFIED only after a human or EVL confirmation run independently re-executes the gate commands (per orchestration.md EVL rules) — code-only completion must not be marked VERIFIED.

## Touchpoints

| File | Change |
|---|---|
| `packages/core/src/integrations/network/types.ts` | Add new `RouterUnreachableError` class (near top of file, alongside the other exported types/interfaces — no existing class to mirror in this file, so place it as a new top-level export, doc-commented like `RetryablePaymentError`) |
| `packages/core/src/integrations/network/mikrotik.ts` | Add real (non-type) import of `RouterUnreachableError` from `./types`; change `withTimeout()` (lines 221–236) to `reject(new RouterUnreachableError(...))` instead of `reject(new Error(...))` |
| `packages/core/src/services/adminAccess.ts` | Add real (non-type) import of `RouterUnreachableError` from `../integrations/network/types`; change `withTimeout()` (lines 105–119) to `reject(new RouterUnreachableError(...))` instead of `reject(new Error(...))` |
| `packages/core/src/observability.ts` | Add real import of `RouterUnreachableError` from `./integrations/network/types`; rewrite `beforeSend` in `sentryOptions()` (lines 220–237) from the one-arg form to a two-arg `(event, hint)` form that classifies `RouterUnreachableError` to `warning` level, then always returns `scrubEvent(event)` |
| `packages/core/src/integrations/network/mikrotik.spec.ts` | Strengthen the existing timeout test (line 81–86) to also assert `instanceof RouterUnreachableError` |
| `packages/core/src/observability.test.ts` | Add new `beforeSend` classification test cases with 3 test cases (see Verification Evidence) |

## Public Contracts

- **New exported class**: `RouterUnreachableError` from `packages/core/src/integrations/network/types.ts`
  — a new named export on the `@veent/core` `.` and any relevant subpath exports that re-export
  network types. Confirm at EXECUTE time whether `packages/core`'s subpath export map
  (`.`, `./services`, `./integrations`, `./observability`) needs this type re-exported anywhere new;
  it does NOT need a new subpath — it lives inside the existing `./integrations` surface.
  VALIDATE confirmed: `types.ts` is re-exported via `export * from './types'` in
  `network/index.ts` → `export * from './network'` in `integrations/index.ts` → `export * from
  './integrations'` in `src/index.ts`, so the new class auto-propagates to `@veent/core` `.` and
  `./integrations` with no barrel edit required.
- **`sentryOptions()` return shape**: `beforeSend` signature changes from `(event: ErrorEvent) => ErrorEvent`
  to `(event: ErrorEvent, hint: EventHint) => ErrorEvent`. This is the standard Sentry SDK
  `beforeSend` two-arg signature — NOT a breaking change to any caller, since `Sentry.init()` calls
  this positionally and Sentry's own types accept either arity. VALIDATE ground-truthed this against
  the installed `@sentry/core` 10.62.0 types (see validate-contract dimension findings).
- No change to the `withTimeout()` function signatures — both remain `Promise<T>`-returning; only the
  rejection value's runtime type changes (from `Error` to `RouterUnreachableError`, a subtype of `Error`).
  Any existing `.catch` / `.rejects.toThrow` callers keep working because `RouterUnreachableError`
  IS-A `Error`.

## Blast Radius

- **Direct file count**: 6 files (1 new class, 2 throw-site changes, 1 classification-site change,
  2 test files).
- **Shared-surface blast radius**: `sentryOptions()` / `beforeSend` is called from EVERY app's
  Sentry init (`apps/admin/src/hooks.server.ts` + `hooks.client.ts`, `apps/customer/src/hooks.server.ts`
  + `hooks.client.ts`, `apps/locator/src/hooks.server.ts` + `hooks.client.ts` — verify exact hook
  file names at EXECUTE time). This is a DELIBERATE, INTENDED widening: admin's own MAC-detect flow
  (`resolveMacByIp` in `adminAccess.ts`) also throws `RouterUnreachableError` on timeout, so admin's
  Sentry noise gets classified too — that's a feature of this fix, not a side effect to guard
  against.
- **Locator app is unaffected in practice**: `packages/core/src/integrations/network/types.ts` has
  no imports of `node-routeros`, Maya, or Resend (VALIDATE re-confirmed via grep — 0 imports, pure
  type/interface file), so importing `RouterUnreachableError` into `observability.ts` does not pull any
  provider-specific dependency into locator's narrow `@veent/core/observability` subpath. Locator's
  Sentry init stays clean; it simply never sees a `RouterUnreachableError` event because it never
  calls a network-controller method. (Locator IS a live consumer of `sentryOptions`/`nonEmptyEnv`
  from `@veent/core/observability` — confirmed in its `hooks.client.ts`/`hooks.server.ts`.)
- **Risk class**: Sentry observability data classification only — no schema, auth, billing, or
  public API contract change. No migration. No behavior change to the guest/admin network-revoke
  flow itself (the throw still propagates to `withMonitor` identically; only the Sentry level tag
  on the resulting event changes).

## Implementation Checklist

1. Read `packages/core/src/integrations/payments/types.ts` (lines 1–20) as the exact pattern to
   mirror — already done during planning; execute-agent should re-confirm at start.
2. In `packages/core/src/integrations/network/types.ts`, add a new exported class
   `RouterUnreachableError extends Error` near the top of the file (after the file-level doc
   comment, before `GrantInput`), with:
   - A doc comment explaining: thrown by `withTimeout()` in `mikrotik.ts` and `adminAccess.ts`
     when a router call exceeds its bound; classified by `observability.ts`'s `beforeSend` to
     Sentry `warning` level (not dropped) because the cron `withMonitor` check-in already alerts
     on this failure — this is a low-noise breadcrumb, not silence.
   - Constructor: `constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'RouterUnreachableError'; }` (identical shape to `RetryablePaymentError`).
3. In `packages/core/src/integrations/network/mikrotik.ts`:
   - Add `import { RouterUnreachableError } from './types';` (or merge into an existing import
     line from `./types` if one already exists — check imports at top of file first).
   - In `withTimeout()` (line 224), change `reject(new Error(\`${label} timed out after ${ms}ms\`))`
     to `reject(new RouterUnreachableError(\`${label} timed out after ${ms}ms\`))`. Message text
     unchanged.
4. In `packages/core/src/services/adminAccess.ts`:
   - Add `import { RouterUnreachableError } from '../integrations/network/types';` (check existing
     imports first; merge if a `./types`-equivalent import already exists).
   - In `withTimeout()` (line 107), change `reject(new Error(\`resolveMacByIp timed out after ${ms}ms\`))`
     to `reject(new RouterUnreachableError(\`resolveMacByIp timed out after ${ms}ms\`))`. Message
     text unchanged.
5. In `packages/core/src/observability.ts`:
   - Add `import { RouterUnreachableError } from './integrations/network/types';` near the top
     (alongside the existing `@sentry/core` imports at lines 17–18).
   - Rewrite `beforeSend` inside `sentryOptions()` (currently line 234) from:
     ```
     beforeSend: (event: ErrorEvent) => scrubEvent(event),
     ```
     to a two-arg form using `EventHint` from `@sentry/core`:
     ```
     beforeSend: (event: ErrorEvent, hint: EventHint) => {
       const isRouterUnreachable =
         hint.originalException instanceof RouterUnreachableError ||
         event.exception?.values?.[0]?.type === 'RouterUnreachableError';
       if (isRouterUnreachable) {
         event.level = 'warning';
       }
       return scrubEvent(event);
     },
     ```
     — VALIDATE ground-truthed the exact type shapes against installed `@sentry/core` 10.62.0
     (see validate-contract). Add `EventHint` to the existing `import type { ErrorEvent,
     TransactionEvent } from '@sentry/core'` line (line 18) — see execute-agent instruction E2. Both
     branches (matched and unmatched) MUST return `scrubEvent(event)` — PII scrub is non-negotiable
     and must never be skipped regardless of classification outcome.
   - Do NOT change `beforeSendTransaction` (line 235) — out of scope, transactions don't carry
     exception info the same way.
6. In `packages/core/src/integrations/network/mikrotik.spec.ts`, strengthen the existing test at
   line 81–86 (`'rejects via timeout instead of hanging when connect never settles'`): after the
   existing `.rejects.toThrow(/timed out/)` assertion, add or combine with an `instanceof` check,
   e.g. `await expect(connectHardened(...)).rejects.toBeInstanceOf(RouterUnreachableError)` (import
   `RouterUnreachableError` in the spec file's imports). Keep the existing timing assertion
   (`Date.now() - t0 < 500`) unchanged. Note: `connectHardened` wraps `withTimeout` — VALIDATE
   confirmed `connectHardened` re-throws the rejection unchanged (`await withTimeout(...)` at line
   269 with no wrapping catch), so the `RouterUnreachableError` instance surfaces intact.
7. In `packages/core/src/observability.test.ts`, add the new `beforeSend` classification tests
   (per execute-agent instruction E1, nest them INSIDE the existing `describe('sentryOptions', ...)`
   block at line 135 rather than creating a sibling describe) with these 3 test cases:
   - **Case A (primary discriminator)**: construct `sentryOptions({...minimal valid input})`,
     call the returned `beforeSend` with an `ErrorEvent` stub and a `hint = { originalException: new RouterUnreachableError('router timed out after 5000ms') }`; assert the returned event has
     `level === 'warning'`.
   - **Case B (unmatched — normal error stays untouched)**: call `beforeSend` with a plain
     `new Error('normal bug')` as `hint.originalException` and NO pre-set `event.level`; assert
     the returned event's `level` is unchanged (i.e. still `undefined` or whatever the input event
     had — do not assert it becomes `'warning'`).
   - **Case C (fallback discriminator)**: call `beforeSend` with `hint.originalException` absent/undefined but `event.exception.values[0].type === 'RouterUnreachableError'` set directly on the
     event stub; assert `level === 'warning'` (proves the fallback path independent of `hint`).
   - **PII-scrub-still-runs assertion**: in at least Case A and Case B, include a PII value (e.g.
     an email or MAC) in `event.message` and assert it is redacted in the returned event in BOTH
     branches — proving `scrubEvent` runs regardless of classification outcome.
8. Run the gate commands (see Verification Evidence) and fix any failures before considering the
   change complete.

## Verification Evidence

Test routing followed `process/context/tests/all-tests.md` (bunx vitest run — see project unit-test runner gotcha: never `bun test <file>`, bun's native runner silently no-ops `vi.setSystemTime`/vitest-only features).


| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` | Fully-Automated | Timeout rejection is `instanceof RouterUnreachableError`, existing `/timed out/` message-text behavior unchanged |
| `bunx vitest run packages/core/src/observability.test.ts` — Case A (`hint.originalException instanceof RouterUnreachableError` → `level: 'warning'`) | Fully-Automated | `beforeSend` downgrades `RouterUnreachableError` events to warning via the primary discriminator |
| `bunx vitest run packages/core/src/observability.test.ts` — Case B (normal `Error` → level unchanged) | Fully-Automated | Non-router errors are NOT downgraded — real bugs stay at error level |
| `bunx vitest run packages/core/src/observability.test.ts` — Case C (`event.exception.values[0].type` fallback → `level: 'warning'`) | Fully-Automated | Fallback discriminator works independent of `hint.originalException` (covers cases where Sentry SDK normalizes the exception before `hint` is populated) |
| `bunx vitest run packages/core/src/observability.test.ts` — PII-scrub-still-runs assertions (Cases A & B) | Fully-Automated | `scrubEvent` PII redaction is never skipped regardless of classification branch taken |
| `bun run check` (scoped at minimum to `packages/core`; full monorepo check acceptable) | Fully-Automated | No TypeScript/svelte-check regressions from the new class, two throw-site changes, and the `beforeSend` signature change |
| Existing `mikrotik.spec.ts` full suite green | Fully-Automated | No regression to other timeout/connect/ping tests in the same file |
| Manual/agent-probe: confirm `Sentry.withMonitor('customer-network-revoke')` check-in code path is untouched (grep for `withMonitor` usage in `apps/customer/src/routes/api/network/revoke/+server.ts` and confirm no try/catch was added around the sweep calls) | Agent-Probe | Non-Goal #1 held — cron red-signal propagation is unchanged |

### Test Infra Improvement Notes
(none identified yet)

## Dependencies, Risks, Integration Notes

- **Dependency**: none new — `@sentry/core` 10.62.0 is already a dependency of `packages/core`.
- **Risk (RESOLVED by VALIDATE)**: the exact `EventHint`/`beforeSend` two-arg type shape in
  `@sentry/core` 10.62.0 was ground-truthed against the installed `.d.ts` files — all four
  assumptions confirmed (see validate-contract dimension findings). No signature mismatch.
- **Risk (RESOLVED by VALIDATE)**: `connectHardened` in `mikrotik.ts` re-throws the `withTimeout`
  rejection unchanged (verified line 269) — the `RouterUnreachableError` instance survives the
  wrapping, so the strengthened spec `instanceof` assertion is safe.
- **Integration note**: this shared `beforeSend` change affects admin, customer, AND locator Sentry
  init paths identically (single shared function) — this is intended per Blast Radius above, not a
  bug to prevent.

## Resume and Execution Handoff

1. **Selected plan file path**: `process/general-plans/active/router-timeout-sentry-classify_17-07-26/router-timeout-sentry-classify_PLAN_17-07-26.md`
2. **Last completed phase or step**: VALIDATE — validate-contract written, Gate PASS.
3. **Validate-contract status**: written (17-07-26) — Gate PASS. See `## Validate Contract` below.
4. **Supporting context files loaded during planning**: `process/context/all-context.md`,
   `packages/core/src/integrations/payments/types.ts`, `packages/core/src/integrations/network/types.ts`,
   `packages/core/src/integrations/network/mikrotik.ts`, `packages/core/src/services/adminAccess.ts`,
   `packages/core/src/observability.ts`, `packages/core/src/observability.test.ts`,
   `packages/core/src/integrations/network/mikrotik.spec.ts`.
5. **Next step for a fresh agent picking up mid-execution**: if implementation checklist items 1–5
   are done but tests (items 6–7) are not written, run `bunx vitest run` on both spec files first
   to see current red/green state before writing new assertions, to avoid duplicating existing
   coverage.

## Validate Contract

Status: PASS
Date: 17-07-26
date: 2026-07-17
generated-by: outer-pvl

Parallel strategy: sequential
Rationale: signal score 1/7 — only S7 present (6 files ≥ 5-file threshold). No auth/billing/schema/API/deploy/secrets surface (S6 absent), single package (S1 absent), single locked design (S3 absent), not a phase program (S4 absent). Sequential fits: trivial single-package change, no fan-out benefit.

Test gates (C3 5-column table):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC2 | Timeout rejects with `instanceof RouterUnreachableError`; `/timed out/` message text unchanged | Fully-Automated | `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` | B |
| AC3 (primary) | `beforeSend` downgrades `RouterUnreachableError` to `level: 'warning'` via `hint.originalException instanceof` | Fully-Automated | `bunx vitest run packages/core/src/observability.test.ts` (Case A) | B |
| AC4 | Normal `Error` NOT downgraded — level left unchanged | Fully-Automated | `bunx vitest run packages/core/src/observability.test.ts` (Case B) | B |
| AC3 (fallback) | Fallback discriminator `event.exception.values[0].type === 'RouterUnreachableError'` → warning, independent of hint | Fully-Automated | `bunx vitest run packages/core/src/observability.test.ts` (Case C) | B |
| AC3 (PII) | `scrubEvent` PII redaction runs on BOTH matched and unmatched branches | Fully-Automated | `bunx vitest run packages/core/src/observability.test.ts` (PII assertions, Cases A & B) | B |
| AC1/AC2/AC3 | No TS/svelte-check regression from new class + throw-site + `beforeSend` signature change | Fully-Automated | `bun run check` | A |
| regression | No regression to other timeout/connect/ping tests | Fully-Automated | `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` (full file) | A |
| AC5 | `withMonitor` cron red-signal propagation unchanged — no try/catch added around sweep calls | Agent-Probe | grep `withMonitor` + sweep calls in `apps/customer/src/routes/api/network/revoke/+server.ts`; confirm no try/catch wrapping | A |

gap-resolution legend: A — proven now; B — gate added by this plan's checklist; C — deferred to later phase; D — backlog test-building stub.
C-4 reconciliation: `strategy` column carries only the 3 proving strategies (Fully-Automated / Hybrid / Agent-Probe). No Known-Gap rows — every developed behavior has an automated or agent-probe gate.

Legacy line form (retained for existing validate-contract consumers):
- mikrotik.ts throw site: Fully-automated: `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts`
- observability.ts beforeSend classification: Fully-automated: `bunx vitest run packages/core/src/observability.test.ts`
- typecheck: Fully-automated: `bun run check`
- withMonitor invariant: agent-probe: grep revoke/+server.ts for try/catch around sweep calls

Failing stub (Case A — Fully-Automated):
```
test("should downgrade RouterUnreachableError events to warning via hint.originalException", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: beforeSend sets level='warning' when hint.originalException instanceof RouterUnreachableError")
})
```
Failing stub (Case B — Fully-Automated):
```
test("should NOT downgrade a normal Error passed through beforeSend", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: beforeSend leaves level unchanged for a plain Error")
})
```
Failing stub (Case C — Fully-Automated):
```
test("should downgrade via event.exception.values[0].type fallback when hint is absent", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: beforeSend fallback discriminator sets level='warning'")
})
```
Failing stub (mikrotik instanceof — Fully-Automated):
```
test("should reject via timeout with an instanceof RouterUnreachableError", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: connectHardened timeout rejection is instanceof RouterUnreachableError")
})
```

Dimension findings:
- Infra fit: PASS — target file paths, line numbers, and the `@veent/core` barrel re-export chain (`types.ts` → `network/index.ts` → `integrations/index.ts` → `src/index.ts` via `export *`) all confirmed on disk. `packages/core` uses Vitest; `bunx vitest run <file>` is the correct scoped command (bun-native `bun test <file>` gotcha avoided).
- Test coverage: PASS — all developed behaviors covered by Fully-Automated gates (5 vitest cases + typecheck + regression) plus one Agent-Probe for the withMonitor no-touch invariant. No Known-Gap rows. No high-risk class requiring a hybrid gate (observability data-classification only).
- Breaking changes: PASS — GROUND-TRUTHED against installed `@sentry/core` 10.62.0 `.d.ts`: (a) `beforeSend?: (event: ErrorEvent, hint: EventHint) => PromiseLike<ErrorEvent|null> | ErrorEvent | null` (options.d.ts:597); (b) `EventHint.originalException?: unknown` (event.d.ts:82); (c) `Event.level?: SeverityLevel` where `SeverityLevel = 'fatal'|'error'|'warning'|'log'|'info'|'debug'` (mutable, 'warning' valid); (d) `Exception.type?: string` exists for the fallback discriminator. `scrubEvent<T>(event:T):T` return is assignable to the `ErrorEvent|null` return type. No signature mismatch. `RouterUnreachableError` IS-A `Error`, so all existing `.catch`/`.rejects.toThrow` callers keep working.
- Security surface: PASS — PII invariant verified: plan mandates `return scrubEvent(event)` on BOTH matched (downgraded) and unmatched branches; no path drops scrubEvent. No auth/billing/secret/trust-boundary surface touched. Not a high-risk class → no risk-evidence-pack required.
- Section A (types.ts + throw sites): PASS — `types.ts` has 0 imports (locator bundle stays clean); `mikrotik.ts:224` and `adminAccess.ts:107` `reject(new Error(...))` sites match plan line refs exactly; `RetryablePaymentError` pattern confirmed byte-identical to mirror target.
- Section B (observability.ts beforeSend): PASS — `observability.ts:234` one-arg `beforeSend` matches plan; type shapes confirmed; highest-risk edit is the signature rewrite, mitigated by the ground-truthed types + 5 automated test cases.
- Section C (test additions): PASS — existing `mikrotik.spec.ts:81-86` test body and `observability.test.ts` structure confirmed; `connectHardened` re-throws unchanged (line 269, no wrapping catch) so `instanceof` assertion is safe. One advisory (nest new tests in existing `sentryOptions` describe) captured as execute-agent instruction E1.

Execute-agent instructions:
- E1: `observability.test.ts` already contains a `describe('sentryOptions', ...)` block (line 135, tracesSampleRate clamping only). Nest the 3 new `beforeSend` classification cases (A/B/C) + PII-scrub assertions INSIDE that existing `sentryOptions` describe block — do NOT create a sibling `describe('sentryOptions beforeSend classification', ...)`. Trigger: Implementation Checklist item 7.
- E2: When editing `observability.ts` line 18, add `EventHint` to the existing `import type { ErrorEvent, TransactionEvent } from '@sentry/core'` line — do not add a separate import statement. `EventHint` is exported from `@sentry/core` (confirmed event.d.ts:77). Trigger: Implementation Checklist item 5.

Open gaps: none

What this coverage does NOT prove:
- `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` does NOT prove real MikroTik router behavior — it uses the mocked `node-routeros` fake connection; it proves the timeout-rejection type contract only, not live-router timeout timing.
- `bunx vitest run packages/core/src/observability.test.ts` does NOT prove that a REAL Sentry SDK, at runtime, populates `hint.originalException` for this specific throw path (that depends on Sentry's internal event pipeline). It proves the `beforeSend` function's own classification logic against constructed event/hint stubs. The Case C fallback discriminator exists precisely to cover the case where the SDK normalizes the exception before `hint` is populated — but neither branch is proven against a live Sentry dispatch.
- `bun run check` does NOT prove runtime correctness — only TypeScript/svelte-check type validity across the apps fan-out (note: `packages/core` itself has no `check` script; type-safety of the core change is proven transitively when the apps that import it are checked, plus the vitest type-level usage).
- The Agent-Probe (withMonitor invariant) proves no try/catch was ADDED around the sweep calls; it does NOT prove the live cron check-in goes red on a real router outage (that is existing, unchanged behavior not re-exercised here).

Gate: PASS (no FAILs, no CONCERNs; plan updated with VALIDATE findings and 2 execute-agent instructions)
Accepted by: session (coordinator explicitly accepted Net Gate PASS this session)

## Autonomous Goal Block

```
SESSION GOAL: Classify router-unreachable timeouts as Sentry warnings (not errors) without breaking the cron withMonitor check-in
Charter + umbrella plan: N/A — single plan
Autonomy: single-plan EXECUTE — proceed on validate-contract; no live-provider/irreversible actions in scope. Feedback ref: feedback_autonomous_phase_execution.
Hard stop conditions / safety constraints:
- Do NOT add try/catch around sweepCheckoutAccess / sweepAdminAccess / sweepAdminBindings or their callers — the throw MUST reach Sentry.withMonitor (breaking this destroys the cron red-signal).
- scrubEvent(event) MUST run on BOTH the downgraded and unmatched beforeSend branches — dropping PII scrub on any path is a hard stop.
- Do NOT change the timeout error message text ("... timed out after ...ms") — existing /timed out/ regex test must keep passing.
- Agents never commit — prepare staged changes + suggested message only.
Next phase: EXECUTE — process/general-plans/active/router-timeout-sentry-classify_17-07-26/router-timeout-sentry-classify_PLAN_17-07-26.md
Validate contract: inline in plan (## Validate Contract, Gate PASS)
Execute start: bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts | bunx vitest run packages/core/src/observability.test.ts | bun run check | agent-probe: grep withMonitor in apps/customer/src/routes/api/network/revoke/+server.ts | high-risk pack: no
```
