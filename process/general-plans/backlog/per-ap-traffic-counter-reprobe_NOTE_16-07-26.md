---
name: note:per-ap-traffic-counter-reprobe
description: "Re-probe MikroTik hotspot byte counters on the live router — G14 was INCONCLUSIVE at EXECUTE (router unreachable). Confirms whether per-AP traffic shows a real figure or the honest '—'."
date: 16-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# Per-AP traffic counter re-probe (G14 deferred)

## Why this exists

During EXECUTE of `per-ap-visibility_PLAN_16-07-26.md`, the live MikroTik router and APs were
UNREACHABLE (operator off-site). Per the plan's validate-contract, gate **G14** (Agent-Probe:
`/ip/hotspot/active` byte-counter two-sample monotonicity) could not run → verdict **INCONCLUSIVE**.

Per the contract's gap-resolution rule (C), the honest degradation branch shipped instead:
- The service computes per-AP throughput from `bytes-in`/`bytes-out` deltas WHEN the firmware
  exposes them; when a counter is absent it leaves `throughputMbps` null → the card shows `—`.
- This is fully implemented and proven offline by **G15** (Fully-Automated: delta math + negative
  clamp + first-sample null + null-counter degradation, `packages/core` PGlite + pure tests).

What is NOT yet known: whether the deployed AP3000G / RouterOS firmware actually exposes
`bytes-in`/`bytes-out` on `/ip/hotspot/active`, and whether they increase monotonically under real
traffic. If they do, real per-AP Mbps figures will appear automatically (no code change). If they
don't, the honest `—` stands.

## What to do (one live session, read-only, cheap)

1. On the admin's configured MikroTik connection, print `/ip/hotspot/active` twice ~60s apart.
2. Record whether `bytes-in` / `bytes-out` are present and increasing across the two samples.
3. Also confirm the Option 82 field key (E5): `/ip/dhcp-server/lease/print` — is the circuit-id under
   `agent-circuit-id` (the assumed key, isolated at `mikrotik.ts` `DHCP_OPTION82_CIRCUIT_KEY`)? If a
   different key, that one constant is the only edit.
4. Verify E4 (R1): a live 3+ concurrent `/ping` batch on one node-routeros 1.6.9 connection behaves.
   The shipped `pingHosts` uses bounded concurrency (chunks of 4). If concurrent writes misbehave,
   drop `AP_PING_CONCURRENCY` to 1 or open a second short-lived connection (both pre-approved).
5. Record the verdict in the phase report and close this note. Also run **G16** (post-deploy live
   up/down sanity: AP-Corrales offline / a live AP online).

## Pointers

- Plan / contract: `process/general-plans/active/per-ap-visibility_16-07-26/per-ap-visibility_PLAN_16-07-26.md`
- Traffic math + degradation: `packages/core/src/services/networkHealth.ts` (`computeTrafficRateMbps`, `aggregateByCircuit`)
- Provider raw sampling: `packages/core/src/integrations/network/mikrotik.ts` (`listHotspotActive`, `listDhcpLeases`, `pingHosts`)
- Offline proof: `packages/core/src/services/networkHealth.integration.spec.ts` (G15)
