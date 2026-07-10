---
domain: plan
iteration: 1
date: 10-07-26
task: ims-audit-remediation
gaps_found: 5
fail_count: 0
concern_count: 5
applied: 5
loop_status: CONTINUE
---

# PVL Iteration 001 — IMS Audit Remediation Plan

First VALIDATE pass (vc-validate-agent, V1–V7) returned **Gate: CONDITIONAL** — 0 FAILs, 5
CONCERNs. vc-plan-agent applied all 5 supplements in place; plan-artifact validator stayed clean.

| Gap | Severity | Summary | Resolution |
|---|---|---|---|
| G1 | CONCERN | M1/L4 feed tests mis-tiered Fully-Automated (fakeDb can't exercise SQL) | Retiered to Hybrid (e2e) + Agent-Probe browser 4; unit test scoped to JS-shape |
| G2 | CONCERN | M3 fix uses ISSUE_STATUS.open but detail/+server.ts lacks the import | Import sub-step added (Phase 2 item 13a) |
| G3 | CONCERN | Root `bun run check` skips packages/db — Phase 1 schema edit untypechecked | `cd packages/db && bunx tsc --noEmit` added to Phase 1 gate |
| G4 | CONCERN | M3 predicate change had no dedicated automated proof | Named incident-detail e2e assertion (resolved-unassigned → 404 for non-assignee) |
| G5 | CONCERN | HIGH-risk classes relied on browser handoff alone at closeout | vc-risk-evidence-pack 5-artifact set required in {task-folder}/harness/ |

Next: re-spawn vc-validate-agent from V1 against the supplemented plan.
