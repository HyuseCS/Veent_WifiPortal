---
name: plan:walled-garden-wipe
description: 'Add scripted --wipe / --wipe-only walled-garden teardown to setup:router (both menus, skip dynamic rows, dry-run safe)'
date: 30-07-26
feature: general
---

# Walled-Garden Wipe (`--wipe` / `--wipe-only`) — SIMPLE plan

- **Date**: 30-07-26
- **Status**: VERIFIED (30-07-26 — staging `--wipe-only --dry-run` probe confirmed a true no-op)
- **Complexity**: SIMPLE

## Overview / Context

`setup:router` can additively provision and opt-in prune (`--reconcile`) the walled garden, but a
true hard reset still requires an operator to manually `remove [find]` rows in Winbox/console. This
plan adds scripted teardown so the from-scratch rebuild is a single command. Follows the existing
`reconcileWalledGarden` pattern (connect → print → remove-by-`.id`), reads `process/context/all-context.md`
walled-garden model, and adds unit + typecheck gates per `process/context/tests/all-tests.md`.

## Phase Completion Rules

Single-phase SIMPLE plan. `CODE DONE` when checklist 1-5 applied and both test gates
(`bunx vitest run .../mikrotik.spec.ts` + `bun run --filter radius-admin check`) are green.
`VERIFIED` requires the staging `--wipe-only --dry-run` manual probe — **run and confirmed
30-07-26** (true no-op on real RouterOS).

**TL;DR:** Add `wipeWalledGarden(config, {dryRun})` to `mikrotik.ts` that clears every STATIC row from
BOTH walled-garden menus (host + ip), skipping dynamic auto-shadow rows, honoring a `--dry-run` no-op,
returning per-menu removed counts. Wire `--wipe` (wipe then rebuild) and `--wipe-only` (wipe then stop)
into `setup:router`. Add unit tests + update the hard-reset doc runbook.

## Goal / Acceptance Criteria

- **AC1** — `wipeWalledGarden` removes all STATIC rows from `/ip/hotspot/walled-garden` AND
  `/ip/hotspot/walled-garden/ip`.
- **AC2** — Rows with `dynamic === 'true'` are NEVER removed (unremovable auto-shadows). Negative control.
- **AC3** — `dryRun: true` removes nothing but reports intended counts (real no-op preview).
- **AC4** — Returns removed counts per menu (`{ host, ip }`), for logging.
- **AC5** — `--wipe`: wipe FIRST (respecting `--dry-run`), then fall through to the existing 3-group
  provisioning. `--wipe-only`: wipe (respecting `--dry-run`) and exit(0) before provisioning.
- **AC6** — `--wipe-only` takes precedence over `--wipe`/`--reconcile` (documented precedence).
- **AC7** — `provisionWalledGarden` / `reconcileWalledGarden` signatures + bodies untouched; scheduler,
  tag model, PAYMENT_HOSTS/PROBE_DENIES/PORTAL_LAN_IPS contents untouched; login.html untouched.

## Touchpoints

