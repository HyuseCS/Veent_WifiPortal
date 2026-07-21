---
phase: per-ap-visibility-phase-a
date: 2026-07-16
status: COMPLETE_WITH_GAPS
feature: general-plans
plan: process/general-plans/active/per-ap-visibility_16-07-26/per-ap-visibility_PLAN_16-07-26.md
---

# Per-AP Visibility Phase A — EXECUTE report

## TL;DR

All 5 sections implemented in order (1→2→3→4, 5 after 3), every LOCAL gate green: G1–G13, G15,
G17, `bun run check` (3 apps, 0 errors), `bun run test` (locator 6 / customer 79 / admin 140 /
core 43), G11 e2e (4/4 against stub + seeds). Migration `0047` generated (additive-only), NOT
`db:migrate`'d (PGlite chain is the authoritative proof). Live-router items (E4/E5/G14/G16) are
PENDING tomorrow — router was unreachable this session; the honest `—` traffic degradation shipped
and G14's re-probe backlog note is filed. `COMPLETE_WITH_GAPS` only because of those deferred
live-router verifications + one unavailable tool (Svelte MCP).

## What Was Done

**Section 1 — schema (packages/db):** `network_health` gains `mac` (+ unique index
`network_health_mac_key`), `ap_circuit_id`, `attribution_source`, `traffic_bytes` (bigint); dropped
`NOT NULL` on `throughput_mbps` (keeps default 0). New table `network_client_attribution`
(mac PK → circuit_id, updated_at). Migration `0047_aberrant_agent_zero.sql` generated — additive only
(ADD COLUMN / DROP NOT NULL / CREATE UNIQUE INDEX / CREATE TABLE).

