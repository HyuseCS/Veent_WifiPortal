---
name: plan:per-ap-visibility-spec
description: "Per-AP visibility on admin /networks page — Phase A (router-side DHCP Option 82) requirements doc; Phase B (AP controller API) deferred scope"
date: 16-07-26
feature: general-plans
---

# Per-AP Visibility — SPEC

## Summary

Right now the admin `/networks` page shows exactly one row — the router's single hotspot
interface — even though the business has deployed several physical outdoor Wi-Fi access points
behind that one router. Staff can't tell which AP is up, how many guests are connected to which
AP, how much traffic each AP is carrying, or which AP a specific guest device is using. This SPEC
covers **Phase A**: making the existing router (MikroTik) tell us which DHCP lease belongs to
which physical AP, so `/networks` can show one row per AP instead of one row for the whole
network. A second phase (**Phase B**, talking directly to each AP's own management API for
richer per-client signal data) is named here as future scope but is explicitly NOT part of what
we're building now — the credentials and API behavior for that path are still being confirmed.

## User Stories / Jobs To Be Done

1. **As an on-site support staffer**, I want to see each physical AP listed separately with its
   own up/down status, so that when a guest complains about no Wi-Fi I know immediately whether
   the problem is "the whole site is down" or "just the AP near the loading dock is down."

2. **As an on-site support staffer**, I want to see how many guest devices are connected to each
   AP, so that I can tell whether a slow-Wi-Fi complaint is caused by an overloaded AP rather than
   a router or backhaul problem.

3. **As ops/management**, I want to see traffic/bandwidth broken down per AP (not just one
   network-wide total), so I can plan where to add capacity or investigate which AP is
   saturating the link.

4. **As a support staffer investigating a specific guest issue**, I want to look up which AP a
   given guest's session is/was connected through, so I can correlate a complaint with the
   specific hardware and location.

5. **As ops**, I want the system to be honest when it can't tell two APs apart (rather than
   silently guessing), so I don't get misled into thinking we have cleaner visibility than we
   actually do.

## What The User Wants (Behavioral Outcomes)

- The `/networks` page shows a separate entry for each physical AP that the router can currently
  identify, in addition to (or instead of) the single network-wide row it shows today.
- Each AP entry shows: online/offline status, number of currently connected guest devices, and a
  traffic/bandwidth figure for that AP.
- APs are recognized automatically — staff do not manually register each AP's identity; the
  system recognizes an AP the first time its DHCP lease is seen (matched by hardware
  manufacturer ID + hostname pattern), the same way the current single-row auto-discovery works.
- When the system genuinely cannot distinguish between two or more APs (because they sit behind
  the same shared network relay point), those APs are shown as a single combined "AP group"
  entry rather than as fabricated separate rows — the UI is honest about the limits of what the
  router can see.
- When an AP hasn't reported in for a while (matching the existing staleness pattern already
  used on `/networks`), it is flagged the same way the page already flags a stale/unreachable
  router today.
- A guest session (identified by device) can be looked up to see which AP entry it's currently
  associated with, reusing the existing session/user lookup the router already exposes.
- Existing `/networks` features — the summary KPI cards, the map with location pins, and the
  ability for staff to manually pin/set a location and display name for a network entry — continue
  to work, extended to work per-AP rather than only for the single network-wide entry.

## Flow / State Diagram

```
Guest device connects to Wi-Fi
        │
        ▼
DHCP request relayed through the shared
network path (OLT) up to the router
        │
        ▼
Router's DHCP lease log includes a
relay-inserted circuit identifier
(identifies which relay hop, not the AP itself)
        │
        ▼
   ┌────────────────────────────────────────┐
   │ Does a currently-known AP lease share   │
   │ the same circuit identifier as this     │
   │ guest device's lease?                   │
   └────────────────────────────────────────┘
        │                         │
       YES                        NO
        │                         │
        ▼                         ▼
Attribute this guest        Guest device is unattributed
device to that AP           (excluded from per-AP counts,
(or to the AP GROUP          included only in network-wide total)
if 2+ APs share that
same circuit identifier)


AP status / discovery loop (runs on existing refresh cadence):
        │
        ▼
Router's DHCP lease table scanned
        │
        ▼
   ┌───────────────────────────────────────────┐
   │ Lease MAC prefix + hostname pattern        │
   │ match known AP hardware signature?         │
   └───────────────────────────────────────────┘
        │                          │
       YES                        NO
        │                          │
        ▼                          ▼
  New or existing AP           Not an AP — ignore
  entry created/updated
        │
        ▼
  Ping AP's current lease IP
        │
   ┌────┴─────┐
  UP         NO REPLY
   │            │
   ▼            ▼
"online"    "offline" (same staleness/
             offline semantics as today's
             single-row banner)
```

