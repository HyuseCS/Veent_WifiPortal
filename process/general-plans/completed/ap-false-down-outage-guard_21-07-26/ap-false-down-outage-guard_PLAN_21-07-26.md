---
name: plan:ap-false-down-outage-guard
description: "RE-SCOPED after VALIDATE BLOCKED (F1). Ship only the sound, no-billing-risk parts of the AP false-DOWN work: a static transaction-tripwire test, an ip-binding-bypass runbook, and two backlog notes (tripwire-implemented + code-safeguard deferral). The behavioral outage.ts guard is DESCOPED — impossible as designed."
date: 21-07-26
feature: general-plans
---

# AP false-DOWN outage guard — RE-SCOPED SIMPLE plan (code guard DESCOPED)

- **Date**: 21-07-26 (re-scoped 21-07-26 after VALIDATE returned BLOCKED)
- **Status**: ACTIVE — re-VALIDATED **PASS** 21-07-26 against the re-scoped code-free plan; ready for EXECUTE.
- **Complexity**: SIMPLE
- **Context:** read `process/context/all-context.md` (root router) → `process/context/tests/all-tests.md` for the test surface.

**TL;DR:** The original one-line `online_since IS NOT NULL` outage guard is **impossible as designed**
(VALIDATE F1 — see below) and has been **removed** from this plan. What remains, and ships, are the
three parts VALIDATE independently PASSED: (1) a static source-text transaction-tripwire test in
`@veent/core`, (2) an operator runbook `docs/mikrotik/ap-liveness-bypass.md` — now THE primary
mitigation for the false-DOWN bug — and (3) two backlog notes (mark the tripwire option implemented;
record the deferred code safeguard with its dead approach and two viable candidates). **No service
code, no schema, no billing/auth/API surface.** Multi-file, so VALIDATE still runs (not the
single-file skip lane), but is expected to gate PASS quickly.

## Context — re-scope rationale (the DESCOPED code change; record so the dead approach is never retried)

**VALIDATE finding F1 (source-provable, no runtime probe needed):** `online_since` / `offline_since`
in `network_health` are **mutually-exclusive CURRENT-STATE stamps, not cumulative history.**
`sinceTransitionSet()` (`packages/core/src/services/networkHealth.ts:95-107`) hard-sets
`online_since = NULL` on every refresh that sees an AP not-serving. Therefore the outage down-set
(currently-down APs only) **always** has `online_since = NULL`, for a genuinely-went-down AP exactly
as for a never-up AP. Adding `AND online_since IS NOT NULL` would make the down-set **always empty**
→ **disable ALL outage auto-pausing** and regress ≥3 existing passing integration tests
(`outage.integration.spec.ts` WAN-outage case and G13). There is **no set-once "ever served"
discriminator in the current schema**, so the one-line never-up guard is impossible as designed.

**DESCOPED (removed from this plan — do NOT re-add as active checklist items):**

| Removed item | Reason (F1) |
|---|---|
| `outage.ts` `isNotNull(onlineSince)` guard clause | Dead — would make the down-set always empty and disable outage pausing entirely. |
| `outage.spec.ts` never-up / went-down unit cases | Nothing behavioral to test — the guard is gone. |
| `outage.integration.spec.ts` never-up exclusion case | Would seed a production-impossible row state (`online=false` with `online_since` non-null); false confidence. |

The code safeguard is **not abandoned** — it is deferred to a backlog note (checklist item 4) with
its dead approach recorded and two viable candidate designs preserved.

## Phase Completion Rules

Single-phase SIMPLE plan. `CODE DONE` when checklist items 1–4 are applied AND the tripwire gate
(Verification Evidence) is green. `VERIFIED` only after the EVL confirmation run (vc-tester re-runs
the gate command independently) passes and the runbook doc (AC2, Agent-Probe) has been reviewed.

## Touchpoints

