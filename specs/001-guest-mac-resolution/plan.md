# Implementation Plan: Guest MAC Resolution Behind the OLT Relay

**Branch**: `fix/olt-relay-mac-resolution` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-guest-mac-resolution/spec.md` (GH #114)

## Summary

P1 adds one temporary `[mac-diag]` log line per MAC resolution, through one core helper. The
committed helper masks the IP. The staged VM gets a one-line uncommitted edit that prints the raw IP.
One phone test names the source of the relay MAC.

P2 adds one core guard, `dropRelayMac`. It reads relay MACs from the DHCP lease table (lease
`src-mac-address` that differs from the lease MAC), caches them for 5 minutes, and drops a relay MAC
to "no MAC". The guard sits at the existing chokepoints: core `resolveDeviceMac` and
`grantAdminAccess`, customer `resolveMac` / `resolveMacForUser`, `capturePortalContext`, and the login
action. Then the source named in P1 is fixed (FR-014, placeholder until P1 ends) and the diagnostic
is removed.

## Technical Context

**Language/Version**: TypeScript, bun runtime, SvelteKit 2 / Svelte 5

**Primary Dependencies**: `@veent/core` network controller, `node-routeros` ^1.6.9 (RouterOS v6 API), drizzle-orm

**Storage**: PostgreSQL. No schema change.

**Testing**: vitest (`bun run test`), Playwright admin e2e (`apps/admin`, `bun run test:e2e`)

**Target Platform**: Linux server (staged VM), MikroTik RouterOS v6 hotspot behind a Huawei OLT

**Project Type**: bun workspace web apps (`apps/customer`, `apps/admin`) plus `packages/core`

**Performance Goals**: at most one extra lease-table read per 5 minutes per app process

**Constraints**: the relay read is bounded to 2.5 s, raised if T013's live measurement needs it. A router outage must not fail a request (FR-015).

**Scale/Scope**: 8 files of product code, about 6 test files. One VM, one test phone.

## Constitution Check

| Rule                            | Status                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Admin scope first            | Pass. The user asked for `apps/customer` work (GH #114). Core changes are shared; admin code is untouched but admin e2e runs.                                                                                   |
| II. One schema                  | Pass. No schema change.                                                                                                                                                                                         |
| III. Auth isolation             | Pass. No auth instance change. Apps share the guard only through `@veent/core`.                                                                                                                                 |
| IV. High-risk paths             | Applies: WiFi grant binding, admin bypass, payment attribution. Every guard task has a failing test first, then the fix, then a live check (tasks). Payment confirmation and credits are not touched (FR-016c). |
| V. Captive portal verified live | Applies to the CNA / `?mac=` capture change. P2 live test runs on the real phone. `?mac=` stays a fallback, not a verified binding. No walled-garden or router config change.                                   |
| VI. Simplicity                  | Pass. One core guard function, one temporary log helper, no config.                                                                                                                                             |
| Env / servers                   | Agents do not edit `.env` or start servers. VM steps are the user's.                                                                                                                                            |
| Git                             | Each finished task commits with exact paths. The full-IP edit is never committed (FR-016a).                                                                                                                     |

Post-design re-check: pass. No violations, so no Complexity Tracking rows.

## Security Notes

- S1 Access binding and grants (`network-location.ts`, `portal.ts`, `login/+page.server.ts`): the
  guard only removes a value. It never adds a MAC, so it cannot bind a device that was not bound
  before. Two OLT guests can no longer share the relay MAC. `?mac=` stays client-influenceable.
- S2 Admin bypass (`adminAccess.ts` `resolveDeviceMac`, `grantAdminAccess`): a relay MAC never gets a
  `veent-admin` binding. FR-015 is fail open, keep the last set: on a read error the last loaded
  relay set is used; with no set loaded, behavior equals today. The request never fails.
- S3 Personal data in logs (`types.ts` `logMacSource`): MAC masked to two octets. Full IP exists only
  as an uncommitted edit on the staged VM (no real users). P2 deletes the helper (FR-016, SC-005).
  Notes in `notes.md` record only the test phone IP, which is already in the spec.
- S4 External service (RouterOS API): one extra full lease print per 5 minutes, read only, 2.5 s
  timeout, never throws.
- S5 Payments: only the MAC used for access point attribution changes. With no valid MAC, checkout
  keeps today's fallback tiers (FR-016b). Webhook, credit and confirmation code is not touched
  (FR-016c).
- No secrets, no minors' data, no contract change for external users.

## Project Structure

### Documentation (this feature)

```text
specs/001-guest-mac-resolution/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/core-mac-guard.md
├── notes.md          # written in P1 (FR-005)
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── integrations/network/
│   ├── types.ts            # DhcpLeaseEntry.srcMac; logMacSource (P1, removed in P2)
│   ├── types.spec.ts       # new, P1 log helper test (removed in P2)
│   ├── mikrotik.ts         # listDhcpLeases maps src-mac-address; resolveMacByIp diag (P1)
│   └── mikrotik.spec.ts
└── services/
    ├── adminAccess.ts      # dropRelayMac + relay cache; guards in resolveDeviceMac, grantAdminAccess
    └── adminAccess.spec.ts # new

