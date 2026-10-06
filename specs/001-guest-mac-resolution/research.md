# Research: Guest MAC Resolution Behind the OLT Relay

All findings are from the code on branch `fix/olt-relay-mac-resolution` (off `staging` bdcf133).

## R1. Where MAC resolution happens today

- Decision: guard the existing chokepoints. Do not add a new resolution layer.
- Facts:
  - Customer: `resolveMac` (`apps/customer/src/lib/server/network-location.ts:38`) reads the portal
    context (`?mac=` query, then `veent_portal` cookie), then the router via core `resolveDeviceMac`.
    `resolveMacForUser` (`:131`) adds the device cookie, the account MAC and the last-session MAC.
    `resolveMacTrusted` (`:82`) wraps `resolveMacForUser`.
  - Callers of `resolveMacForUser` / `resolveMacTrusted`: `routes/+page.server.ts:42`,
    `routes/dashboard/+page.server.ts:53,158,192,251,354`, `routes/top-up/+page.server.ts:40,153`,
    `routes/top-up/processing/+page.server.ts:61`, `routes/api/network/grant/+server.ts:52`.
  - Checkout attribution `resolveCheckoutLocation` (`network-location.ts:323-324`) calls `resolveMac`
    directly on this branch. PR #115 changes it to `resolveMacForUser`.
  - Live evidence (2026-10-06): the VM already ran the #115 line (applied by `sed`, customer image
    rebuilt) before the phone tests at 04:28 and 05:18 UTC. Both still logged `80:88`, with no
    `[mac] unresolved` warning, and the dashboard logged `live=true` for `80:88`. So the relay MAC
    came from a live source in `resolveMac`: the redirect `?mac=`, the portal cookie, or the router
    lookup. It did not come from the device cookie, the account MAC or the last-session MAC. P1
    narrows it to one of these three.
  - Cookie writes: `capturePortalContext` (`portal.ts:84`, called from `hooks.server.ts:63` on every
    request with `?mac=`) writes `veent_portal` and `veent_device`. `persistResolvedMac` (`portal.ts:131`)
    writes both after a router hit.
  - Account writes: `rememberAccountMac` (live MAC) and `seedAccountMac` (device-cookie MAC) in
    `network-location.ts`.
  - Other raw reads: `routes/login/+page.server.ts:43` (portal MAC or device cookie, used for the OTP
    send limit and carried into the pending cookie, then `/dashboard?mac=` after verify) and
    `lib/server/auth.ts:97` (direct `send-otp` POST only; form actions set `otpLimitEnforced`).
  - Admin: `apps/admin/src/lib/server/postLogin.ts:56` calls core `resolveDeviceMac`, then
    `grantAdminAccess`. `adminBypass.ts:68` re-grants the stored MAC through `grantAdminAccess`.
  - Core router lookup: `mikrotik.ts:554` `resolveMacByIp` tries hotspot host, then lease, then ARP.
    Its only caller is `resolveDeviceMac` (`adminAccess.ts:106`).

## R2. Relay MAC detection (FR-006)

- Decision: a relay MAC is `srcMac` of any lease where `srcMac` is set and differs from the lease
  `mac`. Read from `listDhcpLeases`. Add `srcMac?: string | null` to `DhcpLeaseEntry`, mapped from the
  RouterOS lease field `src-mac-address` (uppercased, empty to null).
- Rationale: on a relayed lease the DHCP packet comes from the relay, so the source MAC is the relay
  and `mac-address` is the client. On a direct (bridged) lease both are equal. No config list.
- Today `listDhcpLeases` (`mikrotik.ts:834`) does NOT expose `src-mac-address`. It maps only
  `mac-address`, `address`, `host-name`, `agent-circuit-id`, `status`.
- Not verified: the field key `src-mac-address` on the live RouterOS v6 router, and that its value on
  relayed leases is `F4:B7:8D:A6:80:88`. The 2026-10-06 CLI print proves the field and value (T012).
  The API key is proven live by the negative check in T029 (quickstart P2-4). Same pattern as the
  unverified `DHCP_OPTION82_CIRCUIT_KEY` (`mikrotik.ts:75`).
- Alternatives: config list of relay MACs (rejected by FR-006); per-IP check inside
  `resolveMacByIp` only (does not cover saved cookies or the account row).

## R3. Cost of the relay set

