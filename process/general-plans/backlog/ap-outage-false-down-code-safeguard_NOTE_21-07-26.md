---
name: note:ap-outage-false-down-code-safeguard
description: "Deferred code safeguard against freezing paid guests on a falsely-DOWN AP. Records the DEAD `online_since IS NOT NULL` approach (VALIDATE F1 — would disable all outage pausing) and two viable candidates. The ip-binding-bypass runbook is the shipped operational mitigation; the code fix is defense-in-depth only."
date: 21-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# AP false-DOWN: deferred code safeguard

## (a) Goal

Don't freeze paid guests on a falsely-DOWN AP. An un-bypassed AP reads permanently DOWN because the
hotspot walled-garden `hs-unauth-to` rule rejects the router's ICMP to it (see
[`docs/mikrotik/ap-liveness-bypass.md`](../../../docs/mikrotik/ap-liveness-bypass.md)). If outage
auto-pausing acts on that false DOWN, guests who are actually online through the AP get paused. The
goal of a code safeguard is to make `sweepOutagePauses()` never pause on an AP that has never
genuinely served — i.e. distinguish "never came up" from "went down after serving."

## (b) DEAD approach — never retry (VALIDATE F1)

**Adding `AND online_since IS NOT NULL` to the outage down-set.**

`online_since` / `offline_since` in `network_health` are **mutually-exclusive CURRENT-STATE stamps,
not cumulative history.** `sinceTransitionSet()`
(`packages/core/src/services/networkHealth.ts:95-107`) hard-sets `online_since = NULL` on every
refresh that sees an AP not-serving. So the outage down-set (currently-down APs only) **always** has
`online_since = NULL` — for a genuinely-went-down AP exactly as for a never-up AP. The clause would
make the down-set **always empty**, disabling ALL outage auto-pausing, and regress ≥3 existing
passing integration tests (`outage.integration.spec.ts` WAN-outage case + G13). There is **no
set-once "ever served" discriminator in the current schema**, so the one-line never-up guard is
impossible as designed. Do not re-add this clause or its unit/integration cases.

## (c) Two viable candidates (surfaced by VALIDATE)

1. **`ever_served` set-once column.** Add a new never-cleared `network_health` column (`ever_served
   bool` or `first_online_at timestamptz`), set the first time an AP is observed serving and never
   cleared thereafter; the outage guard becomes `ever_served = true` (or `first_online_at IS NOT
   NULL`). Requires a migration (~0050), a write in `sinceTransitionSet` / insert paths, and a
   backfill decision for existing rows. **High-risk schema class** → full RIPER-5 + risk-evidence
   pack if pursued.

2. **Bypass-state router read.** At pause time, query `/ip/hotspot/ip-binding type=bypassed` and
   trust a ping-DOWN only for APs that ARE bypassed — a non-bypassed AP's DOWN is untrustworthy
   (that's the whole false-DOWN artifact). Needs a `VC-FEASIBILITY-PROBE-NEEDED` on the
   ip-binding-table response shape (observed live only once, in the Probe 4 / G16 report). This note
   **supersedes** the earlier Signal-C-only deferral idea — fold the `listHotspotHosts()`
   authorized/bypassed cross-check into this candidate's bypass-state reasoning.

## (d) Runbook is the shipped mitigation

The operational fix already shipped: [`docs/mikrotik/ap-liveness-bypass.md`](../../../docs/mikrotik/ap-liveness-bypass.md)
tells operators to bypass every new AP MAC so its liveness reads correctly and it never falsely
reads DOWN in the first place. A code safeguard is **defense-in-depth only**. **Revisit only if a
regressed-bypass case is actually observed live** (an AP that was bypassed, lost its bypass, and
falsely paused guests). Low urgency — do not action reflexively.

## Pointers

- `packages/core/src/services/outage.ts` — `sweepOutagePauses()` (the down-set query).
- `packages/core/src/services/networkHealth.ts:95-107` — `sinceTransitionSet()` (the F1 state model).
- `packages/core/src/services/outage.integration.spec.ts` — WAN-outage + G13 cases the dead clause would regress.
- `process/general-plans/active/ap-false-down-outage-guard_21-07-26/ap-false-down-outage-guard_PLAN_21-07-26.md` — the re-scoped plan and full F1 reasoning.
- `process/general-plans/active/per-ap-visibility_16-07-26/live-verification_REPORT_17-07-26.md` — Probe 4 / G16 live evidence.
- `docs/mikrotik/ap-liveness-bypass.md` — the shipped operational mitigation (item d).
