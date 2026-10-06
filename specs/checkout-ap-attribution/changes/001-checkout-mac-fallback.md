# 001 checkout-mac-fallback

What: `resolveCheckoutLocation` gets its MAC from `resolveMacForUser(event, userId).mac` instead of `resolveMac(event)`. When the hotspot NAT hides the device (no portal cookie, IP→MAC null), the device-cookie / account MAC / last-session MAC still feeds the circuit-id tier, so checkout stores the physical AP (`ap_circuit_id`, `ap_name_snapshot`) instead of falling to `last-known` with nulls. GH #97 follow-up.
FRs: none. No spec.md exists (feature predates Stratum). Source history (frozen, read-only):

- process/general-plans/backlog/maya-checkout-ap-attribution-interface-not-physical_NOTE_22-07-26.md
- process/general-plans/completed/purchase-ap-attribution_21-07-26/ (PLAN, SPEC)
- process/general-plans/completed/tx-ap-name-snapshot_22-07-26/ (SPEC)
  Impact area: core runtime (payment location attribution; high-risk path per constitution IV, test first)

Live evidence (2026-10-06): newest payment*checkouts row has network_id=4, ap_circuit_id NULL, ap_name_snapshot NULL. Log shows `[mac] unresolved` x3 (ip 10.210.*.\_) then `[topup] AP resolved { via: 'last-known' }`. The dashboard on the same phone resolved the MAC through `resolveMacForUser`. network_health id 4 = OAP3000G-FC6G, circuit 'OLT-9 xpon 0/1/0/4:16.3.70'.

## Decisions

- D1 `mac` use 1, circuit-id tier (`resolveCircuitIdForMac`): fallback MAC is right. It is the fix. A cache miss or no matching AP row falls through as today.
- D2 `mac` use 2, `device-mac` tier (`network.resolveApForMac`): same variable, so it also gets the fallback MAC. Acceptable. The router answers by the MAC's current registration, so a stale MAC gives null and falls through to the active-session and last-known tiers. No code split needed.
- D3 Side effects of `resolveMacForUser`: `rememberAccountMac` (live MAC only) and `seedAccountMac` (only when `last_known_mac IS NULL`) write `customer_profile.last_known_mac`. Both are best-effort and try/catch wrapped, and the dashboard already calls them on every load. Checkout adds no new kind of write and the no-entrench guard stays in SQL. Acceptable.
- D4 Trust: a fallback MAC is not a verified binding (constitution V). Here it only labels payment location. It grants no access, adds no credit, and moves no money. `live` is ignored. Credits still follow the webhook re-check (IV).
- D5 No new call to `resolveMac` is lost: `resolveMacForUser` calls it first, so portal cookie then IP→MAC order is unchanged.

## Files

- apps/customer/src/lib/server/network-location.ts - in `resolveCheckoutLocation`, replace `const mac = await resolveMac(event);` with `const { mac } = await resolveMacForUser(event, userId);`. Update the doc comment tier 2 ("portal cookie or IP→MAC" to add the per-user fallbacks).

## Tests (written first, must fail before the build)

- apps/customer/src/lib/server/network-location.spec.ts - new `it` in "circuit-id beats interface-name (physical AP)": `getPortalContext` returns `{}`, `getDeviceMac` returns undefined, IP→MAC null. Queue: `[{ mac }]` (accountMac), then `[{ circuitId: CID }]` (resolveCircuitIdForMac cache), then `[{ id: 4, name: 'OAP3000G-FC6G', displayName: null }]` (apRowForCircuitId). Expect `{ networkId: 4, apCircuitId: CID, apNameSnapshot: 'OAP3000G-FC6G' }`, `resolveNetworkIdByApName` not called, and the `via: 'device-circuit-id'` log (spy on `console.info`). Fails now because `resolveMac` returns null and the tier is skipped. - `cd /home/hyuse/Desktop/VeentApps/veent_wifiportal/apps/customer && bunx vitest run src/lib/server/network-location.spec.ts`
- Same file, second new `it`: no cookie, device-cookie MAC, `lastKnownMac` path (accountMac empty, session MAC present) reaches the circuit-id tier. Optional if the first covers it. Keep only if cheap.
- Same file, existing tests that use `getPortalContext` returning `{}` with no MAC (tier 3 active-session, fully unresolved, ~lines 136-151): `resolveMacForUser` now consumes two extra `selectQueue` reads (accountMac, lastKnownMac) before the active-session query. Push two `[]` first in those tests. This is a queue fix, not a behavior change. These tests turn red after the build if not fixed.

Gates after build: `bun run check`, `bunx prettier --check .`, `bunx eslint .`, `bun run test`. Live check on the staged VM phone: one top-up, then the newest payment_checkouts row has `ap_circuit_id` and `ap_name_snapshot` set, and the log shows `via: 'device-circuit-id'`.

## Risks

- R1 Stale fallback MAC (user changed phone, no reconnect): checkout is attributed to the old device's AP, or falls through. Attribution only, no money or access effect.
- R2 `resolveMac` warning still logs `[mac] unresolved` when the NAT hides the device. Expected, not a regression.
- R3 Two extra DB reads (accountMac, lastKnownMac) per checkout when live detection misses. Small.
- R4 Only caller is apps/customer/src/routes/top-up/+page.server.ts. Same intent (attribution), no edit needed there.
