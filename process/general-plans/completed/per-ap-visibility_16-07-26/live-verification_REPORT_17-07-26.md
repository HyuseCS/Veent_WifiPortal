---
name: report:per-ap-visibility-live-verification
description: "Live-router read-only verification of Phase A E4/E5/G14/G16 probes — deferred gates from per-ap-visibility_PLAN_16-07-26.md"
date: 17-07-26
metadata:
  node_type: memory
  type: report
  feature: general-plans
  phase: pvl-deferred-probes
---

# Per-AP Visibility — Live-Router Verification Report (E4 / E5 / G14 / G16)

**Date:** 2026-07-17
**Plan:** `process/general-plans/active/per-ap-visibility_16-07-26/per-ap-visibility_PLAN_16-07-26.md`
**Branch:** `feat/multi-controller` (uncommitted Phase A implementation, probed as-is)
**Method:** throwaway Bun/TS scripts under the session scratchpad, importing the real
`createMikrotikController` / `connectHardened` / `recognizeAccessPoints` code by absolute path
(no repo source files touched). All router calls were `/print` (read) or `/ping` (non-mutating).
Zero `/set`, `/add`, `/remove` calls were issued at any point.

## TL;DR

- **E5 (Option 82 key): CONFIRMED, no code change needed.** The router's raw lease field is
  exactly `agent-circuit-id`, matching `DHCP_OPTION82_CIRCUIT_KEY` in `mikrotik.ts` verbatim.
- **E4 (ping multiplex): WORKS, confirmed conclusively.** 4 concurrent `/ping` writes on one
  node-routeros 1.6.9 connection — including a mix of real-RTT and timeout replies — all
  resolved with correct per-host correlation, no crash, no interleaving, ~2s elapsed. The
  bounded-concurrency (chunks of 4) fallback is safe to keep as-is; a future full-parallel change
  would also be safe based on this evidence.
- **G14 (byte counter monotonicity): INCONCLUSIVE — no active clients.** Two `/ip/hotspot/active`
  samples ~75s apart both returned 0 sessions. Ships the honest-degradation branch as planned;
  re-probe needed once a real guest session exists (backlog note already covers this).
