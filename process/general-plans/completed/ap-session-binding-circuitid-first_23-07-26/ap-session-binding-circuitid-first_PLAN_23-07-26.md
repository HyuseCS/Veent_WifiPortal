---
name: plan:ap-session-binding-circuitid-first
description: "Make resolveNetworkIdForMac resolve Option-82 circuit-id FIRST in its router fallback tier, so a session on a shared hotspot bridge binds to the real physical AP row instead of the auto-swept bridge/interface network_health row — fixing the admin Network column flip-flop AND the outage-pause mis-keying"
date: 23-07-26
feature: general-plans
---

# Plan — AP session binding: circuit-id first in the fallback tier

Date: 23-07-26
Status: ✅ VERIFIED — user-confirmed live 23-07-26 (2-SSID AP no longer shows the shared bridge in Active-Session Network column)
Complexity: Simple

**TL;DR:** `resolveNetworkIdForMac`'s router-fallback tier (used on an attribution-cache miss)
currently maps a MAC → interface name → `resolveNetworkIdByApName`, which on a 2-SSID bridged AP
returns the shared BRIDGE row's id (wrong-but-non-null). This plan makes the fallback resolve the
device's Option-82 **circuit-id first** (via the existing `resolveCircuitIdForMac`), map that to the
physical AP row, and only fall through to today's raw interface-name lookup when no circuit-id
resolves at all. Read-only internal refactor of one `@veent/core` function; no schema, no new write
path. Mirrors the already-shipped checkout fix (`resolveCheckoutLocation`, circuit-id-first). Proven
by a PGlite integration test. ~2 files touched.

## Locked Decision (from INNOVATE — Direction A, do not re-open)

Resolve circuit-id FIRST in the fallback tier of `resolveNetworkIdForMac`
(`packages/core/src/services/networkHealth.ts:514-548`), before the raw interface-name lookup, so
the function can never bind a session to an auto-swept bridge/interface row when a real circuit-id AP
row exists. This deliberately mirrors the shipped Maya-checkout precedent
(`process/general-plans/backlog/maya-checkout-ap-attribution-interface-not-physical_NOTE_22-07-26.md`
→ `resolveCheckoutLocation` now resolves circuit-id first via `apRowForCircuitId`).

---

## Overview

### Problem (today)

`resolveNetworkIdForMac(db, network, mac)` has two tiers:

1. **Fast path (correct):** attribution cache (`network_client_attribution`, MAC → circuit-id) → AP
   row by `apCircuitId` (deterministic lowest id). Returns the physical AP. ✅
2. **Fallback (buggy for bridged APs):** on a cache miss, `network.resolveApForMac(mac)` yields an
   **interface name**, then `resolveNetworkIdByApName(apName)` matches `interface_name` then `name`.
   On a deployment where multiple physical APs sit behind ONE shared hotspot bridge
   (`bridge1_WiFi_Project`, an interface row with `apCircuitId = NULL`), the resolved interface is
   that shared bridge — so `resolveNetworkIdByApName` returns the BRIDGE row's own id. Wrong AP, but
   non-null, so nothing downstream notices. ❌

The single highest-frequency trigger is `bindMacToAccount` (`sessions.ts:263-294`) → `attributeAp`
(`sessions.ts:303-321`), which does NOT pre-resolve `apCircuitId` and so always relies on this
fallback when the cache is cold — producing the observed Network-column flip-flop.

### Fix (locked)

In the fallback tier, after (or instead of) the raw router lookup:

1. Resolve the device's circuit-id STRING via the existing `resolveCircuitIdForMac(db, network, mac)`
   — it already does cache→router `resolveApForMac`→`apCircuitId` lookup and **fails closed** (returns
   `null`) when the matched row is a bridge row with `apCircuitId = NULL`
   (`networkHealth.ts:608-645`). Never throws.
