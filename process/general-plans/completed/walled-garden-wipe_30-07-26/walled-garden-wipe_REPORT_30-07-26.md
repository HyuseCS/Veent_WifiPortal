---
phase: walled-garden-wipe
date: 2026-07-30
status: COMPLETE
feature: general
plan: process/general-plans/completed/walled-garden-wipe_30-07-26/walled-garden-wipe_PLAN_30-07-26.md
---

### What Was Done

Added scripted `--wipe` / `--wipe-only` walled-garden teardown so the previously-manual Winbox
hard-reset (`remove [find]` against both walled-garden menus) is now a single command:

- `wipeWalledGarden(config, {dryRun})` in `packages/core/src/integrations/network/mikrotik.ts` —
  clears every STATIC row from both `/ip/hotspot/walled-garden` (host) and
  `/ip/hotspot/walled-garden/ip` menus, skips `dynamic==='true'` auto-shadow rows, honors a real
  `dryRun` no-op, returns per-menu removed counts.
- Barrel re-export added in `packages/core/src/integrations/network/index.ts`.
- `apps/admin/scripts/setup-router.ts` — new `--wipe` (wipe then rebuild the 3 provisioning
  groups) and `--wipe-only` (wipe then `exit(0)` before provisioning) flags, both honoring
  `--dry-run`.
- `packages/core/src/integrations/network/mikrotik.spec.ts` — new `describe('wipeWalledGarden')`
  block: AC1 (both menus emptied), AC2 negative control (dynamic row survives, uncounted), AC3
  (dry-run real no-op).
- `docs/mikrotik/walled-garden.md` — §Hard reset runbook now points at the flags instead of manual
  console steps.

Committed as `53a223b` on `polishing` (already landed before this UPDATE PROCESS session started;
this session did not touch any of those 5 files).

### What Was Skipped/Deferred

None — closed out 30-07-26. The staging `--wipe-only --dry-run` probe against real RouterOS
(deferred at initial archival) has since been run by the user and confirmed a true no-op. The
plan's own Phase Completion Rules requirement for `VERIFIED` is now satisfied.

### Test Gate Outcomes

| Gate | Command | Result |
|---|---|---|
| Unit | `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` | 21/21 green |
| Typecheck | `bun run --filter radius-admin check` | 0 errors |

### Plan Deviations

None. Implementation followed the checklist (items 1-5) and touchpoints as planned; no
`reconcileWalledGarden`/`provisionWalledGarden`/`provisionGcashResolveScheduler` bodies or
signatures were touched (E1 instruction honored).

### Test Infra Gaps Found

None new. The plan itself notes "(none identified yet)" — still true after execution.

### SPEC Achievement

No separate `*_SPEC_*.md` for this SIMPLE plan — governed by the plan's own Goal/Acceptance
Criteria section (7 ACs).

| AC | Criterion | Status |
|---|---|---|
| AC1 | Removes all STATIC rows from both menus | met — Fully-Automated (spec) |
| AC2 | Dynamic rows never removed (negative control) | met — Fully-Automated (spec) |
| AC3 | `dryRun:true` real no-op, reports intended counts | met — unit-proven + staging-probe confirmed 30-07-26 |
| AC4 | Returns per-menu removed counts | met — Fully-Automated (spec) |
| AC5 | `--wipe` wipes-then-rebuilds; `--wipe-only` wipes-then-exits | met — Fully-Automated (typecheck + spec wiring) |
| AC6 | `--wipe-only` precedence over `--wipe`/`--reconcile` | met — code-level + staging-probe confirmed 30-07-26 |
| AC7 | Provision/reconcile/scheduler/tag-model/login.html untouched | met — Fully-Automated (diff review + E1 instruction) |

### Closeout Packet

**VERIFIED (30-07-26)** — the staging `--wipe-only --dry-run` probe against real RouterOS has
been run by the user and confirmed a true no-op (no rows changed, intended removals printed
correctly). This closes the last outstanding Agent-Probe-tier residual (AC3/AC6). Original EVL:
`gates_green: ["bunx vitest run mikrotik.spec.ts (21/21)", "bun run --filter radius-admin check
(0 errors)"]`. No open residual remains.

### Forward Preview

#### Test Infra Found

None new.

#### Blast Radius Changes

Matches plan exactly: 1 core fn (`mikrotik.ts`), 1 barrel re-export (`index.ts`), 1 admin script
(`setup-router.ts`), 1 spec file, 1 doc. No files outside the planned 5.

#### Commands to Stay Green

- `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts`
- `bun run --filter radius-admin check`

#### Dependency Changes

None.