| File                                                                                                | Change                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/integrations/network/mikrotik.ts`                                                | Add `WipeWalledGardenResult` interface + `wipeWalledGarden()` fn (new export). Mirrors `reconcileWalledGarden`'s `openConn`/print/remove-by-`.id`. |
| `packages/core/src/integrations/network/index.ts` (the barrel re-exporting `reconcileWalledGarden`) | Re-export `wipeWalledGarden` alongside `reconcileWalledGarden` (this barrel enumerates exports).                                                   |
| `apps/admin/scripts/setup-router.ts`                                                                | Parse `--wipe` / `--wipe-only`; import `wipeWalledGarden`; wipe block before provisioning; `--wipe-only` early exit.                               |
| `packages/core/src/integrations/network/mikrotik.spec.ts`                                           | New `describe('wipeWalledGarden')` block reusing the in-memory test double.                                                                        |
| `docs/mikrotik/walled-garden.md`                                                                    | Replace manual "remove each row" console steps in §Hard reset with the `--wipe` / `--wipe-only` flags (keep dry-run-first recommendation).         |

## Public Contracts

- **NEW:** `wipeWalledGarden(config: MikrotikConfig, input?: { dryRun?: boolean }): Promise<{ removed: { host: number; ip: number }; dryRun: boolean }>`.
- **NEW CLI flags:** `--wipe`, `--wipe-only` on `setup:router`.
- **Unchanged-hard:** `provisionWalledGarden`, `reconcileWalledGarden`, `provisionGcashResolveScheduler`,
  the `veent-admin:<group>` tag model, `PAYMENT_HOSTS`/`PROBE_DENIES`/`PORTAL_LAN_IPS`.

## Blast Radius

5 files (1 core fn, 1 barrel re-export, 1 admin script, 1 spec, 1 doc). Risk class:
**deploy/runtime (router-mutating, destructive)** — but staging-only, no live guests. Dynamic-row skip +
dry-run no-op are the safety guards; both mirror existing verified `reconcileWalledGarden` behavior.

## Implementation Checklist

1. **`mikrotik.ts`** — add after `reconcileWalledGarden` (~line 1265):
   - `export interface WipeWalledGardenResult { removed: { host: number; ip: number }; dryRun: boolean }`
   - `export async function wipeWalledGarden(config, input: { dryRun?: boolean } = {})`:
     - `const dryRun = input.dryRun ?? false;` open conn via `openConn(config)`; try/finally `conn.close()`.
     - HOST layer: `print`, for each row with `.id`, skip if `r.dynamic === 'true'`, else
       (if `!dryRun`) `remove` by `=.id=`; count.
     - IP layer: same against `/ip/hotspot/walled-garden/ip`.
     - Return `{ removed: { host, ip }, dryRun }`.
   - Doc comment: full wipe of BOTH menus, skips dynamic auto-shadows, does NOT touch the
     `gcash-resolve` scheduler (scheduler re-adds the gcash-auto ip row within 5 min).
2. **Barrel** — verify `@veent/core` re-exports it (add alongside `reconcileWalledGarden`).
3. **`setup-router.ts`**:
   - `const WIPE = argv.has('--wipe'); const WIPE_ONLY = argv.has('--wipe-only');`
   - import `wipeWalledGarden`.
   - Insert BEFORE the provisioning `try` block (~line 155): `if (WIPE || WIPE_ONLY) { ...wipe with DRY_RUN, log counts... }`.
   - After the wipe block: `if (WIPE_ONLY) { console.log(...); process.exit(0); }`.
   - Update the header doc-comment usage block with the two flags + dry-run recommendation.
4. **`mikrotik.spec.ts`** — new `describe('wipeWalledGarden')`:
   - seed a mixed table: static allow, static deny, static ip row, one `dynamic:'true'` host row.
   - AC1: both menus emptied of static rows; assert counts.
   - AC2 (negative control): the `dynamic:'true'` row survives; not counted.
   - AC3: `dryRun:true` → table unchanged, counts still reported.
5. **`walled-garden.md`** — swap the manual `/ip hotspot walled-garden remove [find]` steps for
   `setup:router --wipe` / `--wipe-only`, keep the `--dry-run`-first safety note.

## Verification Evidence

| Gate / Scenario                                                                                                         | Strategy                                                           | Proves SPEC criterion                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` — wipe tests + existing reconcile tests green | Fully-Automated                                                    | AC1–AC4 (both menus, dynamic skip, dry-run no-op, counts) |
| `bun run --filter radius-admin check` (tsc/svelte-check)                                                                | Fully-Automated                                                    | AC5–AC7 (flag wiring typechecks, no contract drift)       |
| Manual: `setup:router --wipe-only --dry-run` on staging prints intended removals, changes nothing                       | Agent-Probe (staging) — **run and confirmed 30-07-26, true no-op** | AC3/AC6 against real RouterOS                             |

## Test Infra Improvement Notes

(none identified yet)

## Resume and Execution Handoff

1. Selected plan: `process/general-plans/completed/walled-garden-wipe_30-07-26/walled-garden-wipe_PLAN_30-07-26.md` (archived).
2. Last completed step: EXECUTE + VERIFY done — shipped (commit `53a223b`), archived; VERIFIED via staging `--wipe-only --dry-run` no-op probe (30-07-26).
3. Validate-contract status: written — `Gate: CONDITIONAL` (accepted; destructive router op guarded by dry-run no-op + dynamic-row skip).
4. Context loaded: `mikrotik.ts` (reconcileWalledGarden lines 1169-1265, openConn 966), `setup-router.ts` (full), `mikrotik.spec.ts` (test double 1-130 + reconcile block 232-381), `walled-garden.md` §Hard reset 366-419.
5. Next step for fresh agent: none — session complete and VERIFIED.

## Validate Contract

- **generated-by**: outer-pvl
- **date**: 2026-07-30
- **Gate**: CONDITIONAL (accepted — destructive router op, same risk class as shipped `--reconcile`; guarded by dry-run no-op + dynamic-row skip)

### Layer 1 dimensions

| Dimension        | Status             |
| ---------------- | ------------------ |
| Infra fit        | PASS               |
| Test coverage    | PASS               |
| Breaking changes | PASS               |
| Security surface | CONCERN (accepted) |

### Layer 2 sections

| Section                 | Status |
| ----------------------- | ------ |
| A — wipeWalledGarden fn | PASS   |
| B — setup-router wiring | PASS   |
| C — spec                | PASS   |
| D — doc                 | PASS   |

**Totals: 0 FAILs / 1 CONCERN / 7 PASSes → Net Gate: CONDITIONAL**

### Accepted concerns (known-gaps)

- Destructive router-mutating op. Mitigations REQUIRED in EXECUTE: (a) `dryRun:true` must be a real
  no-op — assert zero deletion in the spec; (b) skip `dynamic==='true'` rows in BOTH menus.

### Execute-agent instructions

| #   | Instruction                                                                                                                     | Trigger   |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | --------- |
| E1  | Do NOT modify `reconcileWalledGarden`/`provisionWalledGarden`/`provisionGcashResolveScheduler` bodies or signatures. Add-only.  | Section A |
| E2  | `wipeWalledGarden` skips ONLY `dynamic==='true'` rows — disabled/deny static rows ARE removed (documented hard-reset behavior). | Section A |
| E3  | `--wipe-only` must `process.exit(0)` before the provisioning `try` block; `--wipe` falls through to it.                         | Section B |
| E4  | Spec negative control: seed one `dynamic:'true'` row, assert it survives and is not counted.                                    | Section C |

### Test gates

1. `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` — new wipe tests + existing reconcile tests green.
2. `bun run --filter radius-admin check` — 0 errors.