- Decision: one module-level cache in `adminAccess.ts`, refreshed at most every 5 minutes. The
  in-flight promise is cached so parallel requests share one lease read. The read is bounded with
  the existing `withTimeout` (2.5 s). On error or a controller without `listDhcpLeases`, keep the
  last set (empty at boot) and wait for the next TTL.
- Rationale: relay MACs change almost never. A stale set is harmless (a relay MAC never becomes a
  guest MAC). Worst case is one 2.5 s stall per 5 minutes during a router outage. The health cron's
  lease read runs in a different job, so it cannot feed this cache.
- FR-015 (fail open, keep the last set): on a read error or timeout the last loaded set is used.
  With no set loaded, every MAC passes, the router lookup result included.
- The 2.5 s timeout is not measured for a full lease print. Task T013 times it on the live router.
  If needed, T022 raises the timeout.

## R4. Where the router-lookup guard goes (FR-008)

- Decision: guard the result in core `resolveDeviceMac`, the only caller of `resolveMacByIp`. A relay
  result returns null at once (no retry, not cached).
- Rationale: one guard covers all three tables and both apps. The ARP table is the table known to
  hold the relay MAC, and it is the last table, so "stop" and "try the next table" give the same
  result. Accepted: a relay MAC from the hotspot host table returns null without trying the lease
  table, and a `macByIpCache` entry made before the set loads can be served for up to 5 min. Spec acceptance 2 only needs "do not return".

## R5. Admin bypass guard (FR-013)

- Decision: guard in `resolveDeviceMac` (sign-in path) and in `grantAdminAccess` (covers the MAC that
  `adminBypass.ts` stored before this fix and re-grants on activity).

## R6. Diagnostic log for P1 (FR-001 to FR-004)

- Decision: one temporary core helper `logMacSource(source, mac, ip)` in
  `packages/core/src/integrations/network/types.ts` (exported through `@veent/core`). It writes
  `console.info('[mac-diag]', { source, mac, ip })`, MAC masked to the last two octets.
- Call sites, chosen so each resolution writes exactly one `[mac-diag]` line:
  - `mikrotik.ts` `resolveMacByIp`: on a match, source `hotspot-host`, `lease` or `arp`. No line on a
    miss (the retries in `resolveDeviceMac` would print three lines).
  - `adminAccess.ts` `resolveDeviceMac`: on a cache hit (fresh or stale), source `router-cache`. The
    table is on the earlier line for the same IP. This name is added to the FR-001 list because the
    60 s IP cache skips the router.
  - `network-location.ts` `resolveMac`: portal hit, source `redirect` when the request URL has `mac`,
    else `portal-cookie`. No line on the router path.
  - `network-location.ts` `resolveMacForUser`: `device-cookie`, `account`, `last-session`, or `none`.
- Gap: on this branch, checkout calls `resolveMac`, so a checkout with no portal MAC and no router hit
  writes no `none` line. Task T001 merges PR #115 (through `staging`) before the P1 deploy, so
  checkout goes through `resolveMacForUser` and the gap is gone.
- Admin sign-in miss already logs `admin bypass skipped — no MAC for client ip=...`.

## R7. Keeping the full-IP log off staging (FR-003, FR-016a)

- Decision: the committed helper masks the IP as `maskIp` does today (`/16`). The staged VM gets a
  one-line local, uncommitted edit in `logMacSource` that prints the raw IP. P2 removes the helper.
- Rationale: the full-IP code is in no commit, so neither the branch history nor the merge commit on
  `staging` holds it (the repo merges PRs with merge commits, so a "revert before PR" commit would
  still put it in `staging` history). One edit point because every diag line goes through one helper.
- Alternatives: env flag (the full-IP path would ship in code); separate commit reverted before PR
  (history reaches `staging`).

## R8. Tests

- Core: vitest (`packages/core`, `bun run test`). `mikrotik.spec.ts` mocks `node-routeros` with a menu
  switch (`mikrotik.spec.ts:68`); add `lease`, `host`, `arp` menus. `adminAccess` has no core spec;
  `apps/admin/src/lib/server/adminAccess.spec.ts` tests core `resolveDeviceMac` through `@veent/core`.
  New core tests go in `packages/core/src/services/adminAccess.spec.ts`.
- Customer: `network-location.spec.ts` mocks `$lib/server/network` as `{}` and `$lib/server/portal`.
  Relay tests give the network mock a `listDhcpLeases` that returns one relayed lease, so the real
  core guard runs.
- Module caches (`macByIpCache`, relay cache) persist across tests. Use distinct IPs and a `Date.now`
  spy, as the existing admin spec does.