| # | File | Change |
|---|---|---|
| 1 | New: `packages/core/src/services/networkHealth.transaction-tripwire.spec.ts` | Static source-text regression test — asserts neither admin call site wraps `refreshNetworkHealth` in `db.transaction(`, and asserts each file DOES contain `refreshNetworkHealth(` (non-vacuous positive anchor). No runtime tx-detection. |
| 2 | `process/general-plans/backlog/ap-name-retry-transaction-tripwire_NOTE_20-07-26.md` | Mark option 2 (static grep/text guard) IMPLEMENTED, with the new spec path. |
| 3 | New: `docs/mikrotik/ap-liveness-bypass.md` | Runbook: every new AP MAC must be `type=bypassed` in `/ip/hotspot/ip-binding` or its liveness reads DOWN. Now the primary false-DOWN mitigation. |
| 4 | New: `process/general-plans/backlog/ap-outage-false-down-code-safeguard_NOTE_21-07-26.md` | Deferral note: goal, dead approach + F1 reason, two viable candidates, runbook = shipped mitigation. |

**No `packages/core` service code, no schema, no billing/auth/API surface is touched.**

## Public Contracts

- **No public contract change.** No service signature, schema, or route changes. The DESCOPED
  behavioral narrowing of `sweepOutagePauses()` is removed — outage-sweep behavior is unchanged from
  today.

## Blast Radius

- **Files changed:** 1 new test file (`@veent/core`), 1 new runbook doc, 1 edited backlog note, 1 new
  backlog note. **4 files, all additive or doc/process.**
- **Packages:** `@veent/core` (one new spec only — no source edit). Docs + process artifacts otherwise.
- **Risk class:** **none.** No billing/auth/API/schema/migration surface. The static tripwire spec
  only reads source text; it cannot affect runtime behavior. Multi-file → VALIDATE still runs, but a
  fast PASS is expected.

## Implementation Checklist

1. **Create `packages/core/src/services/networkHealth.transaction-tripwire.spec.ts`** — static
   source-text regression test. Read the two admin source files via `fs.readFileSync` (resolve paths
   from `import.meta.url`: from `packages/core/src/services/` the repo root is `../../../../`, then
   `apps/admin/src/routes/(app)/networks/+page.server.ts` (~L55) and
   `apps/admin/src/routes/api/network/health/refresh/+server.ts` (~L29)). **Non-vacuous assertion
   (added per VALIDATE 21-07-26, concern C1):** for EACH file assert BOTH — (a) a **positive anchor**:
   the file contains `refreshNetworkHealth(` (proves the reader actually read the intended call site,
   so an "absence" pass can never be silently vacuous from a wrong/renamed path or empty read); AND
   (b) the file does **NOT** contain the substring `db.transaction(` (both currently have zero — green
   baseline confirmed by VALIDATE: 0 `db.transaction(`, 1 `refreshNetworkHealth(` per file). Resolve
   paths so that a missing/renamed file makes `readFileSync` **throw** (a hard, loud failure) rather
   than silently pass. No runtime tx-detection. Add a file-level comment linking to
   `ap-name-retry-transaction-tripwire_NOTE_20-07-26.md` and constraint E3. Runner:
   `bunx vitest run packages/core/src/services/networkHealth.transaction-tripwire.spec.ts`.

2. **Update the backlog tripwire note**
   `process/general-plans/backlog/ap-name-retry-transaction-tripwire_NOTE_20-07-26.md`: under
   "## What to do", mark option 2 (static grep/text guard) as now IMPLEMENTED as a vitest source-text
   assertion, citing the new spec path from item 1. Keep the note in `backlog/` (the static guard is a
   partial mitigation; the runtime-guard option 1 and CI option remain open).

3. **Create runbook `docs/mikrotik/ap-liveness-bypass.md`** — durable operator note. Match the
   existing `docs/mikrotik/` convention (see `walled-garden.md`: `# Title`, a why-paragraph, the exact
   `/ip/hotspot/ip-binding` command, a verify step, cross-links; and `admin-bypass-troubleshooting.md`
   for troubleshooting layout). List the existing `docs/mikrotik/` files first and follow their
   heading style. Content: EVERY new AP MAC must be added to `/ip/hotspot/ip-binding` as
   `type=bypassed` (or otherwise walled-garden-exempted) or its liveness reads DOWN — the hotspot's
   dynamic `hs-unauth-to` rule (`reject-with=icmp-host-prohibited`) drops ICMP to any non-bypassed
   client, and every physical AP is itself an un-bypassed hotspot client. State plainly that this
   runbook is **THE primary mitigation** for the false-DOWN bug (freezing paid guests on a falsely-DOWN
   AP), because the code-side outage guard was found impossible (see F1 / item 4). Cross-reference
   `docs/mikrotik/walled-garden.md` and cite the live-verification report
   (`process/general-plans/active/per-ap-visibility_16-07-26/live-verification_REPORT_17-07-26.md`,
   Probe 4 / Step 1-3 / G16) as the evidence source.