**Section 2 — core service (packages/core/src/services/networkHealth.ts):** exported pure helpers
`AP_MAC_OUI`, `AP_HOSTNAME_RE`, `recognizeAccessPoints` (OUI OR hostname; dedupe by MAC preferring
`bound`), `computeApGroups`; extracted the offline/online-since CASE logic into one shared
`sinceTransitionSet` (Regression #7 — verbatim reuse, E1). `refreshNetworkHealth` extended with a
fully-guarded AP portion: attribution-cache upkeep (non-empty circuit-id only, AC6), per-circuit
client counts + byte sums from hotspot-active (lease circuit-id else cache, AC7), parallel pings,
mac-keyed AP upsert with a deterministic collision-free `resolveApName` pre-check (E3), and a prune
that restricts to `mac IS NULL` when the AP scan didn't run (R2). `resolveNetworkIdForMac` gains a
cache fast path (MAC → circuit-id → lowest-id AP row) with the router fallback preserved byte-for-byte
(Regression #4). New PGlite suite `networkHealth.integration.spec.ts` (13 tests: G1, G1b, G2–G10,
G12, G15). G13 added to `outage.integration.spec.ts`.

**Section 3 — MikroTik provider (mikrotik.ts):** `listDhcpLeases` (Option 82 key isolated in one
constant `DHCP_OPTION82_CIRCUIT_KEY` per E5; empty → null), `listHotspotActive` (absent counters →
null, never 0), `pingHosts` (bounded concurrency chunks of 4 via `AP_PING_CONCURRENCY`, 1.5s/host
timeout, never throws — the E4/R1 pre-approved fallback). `traceMethods` wraps them automatically
(generic own-method wrap — verified). G17 concurrency/timeout/never-throws test added to
`mikrotik.spec.ts` via a mocked node-routeros connection.

**Section 4 — admin UI:** `NetworkAp` gains `mac`/`apCircuitId`/`attributionSource`/`groupPeers` and
`throughput` may be `—`; `listNetworkHealth` selects the new columns, computes `groupPeers`, formats
null throughput as `—` (the single E2 null-safety seam — all readers already parse the leading
number). `/networks` collapses circuit-id groups into one card (lowest-id representative + combined
users), KPI throughput/latency now sum over interface rows only (`attributionSource === null`,
Regression #3); counts/users stay per-row. `NetworkHealthCard` gains a `group` prop (shared-ONU badge
+ per-member up/down), a `—` traffic tooltip, and an AP-row config hint (Reader Audit #7). Seed
fixtures added (A/B shared group, C solo, D offline). New e2e `networks.e2e.ts` (4/4 green).

**Section 5 — per-AP traffic:** delta math `computeTrafficRateMbps` (first-sample null, negative
clamp, elapsed≤0 null) + full byte-sum wiring in the AP refresh, gated on counter availability →
honest `—` when absent. Proven offline by G15. The live presence probe (G14) is deferred.

## What Was Skipped or Deferred

- **E4 — live concurrent-`conn.write('/ping')` multiplex check:** router unreachable. Shipped the
  pre-approved bounded-concurrency (chunks of 4) fallback; live single-connection multiplex check
  PENDING tomorrow. If it misbehaves, one-line drop `AP_PING_CONCURRENCY` to 1 / second connection.
- **E5 — Option 82 field key confirmation:** assumed `agent-circuit-id`, isolated in one constant.
  Live confirm PENDING; one-line fix if the key differs.
- **G14 — hotspot byte-counter two-sample monotonicity:** INCONCLUSIVE (router unreachable). Honest
  `—` degradation shipped; backlog note filed:
  `process/general-plans/backlog/per-ap-traffic-counter-reprobe_NOTE_16-07-26.md`.
- **G16 — post-deploy live up/down sanity (AP-Corrales negative case):** deferred as planned — open.
- **4.5 — Svelte MCP autofixer:** the Svelte MCP tool was not exposed to this execute session.
  `svelte-check` is clean (0 errors / 0 warnings) as the stand-in; recommend a manual MCP pass.
- **F.3 human verification handoff:** the e2e run is the agent browser pass (headless Chromium on
  `/networks` against stub + seeds, 4/4). Human verification handoff is PENDING tomorrow (project rule).

## Test Gate Outcomes

| Gate | Strategy | Result |
|---|---|---|
| G1–G10, G12, G15 | Fully-Automated | GREEN — `networkHealth.integration.spec.ts` (13 tests) |
| G13 | Fully-Automated | GREEN — `outage.integration.spec.ts` (6 tests) |
| G17 | Fully-Automated | GREEN — `mikrotik.spec.ts` (5 tests) |
| Migration 0047 | Fully-Automated | GREEN — PGlite `migrate()` over `packages/db/drizzle` inside the suites |
| G11 | Hybrid (e2e) | GREEN — `networks.e2e.ts` 4/4 (Postgres + Chromium precondition met) |
| `bun run check` | Fully-Automated | GREEN — 3 apps, 0 errors / 0 warnings |
| `bun run test` | Fully-Automated | GREEN — locator 6 / customer 79 / admin 140 / core 43 |
| scoped eslint (my files) | Fully-Automated | GREEN — 0 new errors from this change |
| G14 | Agent-Probe | INCONCLUSIVE — router unreachable → degradation shipped + backlog |
| G16 | Agent-Probe | DEFERRED (post-deploy) |

## Plan Deviations

1. **e2e filename `networks.e2e.ts` (not `networks.spec.ts`).** The admin Playwright `testMatch` is
   `**/*.e2e.ts`; a `.spec.ts` would never be collected. Within-blast-radius naming deviation; the
   F.2 command becomes `bun run test:e2e -- e2e/networks.e2e.ts`.
2. **Section 5 fully wired (both branches), not degradation-only.** The session note allowed shipping
   only the `—` branch given G14 INCONCLUSIVE; I implemented the complete byte-sum + delta logic too
   (checklist 5.2), gated on counter availability. Strictly more complete, still in-scope, fully
   proven offline by G15 — not a reduction.
3. **`bun run test` used for the root fan-out, not `bun test`.** Bare `bun test` invokes bun's native
   runner (fake-timer no-op — the documented gotcha), which fails 32 vitest-only tests. `bun run test`
   is the correct fan-out. Command correction, no code impact.

No hard-stop-class deviations. No auth/billing/schema-beyond-plan/API/container changes.

## Test Infra Gaps Found

- Root `bunx prettier --check` remains blocked by the known `tailwindStylesheet: ./src/routes/layout.css`
  path drift (resolves root-relative). Pre-existing; backlog
  `process/features/incident-management/backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md`. My
  edits follow the repo style (tabs / single quotes / no trailing commas).
- Scoped `bunx eslint apps/admin ...` shows 17 pre-existing errors in files I did not touch
  (`svelte/no-navigation-without-resolve`, `svelte/no-at-html-tags`) + the pre-existing
  `<a href={mapHref}>` in NetworkHealthCard. My changes introduce zero new eslint errors.

## Closeout Packet

- **Selected plan:** `process/general-plans/active/per-ap-visibility_16-07-26/per-ap-visibility_PLAN_16-07-26.md`
- **Finished:** all code (Sections 1–5) + all local automated gates + G11 e2e.
- **Verified vs unverified:** verified — every Fully-Automated gate + Hybrid G11 + check/test.
  Unverified (live router, tomorrow) — E4, E5, G14, G16, F.3 human handoff.
- **Cleanup remaining:** manual Svelte MCP pass on the two changed components; commit 0047 + code.
- **Best next state:** `Keep in active/testing` — code-complete, but the plan stays active until the
  live-router probes (E4/E5/G14/G16) + human `/networks` verification are confirmed tomorrow.

## Forward Preview

- **Test Infra Found:** the PGlite service-suite pattern is now used a third time (outage, now
  networkHealth) — worth extracting a `tests/pglite-integration.md` context doc at UPDATE PROCESS.
- **Blast Radius Changes:** `packages/db` (schema + 0047), `packages/core` (networkHealth service +
  mikrotik/stub/types integration), `apps/admin` (types, queries, networks route, card, seed, e2e).
  `apps/customer` / `apps/locator` unchanged (verified).
- **Commands to Stay Green:** `cd packages/core && bun run test`;
  `cd packages/core && bunx vitest run src/services/networkHealth.integration.spec.ts`;
  `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts`;
  `cd apps/admin && bun run check`; `cd apps/admin && bun run test:e2e -- e2e/networks.e2e.ts`.
  Root: `bun run check` then `bun run test` (NEVER bare `bun test`).
- **Dependency Changes:** none — no new npm deps, no new env vars.

## Follow-up stubs created

- `process/general-plans/backlog/per-ap-traffic-counter-reprobe_NOTE_16-07-26.md` (G14 re-probe + E4/E5/G16).

## CONTEXT_PARTIAL

- `CONTEXT_PARTIAL: Svelte MCP autofixer (plan 4.5)` — tool not exposed this session; svelte-check clean substitutes.
