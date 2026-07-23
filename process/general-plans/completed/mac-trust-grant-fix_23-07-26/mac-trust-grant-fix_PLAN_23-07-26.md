---
name: plan:mac-trust-grant-fix
description: "COMPLEX plan — break the wrong-MAC closed loop: thread live/fallback provenance, honest unverified UX, no-entrench fallback persistence (customer captive portal)"
date: 23-07-26
feature: none
---

# PLAN — MAC-trust grant fix (wrong/fallback MAC binding)

**Date**: 23-07-26
**Status**: DONE — code-complete + EVL green + user browser-confirmed (23-07-26). See closing note under Phase Completion Rules.
**Complexity**: COMPLEX (trust-boundary/identity surface, multi-file signature change, closed-loop correctness)
**Context loaded**: `process/context/all-context.md`, `process/context/tests/all-tests.md`

TL;DR: Change `resolveMacForUser` to return `{ mac, live }`, gate dashboard auto-bind + `thisDeviceBound` on `live`, surface an "unverified — reconnect" banner on `fallback + prior binding`, and stop entrenching fallback MACs into `last_known_mac`. ~5 source files + 1 test file. No schema change. Checkout attribution provably untouched (checkout does not read `last_known_mac`).

## Overview / Context

The customer captive-portal grant path binds a device to the router keyed only by MAC. When live IP→MAC resolution fails, `resolveMacForUser` silently returns a stale fallback MAC, and both server auto-bind and the client re-derive treat "matches DB" as permanent proof of connection — turning a wrong binding into a closed loop a refresh cannot fix. This plan threads live-vs-fallback provenance through the resolver, gates the auto-bind and bound-device UI on it, gives the user an honest "reconnect" recovery path, and stops fallback MACs from entrenching durable truth. Scope is `apps/customer` only; `packages/core`/`packages/db` are read-only reference. See `mac-trust-grant-fix_SPEC_23-07-26.md` for full acceptance criteria.

## Acceptance Criteria

Authoritative list in the SPEC (AC1–AC7). Summary: AC1 provenance returned; AC2 fallback match not treated as verified (loop-break); AC3 honest unverified UX; AC4 no nagging correctly-online/never-bound users; AC5 fallback does not entrench `last_known_mac`; AC6 no checkout attribution regression; AC7 no MAC-rotation/M-2 regression.

---

## Root cause (cited)

| Fact | Location |
|---|---|
| Fallback chain fires silently when live misses | `apps/customer/src/lib/server/network-location.ts:131-153` (`resolveMacForUser`) |
| Live resolver (portal cookie → IP→MAC) | `network-location.ts:38-69` (`resolveMac`) |
| Fallback entrenches device-cookie MAC durably | `network-location.ts:145-149` + `rememberAccountMac` `:170-186` |
| Auto-bind treats "matches DB" as verified forever | `apps/customer/src/routes/dashboard/+page.server.ts:70-85` (esp. `:73`) |
| Client re-derives thisDeviceBound from mac-tail match (client-side closed loop) | `apps/customer/src/routes/dashboard/+page.svelte:53-54` |
| `flushHotspotHost` wipes the live re-verify signal | `packages/core/src/integrations/network/mikrotik.ts:494-497` (context only, not edited) |
| Cosmetic non-cause (do NOT fix) | `packages/core/src/services/sessions.ts:249-255` |
| Legit rotation eviction (do NOT regress) | `packages/core/src/services/sessions.ts:48` |

---

## Touchpoints

