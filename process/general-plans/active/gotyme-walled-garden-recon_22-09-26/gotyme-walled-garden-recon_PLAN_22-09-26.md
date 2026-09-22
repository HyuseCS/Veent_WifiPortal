---
name: plan:gotyme-walled-garden-recon
description: "Recon-and-whitelist GoTyme e-wallet on the staging MikroTik walled garden, per the existing ₱0 recon protocol"
date: 22-09-26
feature: none
---

# GoTyme Walled-Garden Recon — Implementation Plan

**Date**: 22-09-26
**Status**: Ready for VALIDATE
**Complexity**: SIMPLE

## Resume Point (22-09-26, mid-EXECUTE pause)

EXECUTE started and ran Section 0 preflight only: confirmed no drift (`PAYMENT_HOSTS` has no
GoTyme entries; `docs/mikrotik/walled-garden.md:320` doc row still reads
`GoTyme | *.gotyme.com.ph | UNVERIFIED`). Execution then stopped at Section 1 HARD PAUSE #1 per
Execute-Agent Instruction E1 — the user does not currently have staging router/Winbox access to
produce the required live DNS cache capture, so this session paused here to resume in a future
session.

**Exact resume action (4 steps):**
1. On the staging router console (Winbox or terminal), flush the DNS cache: `/ip dns cache flush`.
2. On a captive test device (still un-granted, behind the portal), open the GoTyme app and drive
   it up to — but do NOT confirm — the payment/QRPH screen.
3. On the staging router console, run `/ip dns cache print` and copy the full output.
4. Paste that output back to the agent, then re-invoke `ENTER EXECUTE MODE` on this same plan
   file — execution resumes at Section 2 (host classification), not from the beginning.

This session also ran EXECUTE on Sonnet 5 instead of the usual Opus execute-agent policy, by
explicit user request, due to a live Anthropic status-page incident affecting Opus 5 at the
time — fine to keep using Sonnet for the remainder of this plan.

See also: `gotyme-walled-garden-recon_HANDOFF_22-09-26.md` in this same task folder for a
standalone "start here next session" doc.

## Overview

First of 9 queued wallet/bank recon cycles (see `docs/mikrotik/walled-garden.md`). GoTyme is
`UNVERIFIED` today. This plan follows the codebase's own documented recon protocol
(flush DNS → drive app to pay screen → read `/ip dns cache print` → classify hosts →
add to `PAYMENT_HOSTS` [+ new `:resolve` scheduler if any host is CNAME-to-CDN] → push to
staging via `setup:router` → live retest) to reach exactly one of two terminal states:
GoTyme `VERIFIED` (hosts stay, doc updated) or GoTyme `KNOWN-DEAD` (hosts removed, doc updated
with failure reason — mirrors the existing Google Pay precedent).

INNOVATE was skipped: the approach is fixed by precedent already in the repo
(`provisionGcashResolveScheduler` for CNAME-to-CDN hosts; the Google Pay KNOWN-DEAD doc pattern
for a dead end). No architectural decision remains.

**Hard human-gate structure:** this plan cannot run start-to-finish unattended. It has TWO
mandatory pause points where the agent must stop and wait for the user to supply data the agent
cannot produce itself (see Section 3 and Section 7 below). Do not fabricate or guess DNS cache
output or retest results.

## Goals

- Discover the real hosts GoTyme's app needs, from a live DNS-cache capture (never guessed).
- Add exactly those hosts to `PAYMENT_HOSTS`, correctly classified and bucketed, respecting the
  two hard rules (no broad CDN wildcard; bare-parent + wildcard both added when both are needed).
- Push to the **staging** router only, and prove the push landed.
- Get a live human retest verdict, then land in exactly one terminal state (VERIFIED or
  KNOWN-DEAD) in both code and `docs/mikrotik/walled-garden.md`.
- Leave the collision-guard test and admin typecheck green in either terminal state.

## Scope

In scope: `apps/admin/scripts/walled-garden-config.ts` (`PAYMENT_HOSTS`), optionally
`packages/core/src/integrations/network/mikrotik.ts` (new `:resolve` scheduler function, only if
a GoTyme host turns out to be CNAME-to-CDN) and its wiring into
`apps/admin/scripts/setup-router.ts`, and `docs/mikrotik/walled-garden.md` (GoTyme's row in the
candidate table). Staging router push via `setup:router`.

Out of scope: the other 8 candidate wallets/banks; any production router push; any customer-app
or admin-app UI/business-logic code; new "pending/staged" scaffolding in `PAYMENT_HOSTS`; GoTyme
card/3-D-Secure/bank-transfer paths (e-wallet/QRPH flow only).

## Touchpoints

- `apps/admin/scripts/walled-garden-config.ts` — add (and, on failure path, remove) GoTyme host
  entries in `PAYMENT_HOSTS`.