## Acceptance Criteria (Testable Outcomes)

1. **AP auto-discovery:** When a device matching the known AP hardware signature (manufacturer
   ID + hostname pattern) obtains a DHCP lease for the first time, a new AP entry appears on
   `/networks` without any manual staff action.
   - proven by: integration test seeding a synthetic AP-signature DHCP lease and asserting a new
     network-health row is created for it (pglite-backed service test, mirroring existing
     `networkHealth` upsert/prune test pattern)
   - strategy: Fully-Automated

2. **Per-AP up/down status:** Each AP entry independently reflects whether that specific AP is
   currently reachable, distinct from the status of any other AP or the router itself.
   - proven by: integration test with two AP fixtures, one reachable and one not, asserting their
     `online` fields differ
   - strategy: Fully-Automated

3. **Per-AP client count:** Each AP entry shows a client count reflecting only guest devices
   attributed to that AP (via shared circuit identifier), not the network-wide total.
   - proven by: integration test asserting guest-device fixtures attributed to AP-1 do not count
     toward AP-2's client count
   - strategy: Fully-Automated

4. **Per-AP traffic figure:** Each AP entry shows a bandwidth/traffic figure specific to that AP.
   - proven by: agent-probe against the live router confirming whether per-session byte counters
     are exposed on this firmware, gating whether this criterion can be Fully-Automated or must
     remain a Known-Gap (see Known-Gaps — item 4)
   - strategy: Agent-Probe (unconfirmed mechanism — see Known-Gaps)

5. **Shared-relay honesty (AP group):** When 2 or more AP leases share the same circuit
   identifier, they are shown as one combined group entry, not as separate rows with fabricated
   per-AP splits.
   - proven by: integration test seeding two AP fixtures with an identical circuit identifier and
     asserting they render as a single group entry with a group indicator, not two independent
     rows
   - strategy: Fully-Automated

6. **Attribution tolerates missing circuit-id:** A guest device whose most recent DHCP renewal
   lacks a circuit identifier (e.g. a unicast renewal) is still attributed to its last-known AP
   rather than being dropped from all per-AP counts.
   - proven by: integration test simulating a lease renewal with a blank circuit-id field,
     asserting the device retains its prior AP attribution
   - strategy: Fully-Automated

7. **Unattributable devices still counted network-wide:** A guest device that cannot be
   attributed to any AP (no circuit-id ever seen, e.g. OLT-1 traffic before Option 82 is enabled
   there) still appears in the overall network-wide client count, just not in any specific AP row.
   - proven by: integration test asserting an unattributed device fixture increments the
     network-wide total but no AP-specific count
   - strategy: Fully-Automated

8. **AP identity keyed on MAC, not IP:** An AP entry survives a management-IP change (its DHCP
   lease renewing to a different address) without becoming a duplicate or "new" AP.
   - proven by: integration test renewing an AP fixture's lease to a new IP and asserting the
     same AP entry is updated in place (matched by MAC), not duplicated
   - strategy: Fully-Automated

9. **Staleness/offline banner extends per-AP:** When an individual AP stops reporting for longer
   than the existing staleness threshold, that AP (not necessarily the whole page) is flagged as
   unreachable, consistent with the existing "router unreachable" banner pattern.
   - proven by: integration test asserting an AP fixture whose `lastSampleAt` exceeds the
     existing staleness threshold is flagged, independent of other AP fixtures' freshness
   - strategy: Fully-Automated

10. **Guest-session-to-AP lookup:** Given a guest's active session, staff can determine which AP
    (or AP group) that session is currently attributed to.
    - proven by: integration test asserting the existing session/MAC resolution path returns the
      correct AP identifier for a fixture with a known circuit-id match
    - strategy: Fully-Automated

11. **Existing /networks features preserved:** KPI summary cards, map pins, and operator-set
    display name/location continue to function when there are multiple AP rows instead of one.
    - proven by: admin e2e Playwright spec loading `/networks` with multiple seeded AP fixtures
      and asserting KPI cards aggregate correctly and map pins render per pinned AP
    - strategy: Fully-Automated (existing Playwright harness — throwaway DB, per `tests/all-tests.md`)