| File | Change |
|---|---|
| `apps/customer/src/lib/server/network-location.ts` | `resolveMacForUser` returns `{ mac: string \| null; live: boolean }`; fallback (device-cookie) path stops entrenching durable MAC (seed-only-when-empty); `resolveMacTrusted` destructures `.mac`. |
| `apps/customer/src/lib/server/account-view.ts` | `buildAccountView` + `shapeDevices` accept optional `verified` (default `true`); compute `thisDeviceBound = matched && verified` and add `thisDeviceUnverified = matched && !verified`. |
| `apps/customer/src/routes/dashboard/+page.server.ts` | Destructure `{ mac, live }`; gate auto-bind block on `live`; pass `verified: live` to `buildAccountView`; return `deviceVerified: live`. |
| `apps/customer/src/routes/dashboard/+page.svelte` | Gate client `thisDeviceBound` re-derive on `data.deviceVerified`; render unverified banner (reuse the `!hasMac` banner block, lines 98-100) when a prior binding exists but device is unverified. |
| `apps/customer/src/routes/+page.server.ts:42` | Destructure `.mac` (mechanical; no provenance use). |
| `apps/customer/src/routes/top-up/+page.server.ts:40,150` | Destructure `.mac` (mechanical). |
| `apps/customer/src/routes/top-up/processing/+page.server.ts:61` | Destructure `.mac` (mechanical). |
| `apps/customer/src/routes/dashboard/+page.server.ts:340` (signOut) | Destructure `.mac` (mechanical). |
| `apps/customer/src/lib/server/network-location.spec.ts` | Add provenance + no-entrench unit cases. |

## Public Contracts

- **`resolveMacForUser` return type changes** `string | null` → `{ mac: string \| null; live: boolean }`. Internal to `apps/customer`; all 6 call sites enumerated above. No cross-package export.
- **`buildAccountView` signature** gains an optional trailing `verified = true` param — back-compat for the SSE (`api/account/stream`) and root `+page` callers (they keep current behavior).
- **Dashboard load payload** gains `deviceVerified: boolean`. Additive; the client already tolerates absent flags via `$derived` fallbacks.
- No DB schema / migration change. `last_known_mac` column unchanged.

## Blast Radius

- **Files:** 8 source + 1 spec (5 substantive, 4 mechanical destructure).
- **Packages:** `apps/customer` only. `packages/core` / `packages/db` read-only (cited, not edited).
- **Risk class:** trust-boundary / device-identity (high-risk class). No auth/billing/schema/migration surface touched.
- **Enumerated readers of `last_known_mac` / `accountMac`** (AC6 proof): ONLY `accountMac()` (`network-location.ts:156-163`), consumed ONLY by the `resolveMacForUser` fallback chain. `resolveCheckoutLocation` uses `resolveMac` (LIVE) + `customer_profile.last_network_id` (a DIFFERENT column) — it never reads `last_known_mac`. **Therefore the persistence change (AC5) cannot regress checkout attribution.** External non-internal reference to the column: schema def only (`packages/db/src/schema/customer.ts:88`).

## Design decisions (locked by INNOVATE below)

1. **Provenance = `live` boolean, returned from `resolveMacForUser`.** `live = true` iff `resolveMac(event)` returned non-null (portal cookie OR router IP→MAC). Device-cookie / `accountMac` / `lastKnownMac` tiers ⇒ `live = false`.
2. **Loop-break = gate on `live`, not force-regrant.** On `!live`, skip auto-bind (never push a possibly-wrong MAC) and report the device as unverified so the UX recovery lever (reconnect → fresh `?mac=` → live hit → correct MAC) can fire. Re-granting a wrong MAC would not self-correct, so it is explicitly rejected.
3. **Unverified UX trigger = `fallback + matching prior binding`** (`thisDeviceUnverified`), NOT bare "live failed" — prevents nagging correctly-online or never-bound users (AC4).
4. **Persistence (AC5) = seed-only-when-empty on the fallback path.** Keep `rememberAccountMac(userId, live)` on the LIVE branch. On the device-cookie branch, only write `last_known_mac` when it is currently NULL (do not overwrite an existing durable value with a fallback). Smallest change, no schema, no new column.

---

## Implementation Checklist

### Section A — provenance in `network-location.ts`
1. Change `resolveMacForUser` signature to return `{ mac: string | null; live: boolean }`:
   - live branch (`resolveMac` non-null): `await rememberAccountMac(userId, live)`; `return { mac: live, live: true }`.
   - device-cookie branch: seed durable MAC ONLY when currently empty (see step 2); `return { mac: device, live: false }`.
   - final fallback (`accountMac ?? lastKnownMac`): `return { mac: <that>, live: false }`.