4. **Create backlog note `process/general-plans/backlog/ap-outage-false-down-code-safeguard_NOTE_21-07-26.md`**
   — code-safeguard deferral. Use repo note frontmatter convention (`name: note:...`, `description`,
   `date: 21-07-26`, `metadata: {node_type: memory, type: note, feature: general-plans}`). It MUST record:
   - **(a) Goal** — don't freeze paid guests on a falsely-DOWN AP (an un-bypassed AP that reads
     permanently DOWN via ICMP because the hotspot walled-garden rejects ICMP to it).
   - **(b) DEAD approach + F1 reason (never retry)** — adding `online_since IS NOT NULL` to the outage
     down-set. `online_since`/`offline_since` are mutually-exclusive CURRENT-STATE stamps, not history
     (`sinceTransitionSet()` nulls `online_since` on every not-serving refresh), so the down-set always
     has `online_since = NULL`; the clause would make the down-set always empty and disable all outage
     pausing. There is no set-once "ever served" discriminator in the current schema.
   - **(c) TWO viable candidates VALIDATE surfaced:**
     1. **`ever_served` set-once column** — new never-cleared `network_health` column (`ever_served bool`
        or `first_online_at timestamptz`), set the first time an AP is observed serving and never
        cleared; guard becomes `ever_served = true` (or `first_online_at IS NOT NULL`). Needs a
        migration (~0050), a write in `sinceTransitionSet`/insert paths, and a backfill decision.
        **High-risk schema class** → full RIPER-5 + risk-evidence pack if pursued.
     2. **Bypass-state router read** — at pause time query `/ip/hotspot/ip-binding type=bypassed` and
        trust a ping-DOWN only for APs that ARE bypassed (a non-bypassed AP's DOWN is untrustworthy).
        Needs a `VC-FEASIBILITY-PROBE-NEEDED` on the binding-table shape (observed only once).
   - **(d) Runbook is the shipped mitigation** — item 3's `ap-liveness-bypass.md` is the operational
     fix; a code safeguard is defense-in-depth only. **Revisit only if a regressed-bypass case is
     actually observed live.** Note this note SUPERSEDES the earlier Signal-C-only deferral idea (fold
     the `listHotspotHosts()` cross-check into candidate 2's bypass-state reasoning).

5. **Run the tripwire gate** (Verification Evidence) and confirm green before handoff.

## Verification Evidence

Acceptance criteria (this plan defines them; no separate SPEC doc):
- **AC1** — a source-text tripwire fails if either `refreshNetworkHealth` call site gains a `db.transaction(` wrapper.
- **AC2** — operators have a durable runbook step: new AP MAC → `/ip/hotspot/ip-binding` bypass.
- **AC3** — the dead code approach and its two viable successors are recorded in backlog so the work is not lost and the dead approach is never retried.

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `bunx vitest run packages/core/src/services/networkHealth.transaction-tripwire.spec.ts` — no `db.transaction(` in either call site AND `refreshNetworkHealth(` present in both (positive anchor) | Fully-Automated (source-text) | AC1 (proven by: tripwire spec, item 1) |
| Manual review: `docs/mikrotik/ap-liveness-bypass.md` exists, matches runbook convention, cross-links live-verification report | Agent-Probe (prose/accuracy judgment) | AC2 (proven by: runbook, item 3) |
| Manual review: `ap-outage-false-down-code-safeguard_NOTE_21-07-26.md` records goal + dead approach (F1) + two candidates + runbook mitigation | Agent-Probe (completeness judgment) | AC3 (proven by: backlog note, item 4) |

**Runner convention (repo rule):** always `bunx vitest run <file>`. `bun test <file>` is BANNED — bun's
native runner silently no-ops fake timers and mis-handles vitest specs (see
`process/context/tests/all-tests.md` + memory `project_unit-test-runner-gotcha`).

## Test Infra Improvement Notes

(none identified yet)

## Resume and Execution Handoff

1. **Selected plan file:** `process/general-plans/active/ap-false-down-outage-guard_21-07-26/ap-false-down-outage-guard_PLAN_21-07-26.md`
2. **Last completed step:** RE-SCOPED after VALIDATE BLOCKED, then re-VALIDATED PASS 21-07-26. Nothing executed yet.
3. **Validate-contract status:** PASS (written 21-07-26, `generated-by: outer-pvl`) against the re-scoped code-free plan; supersedes the prior BLOCKED contract. Ready for EXECUTE.
4. **Supporting context loaded:** `process/context/all-context.md` (root router), `process/context/tests/all-tests.md`, `ap-name-retry-transaction-tripwire_NOTE_20-07-26.md`, `docs/mikrotik/` listing (walled-garden.md convention), live-verification report (Probe 4 / G16).
5. **Next step for a fresh agent:** EXECUTE the 5-item checklist. The only code artifact is item 1 (a new static spec). Items 2–4 are doc/process edits.

## Validate Contract

Status: PASS
Date: 21-07-26
date: 2026-07-21
generated-by: outer-pvl
supersedes: 2026-07-21 (outer-pvl) — prior contract gated BLOCKED against the now-descoped `outage.ts` behavioral guard (F1); this re-validation covers the code-free re-scoped plan (static tripwire + docs).

Parallel strategy: sequential
Rationale: 0/7 signals present — 1 code package (`@veent/core`, one new spec, no source edit), 3 doc/process files, no schema/API/auth/billing/high-risk surface, not a phase program, blast radius under 5 files. Single-agent EXECUTE is correct; fan-out adds no value.

Test gates (C3 5-column table — ADDITIVE; the legacy line form below is retained for existing consumers):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1 | source-text tripwire fails if either `refreshNetworkHealth` call site gains a `db.transaction(` wrapper; each call site is anchored by an asserted `refreshNetworkHealth(` presence (non-vacuous) | Fully-Automated | `bunx vitest run packages/core/src/services/networkHealth.transaction-tripwire.spec.ts` | B — gate added by this plan's checklist item 1 |

Failing stub:
```
test("neither admin call site wraps refreshNetworkHealth in db.transaction, and both call sites are present", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: for each of +page.server.ts and refresh/+server.ts assert refreshNetworkHealth( present AND db.transaction( absent")
})
```

| AC2 | durable operator runbook exists: new AP MAC → `/ip/hotspot/ip-binding` bypass, matches `docs/mikrotik/` convention, cross-links live-verification report | Agent-Probe | manual review of `docs/mikrotik/ap-liveness-bypass.md` | B — doc added by this plan's checklist item 3 |
| AC3 | deferral note records goal + dead approach (F1) + two viable candidates + runbook-as-shipped-mitigation | Agent-Probe | manual review of `process/general-plans/backlog/ap-outage-false-down-code-safeguard_NOTE_21-07-26.md` | B — note added by this plan's checklist item 4 |

gap-resolution legend: A — proven now; B — fixed in this plan (gate added by this plan's checklist); C — deferred to a named later phase/plan; D — backlog test-building stub.

C-4 reconciliation: the `strategy:` column carries ONLY the 3 proving strategies (Fully-Automated / Hybrid / Agent-Probe). Known-Gap is never a strategy here; there are no Known-Gap rows.

Legacy line form (retained so existing validate-contract consumers still parse):
- @veent/core tripwire spec: Fully-automated: `bunx vitest run packages/core/src/services/networkHealth.transaction-tripwire.spec.ts`
- ap-liveness-bypass runbook: agent-probe: manual review of `docs/mikrotik/ap-liveness-bypass.md`
- code-safeguard deferral note: agent-probe: manual review of `ap-outage-false-down-code-safeguard_NOTE_21-07-26.md`

Dimension findings:
- Infra fit: PASS — new spec lands in `packages/core/src/services/`, auto-collected by `vitest run` (sibling `.spec.ts` files already run there); `../../../../` from `packages/core/src/services/` correctly resolves to the repo root; both admin call-site paths and the `docs/mikrotik/` dir exist on disk.
- Test coverage: PASS — tripwire is a deterministic Fully-Automated source-text gate; green baseline verified (0 `db.transaction(`, 1 `refreshNetworkHealth(` per file). The vacuous-assertion concern (C1) was resolved in-plan by requiring the positive `refreshNetworkHealth(` anchor per file, so the "absence" check can never pass on a wrong/empty read.
- Breaking changes: PASS — no source edits, no schema/API/route/contract changes; new test file + docs/process artifacts only. Outage-sweep behavior is unchanged from today.
- Security surface: PASS — no auth/identity, billing/credits, schema/migration, public-API, container, or secret/trust-boundary surface. The spec only reads source text; it cannot affect runtime. No risk-evidence pack required.
- Section 1 feasibility (tripwire spec): PASS — mechanically feasible; highest-risk edit is path resolution — mitigated by (a) the required positive anchor and (b) `readFileSync` throwing loudly on a bad path.
- Sections 2–4 feasibility (docs/process): PASS — target files/dirs exist (item-2 note present, `docs/mikrotik/` + `walled-garden.md` convention present, note frontmatter convention available); item-4 note absent as expected (created by EXECUTE). No conflicts with current file state.

Open gaps: none.

What this coverage does NOT prove:
- The Fully-Automated tripwire proves ONLY the textual absence of a `db.transaction(` wrapper (with an asserted call-site anchor) in the two named files at test time. It does NOT prove the runtime transaction behavior of `refreshNetworkHealth` is correct; does NOT catch a transaction introduced through a helper/indirection whose text is not literally `db.transaction(`; and does NOT cover a future third call site not added to the spec.
- The AC2 runbook and AC3 deferral note are Agent-Probe (existence + prose/completeness judgment only). They prove nothing at runtime and do not themselves fix the false-DOWN bug in code — the runbook is an operational mitigation, the note is a durable record of the deferred code safeguard.

Gate: PASS (no FAILs; the single test-coverage concern C1 was resolved in-plan, leaving zero residual concerns).
Accepted by: session (autonomous re-validation) — recorded for completeness; Gate is PASS with no residual concerns, so no concern-acceptance was required. C1 (vacuous-assertion) was fixed in the plan (item 1 positive anchor), not accepted as a gap.

---

### Prior contract (BLOCKED — superseded 21-07-26; retained for audit; scope no longer active)

The prior VALIDATE returned **Gate: BLOCKED** on 21-07-26 (`generated-by: outer-pvl`) because the
then-planned single behavioral change (`online_since IS NOT NULL`) rested on a false premise about the
`network_health` state model (F1) and would have disabled outage pausing entirely. That code change is
now DESCOPED (see "Re-scope rationale" above); the FAIL no longer applies to the current, code-free
scope. F1's full source-level reasoning is preserved in the Re-scope rationale section and in the
deferral backlog note (checklist item 4).

## Autonomous Goal Block

```
SESSION GOAL: Ship the code-free remnant of the AP false-DOWN work — a static transaction-tripwire spec (@veent/core), an ip-binding bypass runbook, and two backlog notes. The behavioral outage.ts guard is DESCOPED (impossible as designed — VALIDATE F1).
Charter + umbrella plan: N/A — single plan (process/general-plans/active/ap-false-down-outage-guard_21-07-26/ap-false-down-outage-guard_PLAN_21-07-26.md)
Autonomy: /goal autonomous execution — reversible doc/process/test-file work only; auto-proceed on all decisions. Subagent delegation remains mandatory (no inline execution). Ref: feedback_autonomous_phase_execution / orchestration.md §Autonomy Mode.
Hard stop conditions / safety constraints:
- Do NOT re-add the descoped `outage.ts` `online_since IS NOT NULL` guard or its unit/integration cases (F1: makes the outage down-set always empty and disables all outage auto-pausing).
- Do NOT touch service code, schema, migrations, or any billing/auth/API surface — scope is 1 new test file + 3 doc/process files.
- The tripwire spec must be a static source-text read only (no runtime tx-detection, no DB).
Next phase: EXECUTE — process/general-plans/active/ap-false-down-outage-guard_21-07-26/ap-false-down-outage-guard_PLAN_21-07-26.md
Validate contract: inline in plan (## Validate Contract — Gate: PASS, generated-by: outer-pvl, 21-07-26)
Execute start: fully-auto: `bunx vitest run packages/core/src/services/networkHealth.transaction-tripwire.spec.ts` | agent-probe: review docs/mikrotik/ap-liveness-bypass.md + ap-outage-false-down-code-safeguard_NOTE_21-07-26.md | high-risk pack: no
```