apps/customer/src/
├── hooks.server.ts                     # await capturePortalContext
├── lib/server/network-location.ts      # guard portal/device/account/last-session; diag (P1)
├── lib/server/network-location.spec.ts
├── lib/server/portal.ts                # capturePortalContext async + guard
├── lib/server/portal.spec.ts           # new
├── routes/login/+page.server.ts        # guard OTP MAC
└── routes/login/relay-mac.spec.ts      # new
```

**Structure Decision**: existing bun workspace. The guard lives in `packages/core` (FR-007).

## Dependencies

- PR #115 (`fix/checkout-mac-fallback-ap-attribution`, checkout uses `resolveMacForUser`) is not in
  `staging` and not in this branch. SC-004 needs it. P1's checkout `none` line also needs it
  (research R6). Decided: the user merges #115 into `staging` on GitHub, then task T001 merges
  `staging` into this branch before the P1 deploy.
- Live evidence narrows the source to a live one (redirect `?mac=`, portal cookie, or router lookup);
  see research R1.
- Out of scope: the admin sign-in log prints the raw IP (`apps/admin/src/lib/server/postLogin.ts:63,68`).
  SC-005 covers only the `[mac-diag]` lines. The user opens a separate issue.
- FR-014's fix depends on P1's finding and the user's confirmation. Tasks T027 and T028 are
  placeholders until then.

## Complexity Tracking

No constitution violations.

Accepted risks:

- FR-014 placeholders T027 and T028 are a deliberate gate: they are filled only after P1 names the source and the user confirms the fix.
- Validate F5: a relay MAC from the hotspot host table makes the router lookup return null without trying the lease table, and a `macByIpCache` entry made before the relay set loads can be served for up to 5 min.

Task IDs in the Validate section below are the IDs before renumbering. Since then a new T013 (lease print timing) was added and the old T013-T030 became T014-T031.

## Validate

Date: 2026-10-06. Verdict: CONDITIONAL

| Check                 | Verdict | Findings                                                                                                                                                                                                                                          |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup and deps        | CONCERN | vitest ^4.1.8 in core/customer/admin, node-routeros ^1.6.9, Playwright browsers present. Baseline `bun run test` green (core 126, customer 146, admin 167, locator 6). PR #115 not in `origin/staging` (bdcf133) yet (F6). API key unproven (F2). |
| Test coverage per req | CONCERN | Every FR has a named task. Relay cache test isolation not planned (F1). FR-015 text and design disagree (F3). Router-table relay drops the lookup instead of the next table (F5). Direct send-otp path unguarded (F4).                            |
| Breaking changes      | PASS    | `capturePortalContext` has one caller (`hooks.server.ts:63`), awaited by T023. No schema, contract or stored-data change. Existing tests keep passing: their fakes have no `listDhcpLeases`, so the guard fails open to today's result (F7).      |
| Security and privacy  | PASS    | Guard only removes a MAC. Full-IP log is an uncommitted VM edit with a grep gate in T029. No secrets. Admin bypass covered by T016.                                                                                                               |

F1. `data-model.md` Relay MAC set, tasks T015/T016/T017. The relay set is module-global, lives 5 min and keeps the last set on error. In one spec file, a case that loads the relay set makes a later "throwing / missing `listDhcpLeases` passes the MAC" case return `null`, and "called once per 5 min" counts leak across cases. -> In T016 (and T015, T017 where order matters) use `vi.resetModules()` plus a dynamic `await import(...)` per case, or a `Date.now` spy that moves past 5 min. No test-only reset export in product code.

F2. `quickstart.md` P1-1, T012. The 2026-10-06 CLI print proves the lease field and value (`src-mac-address=F4:B7:8D:A6:80:88` on the AP lease `E4:67:1E:B6:FC:60` and both phones). The API key is very likely the same: the code already reads CLI-named keys through the API (`mac-address`, `host-name`, `agent-circuit-id` at `mikrotik.ts:75`). But P1-1 is a CLI step, so it cannot prove the API key. If the key differs, the set stays empty, every guard silently no-ops, and the unit tests (fed the assumed key) stay green. -> Add a live negative control to P2: in a fresh browser on the test phone, open `/dashboard?mac=F4-B7-8D-A6-80-88` and confirm the page does not show `80:88` and no `veent_portal` / `veent_device` cookie holds it. Mark P1-1's key check as done by the CLI evidence.

F3. `spec.md:137` FR-015 vs `data-model.md` Failure rule and T016. The design is fail-open everywhere: with no relay set, `dropRelayMac` passes the MAC, the router lookup included. FR-015 says the router lookup then returns no MAC. The two match only when the lease read and the IP lookup fail together. They split when the unfiltered lease print exceeds 2.5 s while the filtered `?address=` lookup succeeds. Then the set never loads and the guard never acts. The 2.5 s was not measured for a full lease print. -> User decides: (a) change FR-015 to "fail open, keep last set" (recommended, matches the design), or (b) make `resolveDeviceMac` return null when the set was never loaded. In both cases, measure a full lease print time on the router before you keep 2.5 s.

F4. `apps/customer/src/lib/server/auth.ts:97`. The better-auth `sendOTP` hook passes `getPortalContext(ev)?.mac` to `enforceOtpSendLimit` when a client POSTs straight to `/api/auth/phone-number/send-otp`. It is not in T024. Effect: a relay MAC becomes the per-MAC rate key, so all OLT guests share one send cap on that path only. Form paths are covered (`login/+page.server.ts:43` by T024; `auth/verify/+page.server.ts:55,91` read `pending.mac`, which T024 feeds). -> Add the same `dropRelayMac` line to T024, or accept it as low risk. User decides.

F5. `contracts/core-mac-guard.md` `resolveDeviceMac`, T021. The guard runs after `resolveMacByIp` (`mikrotik.ts:554`) returns. A relay MAC from the hotspot host table makes the lookup return null and skips the lease table, which holds the real MAC. Spec US2 scenario 1 says "tries the next normal fallback". FR-008 only requires "not returned". Also, a MAC cached in `macByIpCache` (`adminAccess.ts:119`, `:144`) before the relay set loaded is served for up to 5 min. -> Accept (ARP is the table that lists the relay and it is checked last), or check each table against the set inside `resolveMacByIp`. No user decision needed if accepted.

F6. T001. `origin/staging` is still `bdcf133`, so PR #115 is not merged. T009, T017, T013 and T028 are blocked until the user merges it. -> User merges #115, then T001 runs.

F7. Callers checked, no break. `resolveDeviceMac`: `network-location.ts:47`, `postLogin.ts:56`. `grantAdminAccess`: `postLogin.ts:58`, `adminBypass.ts:68` (its spec mocks it). `resolveMac`: `network-location.ts:135,324`. `resolveMacForUser`: `+page.server.ts:42`, `dashboard/+page.server.ts:53,354`, `top-up/+page.server.ts:40,153`, `top-up/processing/+page.server.ts:61`, `network-location.ts:87`. `capturePortalContext`: `hooks.server.ts:63` only. `network-location.spec.ts:53` spreads the real `@veent/core` and mocks `network` as `{}`, so the real `dropRelayMac` runs and passes MACs through. `apps/admin/src/lib/server/adminAccess.spec.ts` fakes are `{ resolveMacByIp }` only, so the same applies. T023 adds up to 2.5 s to the hook on a set-cache miss for `?mac=` requests, once per 5 min per process. -> None.

Not verified: the RouterOS API key name (needs the router, F2). Full lease print time (needs the router, F3). Admin e2e was not run (needs the dev DB and server, which the user starts).