2. Add a `seedOnlyIfEmpty` path for fallback persistence: either a new `seedAccountMac(userId, mac)` that updates only `WHERE last_known_mac IS NULL`, or a boolean param on `rememberAccountMac`. Do NOT overwrite an existing `last_known_mac` from a fallback source. `// ponytail:` reuse the existing update shape, just drop the `ne(...)` change-branch for the seed path.
3. Update `resolveMacTrusted` (`:87`) to `const { mac } = await resolveMacForUser(...)`.

### Section B — verified-aware account view (`account-view.ts`)
4. `shapeDevices(access, thisMac, cap, verified = true)`: compute `matched = list.some(d => d.thisDevice)`; set `thisDeviceBound = matched && verified`; add `thisDeviceUnverified = matched && !verified` to the returned object.
5. `buildAccountView(db, userId, thisMac, verified = true)`: forward `verified` to `shapeDevices`.

### Section C — dashboard server (`dashboard/+page.server.ts`)
6. `const { mac, live } = await resolveMacForUser(event, user.id);`
7. Gate the auto-bind block (`:70-85`) additionally on `live` (`if (access && !access.paused && mac && live && !blocked)`).
8. `const view = await buildAccountView(db, user.id, mac, live);`
9. Return `deviceVerified: live` in the payload (keep `mac`, `hasMac` for display). Update the diagnostic log line to include `live`.

### Section D — dashboard client (`dashboard/+page.svelte`)
10. Gate the client `thisDeviceBound` re-derive (`:53-54`) on `data.deviceVerified` — when `!deviceVerified`, do NOT let a mac-tail match assert bound; use `devices.thisDeviceUnverified` to drive the banner.
11. Render an "unverified" banner (reuse the `!hasMac` block at `:98-100`, copy: "We couldn't verify this device is connected. Reconnect through the WiFi portal to get back online.") shown when `access.active && devices.thisDeviceUnverified`. Ensure `thisOnline`/`needsConnect` reflect the unverified state (unverified ⇒ not `thisOnline`).

### Section E — mechanical caller updates
12. `+page.server.ts:42`, `top-up/+page.server.ts:40` & `:150`, `top-up/processing/+page.server.ts:61`, `dashboard signOut :340`: change to `const { mac } = await resolveMacForUser(...)`.

### Section F — tests
13. `network-location.spec.ts`: add cases — (a) portal-cookie/IP→MAC hit ⇒ `{ live: true }`; (b) all-live-miss + device cookie ⇒ `{ mac: <device>, live: false }`; (c) fallback path does NOT overwrite a populated `last_known_mac` (assert the update ran with the `IS NULL` guard / was not called with the change branch); (d) live hit still persists.
14. (If cheap) `account-view` unit: `verified = false` + matching device ⇒ `thisDeviceBound === false && thisDeviceUnverified === true`; `verified = true` ⇒ `thisDeviceBound === true`.

---

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `bunx vitest run src/lib/server/network-location.spec.ts` — provenance cases (13a,13b) | Fully-Automated | AC1, AC2 (fallback distinguished from live) |
| `network-location.spec.ts` — no-entrench case (13c) | Fully-Automated | AC5 |
| `network-location.spec.ts` — live-persist case (13d) | Fully-Automated | AC5 (live still persists) |
| `network-location.spec.ts` existing M-1/L-1 + checkout tiers still green | Fully-Automated | AC6, AC7 (no regression) |
| `account-view` verified-flag unit (14) | Fully-Automated | AC3, AC4 (bound vs unverified logic) |
| `bunx vitest run` (customer, full) + `bun run check` | Fully-Automated | Type-safety of signature change across all 6 callers |
| Manual browser: force fallback (clear portal cookie, wrong last_known_mac) → dashboard shows unverified banner; reconnect via portal → verified/online | Agent-Probe + human handoff | AC2, AC3 end-to-end (router-side, not unit-testable) |

