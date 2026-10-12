# 001 mask-admin-signin-log

What: The admin sign-in and logout bypass logs print the full client IP and device MAC. Mask them with the same `maskIp` and `maskMac` the customer app uses (GitHub #116). Path is auth/staff access, so high risk (constitution IV): failing tests first.
FRs: none (no spec.md for this feature; Fast lane chosen by the user)
Impact area: core runtime

## Decision for the gate
D1. Where do the helpers live?
- O1 (recommended): move `maskMac` and `maskIp` to `@veent/core`, import from admin and customer. One copy, no drift. Touches `apps/customer/` (needs your OK): delete lines 17-28 of `apps/customer/src/lib/server/network-location.ts`, import both from `@veent/core`, keep `export { maskMac }` because `apps/customer/src/routes/dashboard/+page.server.ts:21` imports it from there. Customer behavior must not change.
- O2: copy both into `apps/admin/src/lib/server/mask.ts`. No customer edit. Cost: two copies of PII code that can drift, and the next fix must be made twice.
The Files list below assumes O1. Under O2, replace the core and customer rows with the one admin file.

## Files
- packages/core/src/mask.ts (new) - `maskMac`, `maskIp` moved as-is from `apps/customer/src/lib/server/network-location.ts:17-28` (export both; `maskIp` is private there today)
- packages/core/src/index.ts - add `export * from './mask';`
- apps/admin/src/lib/server/postLogin.ts:63 - `ip=${maskIp(ip)} mac=${maskMac(mac)}`; line 68 - `ip=${maskIp(ip)}`; add both to the existing `@veent/core` import (line 2)
- apps/admin/src/lib/server/adminBypass.ts:90 - `mac=${maskMac(mac)}`; add import from `@veent/core`
- apps/customer/src/lib/server/network-location.ts:17-28 - remove local helpers, import from `@veent/core`, re-export `maskMac` (O1 only, needs your OK)
- apps/admin/src/lib/server/adminBypass.spec.ts:~46-50 - add `maskMac` to the `vi.mock('@veent/core', ...)` factory (it lists exports by hand, so the new import would fail every test in the file)

## Tests (written first, must fail before the build)
- apps/admin/src/lib/server/adminBypass.spec.ts - new case: store MAC `AA:BB:CC:DD:35:8F` for a session, call `revokeAdminBypass`, assert the `log.info` message contains `**:**:**:**:35:8F` and not `AA:BB:CC:DD`. Needs the logger mock to expose a shared `info` spy (today `vi.fn()` is created inline and cannot be read). Fails now: message holds the full MAC. - `cd apps/admin && bunx vitest run src/lib/server/adminBypass.spec.ts`
- apps/admin/src/lib/server/postLogin.spec.ts (new) - call `finishStaffSignIn` with `grantDevice: true`, `getClientAddress` returning `::ffff:10.210.4.7`, mocked `resolveDeviceMac`. Case 1 (MAC found): `log.info` message has `10.210.*.*` and `**:**:**:**:35:8F`, and has no `10.210.4.7` and no full MAC. Case 2 (no MAC): `log.warn` message has `10.210.*.*`, no `10.210.4.7`. Mock `getStaffStatus` active, `$lib/server/{auth,db,network,logger,adminBypass}`. Fails now: both lines print raw values. - `cd apps/admin && bunx vitest run src/lib/server/postLogin.spec.ts`
- packages/core/src/mask.test.ts (new, O1 only) - port of the helper behavior: MAC keeps last two octets, null/empty pass through, IPv4 keeps /16, IPv6 masks the tail, `::ffff:10.210.4.7` is not left raw. Fails now: module does not exist. - `cd packages/core && bunx vitest run src/mask.test.ts`
- Customer: no existing test for the helpers found. After O1, run `bun run check` and `bun run test` at the root to prove customer still builds.

Gates after the build: `bun run check`, `bunx prettier --check .`, `bunx eslint .`, `bun run test`, `bun run build`.

## Live check on the VM
1. Deploy the branch, then sign in to admin from a device on the hotspot (with 2FA, since the grant only runs after 2FA).
2. `docker compose logs admin | grep 'admin bypass'` must show `[sign-in] admin bypass granted: ip=10.210.*.* mac=**:**:**:**:XX:XX`. No full octets.
3. Sign out, run the grep again: `[admin-bypass] admin bypass revoked on logout: mac=**:**:**:**:XX:XX`.
4. Optional negative case: sign in from a device off the hotspot, expect `admin bypass skipped — no MAC for client ip=<masked>`.
5. Also `docker compose logs admin | grep -E '([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}'` returns no line from the admin sign-in or logout.

## Other raw IP/MAC log lines found
- None in admin or core besides the three in this plan.
- `packages/core/src/services/sessions.ts:1019` logs only the user id, no MAC (safe).
- `apps/admin/src/lib/server/rateLimit.ts:14` `clientIp()` is used only as a rate-limit key, never logged (checked all callers).
- `apps/admin/scripts/setup-router.ts:208,236,432` print router and portal IPs from config at setup time. These are infrastructure addresses, not client addresses. Left alone.
- Sentry path: `log.error` is not touched; the error calls on these paths pass no IP/MAC.

## Risks
- R1. `adminBypass.spec.ts` mocks `@veent/core` with a fixed list. The new import breaks it unless the mock is updated (listed in Files).
- R2. `maskIp('::ffff:10.210.4.7')` returns `::*:10.210.4.7`: the v4 regex fails and the fallback masks `ffff`, so the full IP stays visible. `getClientAddress()` returns this form on a dual-stack listener (`adminAccess.spec.ts:56`), and `postLogin.ts:55` logs it before any normalizing. Fix: strip `^::ffff:` first in `maskIp` (same as `rateLimit.ts:15`). Customer output changes only for mapped addresses. Open for you: accept this tweak. Without it the fix does not work for the likely real input. The `mask.test.ts` and `postLogin.spec.ts` cases must use a `::ffff:` input to fail first.
- R3. Under O1 the customer app changes. Behavior must stay identical except R2.