2. Map that circuit-id → its physical AP row (`network_health` where `apCircuitId = cid`, `ORDER BY id`,
   `LIMIT 1` — identical selection to the fast path and to checkout's `apRowForCircuitId`).
3. ONLY when no circuit-id resolves at all (pure-bridge deployment, no Option-82 circuit-id AP row)
   fall through to today's raw `resolveNetworkIdByApName(apName)` — preserving current behavior there.

**Reuse, do not duplicate:** factor a small private helper `apIdForCircuitId(db, circuitId):
Promise<number | null>` (the circuit-id → lowest-id AP-row-id lookup already inlined in the fast path
at `networkHealth.ts:528-534`, mirroring checkout's `apRowForCircuitId`). Use it in BOTH the fast
path and the new fallback. Do not re-implement the ARP/circuit-id resolution shape — call the
existing `resolveCircuitIdForMac`.

## Goals

- G1 (correctness): a session/bind on a shared hotspot bridge resolves to the **physical AP row**,
  never the bridge/interface row, whenever an Option-82 circuit-id AP row exists.
- G2 (display): admin Active-Session "Network" column (`queries.ts:198-199`) and per-AP active-user
  counts (`queries.ts:391-394`) stop showing / flip-flopping to the raw bridge name
  `bridge1_wifi_project1`.
- G3 (access correctness): outage auto-pause keys on the same `network_id` — the pause query selects
  on `eq(networkSessions.networkId, ap.id)` (`outage.ts:113`), stamps `networkId: ap.id` on the pause
  write (`outage.ts:143`), and reads `accessPausedNetworkId` (`outage.ts:178`); binding to the AP row
  (not the bridge row) makes pause/resume key the right row.
- G4 (no regression): pure-bridge / no-circuit-id deployments keep today's exact interface-name
  fallback behavior.

## Scope

- **In scope:** one function's fallback tier in `packages/core/src/services/networkHealth.ts` +
  factoring one private helper; a PGlite integration test.
- **Out of scope:** any schema/migration change; any new write path; `resolveApNameSnapshot` /
  `resolveApCircuitLabel` / display resolvers (unchanged); `revenueByAp` /
  `paymentTransactions.networkId` (the checkout resolver — already fixed separately, do NOT touch);
  the checkout resolver `resolveCheckoutLocation` (already circuit-id-first).

---

## Touchpoints

| File | Change |
|---|---|
| `packages/core/src/services/networkHealth.ts` | **CHANGE.** Factor private `apIdForCircuitId(db, circuitId): Promise<number \| null>` (lowest-id AP row for a circuit-id). Rewrite the fallback tier of `resolveNetworkIdForMac` (`:539-547`) to: call `resolveCircuitIdForMac(db, network, mac)` → `apIdForCircuitId` → return if non-null; else fall through to the existing `resolveApForMac` → `resolveNetworkIdByApName` path unchanged. Fast path (`:520-538`) refactored to call the new helper (behavior identical). |
| `packages/core/src/services/networkHealth.integration.spec.ts` | **CHANGE.** Add cases (a)-(d) below to the existing PGlite suite (real migrations + `fake()` controller with injectable `resolveApForMac`). Case (b) and case (d) fixture shapes are specified concretely under Verification Evidence → "Test fixture shapes (E1 / E2)". |
| `packages/core/src/services/sessions.ts` | **READ-ONLY consumer.** `attributeAp` (`:303-321`, reached from `bindMacToAccount :263-294` and all bind paths) calls `resolveNetworkIdForMac`; benefits automatically. No edit. |
| `packages/core/src/services/outage.ts` | **READ-ONLY consumer.** Roamer check (`currentAp = resolveNetworkIdForMac`) — read-only comparison, benefits. Pause selection keys `eq(networkSessions.networkId, ap.id)` at `:113`, write at `:143`, `accessPausedNetworkId` read at `:178`. No edit. |
| `apps/admin/src/lib/server/queries.ts` | **READ-ONLY downstream.** `listActiveSessions` Network column (`:198-199`) + `listNetworkHealth` per-AP counts (`:391-394`) read the resulting `network_sessions.network_id`. No edit — behavior improves once binds stamp the AP row. |
| `packages/core/src/services/networkHealth.ts` (`resolveNetworkIdByApName :480-502`) | **UNCHANGED** — still the terminal pure-bridge fallback. |

## Public Contracts

- **`resolveNetworkIdForMac(db, network, mac): Promise<number | null>` — signature UNCHANGED; return
  TYPE unchanged; never-throws contract preserved.** What changes is *which* `network_health.id` the
  fallback returns for a bridged/ambiguous AP: the physical AP row instead of the shared bridge row.
- **Contract-revision note (MANDATORY — flagged by INNOVATE #1):** This DELIBERATELY REVISES the
  per-ap-visibility Phase A guarantee "Regression #4 — external contract unchanged / fallback
  preserved byte-for-byte" on `resolveNetworkIdForMac`, but ONLY for the **ambiguous-bridge case**
  (a MAC whose interface resolves to a shared bridge row while a distinct circuit-id AP row exists).
  That guarantee predated this bug's diagnosis; the "byte-for-byte" fallback was itself the bug for
  bridged deployments. Non-bridged / no-circuit-id deployments keep byte-for-byte behavior (G4).
  **Action:** update the per-ap-visibility Phase A contract note (in
  `process/general-plans/completed/per-ap-visibility_16-07-26/` — PLAN `:87`, SPEC `:221`, REPORT
  `:37`) at UPDATE-PROCESS to record this as an intentional, diagnosed revision — NOT an accidental
  break. (Documentation-only cross-reference; the completed plan stays archived.)
- **Risk class:** shared cross-app read-path that feeds a **money/access surface** (outage
  auto-pause pauses/resumes paid guests by `network_id`). Treat with care. No auth, no billing math,
  no secrets, no schema, no public HTTP API touched. `?mac=`/circuit-id signals remain
  client-influenceable — this improves accuracy, NOT tamper-proofing (per memory `mac-trust-residual`).

## Blast Radius

- **Files changed:** 2 (`networkHealth.ts` + its integration spec), both in `packages/core`.
- **Packages:** 1 (`packages/core`). Downstream read consumers in `packages/core` (sessions, outage)
  and `apps/admin` (queries) are unmodified.
- **Risk:** MEDIUM — single-function internal refactor, but the resolved `network_id` feeds the
  outage auto-pause access gate; a wrong id there = wrong pause/resume decision. Mitigated by the
  fail-closed `resolveCircuitIdForMac` (null → old behavior) and case-(d) outage-keying test.
- **Selection determinism:** unchanged — `ORDER BY id LIMIT 1` on `apCircuitId` matches, so a
  shared-ONU group resolves to the same representative AP the fast path already picks.

---

## Sequencing / Merge-Collision Avoidance (MANDATORY — flagged by INNOVATE #2)

Two ACTIVE plans also touch `sessions.ts` / `resolveNetworkIdForMac`. This plan edits ONLY the body
of `resolveNetworkIdForMac` + a new private helper in `networkHealth.ts`; it does NOT edit `sessions.ts`.

| Active plan | Overlap | Collision risk | Resolution |
|---|---|---|---|
| `purchase-ap-attribution_21-07-26/` | Added `apCircuitId`/`apNameSnapshot` to `network_sessions` (`customer.ts:302-305`) and explicitly declared the `afterBind`/`resolveNetworkIdForMac` post-hoc path **UNTOUCHED** (PLAN `:36-37`). It ADDED sibling exports `resolveCircuitIdForMac` + `resolveApCircuitLabel` next to `resolveNetworkIdForMac`. | LOW — it left `resolveNetworkIdForMac`'s body alone by design; this plan is the deliberately-deferred remainder that finally fixes that body. It is NOT a duplicate. | This plan consumes the `resolveCircuitIdForMac` helper that purchase-ap-attribution created. Land only after purchase-ap-attribution's `resolveCircuitIdForMac` export is present in `networkHealth.ts` (it already is — verified at `:608-645`). No line-level overlap. |
| `multi-router-support_13-07-26/` | Plans to have `sessions.ts` bind stamp `site_id` in the SAME transaction as `networkId` (PLAN `:202`), and to thread a resolved controller through the bind entry points. It reads `resolveNetworkIdForMac` at `sessions.ts:273-281`. | MEDIUM if both land in `sessions.ts` — but this plan does NOT edit `sessions.ts`. Overlap is only that both depend on `resolveNetworkIdForMac`'s return being a correct `network_id`. | Coordinate at EXECUTE: this plan's change to `resolveNetworkIdForMac` is transparent to multi-router (it returns a better id via the same signature). If multi-router lands first and changes `resolveNetworkIdForMac`'s signature to be site-aware, re-base this plan's fallback edit onto the new signature. No `sessions.ts` line collision from this plan. Record the ordering in the EXECUTE handoff. |

**EXECUTE rule:** before editing, re-read `resolveNetworkIdForMac` and `resolveCircuitIdForMac` in
`networkHealth.ts` HEAD to confirm neither active plan has already re-shaped them; if the signature
changed, adapt the fallback edit to the current signature rather than reverting in-flight work.

---

## Implementation Checklist

1. In `packages/core/src/services/networkHealth.ts`, add a private helper
   `async function apIdForCircuitId(db: DB, circuitId: string): Promise<number | null>` — selects
   `network_health.id` where `apCircuitId = circuitId`, `ORDER BY id ASC`, `LIMIT 1`, wrapped in
   try/catch returning null (mirrors checkout's `apRowForCircuitId` at
   `apps/customer/src/lib/server/network-location.ts:268-291`, but returns just the id).
2. Refactor `resolveNetworkIdForMac`'s fast path (`:520-538`) to call `apIdForCircuitId(db,
   cached.circuitId)` instead of the inline select — behavior identical, removes duplication.
3. Rewrite `resolveNetworkIdForMac`'s fallback tier (`:539-547`):
   - `const circuitId = await resolveCircuitIdForMac(db, network, macAddress);` (never throws by
     contract).
   - `if (circuitId) { const id = await apIdForCircuitId(db, circuitId); if (id !== null) return id; }`
   - Then the existing raw interface-name path UNCHANGED: `if (!network.resolveApForMac) return null;`
     → `try { const apName = await network.resolveApForMac(macAddress); if (!apName) return null;
     return await resolveNetworkIdByApName(db, apName); } catch { return null; }`
   - Note: `resolveCircuitIdForMac` re-checks the attribution cache internally; that is a cheap,
     harmless redundancy on the cache-miss path (cache already missed in the fast path). Do NOT add a
     second router round-trip beyond the one `resolveCircuitIdForMac` already makes plus the terminal
     `resolveApForMac` fallback. (Accept the at-most-two `resolveApForMac` calls on the pure-bridge
     path, or — if trivially clean — hoist a single `resolveApForMac` result; keep the diff minimal,
     do not over-engineer.)
4. Update the doc-comment on `resolveNetworkIdForMac` (`:504-513`) to state the fallback is now
   circuit-id-first, with the raw interface-name lookup as the terminal tier for pure-bridge
   deployments. Explicitly note this revises the Phase A "byte-for-byte fallback" claim for the
   ambiguous-bridge case. While here, fix any stale `outage.ts` line citation in comments/notes: the
   pause query keys `networkSessions.networkId` at `:113`, stamps `networkId: ap.id` at `:143`, and
   `accessPausedNetworkId` lives at `:178` — the previously-cited `outage.ts:634` does NOT exist
   (file is ~203 lines).
5. Add PGlite integration test cases (a)-(d) to
   `packages/core/src/services/networkHealth.integration.spec.ts`. **Build case (b) and case (d) to
   the concrete fixture shapes specified in Verification Evidence → "Test fixture shapes (E1 / E2)"
   below — these are load-bearing: a mis-built case (b) is vacuous (secretly re-tests the fast path)
   and a mis-built case (d) proves only a stamped value, not the outage keying behavior.** Cases (a)
   and (c) follow the existing G3/G9/G10 patterns in the same spec.
6. Run gate commands (see below); fix to green.
7. ✅ DONE (UPDATE PROCESS, 23-07-26): added the intentional-contract-revision cross-reference to
   the per-ap-visibility Phase A note (PLAN `:87`, SPEC `:220`, REPORT `:37` in
   `process/general-plans/completed/per-ap-visibility_16-07-26/`); updated `all-context.md`.

---

## Verification Evidence

Automated proof = PGlite integration test in the existing
`packages/core/src/services/networkHealth.integration.spec.ts` (real migrations via
`drizzle-orm/pglite/migrator`; `fake()` controller with injectable `resolveApForMac`).

**Runner (MANDATORY):** `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts`
— NEVER `bun test <file>` (bun's native runner silently no-ops fake timers; per
`tests/all-tests.md` §Gotcha). `cd` into `packages/core` first (no root vitest config).

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| (a) cache HIT → returns the AP row id (fast path unchanged after helper refactor) | Fully-Automated | G1 (no regression to fast path) |
| (b) cache MISS + `resolveApForMac` yields shared-bridge iface, circuit-id RESOLVABLE → returns the physical AP row id, NOT the bridge row id (fixture: see "Test fixture shapes (E1 / E2)" — genuine cache miss, bridge row `apCircuitId=NULL`, distinct lower-id AP row with the circuit-id) | Fully-Automated | G1, G2 |
| (c) cache MISS + `resolveApForMac` yields iface with NO resolvable circuit-id (pure bridge, `apCircuitId = NULL`) → returns the interface-name-matched id (old fallback preserved) | Fully-Automated | G4 |
| (d) a `network_session` bound via the new path carries the AP row's `network_id`, AND the real outage pause selection `eq(networkSessions.networkId, ap.id)` (`outage.ts:113`) matches that session for the AP row and NOT for the bridge row (fixture + acceptable fallback framing: see "Test fixture shapes (E1 / E2)") | Fully-Automated | G3 |
| `cd packages/core && bunx tsc -p tsconfig.json --noEmit` — 0 errors (core has no `bun run check` script) | Fully-Automated | typecheck of the changed package |
| `bun run check` — 0 errors (typechecks `apps/admin` read consumer `queries.ts`) | Fully-Automated | downstream consumer still typechecks |
| Live 2-SSID-router reproduction of the exact `resolveApForMac` bridge-name shape | Known-Gap | (see Test Infra Improvement Notes — provable only on hardware) |

### Test fixture shapes (E1 / E2 — concrete, do NOT make vacuous)

**Case (b) — genuine cache-MISS + circuit-id-resolvable (E1).** Seed so the fast path CANNOT fire and
the fallback tier is the code under test:

- `network_client_attribution`: **NO row for the test MAC** — a genuine cache miss, so the fast path
  does not fire. (Pre-seeding an attribution-cache row here is the failure mode: it would silently
  re-test the fast path and make case (b) vacuous. Do NOT do it.)
- `network_health` seed rows:
  - one **shared-bridge interface row** with `apCircuitId = NULL` (e.g. `interface_name`
    `bridge1_WiFi_Project`) — this is the row the raw interface-name path would resolve.
  - one **distinct physical AP row** carrying a **NON-NULL `apCircuitId`** (e.g. `cid =
    "0/0/1:100.200"`), given the LOWER id among any rows sharing that circuit-id so the
    `ORDER BY id LIMIT 1` representative is deterministic and equals the fast path's pick.
- `fake()` controller `resolveApForMac`: returns the INTERFACE NAME of the shared-bridge row, so the
  terminal raw path would resolve the bridge. `resolveCircuitIdForMac` must resolve the NON-NULL
  `apCircuitId` via its router path (internal `resolveApForMac` → row lookup), then `apIdForCircuitId`
  maps cid → the physical AP row.
- **Assert:** return value === the physical AP row's id, NOT the bridge/interface row's id.
- **Negative control (proves the fallback TIER itself is exercised, not the cache):** run the same
  fixture with the circuit-id branch effectively disabled (e.g. a `fake()` `resolveApForMac` whose
  bridge row has `apCircuitId = NULL` so `resolveCircuitIdForMac` fails closed) and confirm the
  return is the BRIDGE id (old behavior); the enabled run returns the AP id. The id changing from
  bridge→AP proves the new fallback tier caused it, not a preseeded cache.

**Case (d) — outage-keying BEHAVIOR, not just the stamped value (E2).** Prove the pause path keys on
the right row. Choose ONE framing and record which was used:

- **(preferred) Behavioral:** after a session is stamped with the resolved AP-row `network_id`,
  exercise outage's real pause selection — replicate (or import) the pause query
  `eq(networkSessions.networkId, ap.id)` (`outage.ts:113`) and assert it MATCHES the session for the
  AP row and does NOT match it for the bridge row. This proves the pause targets the physical AP, not
  the bridge.
- **(acceptable) Value + same-column-by-construction:** if importing `outage.ts` expands scope beyond
  a clean integration test, assert `network_sessions.network_id === ap.id` AND document (in the phase
  report and here) WHY that is sufficient: outage's pause selects on the identical `network_id` column
  this fix now populates with the AP-row id, so a correct value ⇒ correct keying (the pause query at
  `:113` and the bind write both key the one `network_id` column). Record the chosen framing in the
  phase report.

**Failing stubs (Fully-Automated tier — for the validate-contract Test Gates, red-first):**
```
test("cache miss + circuit-id-resolvable ARP resolves the physical AP row, not the shared bridge", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: fallback circuit-id-first resolves physical AP")
})
test("cache miss + no resolvable circuit-id (pure bridge) preserves the interface-name fallback", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: pure-bridge fallback unchanged")
})
test("cache hit still returns the AP row id after apIdForCircuitId refactor", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: fast-path unchanged")
})
test("session bound via new path keys the outage pause/resume on the AP row network_id", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: outage keying on AP row")
})
```

### Gate commands (summary)

1. `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` — all green.
2. `cd packages/core && bunx tsc -p tsconfig.json --noEmit` — 0 errors.
3. `bun run check` — 0 errors (covers `apps/admin` consumer typecheck).

The 5-validator harness suite is NOT required — no harness/context/plan-artifact source changes
beyond this plan file itself.

## Test Infra Improvement Notes

- **Known-gap (accepted, not a blocker):** the exact live 2-SSID-router `resolveApForMac`
  bridge-name shape (CAPsMAN/wireless/ARP divergence) cannot be reproduced by the stub/`fake()`
  controller — only on real hardware. Consistent with per-ap-visibility Phase A's accepted
  limitation. The PGlite test proves the SQL + branch logic (circuit-id-first vs interface fallback);
  it injects the bridge-name shape via the `fake()` controller's `resolveApForMac`, which is a
  faithful stand-in for the branch under test but not for the router's real ambiguity. Record in the
  phase report `## Test Infra Gaps Found`; no new infra to build here.

