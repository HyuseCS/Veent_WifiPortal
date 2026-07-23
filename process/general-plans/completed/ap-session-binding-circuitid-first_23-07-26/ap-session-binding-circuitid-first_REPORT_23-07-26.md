---
phase: ap-session-binding-circuitid-first
date: 2026-07-23
status: COMPLETE
feature: general-plans
plan: process/general-plans/active/ap-session-binding-circuitid-first_23-07-26/ap-session-binding-circuitid-first_PLAN_23-07-26.md
---

# EXECUTE Report — AP session binding: circuit-id first in the fallback tier

## What Was Done

Checklist items 1-6 complete. Two files touched, both in `packages/core`.

1. `packages/core/src/services/networkHealth.ts`
   - Added private `async function apIdForCircuitId(db, circuitId): Promise<number | null>` — lowest-id
     `network_health.id` for a circuit-id (`ORDER BY id LIMIT 1`, try/catch → null). Mirrors checkout's
     `apRowForCircuitId`, returns just the id.
   - Refactored `resolveNetworkIdForMac` FAST PATH to call `apIdForCircuitId(db, cached.circuitId)` —
     behavior identical, removes the inline duplicate select.
   - Rewrote the FALLBACK tier: tier-1 resolves the device circuit-id via existing
     `resolveCircuitIdForMac` (never-throws, fails-closed on a bridge row) → `apIdForCircuitId` → returns
     the physical AP id when non-null; ONLY when no circuit-id resolves does it fall through to the
     UNCHANGED terminal raw `resolveApForMac` → `resolveNetworkIdByApName` path.
   - Updated the doc-comment: fallback is now circuit-id-first; explicitly notes the deliberate revision
     of the per-ap-visibility Phase A "byte-for-byte fallback" (Regression #4) for the ambiguous-bridge
     case only. `resolveCircuitIdForMac` is hoisted (module-level `export async function`), so the
     forward reference is safe.
   - Signature / return type / never-throws contract UNCHANGED.
2. `packages/core/src/services/networkHealth.integration.spec.ts`
   - Added a new describe block with cases (a), (b), (b-neg NEGATIVE CONTROL), (c), (d) per the plan's
     "Test fixture shapes (E1 / E2)". Added `customerUser`, `networkSessions` to the `@veent/db` import,
     `SESSION_STATUS` from `../config`, `and` to the drizzle import, and `customer_user` to the
     `beforeEach` TRUNCATE (CASCADE clears the case-(d) session/profile rows).

Did NOT edit `sessions.ts`, `outage.ts`, `queries.ts`, or any schema (scope-locked, honored).

## Test Gate Outcomes

- `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` → **22 passed** (all green).
- `cd packages/core && bunx tsc -p tsconfig.json --noEmit` → **0 errors** (EXIT 0).
- `bun run check` → **0 errors** (veent-locator, veent-customer, radius-admin all exit 0).

### Case-design notes (E1 / E2 honored)
- **E1 / case (b):** genuine cache MISS (no `network_client_attribution` row for the test MAC); shared-bridge
  row `interface_name = 'bridge1_WiFi_Project'`, `apCircuitId = NULL`, distinct `name`; physical AP row
  seeded FIRST (deterministic lower id) with `name = 'bridge1_WiFi_Project'` (so `resolveCircuitIdForMac`'s
  `byName` tier resolves it — its `byIface` tier hits the NULL bridge row first, then falls to `name`),
  `apCircuitId = '0/0/1:100.200'`. `fake()` `resolveApForMac` returns the bridge interface name. Asserts
  return === AP id, !== bridge id. **NEGATIVE CONTROL (b-neg):** identical fixture with the AP row's
  `apCircuitId = null` → `resolveCircuitIdForMac` fails closed → fallback returns the BRIDGE id. The
  bridge→AP id flip between (b-neg) and (b) proves the new circuit-id branch is the cause, not a preseeded
  cache — non-vacuous.
- **E2 / case (d):** BEHAVIORAL framing chosen. After binding a session with the resolved AP-row
  `network_id`, the real outage pause selection `eq(networkSessions.networkId, ap.id)` + status-active
  (`outage.ts:113-114`) is replicated inline and asserted to MATCH the AP row (len 1) and NOT match the
  bridge row (len 0). Proves keying behavior, not just a stamped scalar.

## Plan Deviations

None. Implementation matches the plan checklist exactly. (Added a 5th test `(b-neg)` — this is the E1
negative control the plan mandates, not a scope deviation.)

## Test Infra Gaps Found

- **Known-gap (accepted, not a blocker):** the live 2-SSID-router `resolveApForMac` bridge-name shape
  (CAPsMAN/wireless/ARP divergence) is not reproducible by the `fake()` controller — only on real
  hardware. The PGlite suite proves the SQL + circuit-id-first-vs-interface-fallback branch logic; the
  injected bridge-name is a faithful branch stand-in, not the router's real ambiguity. Matches
  per-ap-visibility Phase A's accepted limitation (gap-resolution D).

## Closeout Packet

- **Selected plan:** `process/general-plans/active/ap-session-binding-circuitid-first_23-07-26/ap-session-binding-circuitid-first_PLAN_23-07-26.md`
- **Finished:** checklist 1-6; all 3 gate commands green.
- **Verified:** fast path unchanged (a); circuit-id-first fallback returns physical AP not bridge (b) with
  non-vacuity negative control (b-neg); pure-bridge fallback preserved (c); outage keying targets the AP
  row behaviorally (d); both typecheck gates.
- **Still unverified:** live 2-SSID hardware reproduction (accepted Known-Gap, does not block VERIFIED).
- **Remaining cleanup (UPDATE-PROCESS — E5, checklist item 7):** record the intentional per-ap-visibility
  Phase A contract-revision cross-reference (PLAN `:87`, SPEC `:221`, REPORT `:37` in
  `process/general-plans/completed/per-ap-visibility_16-07-26/`) as a diagnosed, intentional revision of
  the "byte-for-byte fallback" guarantee for the ambiguous-bridge case — NOT an accidental break. The
  completed plan stays archived; documentation-only cross-reference. Update `all-context.md` / memory if durable.
- **Best next state:** `Keep in active/testing` → EVL confirmation run, then UPDATE PROCESS for the E5 cross-reference.

## Forward Preview

### Test Infra Found
Existing `fake()`-controller PGlite suite (`networkHealth.integration.spec.ts`) with injectable
`resolveApForMac`; real migrations via `drizzle-orm/pglite/migrator`. Reused directly for cases (a)-(d).

### Blast Radius Changes
`packages/core/src/services/networkHealth.ts` (1 new private helper + fallback-tier rewrite of one
exported function) and its integration spec. No schema, no new write path. Downstream read consumers
(`sessions.ts`, `outage.ts`, `apps/admin/queries.ts`) benefit automatically, unmodified.

### Commands to Stay Green
- `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts`
- `cd packages/core && bunx tsc -p tsconfig.json --noEmit`
- `bun run check`

### Dependency Changes
None. Consumes the already-present `resolveCircuitIdForMac` export (`networkHealth.ts:608`) created by
`purchase-ap-attribution_21-07-26`. `multi-router-support_13-07-26` had NOT re-shaped the
`resolveNetworkIdForMac` / `resolveCircuitIdForMac` signatures at HEAD (E3 re-read confirmed) — no rebase needed.

## Suggested Commit (agent does not commit)

```
fix(core): resolve circuit-id first in resolveNetworkIdForMac fallback

On a shared hotspot bridge fronting multiple physical APs, the interface-name
fallback resolved the shared bridge row (wrong-but-non-null), causing the admin
Network-column flip-flop and outage-pause mis-keying. The fallback now resolves
the device's Option-82 circuit-id first (via resolveCircuitIdForMac) → the
physical AP row, only falling through to the raw interface-name lookup when no
circuit-id resolves (pure-bridge). Factors a shared apIdForCircuitId helper.
Adds PGlite integration cases (a)-(d) incl. a bridge->AP negative control.
```