12. **Live-network up/down sanity check:** In the user's real deployment, at least one genuinely
    offline AP is correctly shown as offline and at least one genuinely online AP is correctly
    shown as online.
    - proven by: manual/agent-probe verification against the live router post-deployment (this
      was already empirically observed during RESEARCH: 2 of 3 real APs answered ping, 1 did not)
    - strategy: Agent-Probe

## Out Of Scope

- **Multi-router / multi-site support.** A prior plan exists at
  `process/general-plans/active/multi-router-support_13-07-26/multi-router-support_PLAN_13-07-26.md`
  proposing this direction — it has been explicitly rejected as the current direction and must
  NOT be adopted or merged into this work. This feature is single-router, multi-AP only.
- **Phase B (AP controller "Fatap" API) implementation.** Deferred — see Background/Deferred
  Scope section below. No code against the Fatap JSON-RPC API is written in this phase.
- **Per-client signal strength / RSSI.** Only available via the Phase B AP controller API
  (`get_wireless_status`); not available from the router's DHCP/hotspot data.
- **Exact per-AP attribution within a shared-ONU AP group.** When 2+ APs share one relay
  identifier, Phase A cannot split them further — see Known-Gaps.
- **Customer-app (guest-facing captive portal) changes** beyond whatever the shared
  `resolveNetworkIdForMac` service function requires to keep working as-is. No new customer-facing
  UI or behavior is in scope.
  - **Superseded note (23-07-26):** `resolveNetworkIdForMac`'s fallback behavior was later revised
    for the ambiguous-shared-bridge case by
    `process/general-plans/completed/ap-session-binding-circuitid-first_23-07-26/` — see that plan
    for detail. Deliberate, diagnosed revision, not a scope violation of this SPEC.
- **CAPsMAN / SNMP-based AP visibility paths.** Already investigated in RESEARCH and confirmed to
  be dead ends for this topology (APs are not CAPsMAN-managed; SNMP does not provide the needed
  granularity here).
- **Enabling DHCP Option 82 on the "HUAWEI OLT-1" DHCP server instance.** This is an external
  network configuration change on the user's Huawei GPON equipment, not an application change —
  see External Dependencies.

## Constraints

- Must reuse the existing `@veent/core` integration factory + stub pattern (optional controller
  methods) so that non-MikroTik/dev/stub environments do not break.
- AP identity must be keyed on MAC address (OUI `E4:67:1E`) and hostname pattern (`OAP3000G-*`),
  never on IP address, because AP management IPs are DHCP-assigned and change over time.
- Must degrade honestly when circuit-id data is partial or absent (OLT-1 currently has none;
  unicast renewals sometimes lack it) — no fabricated attribution.
- Must respect the existing `network_health` schema's per-row model (one row per named
  interface/AP) and the existing auto-discovery vs. operator-pinned-row distinction (pruning
  logic must not delete staff-pinned rows).
- Must keep working within the existing per-minute cron refresh cadence
  (`api/network/health/refresh`) and existing staleness threshold semantics
  (`NETWORK_HEALTH_STALE_MS`).
- Must not require the customer-facing captive portal or Maya payment flow to change in ways
  that alter guest-facing behavior.
- Scope is admin-app-only (`/admin` and its dependencies), per project-wide agent scope rule.

## Open Questions

None — RESEARCH provided verified, user-confirmed facts, and the user has already locked the
Phase A/Phase B scope split and rejected the multi-router direction. Verification items that
remain (hotspot byte-counter availability; OLT-1 Option 82 enablement; Phase B credentials) are
recorded as Known-Gaps / External Dependencies below, not as open scope questions.

## Background / Research Findings

### Verified facts (live-probed this session)

- Topology: Huawei GPON backhaul; router runs two DHCP server instances, "HUAWEI OLT-1" and
  "HUAWEI OLT-9"; APs sit behind ONUs on shared VLAN 70, not on distinct router ports.
- **Option 82 attribution confirmed working:** OLT-9 inserts an `agent-circuit-id` (ONU identity,
  e.g. `"OLT-9 xpon 0/1/0/4:16.3.70"`) into relayed DHCP leases. An AP's own lease and its
  wireless clients' leases share the same circuit-id — user-confirmed against two real test
  clients on that specific AP's radio. This is the Phase A client→AP attribution mechanism.
- AP self-identification: MAC OUI `E4:67:1E`, hostname prefix `OAP3000G-*`. Management IPs are
  DHCP-assigned and change (unused static reservations exist on wrong subnets) — identity must
  key on MAC.
- Granularity caveat: circuit-id identifies the ONU, not the individual AP radio. One ONU can
  feed multiple APs (user-confirmed). When 2+ AP leases share a circuit-id, attribution for that
  group is ONU-level ("AP group") — auto-detectable, must be represented honestly.