## Resume and Execution Handoff

1. **Selected plan file path:**
   `process/general-plans/active/ap-session-binding-circuitid-first_23-07-26/ap-session-binding-circuitid-first_PLAN_23-07-26.md`
2. **Last completed step:** PLAN written; PVL supplement applied (E1/E2 fixture shapes folded into
   Verification Evidence + checklist; E4 line citations corrected). Next: VALIDATE re-run from V1.
3. **Validate-contract status:** CONDITIONAL (see below); orchestrator re-runs VALIDATE from V1 after
   this supplement.
4. **Supporting context files loaded:** `process/context/all-context.md`,
   `process/context/database/all-database.md`, `process/context/tests/all-tests.md`,
   `packages/core/src/services/networkHealth.ts` (`:480-645`),
   `apps/customer/src/lib/server/network-location.ts` (`:260-339` — checkout precedent),
   `packages/core/src/services/sessions.ts` (`:295-321`), the two overlapping active plans
   (`purchase-ap-attribution_21-07-26/`, `multi-router-support_13-07-26/`), and the precedent note
   `maya-checkout-ap-attribution-interface-not-physical_NOTE_22-07-26.md`.
5. **Next step for a fresh agent (EXECUTE, model = opus):** re-read `resolveNetworkIdForMac` +
   `resolveCircuitIdForMac` at HEAD (confirm neither active plan re-shaped them), then work the
   Implementation Checklist top-to-bottom. Write the 4 integration test cases red-first — case (b)
   and case (d) MUST follow the "Test fixture shapes (E1 / E2)" section — then make them green. Run
   the 3 gate commands. Do NOT edit `sessions.ts`, `outage.ts`, `queries.ts`, or any schema. Respect
   the sequencing table if either overlapping active plan has landed first.

