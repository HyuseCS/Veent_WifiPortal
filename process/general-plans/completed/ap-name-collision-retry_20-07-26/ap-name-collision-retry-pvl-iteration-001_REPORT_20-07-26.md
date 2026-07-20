---
name: report:ap-name-collision-retry-pvl-iteration-001
description: "PVL cycle 1 — G-NC2 leg-2 test staging gap closed; re-validating from V1"
date: 20-07-26
metadata:
  node_type: report
  type: pvl-iteration
  cycle: 1
  domain: plan
---

# PVL Iteration 001 — ap-name-collision-retry

**Plan:** `ap-name-collision-retry_PLAN_20-07-26.md`
**Cycle:** 1 of 10 (cap)
**Entry verdict:** `Gate: CONDITIONAL` (first pass, 1 CONCERN, not self-accepted)

## Gap addressed

**G-NC2 leg 2 was unstageable as written.** The test seeds `X` and `X (tail)` and asserts the
cycle degrades to interface-only on a second collision. It would not have degraded:
`resolveApName`'s pre-check consumes the first collision by resolving the new AP's name to
`X (tail)` before the insert. The insert then raises `network_health_name_key` 23505, the
once-retry recomputes to `X (tail) (tail)`, and that write **succeeds** — so the cycle completes
normally and the degradation assertion fails.

Root cause of the flaw: the test staging reasoned about the retry layer in isolation, forgetting
the pre-check layer sitting in front of it.

## Fix applied

Checklist item 5, G-NC2 leg 2 only: pre-seed all three names — `X`, `X (tail)`, and
`X (tail) (tail)` — so the retry's recomputed name also collides, the second 23505 propagates out
of `refreshAccessPoints`, and it lands in the existing interface-only degradation catch. Rationale
recorded inline in the plan, with an explicit note not to "simplify" it back to two seeds.

Leg 1 (direct `upsertApRow` staging, two seeds) was confirmed correct by VALIDATE and left verbatim.

## Side finding

The validate-contract's AC2 gate row (plan line 209) already specified "three pre-seeded names".
The checklist and the contract were internally inconsistent; this supplement resolves it in the
contract's favour rather than the other way round.

## Not re-litigated

Retry mechanics, error identification (`isNameUniqueViolation` cause-chain walk), the prune
name-bookkeeping fix, and the `upsertApRow` extraction all passed VALIDATE — several with live
probe evidence against the repo's actual PGlite and drizzle versions. Untouched.

## Outcome

Structural validator: 0 failures, 0 warnings. Re-spawning `vc-validate-agent` from V1.
