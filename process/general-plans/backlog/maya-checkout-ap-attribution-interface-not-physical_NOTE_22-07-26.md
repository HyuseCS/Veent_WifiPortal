---
name: note:maya-checkout-ap-attribution-interface-not-physical
description: "Maya payments attribute to the shared hotspot interface (bridge1_WiFi_Project) instead of the physical AP, because checkout resolves by interface-name while grants resolve by Option 82 circuit-id. Diagnosed 22-07-26, fix deferred."
date: 22-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# Maya checkout attributes to the shared bridge, not the physical AP

> **Status: RESOLVED 22-07-26.** Fixed in `apps/customer/src/lib/server/network-location.ts`:
> `resolveCheckoutLocation` now resolves the device's Option 82 circuit-id FIRST
> (`resolveCircuitIdForMac` → new `apRowForCircuitId` helper → physical AP row), before the
> interface-name `?ap=`/`resolveApForMac` tiers. So a Maya checkout on a shared hotspot bridge now
> attributes to the real physical AP (network_id + ap_circuit_id + ap_name_snapshot), matching the
> grant path. Falls back to the interface tiers when no circuit-id resolves (prior behavior). Tests:
> `network-location.spec.ts` "circuit-id beats interface-name (physical AP)". Existing (pre-fix) rows
> keep their old interface attribution — no backfill. Original diagnosis retained below for the record.

## Symptom (live-observed 22-07-26)

For the same guest session, the two transaction sources disagree on which AP the activity happened on:

- **Maya payment** → `network_id = 11`, `ap_circuit_id = NULL`, `ap_name_snapshot = "bridge1_WiFi_Project"`
- **Credit spend (grant)** → `ap_circuit_id = "OLT-9 xpon 0/1/0/4:16.3.70"`, `ap_name_snapshot = "AP-RENAMED2"` (the real physical AP)

So topups (Maya) show the shared bridge; only when the guest *spends* credits to buy a plan does the
real physical AP appear.

## Root cause

The deployment has multiple physical APs (`OAP3000G-*`) behind ONE shared hotspot bridge
(`bridge1_WiFi_Project`, a `network_health` **interface** row: `attribution_source = NULL`, no MAC, no
circuit-id). The router sees every guest on that one hotspot interface; only the **DHCP Option 82
agent-circuit-id** distinguishes the physical AP.

The two paths resolve the AP differently:

- **Grant path** — `resolveNetworkIdForMac` / `resolveCircuitIdForMac`
  (`packages/core/src/services/networkHealth.ts:514`) has a **circuit-id fast path**: MAC →
  `network_client_attribution` cache → circuit-id → physical AP row. → resolves the physical AP. ✅
- **Checkout path** — `resolveCheckoutLocation`
  (`apps/customer/src/lib/server/network-location.ts`) resolves by **interface name**: the `?ap=`
  portal param and/or `network.resolveApForMac(mac)` → `resolveNetworkIdByApName`. On a shared bridge
  the hotspot interface (hence `?ap=`) is `bridge1_WiFi_Project` for *everyone*, so every Maya payment
  collapses onto interface row id 11, with a null circuit-id. ❌

The AP-name-snapshot feature faithfully froze whatever checkout resolved — it did not cause this; it
made it visible by putting the interface name on the payment row.

## Proposed fix (deferred)

Make `resolveCheckoutLocation` resolve circuit-id-FIRST, same as the grant path: try
`resolveCircuitIdForMac` / `resolveNetworkIdForMac` (MAC → circuit-id → physical AP) BEFORE the
`?ap=`/`resolveApForMac` interface tiers; fall back to the interface path only when no circuit-id
resolves. This fixes `network_id`, `ap_circuit_id`, AND `ap_name_snapshot` for all future Maya
payments in one place. Existing rows keep their old attribution (no backfill).

Risk class: billing-path attribution (same as the snapshot). `?mac=`/circuit-id signals remain
client-influenceable — this improves accuracy, not tamper-proofing.

## Pointers

- `apps/customer/src/lib/server/network-location.ts` — `resolveCheckoutLocation`,
  `apAttributionForNetworkId` (tiers: `?ap=` → device-mac via `resolveApForMac` → active-session →
  last-known → dev-fallback).
- `packages/core/src/services/networkHealth.ts:514` — `resolveNetworkIdForMac` (the circuit-id fast
  path checkout should adopt); `resolveCircuitIdForMac` (`:588`).
- Related: `[[project_ap-detection-issue]]` (shared-VLAN = one AP entry), the
  `purchase-ap-attribution` feature (circuit-id attribution, commit `0d13023`), and
  `tx-ap-name-snapshot_22-07-26` (the snapshot feature this fix must land after).