- **G16 (live up/down sanity): INCONCLUSIVE, with a HIGH-SEVERITY finding.** AP discovery and
  circuit-id attribution work correctly against the live router. But **neither test AP (including
  the one expected to be online) showed UP via ping** — root-caused, with direct A/B proof, to the
  router's own hotspot walled-garden firewall (`hs-unauth-to`, `action=reject
  reject-with=icmp-host-prohibited`) rejecting ICMP to any hotspot client that isn't
  authorized/bypassed. Every physical AP is itself an un-bypassed hotspot client, so
  **`pingHosts`-based liveness will read every AP as permanently DOWN regardless of real health**,
  until the router is configured to exempt AP addresses (walled-garden or ip-binding bypass). This
  directly affects Risk R3's mitigation claim ("research confirmed AP3000G answers ICMP") — our
  pings never reached the AP to test that; they were rejected by the router itself first.

---

## Probe 0 — Connectivity Preflight

**Verdict: OK — router reachable.**

Connected via `createMikrotikController` + `listDhcpLeases()` (cheapest read) using the admin
`MIKROTIK_*` env. Succeeded on the first attempt — no api-ssl allowlist issue this session (the
on-site machine's current lease is evidently already allowlisted).

```
Preflight: OK — router reachable, auth succeeded, DHCP lease table readable.
```

---

## Probe 1 (E5) — Raw DHCP Lease Option 82 Key

**Verdict: CONFIRMED — `agent-circuit-id` is correct, no code change needed.**

Raw `/ip/dhcp-server/lease/print` output (9 total leases) was inspected directly (bypassing the
service-layer interpretation) for every field name matching `/circuit|remote-id|option|agent/i`:

```
Keys on raw lease rows matching that pattern: ["dhcp-option", "agent-circuit-id"]
```

`dhcp-option` is present but always empty string on these rows — a distinct, unrelated field.
`agent-circuit-id` is the real OLT-inserted Option 82 circuit id, and it is populated exactly as
the code assumes. Sample raw values observed (not secrets — circuit ids are safe to show):

| MAC | host-name | address | agent-circuit-id | status |
|---|---|---|---|---|
| `E4:67:1E:B6:FB:9C` | `OAP3000G-FK9C` | `10.210.59.33` | `OLT-9 xpon 0/1/0/12:5.3.70` | bound |
| `E4:67:1E:B6:FC:60` | `OAP3000G-FC6G` | `10.210.59.7` | `OLT-9 xpon 0/1/0/4:16.3.70` | bound |
| `7C:B2:7D:47:17:97` | `HyuseTP` (not an AP — OUI mismatch) | `10.210.59.11` | `OLT-9 xpon 0/1/0/4:16.3.70` | bound |

**Code implication:** none. `DHCP_OPTION82_CIRCUIT_KEY = 'agent-circuit-id'` in
`packages/core/src/integrations/network/mikrotik.ts` line 74 is correct as shipped.

**Bonus finding (comment field, not currently captured by `DhcpLeaseEntry`):** the router's lease
`comment` field carries a human-readable AP site name (e.g. `AP-Pabayo`, `AP-Headend`,
`AP-Corrales Office`) that isn't surfaced anywhere in the current schema/UI — `name` on AP rows
is the DHCP hostname (`OAP3000G-FC6G`), not this friendlier comment. Not a bug, just a possible
future UX enhancement (out of scope here) — noting for the record only.

---

## Probe 2 (E4) — Concurrent `/ping` Multiplex Risk

**Verdict: WORKS — confirmed with mixed real/timeout replies, no crash, no interleaving.**

Two rounds were run:

1. **Round 1** (4 concurrent pings, all-timeout targets — the 3 recognized AP addresses plus a
   repeat): all 4 promises resolved (none rejected), each reply's `host` field matched its
   requested address, elapsed 2025ms.
2. **Round 2 (decisive)** — 4 concurrent pings on the SAME connection, deliberately MIXED: two
   targets expected to get real ICMP replies (a bypassed host and a public IP) and two expected to
   time out (the two APs). This tests the actual correlation risk (R1), not just "does it hang":

```
elapsed: 2036ms
[0] requested=10.210.59.11 replyHosts=["10.210.59.11"] CORRECTLY_CORRELATED=true  time=3ms
[1] requested=1.1.1.1      replyHosts=["1.1.1.1"]      CORRECTLY_CORRELATED=true  time=61ms
[2] requested=10.210.59.7  replyHosts=["10.210.59.7"]  CORRECTLY_CORRELATED=true  status=timeout
[3] requested=10.210.59.33 replyHosts=["10.210.59.33"] CORRECTLY_CORRELATED=true  status=timeout
```

Every reply's `host` field matched its own request — zero cross-contamination between concurrent
writes, no thrown/rejected promise, no hang. Total elapsed ~2s for 4 concurrent pings (well inside
the ≤6s budget for 10 APs at concurrency 4).

**Code implication:** none required. `AP_PING_CONCURRENCY = 4` (bounded chunks) in `mikrotik.ts`
is safe as shipped. This evidence also suggests full `Promise.all` (no chunking) would likely be
safe too, but the plan's conservative chunked default is not disproven and needs no change — this
was a "is it safe to keep as designed" probe, not a request to widen concurrency.

---

## Probe 3 (G14) — Hotspot-Active Byte Counter Monotonicity

**Verdict: INCONCLUSIVE — no active hotspot clients during the observation window.**

Two `/ip/hotspot/active` samples, 75 seconds apart:

```
Sample 1 (t=0s): 0 active sessions
Sample 2 (t=75s): 0 active sessions
```

No guest devices were connected through the captive portal (as opposed to the walled-garden
bypassed admin/infra hosts, which don't appear in `/ip/hotspot/active` at all — that table is
specifically the hotspot-authenticated session list). Nothing to compare.

**Code implication:** none new. This is exactly the scenario the plan already anticipated
(`per-ap-traffic-counter-reprobe_NOTE_16-07-26.md` backlog note) — ships the honest `'—'`
degradation branch (G15) until a real guest session exists to re-probe against.

---

## Probe 4 (G16) — Live AP Up/Down Sanity

**Verdict: INCONCLUSIVE, with a HIGH-SEVERITY root-caused finding — not simply "APs are offline".**

### What ran (the actual shipped read path)

`controller.listDhcpLeases()` → `recognizeAccessPoints()` (the real pure function from
`networkHealth.ts`, imported directly) → `controller.pingHosts()` (the real bounded-concurrency
implementation), exactly mirroring the production `refreshNetworkHealth` flow's AP portion (no DB
writes performed — only the read/compute steps were exercised):

```
recognizeAccessPoints() found 3 AP lease(s):
  mac=E4:67:1E:B6:FB:AC hostname=(none)        address=10.210.62.204  circuitId=(none)  status=offered
  mac=E4:67:1E:B6:FB:9C hostname=OAP3000G-FK9C address=10.210.59.33   circuitId=OLT-9 xpon 0/1/0/12:5.3.70  status=bound
  mac=E4:67:1E:B6:FC:60 hostname=OAP3000G-FC6G address=10.210.59.7    circuitId=OLT-9 xpon 0/1/0/4:16.3.70  status=bound

