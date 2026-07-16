---
name: plan:per-ap-visibility
description: "Per-AP visibility on admin /networks — Phase A (router-side DHCP Option 82): AP auto-discovery from DHCP leases, circuit-id client attribution, AP-group honesty, parallel pings, per-AP traffic probe. COMPLEX implementation plan."
date: 16-07-26
feature: general-plans
---

# Per-AP Visibility — Phase A (Router-Side DHCP Option 82) — PLAN

**Date**: 16-07-26
**Status**: Ready for VALIDATE (not started)
**Complexity**: COMPLEX
**Branch:** `feat/multi-controller`
**SPEC:** `process/general-plans/active/per-ap-visibility_16-07-26/per-ap-visibility_SPEC_16-07-26.md` (locked — 5 user stories, 12 ACs)
**Context loaded:** `process/context/all-context.md`, `process/context/tests/all-tests.md` (router — no deeper test docs exist yet; existing blast-radius test files discovered: `packages/core/src/services/outage.integration.spec.ts` (PGlite pattern), `outage.spec.ts`, `mikrotik.spec.ts`)

## Overview

Today `/networks` shows one row — the router's single hotspot interface (`vlan70 hotspot`). Several physical Suncomm AP3000G outdoor APs sit behind that one interface on shared VLAN 70. Phase A makes the MikroTik router's DHCP lease table (with OLT-inserted Option 82 `agent-circuit-id`) the source of per-AP identity and client attribution, so `/networks` shows one card per AP (or per honest AP-group when 2+ APs share an ONU), each with its own up/down status, client count, and (if the firmware exposes byte counters) traffic figure.

All 7 INNOVATE decisions are locked and user-approved — this plan implements them, it does not redesign:

1. **Schema (hybrid):** extend `network_health` with `mac` (nullable, unique), `apCircuitId`, `attributionSource`; PLUS one new table `network_client_attribution` (client MAC PK → circuitId, updatedAt) as the durable last-known-circuit cache. No AP-registry table. `name` semantics for AP rows = AP hostname.
2. **No persisted AP-group entity** — grouping computed at query/render time; UI shows an explicit shared indicator.
3. **Data flow:** existing per-minute cron snapshot + `NETWORK_HEALTH_STALE_MS` semantics unchanged; SSE overlay reads the computed snapshot.
4. **Join seam:** MikroTik provider gains RAW sampling only (leases, hotspot-active, pings); ALL interpretation lives in `packages/core/src/services/networkHealth.ts`. New controller methods are OPTIONAL; stub returns empty.
5. **Liveness:** lease presence (discovery) + ICMP ping (confirmatory). Pings parallelized (`Promise.all`) with short per-AP timeouts.
6. **Per-AP traffic:** per-session byte-counter summation from hotspot-active grouped by attribution; honest "unavailable" degradation; explicit agent-probe feasibility step; network-wide throughput figure untouched.
7. **UI:** extend existing `/networks` card grid to one card per AP/AP-group; KPI cards recompute over multiple rows; map pins per operator-pinned AP; no new drill-down page.

## Goals

- SPEC AC1–AC12 satisfied (traceability table in Acceptance Criteria Mapping below).
- Zero regression on the Regression-Safety Contract (below).
- Dev/stub environments boot and pass tests without a router.

## Out-Of-Scope Guard

- **Multi-router / multi-site** — the plan at `process/general-plans/active/multi-router-support_13-07-26/multi-router-support_PLAN_13-07-26.md` is REJECTED as a direction. Do NOT adopt, merge, or partially implement it. This work is single-router, multi-AP only.
- **Phase B (Fatap AP API)** — no code against the AP's JSON-RPC API. `attributionSource='ap-api'` is reserved vocabulary only.
- **Per-client RSSI / signal strength** — Phase B.
- **AP-side API calls** of any kind.
- **Customer-app UI/behavior changes** — only the shared `@veent/core` read-path (`resolveNetworkIdForMac`) changes internally; external behavior stays stable.
- **Enabling Option 82 on HUAWEI OLT-1** — external network config, not application code.

## Data Flow (architecture note)

Per refresh cycle (cron `POST /api/network/health/refresh` every minute, and best-effort on `/networks` page load — both call `refreshNetworkHealth(db, network)`):

1. **Interface sampling (unchanged):** `network.sampleHealth()` emits one sample per hotspot-bound interface (today: `vlan70 hotspot`) → upsert keyed on `name`. This row remains the network-wide row (network-wide users/throughput/latency, WAN probe).
2. **AP raw sampling (new, optional methods):** `network.listDhcpLeases()` → all DHCP leases with `mac / address / hostname / agentCircuitId / status`. Skipped entirely (no writes, no prune of AP rows) when the method is absent (stub) or throws.
3. **AP recognition (service-side, pure):** leases matching MAC OUI `E4:67:1E` OR hostname `OAP3000G-*` are APs. Identity keys on MAC, never IP (AC8).
4. **Liveness (new, parallel):** `network.pingHosts(apIps)` — provider runs pings in parallel with per-host timeout; service sets `online = aliveMs != null` (ping confirmatory per SPEC flow diagram); when `pingHosts` is unavailable, fall back to `online = lease.status === 'bound'`.
5. **Attribution cache upkeep:** every lease (guest or AP) carrying a NON-EMPTY `agentCircuitId` upserts `network_client_attribution (mac → circuitId, updatedAt)`. Blank/absent circuit-id (unicast renewal) never overwrites a cached value (AC6).
6. **Client attribution:** hotspot-active MACs → circuit-id via their current lease, else via the attribution cache → grouped per circuit-id. Devices with no circuit-id from either source are unattributed (network-wide only, AC7).
7. **AP row upsert:** keyed on new unique `mac` column; writes `name` (hostname), `online`, `latencyMs` (LAN ping RTT), `users` (attributed device count for its circuit-id group), `apCircuitId`, `attributionSource='circuit-id'`, `wanOk` (shared WAN probe result from step 1, default true), `lastSampleAt`, and the same offline/online-since CASE transition semantics the interface upsert uses.
8. **Prune:** auto-discovered rows (latitude IS NULL) whose `name` is NOT in (interface sample names ∪ AP row names this cycle). When the AP scan did not run, the prune additionally restricts to `mac IS NULL` rows so AP rows are never wiped by a stub/failed scan.
9. **Read path:** admin `listNetworkHealth` (also feeds `dashboardSnapshot` → SSE `/api/connected`) derives per-row staleness (`isNetworkHealthStale`, unchanged threshold), computes AP groups at render time, and the `/networks` page renders one card per AP/AP-group.
10. **Session attribution (cross-app):** `resolveNetworkIdForMac` first tries the attribution cache (mac → circuitId → AP row(s); deterministic lowest-id member for a group), then falls back to today's router `resolveApForMac` path unchanged. Feeds `sessions.ts` (networkId stamping), `outage.ts` (roamer check), and — indirectly, via the untouched `resolveApForMac`/`resolveNetworkIdByApName` combination — the customer checkout attribution.

## Touchpoints