## Acceptance Criteria

- AC1 (G1): On an attribution-cache miss where the device's interface resolves to a shared hotspot
  bridge but a distinct Option-82 circuit-id AP row exists, `resolveNetworkIdForMac` returns the
  **physical AP row id**, not the bridge row id. Proven by: integration test case (b), built to the
  E1 fixture shape (genuine cache miss, bridge `apCircuitId=NULL`, distinct lower-id AP row with the
  circuit-id, negative control) — strategy: Fully-Automated.
- AC2 (G2): admin Active-Session Network column and per-AP active-user counts no longer show /
  flip-flop to the raw bridge name once binds stamp the AP row. Proven by: case (b) + `bun run check`
  typecheck of `queries.ts` consumer — strategy: Fully-Automated (display follows the stamped id).
- AC3 (G3): a session bound via the new path keys the outage pause/resume path on the AP row's
  `network_id`. Proven by: integration test case (d), built to the E2 fixture shape (behavioral pause
  selection preferred; value + same-column-by-construction acceptable with recorded rationale) —
  strategy: Fully-Automated.
- AC4 (G4): pure-bridge / no-resolvable-circuit-id deployments keep today's exact interface-name
  fallback behavior. Proven by: integration test case (c) — strategy: Fully-Automated.
- AC5: `resolveNetworkIdForMac` signature, return type, and never-throws contract are unchanged.
  Proven by: `cd packages/core && bunx tsc -p tsconfig.json --noEmit` + fast-path case (a) — strategy:
  Fully-Automated.