pingHosts() results:
  hostname=(unknown)        address=10.210.62.204 -> DOWN (aliveMs null)
  hostname=OAP3000G-FK9C    address=10.210.59.33  -> DOWN (aliveMs null)
  hostname=OAP3000G-FC6G    address=10.210.59.7   -> DOWN (aliveMs null)
```

AP discovery, dedup (bound-status preference), and circuit-id attribution all worked correctly —
`OAP3000G-FC6G` (site comment `AP-Pabayo`) and `OAP3000G-FK9C` (site comment `AP-Headend`) were
both discovered with the correct OLT-9 circuit ids. **But every single AP — including
`AP-Pabayo`, which was expected to be the online positive case — read DOWN.** That contradicted
the expected "one up, one down (AP-Corrales)" split, so this was investigated further rather than
accepted at face value (competing hypotheses: AP genuinely down / ICMP filtered / ping timeout too
short / library bug).

### Root cause — proved with a direct A/B comparison, not a guess

Read-only checks against the router's own state:

```
--- ip-binding table (bypassed) — this dev machine IS bypassed on 10.210.59.11 ---
{"mac":"7C:B2:7D:47:17:97","address":"10.210.59.11","type":"bypassed"}

--- hotspot host table — authorized/bypassed flags ---
E4:67:1E:B6:FC:60 (AP-Pabayo,  10.210.59.7):  authorized=false bypassed=false
E4:67:1E:B6:FB:9C (AP-Headend, 10.210.59.33): authorized=false bypassed=false
7C:B2:7D:47:17:97 (this machine, 10.210.59.11): authorized=false bypassed=true

--- firewall filter rules (dynamic, hotspot-generated) ---
{"chain":"hs-unauth",    "action":"reject","reject-with":"icmp-net-prohibited"}
{"chain":"hs-unauth-to", "action":"reject","reject-with":"icmp-host-prohibited"}