| File | Change |
|---|---|
| `packages/db/src/schema/admin.ts` | `network_health`: add `mac` (+unique index), `apCircuitId`, `attributionSource`, `trafficBytes`; drop NOT NULL on `throughputMbps`. New table `networkClientAttribution`. |
| `packages/db/drizzle/0047_*.sql` (generated) | Migration for the above (single migration authority) |
| `packages/core/src/integrations/network/types.ts` | New optional `NetworkController` methods: `listDhcpLeases`, `listHotspotActive`, `pingHosts` + entry types |
| `packages/core/src/integrations/network/stub.ts` | Implement the 3 new methods returning empty results |
| `packages/core/src/integrations/network/mikrotik.ts` | Implement the 3 new methods (raw sampling only, parallel pings) |
| `packages/core/src/services/networkHealth.ts` | AP recognition, grouping, attribution-cache upkeep, AP-row upsert/prune, `resolveNetworkIdForMac` re-backing, traffic delta computation |
| `packages/core/src/services/networkHealth.integration.spec.ts` (new) | PGlite integration suite (mirrors `outage.integration.spec.ts` pattern) |
| `apps/admin/src/lib/server/queries.ts` | `listNetworkHealth`: select new columns, compute group peers, null-safe throughput, KPI-safe field exposure |
| `apps/admin/src/lib/types.ts` | `NetworkAp` type: `mac`, `apCircuitId`, `attributionSource`, `groupPeers`, nullable throughput |
| `apps/admin/src/routes/(app)/networks/+page.svelte` | Group-aware card rendering; KPI aggregation rules (exclude AP rows from throughput/latency sums) |
| `apps/admin/src/lib/components/feature/NetworkHealthCard.svelte` | Optional group props, shared-ONU indicator, "—" traffic state |
| `apps/admin/scripts/seed-test-data.ts` | AP-identity fixtures (mac/apCircuitId incl. one shared-circuit pair) for e2e |
| `apps/admin/e2e/networks.spec.ts` (new) | Playwright spec: per-AP cards, group card, KPI aggregation, stale chip, map pins |

Read-only blast-radius checks (no code change expected): `apps/customer/src/lib/server/network-location.ts`, `packages/core/src/services/{sessions.ts,outage.ts}`, `apps/locator/src/lib/server/locations.ts`, `apps/admin/src/routes/(app)/{dashboard,map}/+page.server.ts`, `apps/admin/src/routes/api/connected/+server.ts`, `packages/db/src/network-health.ts`.

## Public Contracts

- **`NetworkController` (extended, backward-compatible):** 3 NEW OPTIONAL methods. Existing methods and signatures unchanged. `resolveApForMac` implementation and semantics UNCHANGED (still CAPsMAN → wireless → ARP; returns interface name).
  - `listDhcpLeases?(): Promise<DhcpLeaseEntry[]>` — `{ mac: string (uppercased); address: string; hostname: string | null; agentCircuitId: string | null; status: string }`. Raw, no interpretation.
  - `listHotspotActive?(): Promise<HotspotActiveEntry[]>` — `{ mac: string (uppercased); address: string; bytesIn: number | null; bytesOut: number | null }`. `null` counters = firmware doesn't expose them (AC4 degradation signal).
  - `pingHosts?(addresses: string[], opts?: { timeoutMs?: number }): Promise<Array<{ address: string; aliveMs: number | null }>>` — MUST run pings concurrently; MUST bound each host by `timeoutMs` (default 1500ms); MUST never throw for an unreachable host (`aliveMs: null`).