## Phase Completion Rules

Single-phase SIMPLE plan. This plan is `CODE DONE` when checklist items 1-6 are complete and all
three gate commands are green (integration spec, `packages/core` tsc, `bun run check`). It is
`VERIFIED` only after the EVL confirmation run re-runs those gates green AND the intentional
per-ap-visibility contract-revision cross-reference is recorded at UPDATE-PROCESS (checklist item 7).
The live 2-SSID hardware reproduction is an accepted Known-Gap and does NOT block VERIFIED.

## Validate Contract

Status: PASS
Date: 23-07-26
date: 2026-07-23
generated-by: outer-pvl
supersedes: 2026-07-23 (outer-pvl) — re-validated after PVL supplement cycle; both prior CONDITIONAL concerns (E1/E2) resolved, current evidence.

Parallel strategy: sequential (Simple Mode fan-out run in-session)
Rationale: signal score ~1/7 — single package (packages/core), 2 files, no schema/auth/API/container surface. Layer 1 (4 dimensions) + Layer 2 (2 sections) run in Simple Mode; net PASS after the PVL supplement folded both test-design CONCERNs into concrete fixture specs.

Net Gate: PASS — 0 FAILs, 0 CONCERNs, 6 PASSes. Both prior CONDITIONAL concerns are resolved: E1 (case-(b) reachable cache-miss circuit-id-resolvable fixture) and E2 (case-(d) outage-keying proof) are now specified up front in Verification Evidence → "Test fixture shapes (E1 / E2)" with a non-vacuity negative control and a behavioral pause-selection framing. Developed behavior (G1-G4) is gated by Fully-Automated PGlite tests — NOT vacuously green. The single Known-Gap (live 2-SSID hardware) is a named residual (gap-resolution D), honestly justified and NOT the sole coverage of any developed behavior.

