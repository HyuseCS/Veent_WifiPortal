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

**Constraints**: the router read is bounded to 2.5 s. A router outage must not fail a request (FR-015).

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
  `veent-admin` binding. Fail open on the relay set only (FR-015): with no set, behavior equals today.
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
- FR-014's fix depends on P1's finding and the user's confirmation. Tasks T026 and T027 are
  placeholders until then.

## Complexity Tracking

None.