- Coverage caveat: OLT-1 leases currently carry no circuit-id (Option 82 not enabled there —
  external dependency, ~1 AP believed behind it). Unicast DHCP renewals can also lack circuit-id
  — attribution must tolerate temporarily-absent circuit-id via last-known-circuit-per-MAC.
- Up/down viability confirmed: AP's own DHCP lease liveness + ICMP ping to current IP (2 of 3 real
  APs answered; the third is genuinely offline, stuck at `offered` lease state — a real outage
  this feature would surface).
- Client sessions: router's `/ip hotspot active` table maps client MAC → session/user.
  Per-session byte counters are likely present (standard RouterOS) but unconfirmed on this
  firmware — flagged as a verification item (Acceptance Criterion 4).

### Deferred scope — Phase B (AP controller "Fatap" API)

Goal (not built now): richer per-AP and per-client data (including per-client signal
strength/RSSI) by talking directly to each AP3000G's own management API instead of inferring
from router DHCP data.

What's known: the AP serves a local web UI ("Fatap", `Host: iot-web`) — a Vue SPA driven by
JSON-RPC `POST /api` using a `challenge`→`login`→`call` token auth chain. Firmware includes an
AC/controller mode: `aplist`, `get_controller_host`, `online_ac`, `get_group_ssid`, and a
`/device/{mac}/api` proxy where one AP can expose peer APs' data; also `get_wireless_status`
(expected to carry per-client RSSI/signal).

What's unresolved before Phase B can be planned: user is still acquiring Fatap credentials; the
exact JSON-RPC request/response envelope shapes are unverified (this is an undocumented vendor
API); coupling this deeply to one vendor's firmware is a stated risk to flag when Phase B is
scoped.

### Existing pipeline (do not re-research, cited as-is from completed RESEARCH)

- `packages/db/src/schema/admin.ts` — `network_health` table, one row per interface/AP display
  name, unique on `name`; columns include online, wanOk, offlineSince/onlineSince, uptimePct,
  latencyMs, users, throughputMbps, lastSampleAt, latitude/longitude/address, interfaceName,
  model (references `router_model` catalog, comment already names `suncomm-ap3000g`),
  rangeMeters, clusterName, maxDownKbps/maxUpKbps.
- `packages/core/src/integrations/network/mikrotik.ts` — `sampleHealth()` currently emits one
  sample per hotspot-bound interface (today: exactly one, `vlan70 hotspot`); `connectedUsers` is
  a global count, not per-AP; `resolveApForMac()` falls back CAPsMAN → local wireless → ARP
  (per-VLAN only — its own comment admits it can't see past the shared VLAN).
- `packages/core/src/services/networkHealth.ts` — `refreshNetworkHealth` upserts by name, prunes
  auto-discovered rows absent from the sample set while keeping operator-pinned rows with
  coordinates; `resolveNetworkIdForMac` is shared with the customer app for session attribution
  (cross-app blast radius to note in later PLAN/INNOVATE phases).
- `apps/admin/src/routes/api/network/health/refresh` — per-minute cron endpoint
  (`x-cron-secret` guard, Sentry monitor).
- `apps/admin/src/routes/(app)/networks` — KPI cards, `NetworkHealthCard`, `CoverageMap`
  (Leaflet), `RouterLogPanel`, "router unreachable" staleness banner
  (`NETWORK_HEALTH_STALE_MS` = 3 min), SSE live snapshot overlay.
- Integration conventions: `@veent/core` factory+stub provider pattern (optional controller
  methods so stub/dev environments never break); env via `validateEnv`
  (`NETWORK_CONTROLLER=mikrotik` requires `MIKROTIK_*`); Drizzle migrations authored in
  `packages/db` (dev DB is push-managed — journal-drift gotcha); core tests run on pglite (a
  known repo risk: real-Postgres behavioral gaps are not covered by pglite tests).

### External Dependencies

- **OLT-1 Option 82 enablement** — a Huawei GPON configuration change on the user's side, not an
  application change. Until enabled, APs behind OLT-1 (believed ~1 AP) remain unattributable to
  any specific AP and only appear in the network-wide total.
- **Fatap (Phase B) credentials** — user is still acquiring access; blocks any Phase B planning
  or implementation.
- **AP-Corrales (the third test AP) is physically offline right now** — a real, live-observed
  outage, not a data artifact; useful as a live validation case for Acceptance Criterion 12 once
  Phase A ships.