- **`resolveNetworkIdForMac(db, network, mac): Promise<number | null>` — signature and external behavior contract STABLE** (cross-app: customer indirectly, core sessions/outage directly). New internal fast path (attribution cache) tried first; the existing router-lookup fallback is preserved byte-for-byte in behavior when the cache has no entry. Never throws. Group ambiguity resolves to the DETERMINISTIC lowest-id AP row sharing the circuit-id.
- **`network_health` table:** existing columns/semantics unchanged for interface and pinned rows. New nullable columns are additive. `throughputMbps` becomes NULLABLE (null = "traffic unavailable" for AP rows); all existing writers keep writing numbers. Rows with `attributionSource IS NOT NULL` are AP rows; `NULL` = interface/pinned rows (today's semantics).
- **`network_client_attribution` (new table):** `mac` text PK, `circuit_id` text NOT NULL, `updated_at` timestamptz NOT NULL default now. Internal to `@veent/core` service layer — no app reads it directly.
- **`refreshNetworkHealth(db, network): Promise<number>`** — signature unchanged; return value remains the interface-sample count (callers: cron route asserts nothing about it beyond JSON echo; `/networks` load ignores it).
- **Admin `NetworkAp` view type:** additive fields only; `throughput` display string may now be `'—'`.

## Blast Radius

- **Packages:** `packages/db` (schema + migration), `packages/core` (service + integration), `apps/admin` (queries, types, networks route, card component, e2e seed/spec). **`apps/customer` and `apps/locator`: read-only verification, zero code changes.**
- **File count:** ~12 modified + 2 new (test spec, e2e spec) + 1 generated migration.
- **Risk classes:** schema/data migration (additive — no destructive DDL); shared cross-app read-path (`resolveNetworkIdForMac` feeds customer session/payment attribution and the outage auto-pause sweep). NOT touched: auth, billing math, secrets, public API contracts, deploy surfaces. (No STRIDE pass required: no new trust boundary — circuit-id strings from the router are display/join data; Svelte auto-escapes rendering.)
- **Runtime surfaces:** per-minute cron budget (ping parallelization requirement), SSE dashboard snapshot shape (additive fields).

## `name` / `interfaceName` Reader Audit

Every reader of `network_health.name` and `network_health.interfaceName`, and what changes (verified against code at plan time):

| # | Reader | Location | Impact |
|---|---|---|---|
| 1 | `refreshNetworkHealth` upsert conflict target | `packages/core/src/services/networkHealth.ts:63-69` | CHANGES: interface rows keep `onConflictDoUpdate(target: name)`; AP rows upsert on new unique `mac` index. Name-collision edge handled (checklist 2.6). |
| 2 | `refreshNetworkHealth` prune | `networkHealth.ts:76-81` | CHANGES: prune name-set becomes union (interface names ∪ AP names); when AP scan skipped, prune restricted to `mac IS NULL` rows. Pinned-row protection (`latitude IS NULL` filter) unchanged. |
| 3 | `resolveNetworkIdByApName` | `networkHealth.ts:91-105` | SAFE, unchanged: prefers `interfaceName` binding, falls back to `name`. Router-returned interface names (`vlan70 hotspot`) still match the interface row. AP hostnames become additionally matchable names (harmless — no router path returns a hostname). |
| 4 | `resolveNetworkIdForMac` | `networkHealth.ts:112-125` | CHANGES internally (cache fast path first); signature/contract stable — see Public Contracts. |
| 5 | `listNetworkHealth` (orderBy + display) | `apps/admin/src/lib/server/queries.ts:345-435` | SAFE: `name` is display + sort only. Extended to select new columns; `users` stays session-based (`activeByNetwork`) so the KPI sum never double-counts. |
| 6 | `setNetworkInterface` action | `queries.ts:439-445`, `+page.server.ts:73-84` | SAFE, unchanged: operator binding by row id. |
| 7 | `setApRouterConfig` → `applyInterfaceLimit(apName: row.name, interfaceName: interfaceName ?? row.name)` | `queries.ts:453-464`, `+page.server.ts:90-134` | BEHAVIOR NOTE: for an AP row with no explicit interface binding, the fallback `row.name` is an AP hostname (not a router interface) → `resolveQueueTarget` fails → existing best-effort warning surfaces ("Caps saved, but the router did not accept them"). Graceful today by design; document in card UX copy for AP rows (checklist 4.4). No code change required for safety. |
| 8 | `wipeNetworks` / `deleteNetworkPlace` | `queries.ts` | SAFE: id-keyed. Wipe now also removes AP rows — acceptable (they re-auto-discover next cron). `network_client_attribution` is NOT wiped by these (cache is harmless without AP rows); noted, not changed. |
| 9 | Customer `resolveCheckoutNetworkId` (`ctx.ap` param + `resolveApForMac` → `resolveNetworkIdByApName`) | `apps/customer/src/lib/server/network-location.ts:205-273` | SAFE, unchanged: both inputs are router interface names; they resolve to the interface row exactly as today. Regression-covered (Verification Evidence G12). |
| 10 | `sessions.ts` networkId stamping | `packages/core/src/services/sessions.ts:273-281` | SAFE: consumes `resolveNetworkIdForMac` (stable contract). New sessions will start attributing to AP rows — intended (AC3, AC10). Pre-existing sessions keep their old networkId (transition note below). |
| 11 | `outage.ts` sweep + roamer check | `packages/core/src/services/outage.ts:75-168` | INTERPLAY (no code change): AP rows now participate in the sweep (`online=false` + debounce ⇒ pause guests attributed to that AP). Intended behavior, flagged as Risk R3 with regression evidence (G13). |
| 12 | Locator `listPublicLocations` | `apps/locator/src/lib/server/locations.ts` | SAFE: coords-only rows; AP rows only appear if an operator pins coordinates (deliberate opt-in). No code change. |
| 13 | Seeds/sims: `packages/db/src/seed.ts`, `apps/admin/scripts/{seed-test-data,simulate-live}.ts` | scripts | SAFE: existing fixtures keep working (new columns nullable). `seed-test-data.ts` extended with AP fixtures (checklist 4.6). |
| 14 | `NetworkHealthCard.svelte` (`ap.name` display, `interfaceName` form field) | `apps/admin/src/lib/components/feature/NetworkHealthCard.svelte` | Extended for group props; name display unchanged. |
| 15 | Dashboard / Map / SSE (`listNetworkHealth` consumers) | `(app)/dashboard/+page.server.ts`, `(app)/map/+page.server.ts`, `api/connected/+server.ts` → `dashboardSnapshot` | SAFE: additive `NetworkAp` fields flow through automatically; snapshot shape additive. |
| 16 | `InterfaceLimitInput.apName/interfaceName` doc contract | `packages/core/src/integrations/network/types.ts:52-63` | SAFE: unchanged; doc comment already states `interfaceName ?? name` fallback (see #7). |

## Regression-Safety Contract (must NOT change)

1. **Staleness banner semantics:** page-level "router unreachable" banner still requires ALL rows stale (`+page.svelte` `routerUnreachable`); per-row "Stale" chip logic (`isNetworkHealthStale`, 3-min threshold) untouched.
2. **Operator-pinned rows survive prune** (latitude-set rows never deleted by the sweep) — including pinned AP rows.
3. **Network-wide KPIs stay correct:** users KPI = sum of session-based per-row counts (each session counted once — no double count); throughput and latency KPIs computed over NON-AP rows only (AP throughput is a subset of the interface figure; AP latency is LAN RTT, not internet RTT).
4. **Customer session/payment attribution unbroken:** `resolveCheckoutNetworkId` order and outcomes unchanged; `resolveNetworkIdForMac` returns exactly today's result whenever the attribution cache has no entry for the MAC.
5. **Stub controller keeps dev boot green:** `NETWORK_CONTROLLER=stub` refresh is a no-op for AP rows (empty leases → AP portion skipped, seeded rows untouched).
6. **Network-wide throughput figure untouched:** the interface row's `throughputMbps` computation in `sampleHealth` is not modified.
7. **Outage sweep debounce semantics unchanged** (offline_since/online_since CASE logic reused verbatim for AP rows, not reinvented).
8. **Cron budget:** refresh completes well inside the 60s cadence (Sentry `maxRuntime: 5` min); ping parallelization enforced by test.

## Risk Predictions (pre-implementation debate, condensed)

- **R1 — Parallel pings / RouterOS API concurrency (Performance):** serial 1.5s-timeout pings across N down APs would add N×1.5s; parallel is mandatory. UNKNOWN: whether `node-routeros` multiplexes concurrent `conn.write('/ping', …)` calls safely on one connection (it tags channels, but this is unverified on our pinned 1.6.9). Mitigation: checklist 3.3 verifies empirically at EXECUTE; fallback design pre-approved — bounded-concurrency chunks (e.g. 4 at a time) or a second short-lived connection; total ping budget hard-capped ≤ 6s. Wall-clock unit test with fake timers proves concurrency (note: MUST run via `bunx vitest run`, never `bun test <file>` — bun's native runner silently no-ops `vi.setSystemTime`).
- **R2 — Prune/upsert integrity (Data):** two failure modes: (a) AP rows wiped when the AP scan silently fails → guarded by the `mac IS NULL` prune restriction; (b) `name` unique-index collision when an AP hostname equals an existing row name or two APs share a hostname → deterministic dedupe (checklist 2.6): on name conflict, AP row name becomes `${hostname} (${last-4-of-MAC})`. Both PGlite-tested.
- **R3 — Outage-sweep interplay (Customer impact):** AP rows entering `network_health` means a ping-dead AP can auto-pause guests attributed to it after the down-debounce. Intended (guests on a dead AP have no service) — but a false AP-down (ICMP filtered) would freeze paid time. Mitigations: research confirmed AP3000G answers ICMP; debounce absorbs transient loss; `wanOk` for AP rows carries the shared WAN probe (a WAN-only outage doesn't double-trigger per-AP). Regression evidence G13 + post-deploy AC12 probe.
- **R4 — Attribution-cache staleness (Data):** a device that physically moves to another AP updates its cache row on the next DHCP interaction carrying circuit-id; between renewals the count is stale by ≤ lease/renewal interval. Accepted (SPEC AC6 explicitly wants last-known tolerance); honesty preserved because unattributed devices are never fabricated into counts.
- **R5 — Session-attribution shift (Ops):** new sessions stamp AP-row ids instead of the interface-row id. Pre-existing active sessions keep old ids → per-AP session counts ramp up naturally over ~hours. Transition note only; no backfill (fabricating attribution for old sessions would violate SPEC honesty).

Edge cases folded into checklist items: empty lease table; lease with hostname but foreign OUI (recognized via hostname — both signals are OR); AP lease in `offered`/`waiting` state (discovered, `online` decided by ping); duplicate MACs across DHCP server instances (dedupe by MAC keeping the `bound` lease); circuit-id present on AP lease but absent on all client leases (AP row exists, users=0); hotspot-active entry with no matching lease and no cache row (unattributed, AC7); negative traffic delta after session churn (clamp to 0).

## Implementation Checklist

> Ordering per INNOVATE (code reality agrees): schema → core service (+PGlite tests) → provider raw sampling → admin UI → traffic probe. Section 5 is parallel-safe after Section 3 and gates only the traffic column. Each section ends with its Level-1 test gate; run gates per section, do not batch to the end.

### Section 1 — Schema migration (packages/db)

- [ ] **1.1** `packages/db/src/schema/admin.ts` — extend `networkHealth`:
  - `mac: text('mac')` (nullable) + `uniqueIndex('network_health_mac_key').on(t.mac)` (Postgres permits multiple NULLs — interface/pinned rows unaffected)
  - `apCircuitId: text('ap_circuit_id')` (nullable — raw OLT circuit-id string, e.g. `"OLT-9 xpon 0/1/0/4:16.3.70"`)
  - `attributionSource: text('attribution_source')` (nullable; Phase A writes `'circuit-id'`; `'ap-api'` reserved for Phase B)
  - `trafficBytes: bigint('traffic_bytes', { mode: 'number' })` (nullable — last cumulative attributed byte sum, Section 5 delta basis)
  - `throughputMbps` → remove `.notNull()` (keep `.default(0)`); null = "traffic unavailable"
- [ ] **1.2** Same file — add `networkClientAttribution` table: `mac` text PK, `circuitId: text('circuit_id').notNull()`, `updatedAt: timestamp('updated_at').notNull().defaultNow()`. Doc comment: durable last-known-circuit-per-client cache tolerating unicast renewals that omit agent-circuit-id.
- [ ] **1.3** Confirm the new table exports through `packages/db/src/schema/index.ts` (follow the existing export pattern for `networkHealth`).
- [ ] **1.4** Generate the migration file for the record: `bun run --filter @veent/db db:generate` → expect `packages/db/drizzle/0047_*.sql`. **Dev DB is push-managed (journal-drift gotcha):** do NOT run `db:migrate` locally; verify by applying the generated DDL directly to the dev DB (psql against `DATABASE_URL`, or `bun run --filter @veent/db db:push`) AND keep the generated migration file committed for the record.
- [ ] **1.5** Gate: migration validity is proven by Section 2's PGlite suite (it runs `migrate()` over `packages/db/drizzle/` — real migration chain, catches drift). Interim: `bun run --filter @veent/core test` still green (schema is additive).

### Section 2 — Core service: recognition, attribution, upsert (packages/core)

- [ ] **2.1** `packages/core/src/integrations/network/types.ts` — add `DhcpLeaseEntry`, `HotspotActiveEntry` types and the 3 optional `NetworkController` methods exactly as specified in Public Contracts (JSDoc each: raw-only, no interpretation, provider-agnostic).
- [ ] **2.2** `packages/core/src/integrations/network/stub.ts` — implement `listDhcpLeases` → `[]`, `listHotspotActive` → `[]`, `pingHosts` → `addresses.map(a => ({ address: a, aliveMs: null }))`, each logging intent like existing stub methods (locked decision: stub returns empty, dev never breaks).
- [ ] **2.3** `packages/core/src/services/networkHealth.ts` — exported pure helpers (unit-testable without DB):
  - `AP_MAC_OUI = 'E4:67:1E'`, `AP_HOSTNAME_RE = /^OAP3000G-/i`
  - `recognizeAccessPoints(leases)` → AP leases (OUI match OR hostname match; dedupe by MAC preferring `status === 'bound'`)
  - `computeApGroups(apRows)` → Map circuitId → member rows (2+ members = shared-ONU group)
- [ ] **2.4** Extract the existing offline/online-since CASE upsert logic into a shared internal helper so the AP upsert reuses it verbatim (Regression contract #7 — do NOT duplicate the SQL by hand).
- [ ] **2.5** Extend `refreshNetworkHealth` with the AP portion (Data Flow steps 2–8): guard on `network.listDhcpLeases` presence; try/catch the whole AP portion so a router hiccup degrades to interface-only refresh; attribution-cache upsert (`ON CONFLICT (mac) DO UPDATE`) ONLY for non-empty circuit-ids; per-circuit-id device counts from hotspot-active (lease circuit-id, else cache); ping via `network.pingHosts` (fallback `online = status === 'bound'` when absent); `wanOk` for AP rows = interface sample's shared `wanReachable ?? true`.
- [ ] **2.6** AP row upsert keyed on `mac` (`onConflictDoUpdate(target: networkHealth.mac)`), writing name/online/wanOk/users/latencyMs/apCircuitId/attributionSource/lastSampleAt + since-transitions. Name-collision edge: catch the `network_health_name_key` unique violation and retry once with `${hostname} (${mac.slice(-5).replace(':','')})`; hostname-less AP names as `AP ${mac}`.
- [ ] **2.7** Prune update: name-set = interface sample names ∪ AP names written this cycle; when the AP portion did not run, add `isNull(networkHealth.mac)` to the delete predicate. Pinned protection (`isNull(latitude)`) unchanged.
- [ ] **2.8** `resolveNetworkIdForMac` re-backing: (a) cache lookup `network_client_attribution` by uppercased MAC; (b) on hit, select AP rows `where apCircuitId = circuitId` ordered by id asc, return first id; (c) on miss/no-row, existing `resolveApForMac` → `resolveNetworkIdByApName` path UNCHANGED; (d) still never throws.
- [ ] **2.9** New PGlite suite `packages/core/src/services/networkHealth.integration.spec.ts` mirroring `outage.integration.spec.ts` (real migrations via `drizzle-orm/pglite/migrator`, fake `NetworkController`). Scenarios = Verification Evidence G1–G10, G13 rows below (each test name matches its gate scenario verbatim).
- [ ] **2.10** Gate (run before Section 3): `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` then full `cd packages/core && bun run test` (outage regression included). NEVER `bun test <file>` (fake-timer no-op gotcha per `process/context/tests/all-tests.md`).

### Section 3 — MikroTik provider: raw sampling + parallel pings (packages/core)

- [ ] **3.1** `mikrotik.ts` `listDhcpLeases`: `conn.write('/ip/dhcp-server/lease/print')` → map `mac-address` (uppercase), `address`, `host-name` → hostname, `agent-circuit-id` → agentCircuitId (raw string pass-through; treat empty string as null), `status`. **EXECUTE-time verification (agent probe, read-only):** confirm the exact Option 82 field key on the live router (`agent-circuit-id` was observed in RESEARCH; if the API print exposes it under a different key, adjust mapping — do not guess).
- [ ] **3.2** `mikrotik.ts` `listHotspotActive`: `conn.write('/ip/hotspot/active/print')` → map `mac-address` (uppercase), `address`, `bytes-in`/`bytes-out` → `Number(...)` or `null` when the field is absent (this null is the AC4 degradation signal — never coerce absent to 0).
- [ ] **3.3** `mikrotik.ts` `pingHosts` — **dedicated flagged-risk step (R1):** per-host `conn.write('/ping', ['=address=X', '=count=2'])` wrapped in the existing `withTimeout` helper (default 1500ms/host), reusing `rttToMs`; run hosts via `Promise.all`. EXECUTE MUST empirically verify concurrent writes on one `node-routeros` connection behave (probe with 3+ simultaneous pings against the live router); if unsafe, implement the pre-approved fallback: bounded concurrency (chunks of 4) or one extra short-lived connection for pings. Hard budget assertion: total wall-clock ≤ `timeoutMs × ceil(n/concurrency)`, target ≤ 6s for 10 APs.
- [ ] **3.4** Confirm `traceMethods` wraps the new methods at the factory seam (it wraps provider methods generically in `index.ts:46` — verify new methods appear as `network.mikrotik.*` spans; adjust only if it whitelists method names).
- [ ] **3.5** Unit test (mocked conn, fake timers) proving pings are concurrent, per-host timeout works, unreachable host → `aliveMs: null` without throwing. Runner: `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` (extend the existing spec file).
- [ ] **3.6** Gate: `cd packages/core && bun run test` green.

### Section 4 — Admin UI: cards, groups, KPIs (apps/admin)

- [ ] **4.1** `apps/admin/src/lib/types.ts` `NetworkAp`: add `mac: string | null`, `apCircuitId: string | null`, `attributionSource: string | null`, `groupPeers: string[]` (names of OTHER APs sharing this circuit-id), and make the formatted `throughput` able to carry `'—'`.
- [ ] **4.2** `queries.ts` `listNetworkHealth`: select new columns; compute `groupPeers` from rows sharing a non-null `apCircuitId` with `attributionSource='circuit-id'`; format `throughput` as `'—'` when `throughputMbps` is null; `users` stays session-based (`activeByNetwork`) — unchanged code path (KPI-sum correctness, Regression #3).
- [ ] **4.3** `+page.svelte`: render one card per AP-GROUP for grouped rows (2+ sharing circuit-id) — combined card lists each member with its own status dot/label (per-AP up/down stays independent, AC2), combined users = sum of member users, explicit indicator text ("Shared ONU — router cannot split these N APs", AC5). Ungrouped rows render as today. KPI adjustments: `cntHealthy/cntDegraded/cntOffline/usersTotal/alerts` remain per-ROW; `tputTotal` and `avgLat` computed over rows with `attributionSource === null` ONLY (Regression #3, no double-count/LAN-RTT pollution).
- [ ] **4.4** `NetworkHealthCard.svelte`: optional `group` prop `{ members: { name, tone, status }[] }`; shared-ONU badge; traffic cell renders `'—'` with a "per-AP traffic unavailable on this firmware" tooltip when null; note in the config editor for AP rows that speed caps require an explicit interface binding (Reader Audit #7).
- [ ] **4.5** After editing `.svelte` files: run the Svelte MCP autofixer on changed components and re-run until clean (per project MCP instruction).
- [ ] **4.6** `apps/admin/scripts/seed-test-data.ts`: add AP fixtures — 2 APs sharing one circuit-id (group), 1 solo AP with distinct circuit-id, 1 offline AP (`online=false`), all with `mac`/`apCircuitId`/`attributionSource='circuit-id'`; keep existing 6 rows untouched.
- [ ] **4.7** New e2e spec `apps/admin/e2e/networks.spec.ts`: `/networks` shows one card per solo AP + one combined group card with the shared indicator; KPI users total equals per-row session sum; offline AP shows offline while others healthy; stale rows show the stale chip; map renders pins only for coordinate-set rows. (Follow harness rules in `process/context/tests/all-tests.md`: throwaway DB, `NETWORK_CONTROLLER='stub'`, storageState auth, serial workers.)
- [ ] **4.8** Gates: `cd apps/admin && bun run check`; `cd apps/admin && bunx vitest run --passWithNoTests`; e2e scoped: `cd apps/admin && bun run test:e2e -- e2e/networks.spec.ts` (precondition: local Postgres for the throwaway `radius_admin_test` DB + Chromium installed).

### Section 5 — Per-AP traffic: probe + degradation wiring (parallel-safe; gates only the traffic column)

- [ ] **5.1** **Agent probe (AC4 verification item, read-only against the live router):** with the admin's configured MikroTik connection, print `/ip/hotspot/active` and record whether `bytes-in`/`bytes-out` exist and increase across two samples ~60s apart. Record verdict + raw output in the phase report. Cost-class: cheap (read-only query on already-configured router).
- [ ] **5.2** If counters PRESENT: in `refreshNetworkHealth` AP portion, per circuit-id group sum `bytesIn+bytesOut` over attributed hotspot-active entries; rate = `clamp0((sum − trafficBytes_prev) × 8 / elapsedSec / 1e6)` with `elapsedSec` from the row's previous `lastSampleAt`; write `throughputMbps = Math.round(rate)`, `trafficBytes = sum`. Session churn ⇒ negative delta ⇒ clamp to 0 (never fabricate). First sample after boot writes `trafficBytes` and leaves `throughputMbps` null.
- [ ] **5.3** If counters ABSENT: leave AP `throughputMbps`/`trafficBytes` null → UI shows `'—'` (already wired in 4.2/4.4). Nothing else changes — honest degradation, network-wide figure untouched.
- [ ] **5.4** Fully-automated tests regardless of probe outcome: pure delta-computation function tests (incl. negative-delta clamp, first-sample null) + PGlite test for the null-counter degradation path. Fake timers via `bunx vitest run` only.
- [ ] **5.5** Gate: `cd packages/core && bun run test` green.

### Final regression gate (after all sections)

- [ ] **F.1** `bun run check` (all apps) → `bun test` (root fan-out: 3 apps + core) → lint. **Lint gotcha:** root `bun run lint` has a KNOWN pre-existing repo-wide failure (prettier `tailwindStylesheet` path drift — see `process/context/tests/all-tests.md` Known Gaps); run `bunx eslint apps/admin packages/core packages/db` + `cd apps/admin && bunx prettier --check src` instead and do not chase the pre-existing root failure.
- [ ] **F.2** Admin e2e regression (touched surface only): `cd apps/admin && bun run test:e2e -- e2e/networks.spec.ts`. Full e2e suite optional (3/10 specs have documented pre-existing flaky residuals — do not chase).
- [ ] **F.3** Browser-visible change: agent browser pass on `/networks` (stub + seeded data) AND human verification handoff (project rule — both required before "done").

## Phase Completion Rules

- A section is **CODE DONE** when its checklist items are implemented and its own gate commands pass locally.
- A section is **VERIFIED** only when: all Fully-Automated gates green + Hybrid gates green with preconditions met + its Agent-Probe items have recorded verdicts + no Regression-Safety Contract line violated.
- AC12 (live up/down sanity) can only be VERIFIED post-deploy against the real router — it stays an explicit open item on the phase report until the user confirms (AP-Corrales is a known genuinely-offline AP usable as the negative case).
- Do not mark the plan ✅ VERIFIED without the F.3 human verification handoff (user-confirmed).

## Acceptance Criteria Mapping (SPEC → plan steps → proof)

| SPEC AC | Implemented by | proven by (gate) | strategy |
|---|---|---|---|
| AC1 AP auto-discovery | 2.3, 2.5, 2.6, 3.1 | G1 | Fully-Automated |
| AC2 Per-AP up/down | 2.5, 3.3 | G2 | Fully-Automated |
| AC3 Per-AP client count | 2.5, 2.8 (session path), 4.2 | G3 | Fully-Automated |
| AC4 Per-AP traffic | 5.1–5.4 | G14 (probe) + G15 (degradation) | Agent-Probe + Fully-Automated (degradation path) |
| AC5 Shared-relay honesty (AP group) | 2.3 (computeApGroups), 4.3 | G4 (service) + G11 (e2e render) | Fully-Automated + Hybrid |
| AC6 Attribution tolerates missing circuit-id | 2.5 (cache upsert rule), 2.8 | G5 | Fully-Automated |
| AC7 Unattributable counted network-wide only | 2.5 | G6 | Fully-Automated |
| AC8 AP identity keyed on MAC | 1.1 (unique mac), 2.6 | G7 | Fully-Automated |
| AC9 Staleness extends per-AP | 2.5/2.7 (lastSampleAt semantics), read-side unchanged | G8 + G11 (stale chip) | Fully-Automated + Hybrid |
| AC10 Guest-session-to-AP lookup | 2.8 | G9 | Fully-Automated |
| AC11 Existing /networks features preserved | 4.1–4.7 | G11 | Hybrid (existing Playwright harness — deterministic once throwaway-DB precondition is met; SPEC labeled it Fully-Automated, refined here because of the local-Postgres/Chromium precondition) |
| AC12 Live up/down sanity | deploy + live check | G16 | Agent-Probe |

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| G1 — seeding a synthetic AP-signature DHCP lease creates a new network_health row (PGlite, fake controller) | Fully-Automated | AC1 |
| G2 — two AP fixtures, one ping-alive one not → their `online` fields differ | Fully-Automated | AC2 |
| G3 — devices attributed to AP-1's circuit-id do not count toward AP-2 (`users` write + `resolveNetworkIdForMac` per-AP ids) | Fully-Automated | AC3 |
| G4 — two AP fixtures with identical circuit-id → `computeApGroups` yields one group; both rows carry the shared circuit-id | Fully-Automated | AC5 |
| G5 — lease renewal with blank circuit-id does not overwrite the attribution cache; device retains prior AP attribution | Fully-Automated | AC6 |
| G6 — device with no circuit-id ever: excluded from every AP row's count, still visible in network-wide interface sample | Fully-Automated | AC7 |
| G7 — AP lease renews to a new IP → same row updated in place by MAC, no duplicate | Fully-Automated | AC8 |
| G8 — AP row absent from current scan keeps its old `lastSampleAt` (stale-derivable) and is NOT pruned when pinned / when AP scan skipped | Fully-Automated | AC9 (+Regression #1,#2,#5) |
| G9 — MAC with cache entry resolves to the correct AP id; group MAC resolves to deterministic lowest-id member | Fully-Automated | AC10 |
| G10 — MAC with NO cache entry falls through to today's router path with identical result; stub refresh leaves seeded rows untouched | Fully-Automated | Regression #4, #5 |
| G11 — Playwright `/networks`: per-AP cards, one combined group card + indicator, KPI aggregation, stale chip, map pins (precondition: throwaway `radius_admin_test` DB + Chromium) | Hybrid | AC11, AC5, AC9 (render), Regression #1, #3 |
| G12 — customer attribution regression: `resolveNetworkIdByApName('vlan70 hotspot')` still returns the interface row; `resolveCheckoutNetworkId` inputs unchanged (assert via PGlite service test) | Fully-Automated | Regression #4 |
| G13 — outage-sweep interplay: existing `outage.integration.spec.ts` stays green with AP rows present in fixtures (extend one fixture set) | Fully-Automated | Regression #7, Risk R3 |
| G14 — live-router probe: hotspot-active byte counters present & monotonic? (recorded verdict, read-only) | Agent-Probe | AC4 (feasibility) |
| G15 — traffic delta math: rate computation, negative-delta clamp, first-sample null; null-counter path leaves throughput null → UI `'—'` | Fully-Automated | AC4 (degradation) |
| G16 — post-deploy live check: one genuinely-offline AP shows offline, one genuinely-online AP shows online (AP-Corrales = negative case) | Agent-Probe | AC12 |
| G17 — ping concurrency: mocked-conn fake-timer test proves parallel execution + per-host timeout + never-throws (`bunx vitest run`) | Fully-Automated | Risk R1 / Regression #8 |

No SPEC acceptance criterion for developed behavior rests on Known-Gap alone (vacuous-green ban honored): AC4's mechanism is Agent-Probe-gated with a Fully-Automated degradation branch; AC12 is Agent-Probe by nature (live deployment truth).

**TDD stubs (red-first starting points for EXECUTE — scenario names match gates verbatim, not written to disk before EXECUTE):**

```
test("G1: seeding a synthetic AP-signature DHCP lease creates a new network_health row", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G1") })
test("G2: two AP fixtures, one ping-alive one not, differ in online", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G2") })
test("G3: devices attributed to AP-1 do not count toward AP-2", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G3") })
test("G4: identical circuit-id fixtures form one AP group", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G4") })
test("G5: blank circuit-id renewal keeps prior attribution", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G5") })
test("G6: never-attributed device counts network-wide only", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G6") })
test("G7: AP lease IP change updates the same MAC-keyed row", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G7") })
test("G8: absent AP keeps lastSampleAt; pinned/skipped-scan rows survive prune", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G8") })
test("G9: cache-backed resolveNetworkIdForMac returns AP id (lowest-id for groups)", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G9") })
test("G10: cache-miss falls back to router path; stub refresh leaves seeds untouched", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G10") })
test("G12: interface-name resolution for customer attribution unchanged", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G12") })
test("G15: traffic delta math + degradation to null", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G15") })
test("G17: pingHosts runs concurrently with per-host timeout and never throws", () => { throw new Error("NOT IMPLEMENTED — TDD stub: G17") })
```

**Gap resolution:** G11 precondition unavailable in some environments → A) run locally with `docker`-less Postgres per `compose.yaml` (`db:start`); C) if genuinely unavailable, record as environment gap and rely on G1–G10 + F.3 browser pass — NOT acceptable as a terminal state for AC11 (high-visibility UI surface); D) backlog stub if deferred. G14/G16 need the live router → run at EXECUTE (G14) and post-deploy (G16); if the router is unreachable at EXECUTE time, G14 verdict = INCONCLUSIVE → ship the degradation branch (throughput null) and file a backlog note to re-probe.

## Known-Gaps carried from SPEC (named residuals — not proving strategies)

| Gap | Disposition |
|---|---|
| Per-client signal strength / RSSI | Phase B (Fatap API) — out of scope, backlog remains in SPEC's deferred-scope section |
| Exact-AP attribution within a shared-ONU group | Phase B — Phase A renders the honest group card instead (AC5) |
| APs behind OLT-1 unattributed until Option 82 enabled there | External dependency (user's Huawei GPON config); devices remain network-wide-counted (AC7 behavior) |
| AP-Corrales physically offline | Live reality, not a defect — reserved as the AC12 negative test case |
| Per-AP traffic if firmware hides byte counters | Honest `'—'` state ships (G15); backlog note to revisit after G14 verdict |

## Dependencies

- **Internal ordering:** Section 1 → 2 → 3 → 4; Section 5 after 3 (parallel-safe with 4). PGlite suite (2.9) also validates the 0047 migration.
- **External:** live router reachable for G14/3.1/3.3 empirical checks (admin `MIKROTIK_*` env already configured); OLT-1 Option 82 enablement is NOT a dependency of this plan (graceful absence is designed in).
- **No new npm dependencies.** No new env vars. RouterOS command paths (`/ip/dhcp-server/lease/print`, `/ip/hotspot/active/print`, `/ping`) all follow existing in-repo `conn.write` usage patterns — no unverified library API surface (docs-seeker not required beyond the in-code patterns already proven on this router during RESEARCH).

## Test Infra Improvement Notes

- `process/context/tests/all-tests.md` "Quick Routing" still has no deeper docs; if the PGlite service-suite pattern is reused a third time (outage, now networkHealth), consider extracting a `tests/pglite-integration.md` doc at UPDATE PROCESS.
- Repo-wide root `bun run lint` prettier drift remains an open backlog item (incident-management backlog) — this plan works around it (F.1), does not fix it.

## Resume and Execution Handoff

1. **Selected plan file:** `process/general-plans/active/per-ap-visibility_16-07-26/per-ap-visibility_PLAN_16-07-26.md` (this file — single plan, no umbrella, no supporting phase files).
2. **Last completed phase/step:** PLAN written; VALIDATE (PVL) complete — validate-contract below is `Gate: PASS`. Next: EXECUTE.
3. **Validate-contract status:** written (16-07-26) — `Gate: PASS`, `generated-by: outer-pvl`.
4. **Supporting context loaded:** `process/context/all-context.md`, `process/context/tests/all-tests.md`, SPEC in this task folder; code touchpoints verified at plan time against `feat/multi-controller` @ `e5a3047`.
5. **Next step for a fresh agent mid-execution:** find the first unchecked checklist item above; each section's gate commands are inline; the section boundaries are the safe resume points. If the schema is already migrated locally but 0047 is missing from `packages/db/drizzle/`, regenerate it (1.4) before continuing. Test runner rule: `bunx vitest run <file>`, never `bun test <file>`.

## Validate Contract

Status: PASS
Date: 16-07-26
date: 2026-07-16
generated-by: outer-pvl

Parallel strategy: parallel-subagents (validate fan-out); executed Simple Mode in-thread (self-contained COMPLEX plan, fresh context)
Rationale: 4/7 HIGH — signals S1 (multi-package: db+core+admin), S2 (schema/contract surface), S6 (high-risk class: additive schema migration + cross-app read-path), S7 (5+ files, ~14). Dominant signal: multi-package + schema. Fan-out = 4 Layer-1 + 5 Layer-2 = 9 agents, under the 30 cost-guard.

### Test gates (C3 5-column table — ADDITIVE; legacy line form retained below)

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1 | AP auto-discovery creates a network_health row from an AP-signature lease | Fully-Automated | `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` (G1) | A |
| AC2 | Per-AP up/down reflects that AP's own reachability | Fully-Automated | same suite, G2 (ping-alive vs not) | A |
| AC3 | Per-AP client count counts only that AP's attributed devices | Fully-Automated | same suite, G3 | A |
| AC4 (mechanism) | Per-AP traffic figure from byte counters | Agent-Probe | `/ip/hotspot/active` printed twice ~60s apart on live router; record verdict (G14) | C (deferred to EXECUTE probe; if router unreachable → INCONCLUSIVE, ship degradation) |
| AC4 (shipped) | Honest `'—'` degradation when counters absent | Fully-Automated | `cd packages/core && bun run test` — delta math + null-counter path (G15) | A |
| AC5 | 2+ APs sharing circuit-id render as one honest group | Fully-Automated (service) + Hybrid (render) | G4 service test; `cd apps/admin && bun run test:e2e -- e2e/networks.spec.ts` (G11) | A / B |
| AC6 | Blank-circuit-id renewal keeps last-known attribution | Fully-Automated | integration suite G5 | A |
| AC7 | Unattributable device counted network-wide only | Fully-Automated | integration suite G6 | A |
| AC8 | AP identity keyed on MAC (survives IP change) | Fully-Automated | integration suite G7 | A |
| AC9 | Staleness/offline extends per-AP | Fully-Automated + Hybrid | integration suite G8; e2e stale chip (G11) | A / B |
| AC10 | Guest-session-to-AP lookup via resolveNetworkIdForMac | Fully-Automated | integration suite G9 | A |
| AC11 | Existing /networks features preserved (KPI, map, pin) | Hybrid | `cd apps/admin && bun run test:e2e -- e2e/networks.spec.ts` (G11) — precondition: local Postgres `radius_admin_test` + Chromium | B |
| AC12 | Live up/down sanity (real deployment) | Agent-Probe | post-deploy check: AP-Corrales offline / a live AP online (G16) | C (post-deploy) |
| Regression #4 | Customer attribution unbroken (interface-name path) | Fully-Automated | integration suite G12 | A |
| Regression #7 / R3 | Outage-sweep stays green with AP rows present | Fully-Automated | `cd packages/core && bunx vitest run src/services/outage.integration.spec.ts` (G13) | A |
| R1 / Regression #8 | pingHosts concurrent + per-host timeout + never-throws | Fully-Automated | `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` (G17, fake timers) | A |
| Migration 0047 | Additive migration applies over the committed chain | Fully-Automated | PGlite `migrate()` over `packages/db/drizzle/` inside G1–G13 suite | A |

gap-resolution legend: A — proven now (gate passes this cycle) · B — gate added by this plan's checklist · C — deferred to a named later phase/live check · D — backlog test-building stub.

C-4 reconciliation: the `strategy` column carries only the 3 proving strategies (Fully-Automated / Hybrid / Agent-Probe). Known-Gap is never a strategy — the SPEC-carried known-gaps (RSSI, exact-AP within ONU, OLT-1 pre-Option-82) are named residuals in the plan's "Known-Gaps carried from SPEC" table, not rows here.

Legacy line form (retained so existing validate-contract consumers still parse):
- Core service (packages/core): Fully-automated: `cd packages/core && bun run test` AND `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` (G1–G10, G12, G13, G15)
- MikroTik provider (packages/core): Fully-automated: `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` (G17 concurrency/timeout)
- Schema migration (packages/db): Fully-automated: PGlite chain `migrate()` inside the core integration suite; generate for record via `bun run --filter @veent/db db:generate`
- Admin UI (apps/admin): Hybrid: `cd apps/admin && bun run test:e2e -- e2e/networks.spec.ts` (G11 — precondition: local Postgres `radius_admin_test` DB + Chromium) + `cd apps/admin && bun run check`
- Per-AP traffic counters (live router): Agent-probe: `/ip/hotspot/active` two-sample monotonicity check (G14)
- Live up/down (deployment): Agent-probe: post-deploy AP-Corrales negative case (G16)
- Full regression gate: Fully-automated: `bun run check` (all apps) → `bun test` (root fan-out) → scoped lint `bunx eslint apps/admin packages/core packages/db` + `cd apps/admin && bunx prettier --check src` (root `bun run lint` has known pre-existing prettier drift — do not chase)

Failing stub (Fully-Automated rows — copied verbatim from the plan's TDD stub block; execute-agent's red-first starting points): G1, G2, G3, G5, G6, G7, G8, G9, G10, G12, G15, G17 stubs are in the plan's "TDD stubs" code block above. Hybrid (G11) and Agent-Probe (G14/G16) rows receive no stub.

### Dimension findings

- Infra fit: PASS — no container/worker/proxy; migration 0047 is the correct next number (chain at 0046); stub keeps dev boot green; no new env vars; push-managed dev-DB handled correctly (1.4). Cron-budget bounded by R1 + G17.
- Test coverage: PASS — runners correct (`bunx vitest run <file>` fake-timer gotcha honored); PGlite pattern verified real against `outage.integration.spec.ts`; e2e throwaway-DB + stub controller correct; scoped-lint workaround for known root prettier drift correct. Residual (execute-instruction E1): PGlite real-Postgres fidelity gap on NEW timestamp SQL — mitigated by reusing the verbatim already-fixed CASE helper (2.4).
- Breaking changes: PASS — NetworkController extended with 3 OPTIONAL methods (backward-compatible); `resolveNetworkIdForMac` contract stable; columns additive; `throughputMbps`→nullable safe (writers still write numbers); 16-row Reader Audit thorough. Residual (execute-instruction E2): confirm null-safety of the nullable widening across SSE/dashboard readers.
- Security surface: PASS — no new trust boundary; circuit-id is OLT-relay-inserted (Option 82), not client-settable, used for display/join only; MAC drives attribution display/grouping only, never authz; migration purely additive → does NOT trigger the mandatory risk-evidence-pack; Svelte auto-escapes. Plan's "no STRIDE required" assessment confirmed correct.
- Section 1 (Schema) feasibility: PASS — confirmed name unique index (admin.ts:158) + throughputMbps notNull (126); additive columns + NOT-NULL drop feasible; highest-risk edit = dropping NOT NULL on throughputMbps (backward-compatible).
- Section 2 (Core service) feasibility: PASS — CASE helper (networkHealth.ts:46-59) extractable; resolveNetworkIdForMac (112-125) refactorable; PGlite suite pattern verified; highest-risk = prune predicate `mac IS NULL` guard + name-collision retry mechanics (E3).
- Section 3 (Provider) feasibility: PASS — `withTimeout`/`rttToMs`/`conn.write` helpers present; lease-print path already in use (mikrotik.ts:569); highest-risk = R1 concurrent-write (pre-approved fallback).
- Section 4 (Admin UI) feasibility: PASS — all target files exist; Svelte MCP autofixer step present (4.5); highest-risk = KPI aggregation must exclude AP rows from throughput/latency (Regression #3).
- Section 5 (Traffic) feasibility: PASS — agent-probe (G14) + Fully-Automated degradation (G15), not load-bearing on counters; highest-risk = negative-delta clamp + first-sample null.

### Execute-Agent Instructions

| # | Instruction | Trigger condition |
|---|---|---|
| E1 | Any NEW timestamp comparison/write SQL in the AP upsert MUST interpolate ISO strings (`nowIso` pattern, networkHealth.ts:23), never a JS `Date` object — the repo's JS-Date-in-sql bug class is INVISIBLE on PGlite, so manual review is required; reuse the extracted CASE helper (2.4) verbatim rather than hand-writing since-transition SQL. | Section 2.4 / 2.6 |
| E2 | Before making `throughputMbps` nullable, confirm every reader is null-safe end-to-end — admin `listNetworkHealth`/KPI path (4.2, Regression #3), the SSE `dashboardSnapshot` (`api/connected/+server.ts`), and dashboard/map `+page.server.ts`. A null AP-row throughput must not crash any consumer. Customer/locator do not display throughput (verified) — no change needed there. | Section 1.1 / 4.2 |
| E3 | Implement the name-collision retry (2.6) so a `network_health_name_key` unique violation does NOT poison an enclosing transaction: use a pre-check SELECT or a savepoint/standalone statement, not a bare try/catch inside a wrapping `db.transaction`. PGlite may not replicate PG's abort-on-violation exactly — assert the retry path in the integration suite. | Section 2.6 |
| E4 | Section 3.3 (pingHosts) MUST empirically verify concurrent `conn.write('/ping', …)` on one node-routeros 1.6.9 connection against the live router before finalizing; on any anomaly, implement the pre-approved bounded-concurrency (chunks of 4) or short-lived-second-connection fallback. Cap total ping budget ≤ 6s for 10 APs. | Section 3.3 |
| E5 | Section 3.1: confirm the exact Option 82 field key (`agent-circuit-id` observed in RESEARCH) on the live router's `/ip/dhcp-server/lease/print` output before locking the mapping — do not guess if the key differs. | Section 3.1 |
| E6 | Section 1.4: generate `0047_*.sql` for the record and keep it committed, but do NOT run `db:migrate` locally (journal drift) — apply DDL directly / `db:push` to verify. The PGlite integration suite is the authoritative migration-chain proof. | Section 1.4 |

### Backlog Artifacts

| Artifact | Location | What it tracks | Trigger |
|---|---|---|---|
| `per-ap-traffic-counter-reprobe_NOTE_16-07-26.md` | `process/general-plans/backlog/` | Re-probe hotspot byte counters if G14 verdict is INCONCLUSIVE (router unreachable at EXECUTE) | Only if G14 = INCONCLUSIVE |
| (existing) repo-wide lint prettier drift | `process/features/incident-management/backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md` | Known root-lint failure this plan works around (F.1); not this plan's fix | Already filed |

Open gaps: none blocking. Named residuals (SPEC-carried known-gaps, excluded from CONCERN/FAIL count): per-client RSSI (Phase B), exact-AP within shared ONU (Phase B), OLT-1 APs unattributed until Option 82 enabled upstream (external dependency), AP-Corrales physically offline (live reality / AC12 negative case), per-AP traffic if firmware hides counters (honest '—' ships via G15).

What this coverage does NOT prove:
- G1–G13, G15 (PGlite Fully-Automated): do NOT prove real-Postgres timestamp/transaction-abort behavior (PGlite fidelity gap — see E1/E3); do NOT prove live-router response shapes (mocked/fake controller).
- G11 (Hybrid e2e): does NOT run where local Postgres `radius_admin_test` DB or Chromium is unavailable; does NOT prove real MikroTik data (runs under `NETWORK_CONTROLLER='stub'` with seeded fixtures).
- G14 (Agent-Probe): does NOT prove counters increase correctly under real traffic beyond the two-sample window; a single INCONCLUSIVE verdict ships the honest-degradation branch, not a proven traffic figure.
- G16 (Agent-Probe, post-deploy): cannot be proven pre-deploy — stays an open item on the phase report until user-confirmed against the real router.
- G17 (fake-timer concurrency): proves concurrency semantics against a MOCKED connection — does NOT prove node-routeros 1.6.9 multiplexes concurrent writes on a real connection (that is E4's live probe, R1).

Gate: PASS (no FAILs, no unresolved CONCERNs; 2 residuals converted to execute-agent instructions E1/E2 already anticipated in-plan; every developed behavior has a Fully-Automated or Hybrid gate — vacuous-green ban honored)
Accepted by: n/a (PASS gate — no CONDITIONAL concerns require acceptance)

## Autonomous Goal Block

```
SESSION GOAL: Per-AP visibility on admin /networks — Phase A (router-side DHCP Option 82). One card per physical AP (or honest AP-group per shared ONU) with its own up/down, client count, and per-AP traffic (honest '—' when firmware hides counters).
Charter + umbrella plan: N/A — single standalone general plan (no phase program).
Autonomy: standard interactive RIPER-5 (no /goal active). ENTER EXECUTE MODE required before implementation. Per feedback_autonomous_phase_execution: reversible decisions auto-proceed; surface hard stops.
Hard stop conditions / safety constraints:
- Do NOT adopt/merge the rejected multi-router-support plan — this work is single-router, multi-AP only.
- Do NOT write any code against the Phase B Fatap AP JSON-RPC API (reserved vocabulary only).
- Do NOT change customer-app guest-facing behavior — only the internal @veent/core resolveNetworkIdForMac read-path may change; its external contract stays stable.
- Do NOT run db:migrate locally (journal drift) — generate 0047 for the record, apply DDL directly / db:push to verify.
- Any new timestamp SQL uses ISO-string interpolation (nowIso), never a JS Date (PGlite hides this bug class).
- Migration is additive only — no destructive DDL.
- Browser-visible /networks change needs BOTH an agent browser pass AND a human verification handoff before "done".
Next phase: EXECUTE (per-ap-visibility_PLAN_16-07-26.md) — run sections in order 1→2→3→4, Section 5 after 3; per-section gates, do not batch.
Validate contract: inline in this plan file, ## Validate Contract — Gate: PASS, generated-by: outer-pvl.
Execute start:
- Fully-automated: `cd packages/core && bun run test` ; `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts` ; `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` ; `cd apps/admin && bun run check`
- Hybrid (e2e): `cd apps/admin && bun run test:e2e -- e2e/networks.spec.ts` (precondition: local Postgres radius_admin_test DB + Chromium)
- Agent-probe: `/ip/hotspot/active` two-sample monotonicity (G14, live router) ; post-deploy AP up/down sanity (G16)
- Test-runner rule: `bunx vitest run <file>`, NEVER `bun test <file>` (fake-timer no-op).
- High-risk pack: no (additive migration, no auth/billing/secrets/destructive DDL — evidence pack not triggered).
```

## Next Step

VALIDATE complete — validate-contract above is `Gate: PASS`. Say **'ENTER EXECUTE MODE'** to implement, following the section order 1→2→3→4 (Section 5 after 3) with per-section gates. The orchestrator emits the /goal block (above) before routing to vc-execute-agent.