- `packages/core/src/integrations/network/mikrotik.ts` — CONDITIONAL: only if a captured host is
  CNAME-to-CDN, add one new exported function (e.g. `provisionGotymeResolveScheduler`), modeled
  1:1 on `provisionGcashResolveScheduler` (lines ~1148-1166).
- `apps/admin/scripts/setup-router.ts` — CONDITIONAL: only if the scheduler function above is
  added, wire one new `try { await provisionGotymeResolveScheduler(config) ... }` block,
  mirroring the existing gcash-resolve block (lines ~236-249).
- `docs/mikrotik/walled-garden.md` — update GoTyme's row in the "Candidate wallets/banks" table
  (line ~320) from `UNVERIFIED` to `VERIFIED` or `KNOWN-DEAD` (+ short failure note on the
  KNOWN-DEAD path, mirroring the Google Pay writeup style already in the doc).
- `apps/admin/scripts/setup-router.spec.ts` — NOT edited; its collision-guard assertion
  (`PAYMENT_HOSTS ∩ PROBE_DENIES = ∅`) auto-re-asserts against whatever hosts this plan adds.
- `packages/core/src/integrations/network/mikrotik.spec.ts` — CONDITIONAL: only if a new
  scheduler function is added, extend with a test block mirroring the existing
  `describe('provisionGcashResolveScheduler ...')` block (lines ~216-235): idempotent-upsert
  assertion (2nd call is a no-op, matched by scheduler name) + verify the on-event body is wired.

## Public Contracts

- `PAYMENT_HOSTS` (exported array, `apps/admin/scripts/walled-garden-config.ts`) — contract is
  "every string in this array is pushed live the moment `setup:router` runs." This plan adds
  entries to it (and may remove them again on the failure path) but does not change its shape,
  its consumers (`setup-router.ts`, `setup-router.spec.ts`), or its always-provisioned semantics.
- CONDITIONAL new export `provisionGotymeResolveScheduler(config): Promise<{scheduler: {value: string, created: boolean}}>`
  from `packages/core/src/integrations/network/mikrotik.ts` — same shape as
  `GcashResolveSchedulerResult` / `provisionGcashResolveScheduler`, additive only, no changes to
  any existing exported function signature.
- No schema, API route, or auth surface is touched. No changes to `provisionWalledGarden`,
  `reconcileWalledGarden`, or `wipeWalledGarden`.

## Blast Radius

Small, staging-only, config + doc change. 3-4 files touched depending on branch:
- Always: `apps/admin/scripts/walled-garden-config.ts`, `docs/mikrotik/walled-garden.md`.
- Conditional (CNAME-to-CDN branch only): `packages/core/src/integrations/network/mikrotik.ts`,
  `apps/admin/scripts/setup-router.ts`, `packages/core/src/integrations/network/mikrotik.spec.ts`.
- Risk class: none of auth/billing/schema/public-API — this is router walled-garden
  configuration, which the repo's own Gotchas section flags as "easy to break with
  well-intentioned cleanups," so verify guest onboarding is not disturbed (the collision-guard
  test is the automated proof of this; the live retest is the human proof).
- **Hard stop honored:** no production `setup:router` invocation is permitted under this plan —
  every push command below targets the staging `MIKROTIK_*` env only.

## Implementation Checklist

### Section 0 — Preflight (agent, no router access)

1. Re-read the current state of `apps/admin/scripts/walled-garden-config.ts` `PAYMENT_HOSTS` and
   `docs/mikrotik/walled-garden.md` lines ~311-330 (candidate table) to confirm no drift since
   this plan was written.
2. Confirm the current GoTyme doc row is still `*.gotyme.com.ph — UNVERIFIED` (line ~320). If it
   has changed (e.g. someone else already ran this recon), STOP and report — do not proceed with
   a stale plan.

### Section 1 — HARD PAUSE #1: request DNS capture from the user

3. Ask the user, verbatim, to perform the manual recon steps from
   `docs/mikrotik/walled-garden.md` §"How to add a wallet/bank (₱0 recon protocol)"
   (lines ~259-309):
   a. Flush the staging router's DNS cache (`/ip dns cache flush`).
   b. On a captive test device (still un-granted, behind the portal), open the GoTyme app and
      drive it up to — but do NOT confirm — the payment/QRPH screen.
   c. Read `/ip dns cache print` on the staging router and paste the output back.
4. **STOP HERE.** Do not proceed past this point until the user has supplied real DNS cache
   output. Do not fabricate, assume, or reuse the existing `*.gotyme.com.ph` research guess as a
   substitute for a live capture (SPEC AC1). Per validate-contract Execute-Agent Instruction E1:
   vc-execute-agent must emit `NEEDS_CONTEXT` with this exact question and terminate — it must
   not attempt to hold an interactive wait state.

### Section 2 — Host classification (agent, after DNS capture received)