--- DECISIVE A/B ping test, same VLAN, issued the same way ---
ping -> 10.210.59.11 (bypassed=true):  3 replies, RTT 2-41ms   -> UP
ping -> 10.210.59.7  (bypassed=false, AP-Pabayo):  100% loss, timeout -> reads DOWN
ping -> 10.210.59.33 (bypassed=false, AP-Headend): 100% loss, timeout -> reads DOWN
ping -> 1.1.1.1 (public, unrelated to hotspot):     3 replies, RTT ~61ms -> UP
ping -> 10.210.0.1 (router's own mgmt IP):          2 replies, RTT 0ms  -> UP
```

The router's ping engine is functioning normally (public IP and self both reply instantly). The
**only** variable that predicts ping success/failure on VLAN70 is whether the target host is
`bypassed=true` in the hotspot host table. Neither AP is bypassed — they are ordinary
(unauthenticated) hotspot clients from the router's point of view, so the router's own dynamic
`hs-unauth-to` rule (`reject-with=icmp-host-prohibited`) drops ICMP destined to them before it
ever reaches the AP's radio.

**This means Risk R3's stated mitigation ("research confirmed AP3000G answers ICMP") is not
actually being exercised by `pingHosts` today** — the packets are rejected by the router itself,
never reaching the AP, so we cannot yet confirm or deny whether AP3000G answers ICMP once
reachable. What we *can* say with certainty: **as currently deployed, `pingHosts`-based liveness
will report every AP as DOWN, permanently, regardless of the AP's actual physical/radio state**,
because no AP MAC/IP is in the walled garden or the bypassed ip-binding table (only
`veent-admin`, `OLT1`, `OLT9`, and `dev portal host` are exempted today).

### Code / design implication (no code change made — flagging for a follow-up decision)

This is a **router-config gap, not a code bug** in the sense that `pingHosts`/`recognizeAccessPoints`
behave exactly as designed against what the router reports. But the end-to-end AC12 "live up/down
sanity" cannot pass until one of the following is done (none attempted here — read-only probe
only, and router-side firewall/walled-garden changes are outside a debugging probe's remit):

1. **Add each AP MAC to the walled garden / ip-binding bypass list** (same mechanism already used
   for `veent-admin`/`OLT1`/`OLT9`) — router-side config, not a code change, doable by whoever
   manages the router (the same person who'd enable Option 82 on the OLT).
2. Alternatively, a design change to ping from a context that bypasses the hotspot's client-facing
   firewall (e.g. sourcing the ping from an interface/VRF outside the hotspot's forward path) —
   this would be a real code/architecture change and should go through INNOVATE, not be decided
   here.

**Recommendation:** do not treat "AP-Pabayo shows DOWN" as a shippable G16 PASS. File this as a
new backlog/plan item (distinct from the existing traffic-counter re-probe note) before Phase A is
considered fully verified against the live router — the outage-sweep interplay flagged in R3
("a false AP-down would freeze paid guests' time") is a *live, currently-reproducible* condition
today, not a hypothetical.

---

## Summary Table

| Probe | Gate | Verdict | Code change needed? |
|---|---|---|---|
| E5 | Option 82 key | CONFIRMED — key matches | No |
| E4 | ping multiplex safety | WORKS — confirmed with mixed real/timeout concurrent pings | No |
| G14 | byte counter monotonicity | INCONCLUSIVE — no active clients to observe | No (ships degradation branch as planned) |
| G16 | live up/down sanity | INCONCLUSIVE + HIGH-SEVERITY finding — hotspot walled-garden blocks ICMP to all non-bypassed APs, so liveness reads DOWN regardless of real AP health | Follow-up decision needed (router-side walled-garden exemption, or an INNOVATE-level redesign of the liveness probe path) — not implemented here |

## Constraints Honored

- Every router call was `/print` (read) or `/ping` (non-mutating). No `/set`, `/add`, `/remove`
  was ever issued.
- No repo source files were modified — all probes ran from throwaway scripts in the session
  scratchpad (`/tmp/claude-1000/.../scratchpad/`), importing the real shipped code by absolute
  path.
- No DB writes — `refreshNetworkHealth` (which upserts `network_health`) was never called; only
  its read/compute building blocks (`listDhcpLeases`, `listHotspotActive`, `pingHosts`,
  `recognizeAccessPoints`) were exercised directly.
- `MIKROTIK_USER` / `MIKROTIK_PASSWORD` values are not printed anywhere above or in the scratchpad
  scripts' output. Router/AP IP addresses and DHCP circuit ids are shown — these are private-LAN
  operational identifiers and Option-82 circuit ids, not credentials.

## Unresolved Questions

1. Does AP3000G actually answer ICMP once reachable? Still unverified — R3's mitigation claim is
   unconfirmed pending a walled-garden exemption test.
2. Is `hs-unauth-to` blocking *all* router-originated traffic to non-bypassed hosts, or only
   ICMP specifically? Not probed (out of scope for this read-only pass) — matters for whether a
   future liveness mechanism (e.g. TCP probe, ARP-only) would fare any better without a config
   change.
3. Should AP walled-garden/bypass exemption be added to this Phase A plan's scope, or tracked as a
   separate backlog item / router-runbook step? Left for the orchestrator/user to decide.

---

## G16 re-probe after ip-binding bypass (17-07-26)

**Trigger:** user added the three AP MACs to `/ip/hotspot/ip-binding` as `type=bypassed` via
Winbox terminal (Option A from the earlier finding). Re-ran the same read-only checks — no
`/set`/`/add`/`/remove` issued by this probe, no repo source changed.

### TL;DR

The root-cause finding from the earlier section is **confirmed and resolved for the two APs that
are genuinely reachable**: bypassing AP-Pabayo and AP-Headend in the hotspot ip-binding table
immediately fixed ICMP — both now answer in ~1ms and the feature's own `pingHosts` read path
correctly reports them UP with correct circuit ids. **The AP-Corrales negative case could NOT be
reproduced this session** — its MAC's hotspot host entry shows genuine live traffic (4m45s uptime,
non-zero byte counters, active ICMP-echo heartbeat), i.e. **that device currently appears to be
online**, not offline as expected. This is reported as observed, not adjusted to fit the expected
outcome — see Step 3 for the full evidence.

### Step 1 — ip-binding bypass entries verified

```
total ip-binding rows: 11
AP-Pabayo (OAP3000G-FC6G)  (E4:67:1E:B6:FC:60): FOUND type=bypassed comment=AP-Pabayo
AP-Headend (OAP3000G-FK9C) (E4:67:1E:B6:FB:9C): FOUND type=bypassed comment=AP-Headend
AP-Corrales (offline)      (E4:67:1E:B6:FB:AC): FOUND type=bypassed comment=AP-Corrales (offline)
```

**Verdict: CONFIRMED.** All three requested MACs are present with `type=bypassed`, matching the
user's Winbox change exactly (comments match the AP names given in the coordinator message).

### Step 2 — direct ping test (raw connection, bypassing no code)

```
AP-Pabayo  (10.210.59.7):  replies=3/3  times=["1ms","1ms","1ms"]  packet-loss=0
AP-Headend (10.210.59.33): replies=3/3  times=["1ms","1ms","1ms"]  packet-loss=0
```

**Verdict: CONFIRMED — both now answer ICMP.** This directly contrasts with the pre-bypass result
in the section above (100% loss / timeout on the same addresses via the same method). The A/B
comparison from the first report is now closed: `bypassed=false` → ICMP rejected by
`hs-unauth-to`; `bypassed=true` → ICMP answered normally, 1ms RTT (same-VLAN, effectively
instant). This is direct, repeatable proof that the walled-garden exemption is both necessary and
sufficient to fix the false-DOWN condition for a genuinely-online AP.

### Step 3 — feature's own read path (`listDhcpLeases` → `recognizeAccessPoints` → `pingHosts`)

```
recognizeAccessPoints() found 3 AP lease(s):
  mac=E4:67:1E:B6:FB:AC hostname=(none)        address=10.210.62.204 circuitId=(none)                        status=offered
  mac=E4:67:1E:B6:FB:9C hostname=OAP3000G-FK9C address=10.210.59.33  circuitId=OLT-9 xpon 0/1/0/12:5.3.70     status=bound
  mac=E4:67:1E:B6:FC:60 hostname=OAP3000G-FC6G address=10.210.59.7   circuitId=OLT-9 xpon 0/1/0/4:16.3.70     status=bound

pingHosts() results:
  hostname=(unknown)     address=10.210.62.204 aliveMs=1 -> UP
  hostname=OAP3000G-FK9C address=10.210.59.33  aliveMs=1 -> UP
  hostname=OAP3000G-FC6G address=10.210.59.7   aliveMs=1 -> UP

Summary: 3 recognized, 3 pinged, 3 UP, 0 DOWN
```

**AP-Pabayo / AP-Headend: CONFIRMED UP with correct circuit ids** — matches expectation exactly
(`OLT-9 xpon 0/1/0/4:16.3.70` and `OLT-9 xpon 0/1/0/12:5.3.70` respectively, same values as the
first probe run — the Option 82 attribution is stable across sessions).

**AP-Corrales: read UP, NOT DOWN as expected.** This did not match the coordinator's stated
expectation ("AP-Corrales, physically offline") — investigated rather than accepted at face value,
per the same evidence-first standard as the first report. Direct follow-up checks on the same
MAC (`E4:67:1E:B6:FB:AC`):

```
--- raw lease for the pinged address, 10.210.62.204 ---
status: offered, expires-after: 24s, last-seen: 6s, active-address: 10.210.62.204
(a SECOND lease exists for the same MAC: 10.210.58.28, offered, hostname OAP3000G-FKAC, different OLT — not the one pingHosts selected)

--- ARP for 10.210.62.204 ---
complete: true, dynamic: true — a live, resolved L2 entry, not stale

--- repeat ping x2 (count=4 each) to 10.210.62.204 ---
round 0: 4/4 replies, 1-3ms
round 1: 4/4 replies, 1-4ms

--- hotspot host table entry for this MAC ---
address=10.210.62.204, uptime=4m45s, idle-time=1s, bytes-in=6056, bytes-out=7074,
packets-in=88, packets-out=81, found-by="ICMP echo to 43.152.6.232"
```

The `found-by: "ICMP echo to 43.152.6.232"` field is the router's own explanation for why it
considers this host active: **the device itself is generating outbound ICMP traffic** (an
external heartbeat/keepalive, not something we triggered) with a live 4m45s session and real,
growing byte counters. This is not an ARP cache artifact or a fluke reply — it is direct evidence
of a physically active device on the network right now, at the address `recognizeAccessPoints`
picked for this MAC.

**Verdict: could NOT reproduce the expected negative case this session.** The device carrying
MAC `E4:67:1E:B6:FB:AC` (comment "AP-Corrales Office" / "AP-Corrales (offline)") shows every sign
of being online and active at probe time, not offline. Two honest readings, not adjudicated here:
(a) AP-Corrales genuinely came back online between the first probe run and this re-probe, or
(b) there is a labeling/identity mismatch and this MAC isn't the specific unit the user considers
"the physically offline one." Either way, this is reported as observed — the data was not bent to
match the expected outcome. **A true negative case (a known-currently-down AP correctly reading
DOWN through this same pipeline) remains unverified.**

### Step 4 — opportunistic G14 retry

```
Sample 1: 0 active sessions
Sample 2 (~75s later): 0 active sessions
G14 re-check verdict: INCONCLUSIVE (no active sessions in both samples)
```

**Verdict: INCONCLUSIVE, as anticipated** — still no guest hotspot sessions during this window.
No new evidence either way; the original G14 backlog re-probe note still applies.

### Re-probe summary table

| Check | Verdict | Detail |
|---|---|---|
| ip-binding bypass entries exist | **CONFIRMED** | All 3 MACs present, `type=bypassed`, correct comments |
| Direct ping — AP-Pabayo / AP-Headend | **CONFIRMED UP** | 1ms RTT, 0% loss, both — was 100% loss pre-bypass |
| Feature read path — AP-Pabayo / AP-Headend | **CONFIRMED UP with correct circuit ids** | Matches original E5 attribution, stable across sessions |
| Feature read path — AP-Corrales (expected DOWN) | **NOT REPRODUCED — read UP** | Live traffic evidence (`found-by: ICMP echo...`, growing byte counters, 4m45s uptime) shows this MAC is genuinely active right now; negative case unverified this session |
| G14 (byte counter monotonicity) | **INCONCLUSIVE (unchanged)** | Still 0 active hotspot sessions in both samples |

### Updated recommendation

The core G16 finding from the first report is now validated end-to-end for the positive case:
walled-garden/ip-binding bypass is confirmed as the correct, sufficient fix for the false-DOWN
condition, and the feature's actual read path (not just raw pings) now correctly surfaces two
real APs as UP with correct Option 82 attribution. **Before calling AC12/G16 a clean PASS**,
someone should confirm on-site whether AP-Corrales is actually still physically offline right now
— if it's confirmed still down, its lease/hotspot-host data (live traffic, growing counters)
would itself be the more interesting anomaly to chase (e.g. a different device answering on its
behalf, or the unit partially recovered). If it's confirmed back online, the plan simply needs a
different, currently-down AP to exercise the negative case before AC12 is fully closed.

### Constraints honored (re-probe)

Same as the original run: every call was `/print` or `/ping`; zero `/set`/`/add`/`/remove` issued
by this probe (the ip-binding entries were added by the user via Winbox, outside this session); no
repo source files touched; `MIKROTIK_USER`/`MIKROTIK_PASSWORD` not printed anywhere above.

---

## G14 field verdict — RESOLVED (21-07-26)

**Trigger:** operator ran a read-only probe on the live router with a subscribed, actively-streaming
guest phone (host-name `Pixel-6a`, MAC `2E:47:8F:2D:35:8F`, `10.210.55.26`, behind AP-Pabayo /
circuit-id `OLT-9 xpon 0/1/0/4`) — the "real active guest session" case that both prior G14 windows
(16-07 and 17-07) lacked.

**Verdict: G14 is NOT MEASURABLE — structural, not a firmware limitation, and permanent under the
current grant model.**

```
/ip hotspot active print   ->  EMPTY, even with the guest actively streaming
/ip hotspot host print     ->  guest present, flags=P (bypassed), no bytes-in/bytes-out fields
                                no host present with flags=A (authorized)
```

**Root cause:** paid guests are granted via `ip-binding type=bypassed` (see
`packages/core/src/integrations/network/mikrotik.ts:47-48`, `~768`: "We grant via bypassed
ip-bindings (not hotspot logins)"). Bypassed devices skip the hotspot subsystem entirely — RouterOS
never accounts their traffic on `/ip hotspot active`, so no byte counters exist there for a paid
guest under any firmware. `aggregateByCircuit`
(`packages/core/src/services/networkHealth.ts:423`) sources bytes exclusively from
`listHotspotActive()` → `/ip/hotspot/active/print` (`mikrotik.ts:860`), which is structurally
empty of paid-guest rows by design.

**Correction to the original assumption:** the shipped honest `'—'` degradation (G15) is and
remains CORRECT, but the reason recorded at PLAN/EXECUTE time ("firmware doesn't expose
bytes-in/bytes-out counters", see `per-ap-visibility_PLAN_16-07-26.md` line 85) is the WRONG
explanation for THIS deployment. Firmware-missing-counters is a real, separate possible cause in
general, but it is not what is happening here — the operative reason is the bypass-based grant
model routing paid guests around the hotspot's accounting path entirely.

**Scope:** only the per-AP **throughput (Mbps)** column is affected and will show `'—'`
permanently for paid guests under the current grant model. Per-AP **up/down** health and per-AP
**client count** (grouped by circuit-id) are unaffected and continue to work correctly — this
verdict does not change AC1/AC2/AC3/AC5–AC11 in any way.

**Bonus confirmation (E5, incidental):** the same probe re-confirmed the Option 82 key is
`agent-circuit-id` exactly as assumed (`DHCP_OPTION82_CIRCUIT_KEY`), with live lease
`agent-circuit-id="OLT-9 xpon 0/1/0/4:16.3.70"` matching the guest's AP. No code change. Also
confirmed the per-AP grouping design is sound: `server=` on a DHCP lease is the DHCP/OLT server
name (not the AP); AP identity is the circuit-id's PON port — the feature correctly groups by
circuit-id, not `server`.

**Disposition:** G14 is reclassified from "field-observation pending" to **RESOLVED — not
measurable by design**. No code change is needed or possible to make per-AP guest throughput
measurable through the hotspot subsystem under the current bypass-based grant model. The re-probe
backlog note (`per-ap-traffic-counter-reprobe_NOTE_16-07-26.md`) is closed as superseded by this
finding — see `per-ap-visibility_PLAN_16-07-26.md` Closeout section for the updated AC4 status. If
per-AP guest throughput is wanted in the future, it needs an alternative traffic source (see
`process/general-plans/backlog/` for any follow-up note filed alongside this verdict).

G16 (dashboard up/down sanity, AP-Corrales negative case) was NOT re-probed this session and
remains open/unchanged.