Note (re-validation 23-07-26, after PVL supplement): verified against HEAD source —
- E1 (was CONCERN → PASS): traced case (b) through the real `resolveCircuitIdForMac` (`networkHealth.ts:608-645`) + `resolveNetworkIdByApName` (`:488-502`). The fixture forbids the attribution-cache row (genuine cache miss, fast path cannot fire), and the negative control (branch-disabled, bridge `apCircuitId=NULL` → `resolveNetworkIdByApName` returns the bridge id) vs the enabled run (returns the AP id) proves the fallback tier caused the id flip. Non-vacuous.
- E2 (was CONCERN → PASS): the behavioral framing (replicate/exercise the real `eq(networkSessions.networkId, ap.id)` pause selection at `outage.ts:113`, assert AP-row match / bridge-row non-match) proves keying, not just a stamped scalar. Value + same-column-by-construction retained as an acceptable, justified fallback.
- E4 (cosmetic → confirmed corrected): `outage.ts` is 203 lines; the citations `:113` (`eq(networkSessions.networkId, ap.id)`), `:143` (`networkId: ap.id`), `:178` (`accessPausedNetworkId`) are exact; the old `:634` correctly does not exist.
- No regression: Direction A still locked; sequencing table vs `purchase-ap-attribution_21-07-26` + `multi-router-support_13-07-26` accurate (`resolveCircuitIdForMac` export confirmed present at `:608`, `apIdForCircuitId` confirmed not-yet-present); runner `cd packages/core && bunx vitest run <file>` (never `bun test <file>`) correct per `tests/all-tests.md`; the separate `packages/core` `tsc` gate is correctly justified because `packages/core` is NOT in the `bun run check` fan-out. Live 2-SSID hardware repro remains an accepted Known-Gap.

### Test gates (C3 5-column table)

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1/G1 | cache-miss + circuit-id resolvable → returns physical AP row id, not bridge row id | Fully-Automated | case (b) in `packages/core/src/services/networkHealth.integration.spec.ts` via `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` (E1 fixture shape) | A |
| AC4/G4 | cache-miss + NO resolvable circuit-id (pure bridge) → interface-name fallback preserved | Fully-Automated | case (c), same spec/command | A |
| AC5/G1 | cache-hit still returns AP row id after `apIdForCircuitId` refactor (fast path unchanged) | Fully-Automated | case (a), same spec/command | A |
| AC3/G3 | session bound via new path carries AP row `network_id`; outage pause/resume keys on that same `network_id` | Fully-Automated | case (d), same spec/command (E2 fixture shape — behavioral pause selection preferred) | A |
| AC5 | signature / return-type / never-throws contract unchanged | Fully-Automated | `cd packages/core && bunx tsc -p tsconfig.json --noEmit` — 0 errors | A |
| AC2/G2 | admin Active-Session Network column + per-AP counts consume the corrected `network_id` and still typecheck | Fully-Automated | `bun run check` — 0 errors (covers `apps/admin` `queries.ts` consumer) | A |
| G-live | live 2-SSID-router `resolveApForMac` bridge-name shape (CAPsMAN/wireless/ARP divergence) | (residual) | — not reproducible without real hardware; stub/`fake()` controller is a faithful branch stand-in only | D |

