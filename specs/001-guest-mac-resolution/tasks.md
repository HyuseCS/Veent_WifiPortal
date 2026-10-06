---
description: 'Tasks for guest MAC resolution behind the OLT relay (GH #114)'
---

# Tasks: Guest MAC Resolution Behind the OLT Relay

**Input**: `specs/001-guest-mac-resolution/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: Required. FR-017 and constitution IV: failing test first, then the fix, then live evidence.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: touches no file another open task in the same phase touches, no dependency on an open task
- **[Story]**: US1 = P1 diagnostic, US2 = P2 guard and fix
- "(user)" = the user runs it (VM, router, phone). Agents do not start servers or edit `.env`.
- Every finished task commits with exact paths. Never commit the VM full-IP edit.

---

## Phase 1: Setup

- [ ] T001 After the user merges PR #115 into `staging` on GitHub: `git fetch origin` then `git merge origin/staging` into `fix/olt-relay-mac-resolution` (no rebase). Brings in the #115 changes to `apps/customer/src/lib/server/network-location.ts` and `apps/customer/src/lib/server/network-location.spec.ts`. Run `bun run test` after the merge. Must be done before T009, T017 and the P1 deploy (T013).

---

## Phase 2: Foundational

None. US1 and US2 share no new code except files edited in order below.

---

## Phase 3: User Story 1 - Name the source of the wrong MAC (Priority: P1) MVP

**Goal**: one `[mac-diag]` line per MAC resolution names its source; one phone test names the source of `80:88`.

**Independent Test**: quickstart.md P1. Done when `notes.md` names a source for every `80:88` line.

### Tests for User Story 1 (write first, run, see them fail)

- [ ] T002 [P] [US1] FR-001, FR-002, FR-016a: new `packages/core/src/integrations/network/types.spec.ts`. `logMacSource('lease', 'F4:B7:8D:A6:80:88', '10.210.44.159')` writes exactly one `console.info` with `'[mac-diag]'` and `{ source: 'lease', mac: '**:**:**:**:80:88', ip: '10.210.*.*' }`. Null MAC and null IP give `null`. The masked-IP assertion is the guard that the committed code never prints a full IP.
- [ ] T003 [P] [US1] FR-001 (router tables): in `packages/core/src/integrations/network/mikrotik.spec.ts`, add `host`, `lease`, `arp` arrays to the `routerTable` mock and the `/ip/hotspot/host/print`, `/ip/dhcp-server/lease/print`, `/ip/arp/print` menus (filter with `filterByQuery`). Test `resolveMacByIp` writes one `[mac-diag]` line with source `hotspot-host`, `lease` or `arp` for a match in that table, and no line on a full miss.
- [ ] T004 [P] [US1] FR-001 (cache): new `packages/core/src/services/adminAccess.spec.ts`. With a fake `{ resolveMacByIp }` network, a second `resolveDeviceMac` call inside 60 s writes one `[mac-diag]` line with source `router-cache`. Use a unique IP and a `Date.now` spy (pattern: `apps/admin/src/lib/server/adminAccess.spec.ts`).
- [ ] T005 [P] [US1] FR-001, FR-004: in `apps/customer/src/lib/server/network-location.spec.ts`, mock `logMacSource` in the existing `@veent/core` mock and give test events a `url`. One `resolveMacForUser` call writes exactly one call with source: `redirect` (URL has `?mac=`), `portal-cookie` (portal context, no `?mac=`), `device-cookie`, `account`, `last-session`, `none`. A router hit writes no customer-side call.

### Implementation for User Story 1

- [ ] T006 [US1] Add exported `logMacSource(source, mac, ip)` to `packages/core/src/integrations/network/types.ts` per `contracts/core-mac-guard.md`. MAC mask: `/^(?:[0-9A-Fa-f]{2}:){4}/` → `'**:**:**:**:'`. IP mask: same rule as `maskIp` in `network-location.ts:24`. Makes T002 pass.
- [ ] T007 [US1] In `packages/core/src/integrations/network/mikrotik.ts` `resolveMacByIp` (`:554`), call `logMacSource` on each of the three matches with `hotspot-host`, `lease`, `arp` and the stripped IP. Makes T003 pass.
- [ ] T008 [US1] In `packages/core/src/services/adminAccess.ts` `resolveDeviceMac`, call `logMacSource('router-cache', …)` on the fresh cache hit (`:119`) and the stale fallback (`:144`). Makes T004 pass.
- [ ] T009 [US1] In `apps/customer/src/lib/server/network-location.ts`: `resolveMac` logs `redirect` when `event.url.searchParams.has('mac')`, else `portal-cookie`, on a portal hit; `resolveMacForUser` logs `device-cookie`, `account`, `last-session` or `none` at each return. IP = `event.getClientAddress().replace(/^::ffff:/, '')`. Depends on T001. Makes T005 pass.
- [ ] T010 [US1] Run `bun run check`, `bunx prettier --check .`, `bunx eslint .`, `bun run test`, `bun run build`. Commit T002-T009 paths (`test` + `feat` or one `chore(diag)` commit).
- [ ] T011 [US1] Write the exact one-line VM edit (a `sed -i` on `packages/core/src/integrations/network/types.ts` that makes `logMacSource` print the raw IP) into `specs/001-guest-mac-resolution/quickstart.md` step P1-3. Prove it on a scratch copy in the session scratchpad: `diff` shows one changed line. Commit `quickstart.md`.
- [ ] T012 [US1] (user) quickstart P1-1: router lease, ARP, host prints for `10.210.44.159`. Confirms the `src-mac-address` key and value (research R2).
- [ ] T013 [US1] (user) quickstart P1-2, P1-3: VM checkout plus the local full-IP edit, build, restart.
- [ ] T014 [US1] (user runs, agent reads logs) quickstart P1-4, P1-5: 4 dashboard and 4 checkout loads. Write `specs/001-guest-mac-resolution/notes.md` with: the named source(s) for every `80:88` line (FR-005, SC-001), the router facts from T012, and the proposed FR-014 fix. Log lines copied into notes keep only the test phone IP. Commit `notes.md`.

**Checkpoint**: the user confirms the FR-014 fix and that the `src-mac-address` rule holds. If the rule does not hold, stop and re-plan US2.

---

## Phase 4: User Story 2 - Never accept a relay MAC as a guest MAC (Priority: P2)

**Goal**: no path returns, saves or grants on a relay MAC; the named source is fixed.

**Independent Test**: unit tests T015-T019 and T026 green; quickstart P2 on the VM.

### Tests for User Story 2 (write first, run, see them fail)

- [ ] T015 [P] [US2] FR-006, FR-008, SC-002 (router tables): in `packages/core/src/integrations/network/mikrotik.spec.ts`: (a) `listDhcpLeases` maps `src-mac-address` to `srcMac` UPPERCASED, and empty or absent to `null`; (b) with a lease row `{ address: '10.210.44.159', 'mac-address': '2E:47:8F:2D:35:8F', 'src-mac-address': 'F4:B7:8D:A6:80:88' }` in the mock, put `F4:B7:8D:A6:80:88` in the hotspot host table, then the lease table, then the ARP table for a test IP, one case each, and assert `resolveDeviceMac(controller, ip)` from `../../services/adminAccess` returns `null`.
- [ ] T016 [P] [US2] FR-006, FR-007, FR-008, FR-013, FR-015: in `packages/core/src/services/adminAccess.spec.ts`: `dropRelayMac` returns `null` for a relay MAC in any case, the MAC for a normal one, `null` for empty; a lease with `srcMac === mac` or `srcMac: null` adds nothing; `listDhcpLeases` is called once per 5 min and once for parallel calls; a throwing, hanging (over 2.5 s) or missing `listDhcpLeases` passes the MAC and does not throw; `resolveDeviceMac` returns `null` for a relay router result after 1 attempt and does not cache it; `grantAdminAccess` with a relay MAC does not call `network.grant`, with a real MAC it does.
- [ ] T017 [P] [US2] FR-009, FR-010, FR-011, FR-012, FR-016b, SC-002: in `apps/customer/src/lib/server/network-location.spec.ts`, give the `$lib/server/network` mock a `listDhcpLeases` that returns one relayed lease (relay `F4:B7:8D:A6:80:88`). Cases: relay from `?mac=` and from the portal cookie is skipped and the router is asked; relay device cookie is skipped with no `seedAccountMac` update and the account MAC is used; relay account MAC falls to last-session; relay last-session gives `null`; `persistResolvedMac` and `rememberAccountMac` are never called with the relay; `resolveCheckoutLocation` with only relay sources never calls `resolveCircuitIdForMac` with the relay and ends in the existing fallback tiers. Depends on T001.
- [ ] T018 [P] [US2] FR-011: new `apps/customer/src/lib/server/portal.spec.ts`. `capturePortalContext` with `?mac=F4-B7-8D-A6-80-88` sets no cookie; with a normal MAC it sets `veent_portal` and `veent_device`. Mock `$lib/server/network` with the relayed lease.
- [ ] T019 [P] [US2] FR-009: new `apps/customer/src/routes/login/relay-mac.spec.ts` (pattern: `apps/customer/src/routes/api/network/grant/mac-trust.spec.ts`). The login default action with a relay portal MAC, or a relay device cookie, calls `enforceOtpSendLimit` with `mac` `undefined`; with a normal MAC it passes the MAC.

### Implementation for User Story 2

- [ ] T020 [US2] FR-006: add `srcMac?: string | null` to `DhcpLeaseEntry` in `packages/core/src/integrations/network/types.ts` ("RouterOS `src-mac-address`, UPPERCASED, empty → null"). Map it in `listDhcpLeases` in `packages/core/src/integrations/network/mikrotik.ts` (`:834`). Makes T015(a) pass.
- [ ] T021 [US2] FR-006, FR-007, FR-008, FR-013, FR-015: in `packages/core/src/services/adminAccess.ts` add exported `dropRelayMac(network, mac)` with the relay cache per `data-model.md` (5 min TTL, shared in-flight read, `withTimeout` 2.5 s, keep last set on error). In `resolveDeviceMac`, a relay result returns `null` at once, not cached. In `grantAdminAccess`, return without granting a relay MAC. Makes T015(b) and T016 pass.
- [ ] T022 [P] [US2] FR-009 to FR-012, FR-016b: in `apps/customer/src/lib/server/network-location.ts`, pass the portal MAC (`resolveMac`), the device cookie, `accountMac()` and `lastKnownMac()` results (`resolveMacForUser`) through `dropRelayMac(network, …)`. Writes stay fed only by guarded values. Depends on T021. Makes T017 pass.
- [ ] T023 [P] [US2] FR-011: make `capturePortalContext` in `apps/customer/src/lib/server/portal.ts` async; skip both cookie writes when `dropRelayMac(network, ctx.mac)` is `null`. `await` it in `apps/customer/src/hooks.server.ts:63`. Depends on T021. Makes T018 pass.
- [ ] T024 [P] [US2] FR-009: in `apps/customer/src/routes/login/+page.server.ts:43`, pass the MAC through `dropRelayMac(network, …)` (`?? undefined`). Depends on T021. Makes T019 pass.
- [ ] T025 [US2] Run all gates plus admin e2e (`bun run test:e2e` in `apps/admin/`). Commit T015-T024 paths.
- [ ] T026 [US2] FR-014 failing test. **PLACEHOLDER: filled after the T014 checkpoint.** File and assertion come from `notes.md` and the user's confirmed fix.
- [ ] T027 [US2] FR-014 fix. **PLACEHOLDER: filled after the T014 checkpoint.** Makes T026 pass. Gates, commit.
- [ ] T028 [US2] (user, agent reads logs and DB) quickstart P2-1 to P2-3: VM drops the local edit and pulls; 4 dashboard loads, 4 checkout loads, one payment; admin sign-in bypass check. Record evidence (SC-003, SC-004, FR-013) in `specs/001-guest-mac-resolution/notes.md`. Needs T001. Commit `notes.md`.

**Checkpoint**: SC-002, SC-003, SC-004 met.

---

## Phase 5: Polish

- [ ] T029 FR-016, SC-005: remove `logMacSource` and every call: `packages/core/src/integrations/network/types.ts`, `packages/core/src/integrations/network/mikrotik.ts`, `packages/core/src/services/adminAccess.ts`, `apps/customer/src/lib/server/network-location.ts`. Delete `packages/core/src/integrations/network/types.spec.ts`. Remove the P1 tests from T003, T004, T005 in `mikrotik.spec.ts`, `adminAccess.spec.ts`, `network-location.spec.ts`. `grep -rn "mac-diag\|logMacSource" apps packages --exclude-dir=node_modules` returns nothing. Gates, commit.
- [ ] T030 SC-006: run all gates and admin e2e on the final tree. User runs quickstart P2-4 on the VM. Hand off for the PR.

---

## Dependencies & Execution Order

- T001 before T009, T013, T017, T028.
- US1: T002-T005 in parallel → T006 → T007, T008 → T009 → T010 → T011 → T012, T013 → T014 → checkpoint.
- US2 tests T015-T019 can be written during US1 (different code), but T015 and T003 share `mikrotik.spec.ts`, T016 and T004 share `adminAccess.spec.ts`, T017 and T005 share `network-location.spec.ts`: do the US1 one first.
- T020 → T021 → T022, T023, T024 in parallel → T025.
- T026, T027 after the T014 checkpoint.
- T028 after T025 and T027. T029 after T028. T030 last.

## Parallel Example

```text
US1 tests: T002 (types.spec.ts), T003 (mikrotik.spec.ts), T004 (adminAccess.spec.ts), T005 (network-location.spec.ts)
US2 tests: T015, T016, T017, T018 (portal.spec.ts), T019 (login/relay-mac.spec.ts)
US2 build after T021: T022 (network-location.ts), T023 (portal.ts + hooks.server.ts), T024 (login/+page.server.ts)
```

## Implementation Strategy

1. MVP is US1 (T001-T014): it gives the source. Nothing in US2's FR-014 is written before it.
2. US2 guard (T015-T025) does not depend on the finding. It can be built while the user schedules the phone test.
3. FR-014 (T026, T027), live test (T028), diag removal (T029), final gates (T030).

## Out of Scope

- The admin sign-in log prints the raw IP (`apps/admin/src/lib/server/postLogin.ts:63,68`). SC-005 covers only the `[mac-diag]` lines. The user opens a separate issue.