Known-gaps (documented, not blockers): router lease/ARP repopulation timing; real client per-SSID MAC rotation; SSE stream + root `+page` keep connect-time MAC (default `verified=true`); explicit buy/grant not provenance-gated.

## Phase Completion Rules

Single-plan (not a phase program). Completion = all checklist items A–F done AND the Verification Evidence gates green (unit + `check` + `lint`) AND manual browser handoff (fallback→unverified→reconnect→verified) confirmed by the user. Code-only completion is `CODE DONE`, not `VERIFIED` — the router-side fallback→recovery path is only provable in-browser. Do not archive until the human verification handoff passes.

### Closing note (23-07-26)

Implemented and committed (`6aae41a`, 9 files). EVL green: 19 targeted + 118 server-suite tests,
`bun run check` 0 errors, scoped prettier clean on touched files (repo-wide 297-file prettier drift
is pre-existing, unrelated).

**Honest verification status:** the user attempted to reproduce the original stuck-grant bug this
session — every plan purchase succeeded in granting WiFi, confirming the core regression (AC1/AC2:
grants now reliably succeed) is fixed. The user could NOT force the specific live-IP→MAC-resolution
failure needed to exercise the new fallback→unverified-banner→reconnect UX path (AC3), so that path
remains proven by code + unit tests only, not a live repro. This was a pre-accepted known-gap in the
validate-contract (Layer 1 "Test coverage" CONCERN) — archiving as `CODE DONE` for the UX path and
`VERIFIED` for the core regression fix, not blocking on the unreproducible live case.

## Test Infra Improvement Notes

(none identified yet — `network-location.spec.ts` already mocks `resolveMac`/db; extend existing mock pattern. Confirm during VALIDATE test-coverage pass.)

## Resume and Execution Handoff

1. Selected plan: `process/general-plans/active/mac-trust-grant-fix_23-07-26/mac-trust-grant-fix_PLAN_23-07-26.md`
2. Last completed step: PLAN written; VALIDATE next.
3. Validate-contract status: pending (written by vc-validate-agent before EXECUTE).
4. Context loaded: `all-context.md`, `tests/all-tests.md`, `network-location.ts`, `dashboard/+page.server.ts`, `account-view.ts`, `dashboard/+page.svelte`, caller map.
5. Next step for a fresh agent: run VALIDATE (V1-V7), write the validate-contract, then PAUSE for EXECUTE approval. Do NOT edit source before approval.

## Validate Contract

- generated-by: outer-pvl
- date: 2026-07-23
- **Gate: CONDITIONAL** (0 FAIL / 3 CONCERN — all accepted with documented mitigations)
- Mode: Simple (self-contained plan, single package, <5 substantive files). High-risk class (trust-boundary) noted — for full parallel fan-out a separate `vc-validate-agent` spawn is available; FAST inline single-agent simulation used here.

### Layer 1 dimensions

| Dimension | Status | Finding |
|---|---|---|
| Infra fit | PASS | No container/port/runtime surface. `buildAccountView` gains an OPTIONAL `verified=true` param — SSE (`api/account/stream`) and root `+page` callers unchanged. |
| Test coverage | CONCERN | Provenance + no-entrench + view logic are unit-testable (pure/mocked). The real closed-loop recovery (router IP→MAC repopulation, reconnect→fresh `?mac=`→live hit) is router-side, not unit-testable → hybrid/agent-probe + human handoff. Accepted known-gap. |
| Breaking changes | CONCERN | `resolveMacForUser` return type `string\|null` → `{mac,live}` touches 6 call sites (all enumerated in Touchpoints). `bun run check` (svelte-check) is the mechanical backstop — a missed destructure fails the typecheck. No cross-package export. Accepted. |
| Security surface | PASS | Strictly tightens the device-identity trust boundary; does not weaken M-1/L-1 (server-authoritative `resolveMacTrusted` unchanged), M-2 shared-MAC, or rotation eviction. Stricter `thisDeviceBound` is an availability trade-off (a live blip may show unverified), not a security regression. |

