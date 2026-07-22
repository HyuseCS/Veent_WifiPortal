---
name: note:per-ap-throughput-alt-source
description: "Optional future option — an alternative traffic source for per-AP guest throughput, since /ip hotspot active is structurally unavailable for bypass-granted paid guests. Not started, not committed to."
date: 21-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# Per-AP guest throughput: alternative source (optional, not started)

> **PARKED — not on the actionable list (22-07-26).** Not in our control right now: throughput is
> unmeasurable by design under the current bypass-grant model, and every alternative source needs
> either external creds (Fatap Phase B) or a new integration domain (Huawei OLT). Do not surface
> this as tackleable work; revisit only if per-AP throughput becomes a real product need OR Phase B
> creds arrive.

## Why this exists

Per-ap-visibility Phase A's G14 gate was resolved 21-07-26: per-AP guest throughput is NOT
measurable via `/ip hotspot active` byte counters, and this is structural/permanent — not a
firmware limitation. Paid guests are granted via `ip-binding type=bypassed`
(`packages/core/src/integrations/network/mikrotik.ts`), which skips the hotspot subsystem
entirely, so RouterOS never accounts bypassed traffic on `/ip hotspot active`. The shipped honest
`'—'` degradation (G15) is correct and will remain correct indefinitely under the current grant
model. Full verdict:
`process/general-plans/completed/per-ap-visibility_16-07-26/live-verification_REPORT_17-07-26.md`
§"G14 field verdict — RESOLVED (21-07-26)".

## What this note is (and isn't)

This is a parking spot for a possible **future** direction, not a commitment or a planned phase.
No design work has started. Pick this up only if per-AP guest throughput becomes a real product
need.

## Possible alternative sources (unresearched, listed for later triage)

- **Per-guest simple queues** on the MikroTik router (RouterOS `/queue simple`), keyed by guest IP
  or MAC, then summed per circuit-id at read time — would need queue provisioning wired into the
  grant flow (`grantAccess`/`ip-binding` creation) and a new provider read method.
- **Per-PON/interface counters at the OLT** (Huawei GPON backhaul, per the per-ap-visibility
  Program Goal Charter) — would require a Huawei OLT integration (per-ONU stats), a new
  integration domain not currently in `@veent/core`.
- **Suncomm "Fatap" AP-side API** (per-ap-visibility Phase B, still blocked on the user obtaining
  web-interface credentials) — the AP's own `get_wireless_status` JSON-RPC call may expose
  per-client throughput directly from the radio side, sidestepping the hotspot/bypass problem
  entirely. If Phase B ships, re-evaluate whether this note is even still needed.

## Scope note

None of these have been feasibility-probed. Before picking this up, run a cheap live-router
Agent-Probe (same pattern as G14) against whichever option looks most promising, rather than
committing to a design blind.