5. From the pasted `/ip dns cache print` output, identify every new host that is plausibly
   GoTyme-related (new since a clean flush, or newly resolved during the app session).
6. For each host, classify as:
   - **Direct-resolve**: the cache shows the host resolving to a stable/owned IP (not an
     Akamai/Cloudflare/generic CDN edge) → plain `dst-host` entry, added to `PAYMENT_HOSTS`.
   - **CNAME-to-CDN**: the cache shows the host is a CNAME chain ending on a CDN edge (same shape
     as `payments.gcash.com` → Akamai) → needs a `:resolve` scheduler, not a plain `dst-host`
     entry (RouterOS `dst-host` matching cannot follow a CNAME chain — see the GCash root-cause
     note in `docs/mikrotik/walled-garden.md` / `process/context/all-context.md` MikroTik
     section).
7. Apply the two hard rules while drafting the additions:
   - Never add a broad CDN/Google/Cloudflare wildcard (e.g. no bare `*.akamaiedge.net` or
     similar) — only the specific GoTyme-owned host(s).
   - If both a bare-parent host and its wildcard subdomain form are needed (e.g.
     `gotyme.com.ph` AND `*.gotyme.com.ph`), add both explicitly — a wildcard alone never
     matches its own bare parent (mirrors the existing `alipay.com` / `*.alipay.com` pair).
8. Record the classification (host → direct-resolve or CNAME-to-CDN, with the DNS evidence line
   it came from) in this plan's task folder as a short note before editing any code — this is
   the traceability artifact SPEC AC2 requires.

### Section 3 — Code changes (agent)

9. Edit `apps/admin/scripts/walled-garden-config.ts`: add the classified direct-resolve host(s)
   to `PAYMENT_HOSTS`, in a new labeled block (comment: `// GoTyme e-wallet — QRPH checkout`),
   following the existing block style (Maya / GCash+Alipay / Google APIs blocks above it).
10. CONDITIONAL — only if any host was classified CNAME-to-CDN: add a new exported function
    `provisionGotymeResolveScheduler(config: MikrotikConfig): Promise<GotymeResolveSchedulerResult>`
    to `packages/core/src/integrations/network/mikrotik.ts`, copying
    `provisionGcashResolveScheduler`'s structure exactly (idempotent lookup by
    `?name=gotyme-resolve`, 5m interval, `on-event` script that `:resolve`s the CNAME-to-CDN
    host and upserts a walled-garden-ip row) — new function, not a generic template, per repo
    convention (mirrors the one-off `provisionGcashResolveScheduler` pattern, not a shared
    helper). Define a matching `GotymeResolveSchedulerResult` interface next to
    `GcashResolveSchedulerResult`. Per validate-contract Execute-Agent Instruction E2: the new
    `GOTYME_RESOLVE_ON_EVENT` template string must carry the same SECURITY comment as
    `GCASH_RESOLVE_ON_EVENT` (hardcoded/static only — never templatized from a data structure
    without a script-injection review).
11. CONDITIONAL — only if step 10 ran: wire the new function into
    `apps/admin/scripts/setup-router.ts`, adding a `try { const sched = await
    provisionGotymeResolveScheduler(config); ... } catch (...) { process.exit(1); }` block
    immediately after the existing gcash-resolve block (lines ~236-249), same log/error shape.
12. CONDITIONAL — only if step 10 ran: extend
    `packages/core/src/integrations/network/mikrotik.spec.ts` with a
    `describe('provisionGotymeResolveScheduler ...')` block mirroring the existing
    `provisionGcashResolveScheduler` block (idempotent-upsert assertion: first call creates,
    second call is a no-op matched by scheduler name).

### Section 4 — Test gates, round 1 (agent, before any router push)