### Layer 2 sections

| Section | Status | Note |
|---|---|---|
| A — network-location provenance + no-entrench | PASS | Edit targets unique & present; risk: keep `resolveMacTrusted` returning mac (internal destructure). Seed-only-when-empty reuses existing update shape. |
| B — account-view verified flag | PASS | `shapeDevices` is a pure function; optional param, additive `thisDeviceUnverified`. |
| C — dashboard server | PASS | Destructure + gate auto-bind on `live` + pass `verified` + return `deviceVerified`. |
| D — dashboard client (svelte) | CONCERN | Highest-risk edit: client `thisDeviceBound` re-derive (`:53-54`) must honor `deviceVerified`, and `thisOnline`/`needsConnect` must reflect unverified. Mitigation: reuse the existing `!hasMac` banner block (`:98-100`); human browser handoff verifies. |
| E — mechanical caller updates | PASS | 4 destructure-only sites. |
| F — tests | PASS | Extend existing `network-location.spec.ts` mock pattern; add pure `account-view` unit. |

**Totals: 0 FAILs / 3 CONCERNs / 6 PASSes → Net Gate: CONDITIONAL**

### Accepted concerns (proceed with these on record)
1. Router-side recovery path is not unit-provable — covered by manual browser handoff (fallback→unverified→reconnect→verified). Documented known-gap.
2. Return-type change requires all 6 callers updated — `bun run check` is the hard backstop; EXECUTE must run it green before done.
3. Client UI correctness (unverified state wiring) — verified by human handoff, not automated.

### Execute-Agent Instructions
- E1 (Section A): after changing `resolveMacForUser`'s return type, update ALL 6 call sites (Touchpoints table) in the same pass; run `bun run check` before declaring done — a red typecheck means a missed caller.
- E2 (Section A): the fallback (device-cookie) persistence must NOT overwrite a populated `last_known_mac`. Add an `IS NULL`-guarded seed path; do NOT reuse the change-branch (`ne(...)`) for fallback. Add the AC5 negative-control test (populated column → no overwrite).
- E3 (Section D): ensure `access.active && devices.thisDeviceUnverified` drives the reconnect banner AND suppresses `thisOnline`; do not let a mac-tail match assert bound when `!deviceVerified`.
- E4 (AC6 guard): do NOT touch `resolveCheckoutLocation` or `last_network_id`; confirm the existing checkout tier tests in `network-location.spec.ts` stay green (proves no attribution regression).
- E5: do NOT touch `sessions.ts:249-255` (cosmetic non-cause) or `sessions.ts:48` (rotation eviction).

### Test Gates
- `cd apps/customer && bunx vitest run src/lib/server/network-location.spec.ts` — provenance (live vs fallback), no-entrench (AC5), live-persist, existing M-1/L-1 + checkout tiers green.
- `cd apps/customer && bunx vitest run src/lib/server/account-view.spec.ts` — verified-flag bound/unverified logic (new file).
- `bun run check` — typecheck across all 6 updated callers (mechanical backstop for the return-type change).
- Scoped format: `bunx prettier --check` on touched files only (repo-wide `bun run lint` has known pre-existing 297-file prettier drift — do not gate on it).
- Manual browser handoff (Agent-Probe + human): force fallback (clear portal cookie + wrong `last_known_mac`) → dashboard shows unverified banner, not "connected"; reconnect via portal → verified/online.

### Known gaps (not blockers)
Router lease/ARP repopulation timing; real client per-SSID MAC rotation; SSE stream + root `+page` keep connect-time MAC (default `verified=true`); explicit buy/grant actions not provenance-gated (out of scope).

### Resume
Gate CONDITIONAL accepted → proceed to EXECUTE on explicit approval. EXECUTE = opus; single sequential agent (no fan-out — bounded single-package blast radius).
