# Plan: Live event-driven admin dashboard

## Context

`apps/admin/src/routes/(app)/dashboard` is only half-live. `load()` returns SSR
snapshots for `kpis`, `revenue`, `activeSessions`, and `networks`, but only the
**Active Sessions** table updates afterward — via `/api/connected` SSE, which
itself just **re-queries the DB on a 5s timer**. KPIs, revenue, and network
health stay frozen until a full page reload.

The goal: make the whole dashboard update the moment the underlying data changes,
driven by the DB itself (user chose true event-driven over a polling interval).
The driver is **postgres.js** (`packages/db/src/client.ts`), which has
first-class `LISTEN/NOTIFY` support via `sql.listen()` — so Postgres triggers
fan changes out to the admin process, which pushes over the existing SSE stream.
Triggers fire no matter which app writes, so customer-app payments/sessions light
up the admin dashboard for free.

## Data path

```
any app writes network_sessions | credit_ledger | network_health
  → AFTER-STATEMENT trigger → pg_notify('dashboard')
  → admin process holds ONE LISTEN connection (postgres.js .listen)
  → debounce burst → re-query full snapshot ONCE
  → fan out to all connected SSE clients
  → live store → dashboard derives kpis / revenue / sessions / networks
```

## Changes

### 1. Migration — triggers (`packages/db/drizzle/00XX_*.sql`)
- `bun run db:generate --custom` (in `packages/db`) to mint the next numbered
  migration, then hand-author the SQL:
  - `notify_dashboard()` trigger function → `pg_notify('dashboard', '')`.
  - `AFTER INSERT OR UPDATE OR DELETE … FOR EACH STATEMENT` triggers on
    `network_sessions`, `credit_ledger`, `network_health`.
- Statement-level (not per-row) → one notify per write statement, no storm on
  bulk writes. Triggers can't be expressed in the Drizzle schema, hence a custom
  migration. Apply with `bun run db:migrate`.

### 2. `apps/admin/src/lib/types.ts`
- Add `DashboardSnapshot { kpis; revenue; activeSessions; networks }` (composed
  of the existing `Kpi[]`, `RevenuePoint[]`, `ActiveSession[]`, `NetworkAp[]`).

### 3. `apps/admin/src/lib/server/queries.ts`
- Add `dashboardSnapshot(db)` = `Promise.all` of the existing `dashboardKpis`,
  `revenueByDay`, `listActiveSessions`, `listNetworkHealth` → `DashboardSnapshot`.
  Pure reuse, no new SQL.

### 4. `apps/admin/src/lib/server/dashboard-feed.ts` (new) — singleton feed
- Dedicated `postgres(env.DATABASE_URL)` connection, **separate from the Drizzle
  query pool** (LISTEN needs a long-lived connection; don't starve the pool).
- `sql.listen('dashboard', onNotify)` — postgres.js owns the dedicated connection
  and auto-reconnects (re-issues LISTEN on reconnect).
- A `Set` of subscribers (SSE controllers). On notify: ~250ms debounce →
  `dashboardSnapshot(db)` **once** → fan out to all subscribers. One query per
  burst, shared across every open tab — not N queries.
- `subscribe(cb): () => void`; LISTEN opened on first subscriber, kept for process
  lifetime (one idle connection — fine).
- `// ponytail: 250ms debounce coalesces write bursts; raise if a tab shows a
  partial snapshot.`

### 5. `apps/admin/src/routes/api/connected/+server.ts`
- Drop the 5s `setInterval` poll. On connect: push the initial
  `dashboardSnapshot`, then `subscribe()` to the feed and push on each notify.
- Add a ~25s heartbeat comment (`: ping\n\n`) — pushes are now sporadic, so an
  idle SSE connection needs keepalive to survive proxies.
- On abort: unsubscribe + clear heartbeat (keep the existing safe
  `controller.close()` guard).

### 6. `apps/admin/src/lib/live.svelte.ts`
- Store `snapshot: DashboardSnapshot | null` instead of `sessions`; expose
  `live.snapshot`. `live.status` is unchanged → **Topbar untouched** (it only
  reads `live.status`).

### 7. `apps/admin/src/routes/(app)/dashboard/+page.svelte`
- Derive all four from the stream with SSR fallback:
  `const kpis = $derived(live.snapshot?.kpis ?? data.kpis)` and likewise for
  `revenue`, `activeSessions`, `networks`. SSR `data` seeds first paint; the
  stream takes over. Existing layout/caps/`$effect(connectLive)` stay.

### 8. `apps/admin/src/routes/(app)/dashboard/+page.server.ts`
- Swap the inline four-call `Promise.all` for `dashboardSnapshot(db)` (DRY).
  No behavior change — still seeds SSR.

### 9. `apps/admin/package.json`
- Add `"postgres"` to `dependencies` (currently only transitive via `@veent/db`;
  the feed imports it directly).

## Verify

- `bun run db:migrate` applies the triggers cleanly.
- Open the dashboard, then via `psql`: `INSERT` into `credit_ledger` / `UPDATE
  network_health` / change a `network_sessions` row → the matching KPI / revenue /
  network / sessions card updates within ~debounce, no reload.
- Open two tabs → a single notify produces one snapshot push that reaches both;
  Topbar live-dot still reflects status.
- `svelte-check` passes.

## Scope note

Touches `apps/admin/*` plus one custom migration in `packages/db` (a declared
admin dependency) — within the project's admin-only rule.