13. Run `bunx vitest run apps/admin/scripts/setup-router.spec.ts` — must exit 0 (collision-guard
    auto-asserts the new hosts don't collide with `PROBE_DENIES`). Per validate-contract
    Execute-Agent Instruction E3: run this with cwd `apps/admin`
    (`cd apps/admin && bunx vitest run scripts/setup-router.spec.ts`), matching the repo's
    documented cwd gotcha for `bunx vitest run`.
14. Run `bun run --filter radius-admin check` — must exit 0 (admin typecheck).
15. CONDITIONAL — only if step 10 ran: run
    `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` — must exit 0. Per
    Execute-Agent Instruction E3, run with cwd `packages/core`
    (`cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts`).
16. If any gate fails, fix within this plan's blast radius and re-run before proceeding — do not
    push to the router with a red gate.

### Section 5 — Staging push (agent, staging env only)

17. Confirm the shell/env is pointed at the staging `MIKROTIK_*` target (not production) before
    running anything — this is a hard constraint from the SPEC; if staging vs production cannot
    be confirmed from the environment, STOP and ask the user to confirm before pushing. Per
    Execute-Agent Instruction E4: print the resolved `MIKROTIK_HOST` value to chat so the user
    has a concrete value to visually confirm (the repo has no `.env.staging` — only one `.env`
    per app, so this cannot be inferred automatically).
18. Run `bun run --filter radius-admin setup:router --reconcile --dry-run` (or the repo's
    equivalent `setup:router` invocation) first, as a preview — confirm the diff shows only the
    expected new GoTyme host row(s) (and scheduler, if applicable), nothing else.
19. Run the real push: `bun run --filter radius-admin setup:router` (staging env; additive,
    no `--reconcile`/`--wipe` needed for an additive host add — matches the SPEC's constraint
    that no production `--reconcile`/`--wipe` run is authorized).
20. Ask the user to confirm the push landed on the router (e.g. via
    `/ip hotspot walled-garden print` or the relevant menu showing the new row(s)) — this is
    Agent-Probe evidence per SPEC AC5, the agent cannot verify router state directly.

### Section 6 — HARD PAUSE #2: request live retest from the user

21. Ask the user to re-drive the GoTyme app on the captive test device through the
    payment/QRPH flow now that the hosts are open, and report plainly whether it now
    reaches/passes the confirm screen without a network-caused failure (blocked host, timeout,
    connection reset), or still fails.
22. **STOP HERE.** Do not decide VERIFIED vs KNOWN-DEAD, and do not touch the doc or code again,
    until the user has supplied the live retest result. Per Execute-Agent Instruction E1:
    vc-execute-agent must emit `NEEDS_CONTEXT` with this exact question and terminate — never
    guess, simulate, or auto-proceed on this pause, including under a standing /goal.

### Section 7 — Terminal state: VERIFIED branch (agent, only after user confirms success)

23. Update `docs/mikrotik/walled-garden.md`'s GoTyme row (line ~320) from `UNVERIFIED` to
    `VERIFIED`.
24. Leave `PAYMENT_HOSTS` (and the scheduler, if added) as-is — no removal.
25. Re-run the Section 4 test gates (13-15) once more to confirm still green after the doc edit.
26. Run `git diff --stat` and confirm only the expected file set changed (SPEC AC10):
    `apps/admin/scripts/walled-garden-config.ts`, `docs/mikrotik/walled-garden.md`, and
    conditionally `packages/core/src/integrations/network/mikrotik.ts`,
    `apps/admin/scripts/setup-router.ts`,
    `packages/core/src/integrations/network/mikrotik.spec.ts`.

### Section 8 — Terminal state: KNOWN-DEAD branch (agent, only after user confirms failure)

27. Remove the GoTyme host entries added in step 9 from `PAYMENT_HOSTS` — code returns to its
    pre-attempt shape.
28. CONDITIONAL — if step 10 ran: remove the `provisionGotymeResolveScheduler` function, its
    interface, and the wiring added in step 11, and remove the test block added in step 12 —
    all GoTyme-specific additions are fully reverted.
29. Update `docs/mikrotik/walled-garden.md`'s GoTyme row from `UNVERIFIED` to `KNOWN-DEAD`, with
    a short note of what was tried and the observed failure reason (mirroring the existing
    Google Pay `KNOWN-DEAD` writeup style in the same doc).
30. Re-run the Section 4 test gates (13-15) once more to confirm still green after the reverts.
31. Run `git diff --stat` and confirm the net code diff for `PAYMENT_HOSTS` (and
    `mikrotik.ts`/`setup-router.ts`/`mikrotik.spec.ts` if touched) is empty — only the doc file
    should show a net change (SPEC AC8, AC10). The staging router itself will still have the
    now-dead host rows until a future `--reconcile` run prunes them — note this residual
    explicitly in the phase report/closeout (this SPEC does not authorize a `--reconcile` run;
    router-side cleanup of a dead host is out of scope here and can be a backlog note if
    desired).

## Acceptance Criteria

Mirrors the SPEC's 10 acceptance criteria 1:1 — see
`gotyme-walled-garden-recon_SPEC_22-09-26.md` for full text. Summarized, testable form:

1. DNS recon captured live (Section 1) — proven by the pasted cache output existing in this
   session/task-folder notes before any code edit (step 8).
2. Hosts classified + traceable 1:1 to captured DNS evidence (step 8 note; steps 6-7).
3. Hard rules respected (no broad CDN wildcard; bare-parent+wildcard both added when needed) —
   proven by manual diff review (step 9) + collision-guard test (step 13).
4. Collision-guard + admin typecheck green in either terminal state — proven by steps 13-15 run
   twice (once pre-push, once post-terminal-state edit).
5. Staging-only push, confirmed landed — proven by step 17 (env confirm) + step 20 (operator
   router-side confirm).
6. Live retest confirms success (VERIFIED path) — proven by step 21 operator confirmation.
7. Doc reflects VERIFIED on success — proven by step 23 diff.
8. Hosts cleanly removed on failure (KNOWN-DEAD path) — proven by step 27-28 + step 31 diff.
9. Doc reflects KNOWN-DEAD on failure, with reason — proven by step 29 diff.
10. No scope creep — proven by step 26/31 `git diff --stat` showing only the expected file set.

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| Operator DNS-flush + app-drive + cache-paste (Section 1, steps 3-4) | Agent-Probe | AC1 |
| Host classification traceability note (step 8) | Hybrid | AC2 |
| Manual diff review of added `PAYMENT_HOSTS` lines (step 9, step 17) | Hybrid | AC3 |
| `bunx vitest run apps/admin/scripts/setup-router.spec.ts` (collision-guard) | Fully-Automated | AC3, AC4 |
| `bun run --filter radius-admin check` (admin typecheck) | Fully-Automated | AC4 |
| `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` (CONDITIONAL, new scheduler only) | Fully-Automated | AC4 |
| Operator confirms staging env target before push (step 17) + router-side row confirmation (step 20) | Agent-Probe | AC5 |
| Operator live retest report — success (step 21) | Agent-Probe | AC6 |
| `git diff` of `docs/mikrotik/walled-garden.md` — VERIFIED row (step 23) | Fully-Automated (diff) + Hybrid (content trigger) | AC7 |
| Operator live retest report — failure (step 21) + `PAYMENT_HOSTS`/scheduler removal (steps 27-28) | Hybrid | AC8 |
| `git diff` of `docs/mikrotik/walled-garden.md` — KNOWN-DEAD row + reason (step 29) | Fully-Automated (diff) + Hybrid (content trigger) | AC9 |
| `git diff --stat` shows only expected file set (step 26 / step 31) | Fully-Automated | AC10 |

### Failing-stub note

No new automated test files are created by this plan (the collision-guard test already
auto-covers any new `PAYMENT_HOSTS` entries by construction — no stub needed). The one
CONDITIONAL new test block (step 12, `provisionGotymeResolveScheduler`) is not a red-first TDD
stub — it is written and passing in the same step, mirroring the existing
`provisionGcashResolveScheduler` describe block, because the function it tests is a direct,
low-risk structural copy of an already-proven pattern.

## Test Infra Improvement Notes

(none identified yet)

## Dependencies, Risks, Integration Notes

- **Hard dependency on user action, twice** (Section 1 and Section 6) — this plan cannot be
  executed end-to-end by an agent alone. EXECUTE must pause at both points and resume only when
  the user supplies the required input in chat.
- **Risk: CNAME-to-CDN branch adds real code**, not just config — if this branch triggers,
  treat `mikrotik.ts`/`setup-router.ts` edits with the same care as any other core-package
  change (they are additive-only copies of an existing proven pattern, low risk, but still
  touch a shared integration file).
- **Risk: router-side residual on KNOWN-DEAD** — reverting code does not remove the host rows
  already pushed to the staging router in Section 5. This is a known, accepted residual (see
  step 31) since no `--reconcile`/`--wipe` run is authorized by this SPEC; document it plainly
  rather than silently leaving it unmentioned.
- **Integration note:** this plan deliberately reuses `PAYMENT_HOSTS`'s existing
  always-provisioned, flat-array shape (SPEC constraint) — no "pending" list is introduced, so
  every host added in step 9 goes live the moment `setup:router` runs in Section 5, even before
  the live retest confirms success. This is why Sections 5-6 are ordered push-then-retest, not
  retest-then-push (retest requires a live, reachable host to test against).

## Resume and Execution Handoff

1. **Selected plan file path:** `process/general-plans/active/gotyme-walled-garden-recon_22-09-26/gotyme-walled-garden-recon_PLAN_22-09-26.md`
2. **Last completed phase or step:** PLAN validated (see Validate Contract below); not yet executed.
3. **Validate-contract status:** written 22-09-26, Gate: CONDITIONAL (no FAILs; 4 hardening
   items resolved as Execute-Agent Instructions E1-E4).
4. **Supporting context files loaded:** `process/context/all-context.md` (MikroTik/RouterOS
   section — GCash root-cause + fix, walled-garden tag model, Google Pay KNOWN-DEAD precedent),
   `docs/mikrotik/walled-garden.md` (recon protocol + candidate table), the SPEC file in this
   same task folder, `apps/admin/scripts/walled-garden-config.ts`,
   `apps/admin/scripts/setup-router.ts`, `apps/admin/scripts/setup-router.spec.ts`,
   `packages/core/src/integrations/network/mikrotik.ts` (`provisionGcashResolveScheduler`,
   lines ~1148-1166), `packages/core/src/integrations/network/mikrotik.spec.ts`
   (`describe('provisionGcashResolveScheduler ...')`, lines ~216-235).
5. **Next step for a fresh agent picking up mid-execution:** if no DNS cache output has been
   supplied yet, resume at Section 1 (ask the user for the recon capture — do not skip ahead).
   If DNS output exists in the session/task-folder note but code has not been edited, resume at
   Section 2. If code is edited and gates are green but no push has happened, resume at Section
   5 (confirm staging env first). If pushed but no retest result yet, resume at Section 6 (ask
   the user for the retest result — do not guess or assume success). If a retest result exists,
   resume at Section 7 (VERIFIED) or Section 8 (KNOWN-DEAD) accordingly.

## Phase Completion Rules

- This plan is a SIMPLE single-session plan with two mandatory human-input pauses (Section 1
  and Section 6). A phase/section is complete only when its checklist steps are done AND, where
  a HARD PAUSE is listed, the user has supplied the required input in chat — an agent must never
  mark a paused section done by assuming or fabricating the missing input.
- The plan is `CODE DONE` once Section 7 (VERIFIED) or Section 8 (KNOWN-DEAD) checklist items
  are complete and the Section 4 test gates are green a second time.
- The plan is only `✅ VERIFIED` after the user has explicitly confirmed the live retest result
  in Section 6/7 — code-complete without that confirmation is `CODE DONE`, not `VERIFIED`.

## Post-Phase Testing

Automated gates (run after code changes, before push, and again after the terminal-state doc
edit — see Implementation Checklist Sections 4, 7, 8):
- `bunx vitest run apps/admin/scripts/setup-router.spec.ts` (collision-guard)
- `bun run --filter radius-admin check` (admin typecheck)
- CONDITIONAL: `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` (only if a new `:resolve` scheduler function is added)

Manual/Agent-Probe gates (cannot be automated — see `process/context/tests/all-tests.md` for the
project's test-tier conventions): the DNS-cache capture (Section 1), the staging router-side
push confirmation (Section 5), and the live GoTyme app retest (Section 6) are all real-hardware,
human-hands-on steps.

Context used: `process/context/all-context.md` (MikroTik/RouterOS section), `process/context/tests/all-tests.md` conventions for test-tier labeling.

---

**Next Step:** Say `ENTER EXECUTE MODE` to begin execution under this validate-contract. Section
1 will immediately hard-pause for the DNS capture — have the staging router console and a
captive test device ready.


## Validate Contract

Status: CONDITIONAL
Date: 22-09-26
date: 2026-09-22
generated-by: outer-pvl

Parallel strategy: sequential
Rationale: 7-signal score 1/7 (only S7 — up to 5 files in blast radius across the conditional
branch; no multi-package/schema-auth/3+-direction/phase-program/depth-request/high-risk signals
present). Single SIMPLE plan, no umbrella program — sequential V2 fan-out and sequential EXECUTE
both fit; no parallelization benefit.

Test gates (C3 5-column table):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1 | DNS recon captured live, not assumed | Agent-Probe | Operator: flush cache → drive GoTyme app → paste `/ip dns cache print` output (plan Section 1) | A |
| AC2 | Hosts classified + traceable to DNS evidence | Hybrid | Task-folder classification note (plan step 8) | A |
| AC3 | Hard rules respected (no broad CDN wildcard; bare-parent+wildcard pairing) | Hybrid | Manual diff review of `PAYMENT_HOSTS` additions (plan step 9, step 17) | A |
| AC3/AC4 | No `PAYMENT_HOSTS` entry collides with `PROBE_DENIES` | Fully-Automated | `cd apps/admin && bunx vitest run scripts/setup-router.spec.ts` | A |
| AC4 | Admin package typechecks after edit | Fully-Automated | `bun run --filter radius-admin check` | A |
| AC4 (CONDITIONAL) | New scheduler function idempotent-upserts correctly | Fully-Automated | `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` | A |
| AC5 | Push targets staging only, and landed on the router | Agent-Probe | Operator confirms `MIKROTIK_HOST` value + `setup:router` run + router-side `/ip hotspot walled-garden print` check (plan step 17, 20) | A |
| AC6 | Live retest confirms GoTyme flow completes (VERIFIED path) | Agent-Probe | Operator re-drives GoTyme app post-push (plan step 21) | A |
| AC7 | Doc reflects VERIFIED on success | Fully-Automated (diff) + Hybrid (content trigger) | `git diff docs/mikrotik/walled-garden.md` shows GoTyme row → VERIFIED (plan step 23) | A |
| AC8 | Hosts cleanly removed on failure (KNOWN-DEAD path) | Hybrid | `git diff --stat` shows `PAYMENT_HOSTS`/scheduler net-empty (plan steps 27-28, 31) | A |
| AC9 | Doc reflects KNOWN-DEAD + reason on failure | Fully-Automated (diff) + Hybrid (content trigger) | `git diff docs/mikrotik/walled-garden.md` shows GoTyme row → KNOWN-DEAD + note (plan step 29) | A |
| AC10 | No scope creep — only expected file set changed | Fully-Automated | `git diff --stat` (plan step 26 / step 31) | A |

gap-resolution legend:
- A — proven now (gate passes in this cycle)
- B — fixed in this plan (gate added by this plan's checklist)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

C-4 reconciliation: the `strategy:` column carries ONLY the 3 proving strategies (Fully-Automated / Hybrid / Agent-Probe). No Known-Gap rows exist in this plan — every developed behavior has an assigned proving gate.

Legacy line form (retained so existing validate-contract consumers still parse):
- `PAYMENT_HOSTS`/`walled-garden-config.ts`: Fully-automated: `cd apps/admin && bunx vitest run scripts/setup-router.spec.ts` | hybrid: manual diff review of added host lines (precondition: DNS capture done) | agent-probe: operator DNS-flush + app-drive + cache-paste, operator live retest | known-gap: none
- `mikrotik.ts` CONDITIONAL scheduler: Fully-automated: `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` | hybrid: n/a | agent-probe: n/a | known-gap: none
- `docs/mikrotik/walled-garden.md`: Fully-automated: `git diff docs/mikrotik/walled-garden.md` (row + status changed) | hybrid: content correctness depends on operator-reported retest outcome | agent-probe: n/a | known-gap: none

Dimension findings:
- Infra fit: PASS — all touchpoint file paths verified present on disk (config.ts line 41, doc line 320, mikrotik.ts gcash scheduler lines ~1148-1166 confirmed, setup-router.ts wiring lines ~200-249 confirmed, mikrotik.spec.ts gcash describe block confirmed); `bun run --filter radius-admin ...` and `bunx vitest run ...` command forms match repo conventions; staging-only push correctly gated with an explicit hard-stop-if-unconfirmable instruction.
- Test coverage: PASS — all 10 SPEC ACs mapped to an explicit proving gate (Fully-Automated / Hybrid / Agent-Probe); collision-guard test (`setup-router.spec.ts`) confirmed live-green (ran during this VALIDATE pass: 1 passed) and its exact-string-equality check mechanically covers any GoTyme host format (bare, wildcard, or subdomain) since `PROBE_DENIES`'s 11 hosts are all Google/Apple/Microsoft/Firefox probe domains unrelated to `gotyme.com.ph` — no functional gap in what request-point 3 asked about.
- Breaking changes: PASS — `PAYMENT_HOSTS` array shape unchanged (additive entries only); CONDITIONAL new export is additive-only per the plan's own Public Contracts section; no existing exported function signature changes.
- Security surface: PASS (with reinforcement) — no auth/billing/schema/API surface touched. The CONDITIONAL scheduler branch reuses a router-script pattern that carries an explicit anti-injection SECURITY comment in its existing precedent (`GCASH_RESOLVE_ON_EVENT`); the plan's step 10 did not originally call this out, so it is added here as Execute-Agent Instruction E2 (mirrors the historical gcash validate-contract precedent, item-18 supplement instruction E3).
- Section-level feasibility (Layer 2, all 8 checklist sections): PASS — every named edit target verified present and uniquely matchable; no conflicts found against current file state or repo conventions; highest-risk edit identified as the Section 5 staging router push (step 19), mitigated by the existing dry-run preview (step 18) + operator env confirmation, reinforced by Execute-Agent Instruction E4.

Open gaps: none blocking. 4 non-blocking hardening items resolved below as Execute-Agent Instructions (E1-E4) rather than plan-text rewrites, since they are execution-time behavioral guidance, not changes to what is built.

### Execute-Agent Instructions

| # | Instruction | Trigger condition |
|---|---|---|
| E1 | At each HARD PAUSE (plan Section 1 steps 3-4; Section 6 steps 21-22), vc-execute-agent must NOT attempt to hold an interactive wait state — subagents are fire-and-forget per `orchestration.md`. It must emit `NEEDS_CONTEXT` with the exact question to relay to the user (the DNS-flush/app-drive/cache-paste request, or the live-retest pass/fail request) and terminate. The orchestrator relays the question, collects the answer, and re-spawns vc-execute-agent with the supplied data, resuming per the plan's "Resume and Execution Handoff" section. Never fabricate, guess, or simulate either the DNS cache output or the retest result — these two pauses are exempt from autonomous auto-proceed even under a standing /goal. | Reaching plan step 4 or step 22 |
| E2 | When drafting the CONDITIONAL `GOTYME_RESOLVE_ON_EVENT` template string (plan step 10), copy the SECURITY comment already present on `GCASH_RESOLVE_ON_EVENT` (`packages/core/src/integrations/network/mikrotik.ts`) verbatim: the on-event body must stay a hardcoded, static string with the GoTyme host baked in as a literal — never templatized/interpolated from a data structure or loop without a RouterOS-script-injection review first. | Reaching plan step 10 (only if any host classified CNAME-to-CDN) |
| E3 | Run `bunx vitest run <path>` commands (plan steps 13, 15) with cwd set to the target package (`cd apps/admin && bunx vitest run scripts/setup-router.spec.ts`; `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts`), per the documented cwd gotcha in `process/context/tests/all-tests.md`. Running `setup-router.spec.ts` from repo root was confirmed to pass during this VALIDATE session (it has no `$lib` alias usage), but do not rely on that — always cd first. | Reaching plan step 13, 15, 25, or 30 |
| E4 | Before the real push (plan step 19), print the resolved `MIKROTIK_HOST` value to chat so the user has a concrete value to visually confirm as staging — the repo has no `.env.staging`, only one `.env` per app, so staging-vs-production cannot be inferred automatically. This is the plan's single highest-risk step (an accidental production push). | Reaching plan step 17-19 |

### Backlog Artifacts

None required — the router-side residual on the KNOWN-DEAD path (step 31) is already documented
inline in the plan's Dependencies/Risks section as an accepted, explicitly out-of-scope residual;
no separate backlog note needed unless a future session decides to productionize a `--reconcile`
cleanup pass.

Open gaps: none (all 4 hardening items resolved as Execute-Agent Instructions above; no FAILs;
no Known-Gap rows).

What this coverage does NOT prove:
- The Fully-Automated gates (collision-guard, admin typecheck, CONDITIONAL scheduler test) do
  not prove GoTyme's app will actually complete a payment on captive WiFi — only the live human
  retest (AC6) proves that; the repo has a documented precedent (Google Pay) of an app that
  cert-pins/detects captive networks and fails even with every host reachable.
- The collision-guard test proves `PAYMENT_HOSTS` has no exact-string overlap with
  `PROBE_DENIES`; it does NOT prove the two hard rules (no broad CDN wildcard; bare-parent +
  wildcard pairing) — those remain human-reviewed-diff only (Hybrid, AC3).
- The admin typecheck proves TypeScript soundness; it does NOT prove the staging router actually
  accepted/applied the pushed config — only the operator's router-side print check (AC5) proves
  that.
- No automated gate proves the staging router's already-pushed host rows are cleaned up on the
  KNOWN-DEAD path — this is an explicitly accepted, out-of-scope residual (plan step 31).
- No gate in this plan exercises GoTyme's card/3-D-Secure/bank-transfer paths — only the
  e-wallet/QRPH flow is covered, matching scope.

Gate: CONDITIONAL (no FAILs; 4 non-blocking hardening concerns resolved via Execute-Agent
Instructions E1-E4 above — no plan-text changes required, no open design questions remain)
Accepted by: session (vc-validate-agent autonomous completion — this is a fire-and-forget V1-V7
VALIDATE pass with no live interactive user in this invocation; all 4 concerns are non-blocking
technical hardening items with a single correct resolution, not judgment calls requiring human
input. Orchestrator/user may re-open any of E1-E4 before EXECUTE if a different resolution is
preferred.)

## Autonomous Goal Block

SESSION GOAL: Recon and whitelist (or definitively rule out) GoTyme e-wallet on the staging
MikroTik walled garden — first of 9 queued wallet/bank recon cycles.
Charter + umbrella plan: N/A — single plan (`process/general-plans/active/gotyme-walled-garden-recon_22-09-26/gotyme-walled-garden-recon_PLAN_22-09-26.md`)
Autonomy: EXECUTE proceeds autonomously through Sections 0, 2-5, 7/8 (classification, code
edits, test gates, staging push, terminal-state doc/code update) but MUST hard-stop
(`NEEDS_CONTEXT`, never simulate) at Section 1 (DNS capture) and Section 6 (live retest) per the
plan's Hard-Pause structure — see Execute-Agent Instruction E1. This exemption holds even under
a standing /goal.
Hard stop conditions / safety constraints:
- Never push to the production router — staging `MIKROTIK_*` env only (plan Blast Radius "Hard
  stop honored").
- Never fabricate, guess, or simulate the DNS cache output or the live retest result.
- Never add a broad CDN/Google/Cloudflare wildcard host to `PAYMENT_HOSTS`.
- Router-script on-event bodies (CONDITIONAL scheduler branch) must stay hardcoded/static, never
  templatized from data (script-injection guard, Execute-Agent Instruction E2).
Next phase: EXECUTE — `process/general-plans/active/gotyme-walled-garden-recon_22-09-26/gotyme-walled-garden-recon_PLAN_22-09-26.md`
Validate contract: inline in plan (this file, `## Validate Contract` section above)
Execute start: Section 0 preflight (agent, no router access) → Section 1 HARD PAUSE (ask user
for DNS capture) | e2e spec: N/A | probe scenario: live GoTyme app retest (Section 6) |
high-risk pack: no (staging-only, additive, no auth/billing/schema/API surface; the collision-
guard test + two mandatory human retests already exceed what the 5-artifact risk-evidence-pack
would add for this scope)
