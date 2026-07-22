---
phase: ap-false-down-outage-guard
date: 2026-07-21
status: COMPLETE
feature: general-plans
plan: process/general-plans/active/ap-false-down-outage-guard_21-07-26/ap-false-down-outage-guard_PLAN_21-07-26.md
---

## What Was Done

Executed all 5 checklist items of the re-scoped (code-free) plan:

1. Created `packages/core/src/services/networkHealth.transaction-tripwire.spec.ts` — static
   source-text tripwire. For each admin call site (`+page.server.ts`, `health/refresh/+server.ts`)
   it asserts `refreshNetworkHealth(` present (non-vacuous positive anchor) AND `db.transaction(`
   absent. Paths resolve from `import.meta.url` up 4 levels to repo root; a bad path makes
   `readFileSync` throw. File-level comment links the E3 constraint and the backlog note.
2. Updated `process/general-plans/backlog/ap-name-retry-transaction-tripwire_NOTE_20-07-26.md` —
   marked option 2 (static grep/text guard) IMPLEMENTED with the spec path; added spec to Pointers.
   Note stays in `backlog/` (runtime-guard option 1 + CI option remain open).
3. Created `docs/mikrotik/ap-liveness-bypass.md` — operator runbook: every new AP MAC →
   `/ip/hotspot/ip-binding type=bypassed` else router→AP ICMP is rejected by `hs-unauth-to` and the
   AP reads DOWN. States it is THE primary false-DOWN mitigation; cross-links walled-garden.md and
   cites the live-verification report (Probe 4 / G16).
4. Created `process/general-plans/backlog/ap-outage-false-down-code-safeguard_NOTE_21-07-26.md` —
   deferral note with (a) goal, (b) DEAD `online_since IS NOT NULL` approach + F1 reason, (c) two
   viable candidates (`ever_served` set-once column; bypass-state router read), (d) runbook =
   shipped mitigation / code fix is defense-in-depth.
5. Ran the gate — green (2 passed).

## What Was Skipped or Deferred

Nothing skipped. The behavioral `outage.ts` guard was already DESCOPED at PLAN time (VALIDATE F1);
it is recorded in the item-4 deferral note, not implemented.

## Test Gate Outcomes

- `bunx vitest run packages/core/src/services/networkHealth.transaction-tripwire.spec.ts` — PASS
  (Test Files 1 passed, Tests 2 passed). Fully-Automated / AC1. Run twice (before and after doc
  work), green both times.
- AC2 (runbook) and AC3 (deferral note) are Agent-Probe — files created per spec, pending
  EVL/reviewer prose judgment.

## Plan Deviations

None. Implementation matches the plan checklist exactly.

## Test Infra Gaps Found

None.

## Closeout Packet

- Selected plan: `process/general-plans/active/ap-false-down-outage-guard_21-07-26/ap-false-down-outage-guard_PLAN_21-07-26.md`
- Finished: all 4 checklist artifacts + green tripwire gate.
- Verified: AC1 (automated, green). Unverified pending EVL: AC2/AC3 (Agent-Probe prose review).
- Remaining: EVL confirmation run (vc-tester re-runs the gate); UPDATE PROCESS archival.
- Best next state: `Ready for UPDATE PROCESS archival` after EVL confirms the gate green.

## Forward Preview

- Test Infra Found: sibling `.spec.ts` files in `packages/core/src/services/` are auto-collected by
  `vitest run`; the new tripwire runs there with no config change.
- Blast Radius Changes: 1 new spec (`@veent/core`, no source edit), 1 new runbook doc, 1 new backlog
  note, 1 edited backlog note. No service/schema/billing/auth/API surface touched.
- Commands to Stay Green: `bunx vitest run packages/core/src/services/networkHealth.transaction-tripwire.spec.ts`
- Dependency Changes: none.