gap-resolution legend: A — proven now; B — fixed by this plan's checklist; C — deferred to a named later phase/plan; D — backlog test-building stub / named residual (keep-active, continue).

C-4 reconciliation: the `strategy:` column carries only the 3 proving strategies. `Known-Gap` (G-live row) is a named residual carried via gap-resolution D — never a strategy.

Legacy line form (retained for existing consumers):
- fallback resolution (networkHealth.ts): Fully-automated: `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` (cases a-d) + `cd packages/core && bunx tsc -p tsconfig.json --noEmit`
- admin display consumer (queries.ts): Fully-automated: `bun run check`
- live 2-SSID router bridge-name shape: known-gap: documented — provable only on hardware

Failing stubs (Fully-Automated rows, red-first — from the plan's Verification Evidence):
```
test("cache miss + circuit-id-resolvable ARP resolves the physical AP row, not the shared bridge", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: fallback circuit-id-first resolves physical AP")
})
test("cache miss + no resolvable circuit-id (pure bridge) preserves the interface-name fallback", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: pure-bridge fallback unchanged")
})
test("cache hit still returns the AP row id after apIdForCircuitId refactor", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: fast-path unchanged")
})
test("session bound via new path keys the outage pause/resume on the AP row network_id", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: outage keying on AP row")
})
```

### Dimension findings

- Infra fit: PASS — single package (`packages/core`), no container/port/infra/worker surface; `packages/core/tsconfig.json` exists for the tsc gate; runner correct.
- Test coverage: PASS — cases (a),(c),(d) map cleanly to existing G3/G9/G10 patterns in the same PGlite spec; case (b) (genuine cache MISS yet circuit-id-resolvable) and case (d)'s outage-keying proof are now concretely specified in "Test fixture shapes (E1 / E2)" with a non-vacuity negative control and a behavioral pause-selection framing. Access surface (high-risk-adjacent) minimum tier met by real-Postgres PGlite integration (hybrid-equivalent, zero external deps). Live-hardware known-gap honestly recorded (gap-resolution D).
- Breaking changes: PASS — `resolveNetworkIdForMac` signature / return type / never-throws contract unchanged; the ONE intentional revision (per-ap-visibility Phase A "byte-for-byte fallback", ambiguous-bridge case only) is documented with a mandatory UPDATE-PROCESS cross-ref (checklist item 7); non-bridge / no-circuit-id paths preserved (G4/case c); downstream consumers (sessions, outage, queries) are read-only and benefit automatically.
- Security surface: PASS — no auth, no billing math, no secrets, no schema, no new write path, no public HTTP API. Touches an access-decision read path (outage auto-pause pauses/resumes paid guests by `network_id`); risk mitigated by fail-closed `resolveCircuitIdForMac` (null → unchanged old behavior) + case (d). Full risk-evidence-pack NOT required (accuracy-improving read refactor, no write/billing surface) — the PGlite integration test + fail-closed contract is proportionate. `?mac=`/circuit-id remain client-influenceable (per memory `mac-trust-residual`) — plan correctly frames this as accuracy, not tamper-proofing.
- Section A feasibility (fallback rewrite, networkHealth.ts): PASS — all edit targets present and uniquely matchable (`resolveNetworkIdForMac:514-548`, fast-path inline select `:528-534`, `resolveCircuitIdForMac:608-645`, `resolveNetworkIdByApName:488-502`); helper `apIdForCircuitId` confirmed not-yet-present (clean add). Value scenario bounded by the E1 fixture spec. No conflicts — collision table accurate, both overlapping active plans present, re-read-at-HEAD instruction present. Highest-risk edit: the fallback rewrite feeding outage keying — mitigated by fail-closed fallback + case (d) + EXECUTE re-read at HEAD.
- Section B feasibility (integration test cases a-d): PASS — mechanically feasible in the existing `fake()`-controller PGlite suite (verified: `fake()` at `:38`, injectable `resolveApForMac` at `:43`/`:60`, G9/G10 cache-hit/cache-miss patterns at `:260`/`:277`); correctness of the PROOF pinned by the "Test fixture shapes (E1 / E2)" section + non-vacuity negative control.

### Execute-Agent Instructions (carried on record)

| # | Instruction | Trigger |
|---|---|---|
| E1 | Build case (b) to the "Test fixture shapes (E1 / E2)" spec: genuine cache MISS (NO `network_client_attribution` row for the test MAC), a shared-bridge `network_health` row with `interface_name` = the `fake()` `resolveApForMac` return string and `apCircuitId=NULL`, and a distinct LOWER-id physical AP row carrying a NON-NULL `apCircuitId`. **Fixture detail (VALIDATE clarification):** for `resolveCircuitIdForMac` to resolve the non-null circuit-id via its `byName` tier, the physical AP row's `name` column must equal that same `resolveApForMac` return string (its `byIface` tier hits the NULL bridge row first, then falls to `name`). Give the bridge row a DIFFERENT `name` so `byName` is deterministic. Assert the return is the AP row id, not the bridge id; include the negative control (branch-disabled run returns the bridge id). Do NOT pre-seed the attribution cache — that makes case (b) vacuous. | writing case (b) |
| E2 | Build case (d) to the "Test fixture shapes (E1 / E2)" spec: prove outage keying behaviorally (preferred — exercise the real `eq(networkSessions.networkId, ap.id)` pause selection at `outage.ts:113`, match AP row / not bridge row) OR the acceptable value + same-column-by-construction framing with recorded rationale in the phase report. | writing case (d) |
| E3 | Before editing, re-read `resolveNetworkIdForMac` + `resolveCircuitIdForMac` in `networkHealth.ts` at HEAD to confirm neither `multi-router-support_13-07-26` nor `purchase-ap-attribution_21-07-26` has re-shaped the signature; adapt the fallback edit to the current signature rather than reverting in-flight work. Do NOT edit `sessions.ts`, `outage.ts`, `queries.ts`, or any schema. | before any edit |
| E4 | (Verified corrected in plan text 23-07-26.) The correct `outage.ts` citations are: pause query keys `networkSessions.networkId` at `:113`, stamps `networkId: ap.id` at `:143`, `accessPausedNetworkId` at `:178`; the old `outage.ts:634` does not exist (file is 203 lines — VALIDATE-confirmed). Keep the record accurate when touching the doc-comment / phase report. | doc-comment / phase report |
| E5 | At UPDATE-PROCESS, actually execute checklist item 7 — record the intentional per-ap-visibility Phase A contract-revision cross-reference (PLAN `:87`, SPEC `:221`, REPORT `:37` in `completed/per-ap-visibility_16-07-26/`). This is the one action that keeps the "byte-for-byte fallback" revision documented as intentional, not an accidental break. | UPDATE-PROCESS |

Open gaps: none blocking. One named residual — live 2-SSID-router `resolveApForMac` bridge-name reproduction (gap-resolution D, provable only on hardware); the PGlite suite proves the SQL + branch logic, not the router's real CAPsMAN/wireless/ARP ambiguity.

What this coverage does NOT prove:
- cases (a)-(d) (`bunx vitest run networkHealth.integration.spec.ts`): do NOT prove the real MikroTik `resolveApForMac` returns the bridge-name shape on a live 2-SSID router (the injected `fake()` shape is a faithful branch stand-in, not the router's real ambiguity); do NOT prove behavior on a pure shared-bridge + cold-cache deployment where no circuit-id is resolvable (that path is unchanged by design, G4/case c, and is the accepted known-gap for the ambiguous case).
- `cd packages/core && bunx tsc -p tsconfig.json --noEmit`: proves the changed package typechecks; does NOT run any admin/customer app typecheck.
- `bun run check`: proves `apps/admin` (incl. `queries.ts` consumer) svelte-check passes; does NOT cover `packages/core` (not in the `check` fan-out — that is why the separate `tsc` gate exists) and does NOT run the integration test.

Gate: PASS (no FAILs; both prior test-design CONCERNs resolved — case-(b)/case-(d) fixtures now specified up front with a non-vacuity negative control; developed behavior gated by Fully-Automated PGlite tests; one named live-hardware residual carried as gap-resolution D)
Accepted by: session — re-validated from V1 after the PVL supplement. Prior concerns (1) case (b) reachable cache-miss circuit-id-resolvable fixture and (2) case (d) outage-keying proof are now specified in the plan body (Verification Evidence → "Test fixture shapes (E1 / E2)") and verified against HEAD source; no unresolved concern remains. E1-E5 carried forward as on-record execute-agent instructions.

## Autonomous Goal Block

```
SESSION GOAL: AP session binding — resolve Option-82 circuit-id FIRST in resolveNetworkIdForMac's fallback tier so a session on a shared hotspot bridge binds to the real physical AP row (not the auto-swept bridge row), fixing the admin Network-column flip-flop AND the outage-pause mis-keying.
Charter + umbrella plan: N/A — single plan.
Autonomy: standard interactive RIPER-5 (no standing /goal). Under /goal: proceed on CONDITIONAL (concerns are execute-agent instructions); BLOCKED → backlog + continue. Never auto-run irreversible/outward-facing actions.
Hard stop conditions / safety constraints:
- Do NOT edit sessions.ts, outage.ts, queries.ts, or any schema/migration — read-only consumers only.
- Preserve resolveNetworkIdForMac signature, return type, and never-throws contract exactly.
- Re-read resolveNetworkIdForMac + resolveCircuitIdForMac at HEAD before editing (two overlapping active plans touch this surface).
- Do NOT pre-seed the attribution cache in case (b) — that would make the fallback test vacuous (E1).
Next phase: EXECUTE — process/general-plans/active/ap-session-binding-circuitid-first_23-07-26/ap-session-binding-circuitid-first_PLAN_23-07-26.md (model = opus).
Validate contract: inline in plan (## Validate Contract, Gate: PASS).
Execute start: red-first write cases (a)-(d) in packages/core/src/services/networkHealth.integration.spec.ts (case b + d to the "Test fixture shapes (E1 / E2)" spec), then make green. Gates: `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` | `cd packages/core && bunx tsc -p tsconfig.json --noEmit` | `bun run check`. High-risk pack: no (accuracy-improving read refactor, no write/billing surface). Honor E1-E5.
```
