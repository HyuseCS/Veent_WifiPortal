# Per-Antenna/Hotspot Bandwidth Limiting

> Status: **PLAN — not yet implemented.** Feasibility investigated 2026-07-01.
> Scope: admin-configurable aggregate up/down speed cap **per AP/hotspot interface**,
> enforced on the MikroTik router. This is deliberately *not* per-user or per-plan
> (see "Why per-hotspot" below).

## Goal

Let an operator set a maximum aggregate bandwidth (download/upload) for each
antenna/hotspot from the admin **Networks** page, and have the router enforce it so all
traffic crossing that AP is capped regardless of how many guests are on it.

## Why per-hotspot (and not per-user)

Per-user/per-plan limiting was evaluated first and is harder here for two structural
reasons, both of which the per-hotspot approach sidesteps:

1. **Bypass bindings defeat hotspot rate-limits.** Access is granted by writing an
   `/ip/hotspot/ip-binding` with `type=bypassed`
   (`packages/core/src/integrations/network/mikrotik.ts:247`), which makes the device
   **skip the hotspot entirely**. MikroTik's per-user hotspot rate-limits (user-profile
   `rate-limit`) therefore never apply to our granted devices. A queue on the
   **interface/subnet** applies to all traffic crossing it, bypassed or not.
2. **DHCP-IP churn.** A per-device queue must chase the device's changing DHCP IP. A
   per-hotspot queue targets a **fixed interface name** (or the hotspot's client subnet),
   so it never moves.

There is a dead `GrantInput.bandwidthMbps?` hook in the service layer
(`packages/core/src/integrations/network/types.ts:12-13`) plumbed through the grant paths
but never set and never read by the driver. The per-hotspot design does **not** use it and
leaves it untouched; a future per-plan feature could revive it independently.

## Key facts established during research

- **Router target**: MikroTik **RouterOS v6**, binary API via `node-routeros` (dynamically
  imported, `mikrotik.ts:106`). No REST, no RADIUS/CoA. RouterOS supports aggregate rate
  limiting natively via `/queue/simple` (or queue trees).
- **The "antenna/hotspot" already exists as a durable unit.** Each `network_health` row is
  an AP: stable unique `name` key (`network_health_name_key`, `admin.ts:127-131`) plus an
  operator-bound `interfaceName` linking it to a real router interface (`admin.ts:110-113`).
  These rows are already edited from the admin Networks page (location, model, coverage
  range).
- **Operator-set columns survive the health sweep.** `refreshNetworkHealth` upserts on
  `name` but its `set:` only touches telemetry columns —
  `online/users/throughputMbps/uptimePct/latencyMs/lastSampleAt`
  (`packages/core/src/services/networkHealth.ts:25-38`). Operator columns
  (`interfaceName`, `latitude`, `model`, `rangeMeters`, `clusterName`, …) are **not** in the
  set, so a new bandwidth column would persist across sweeps. Pins with coordinates are also
  never pruned (`networkHealth.ts:44-49`).
- **`throughputMbps` on `network_health` is measured telemetry, not a cap**
  (`admin.ts:105`) — do not overload it.
- **An idempotent "apply config to router" pattern already exists**: `provisionWalledGarden`
  (`mikrotik.ts:529`) does add-or-update-by-comment against `/ip/hotspot/walled-garden`.
  The bandwidth apply method mirrors it exactly.
- **Controller abstraction**: everything codes against the `NetworkController` interface
  (`packages/core/src/integrations/network/types.ts`), with a `stub` no-op impl
  (`stub.ts`) selected in dev via `NETWORK_CONTROLLER=stub`. Any new method needs a stub
  counterpart or must be optional (`network.method?.(…)`).

## Data model

Add two **nullable** columns to `network_health`
(`packages/db/src/schema/admin.ts:98`):

```
maxDownKbps  integer   -- null = uncapped
maxUpKbps    integer   -- null = uncapped
```

- Kbps (not Mbps) so sub-Mbps caps are expressible; the UI can present Mbps and convert.
- Nullable = "no limit". Clearing either field removes the queue for that AP.
- Optional DB check: `maxDownKbps IS NULL OR maxDownKbps > 0` (mirror the
  `router_model_range_meters_positive` check at `admin.ts:87`).
- New Drizzle migration under `packages/db/drizzle/`.

A **global default** in `app_settings` (`packages/db/src/schema/customer.ts:299`, alongside
`maxDevicesPerAccount`/`freeTimeMinutes`) is optional/out-of-scope for v1 — per-AP is enough.

## Router enforcement (the real work)

New method on the MikroTik controller — signature added to the `NetworkController`
interface as **optional** so the stub/other impls can no-op:

```
applyInterfaceLimit(input: {
  interfaceName: string;
  downKbps: number | null;   // null → remove the cap
  upKbps: number | null;
  tag?: string;              // comment marker, e.g. "veent-hotspot-limit:<name>"
}): Promise<void>
```

Behaviour (idempotent, mirroring `provisionWalledGarden`):

- Resolve a **queue target**. Two options — **default to subnet-target** for correct up/down
  semantics, fall back to interface:
  - *Client subnet/pool* (preferred): resolve the hotspot's client network from
    `/ip/hotspot/print` → its `address-pool` / the interface's IP network, and target the
    CIDR (e.g. `10.210.x.0/24`). Then `max-limit=<down>/<up>` reads intuitively as
    download-to-client / upload-from-client.
  - *Interface* (fallback): `target=<interfaceName>`. Simpler but up/down are **relative to
    the interface**, i.e. client-download = interface-upload — document this if used.
- Find our existing queue by comment tag; `set` it if present, `add` if not, `remove` if both
  limits are null.
- Best-effort + bounded like the rest of the driver (`withTimeout`, swallow socket errors);
  never throw in a way that breaks the admin save — surface a soft failure instead.

Add the same method (no-op, or log-only) to `stub.ts`.

### RouterOS command sketch

```
# add / update
/queue/simple add name=<tag> target=<cidr-or-iface> max-limit=<upBps>/<downBps> comment=<tag>
/queue/simple set  .id=<found> max-limit=<upBps>/<downBps>
# remove
/queue/simple remove .id=<found>
```

Note RouterOS `max-limit` is `<upload>/<download>` in **bits/s** (accepts `k`/`M`
suffixes). Convert Kbps → the router's units carefully and unit-test the formatter.

## Admin UI

- Extend the existing Networks AP editor (the page that already edits
  `interfaceName`/`model`/`rangeMeters`/coordinates for a `network_health` row) with two
  fields: **Max download** and **Max upload** (present as Mbps, store Kbps). Blank = no limit.
- Owner/appropriate-role gated, consistent with the other Networks mutations.
- On save: persist the columns, then call `applyInterfaceLimit` for that AP's
  `interfaceName`. If `interfaceName` is null (a pure map pin with no router binding), skip
  the router call and just store the value (or block the field — decide during impl).
- Consider a "re-apply all limits" reconcile action (idempotent sweep over all rows with a
  non-null cap), useful after a router reboot/config wipe — mirrors how walled-garden is
  re-provisioned.

## Enforcement lifecycle / edge cases

- **Router reboot or config reset** drops the queues. Mitigate with the reconcile sweep
  above, optionally run from the same place health is refreshed.
- **Interface rename / AP re-binding**: if `interfaceName` changes, remove the old queue
  (old tag) and add the new one. Tag the queue by the `network_health.name` (stable) so it's
  traceable back to the row.
- **AP deleted**: remove its queue on delete.
- **Subnet resolution fails** (odd hotspot config): fall back to interface-target and log.
- **Multiple hotspots sharing a subnet**: subnet-target would double-count — prefer
  interface-target in that topology. Detect and warn, or make the target strategy a per-AP
  choice if real deployments need it.

## Files to touch

| Area | File |
| --- | --- |
| Schema | `packages/db/src/schema/admin.ts` (network_health cols) + new migration in `packages/db/drizzle/` |
| Controller iface | `packages/core/src/integrations/network/types.ts` (optional `applyInterfaceLimit`) |
| MikroTik impl | `packages/core/src/integrations/network/mikrotik.ts` (new method + subnet resolver + `max-limit` formatter) |
| Stub impl | `packages/core/src/integrations/network/stub.ts` (no-op) |
| Admin server | Networks AP-edit action (`apps/admin/src/routes/(app)/networks/…` + `apps/admin/src/lib/server/network.ts`) |
| Admin UI | Networks AP editor `.svelte` (two speed fields) |
| Tests | `max-limit` unit conversion; idempotent add/set/remove logic |

## Explicitly out of scope (v1)

- Per-user and per-plan speed caps (the `bandwidthMbps` path) — separate feature.
- Data-volume quotas (GB caps) — not modeled anywhere today.
- Burst/`limit-at` shaping and queue-tree QoS — start with a flat `max-limit`.
- Global default cap in `app_settings`.

## Open questions for implementation time

1. Target strategy: subnet vs interface as the default (leaning **subnet** for intuitive
   up/down). Confirm against a real hotspot's config.
2. Present limits in Mbps or Kbps in the UI? (Store Kbps regardless.)
3. Should a map-pin row with no `interfaceName` be allowed to hold a limit value, or should
   the fields be disabled until it's bound to an interface?
4. Where to hang the reconcile/re-apply sweep (piggyback on the health refresh, or a
   separate admin action / cron)?
