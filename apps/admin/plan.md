# Plan: Coverage Simulator (admin Map page)

An RF **coverage-planning** tool: drop router/AP models on the admin map and see a
simulated signal field around each. A planning/demo aid — **not** a survey-grade
predictor. Reuses the existing Leaflet + OSM stack, adds **no** new dependency.

> **Update (shipped) — the Live/Simulate toggle was removed.** `/map` is now a single
> **always-simulate** map (`NetworkMap.svelte`): real APs always show coverage domes +
> clustered live-count popups; **clicking the map** (or "Add router") drops a draggable
> pin you can model/name/address and **Save to network**; clicking a real AP → **Edit on
> map** lets you move / re-model / re-address / **Remove** it in place (server actions
> `addPlace` / `updatePlace` / `deletePlace`). `CoverageSimulator.svelte` and
> `AddPlaceDialog.svelte` were folded in and deleted; `MapPicker.svelte` stays (used by
> `/networks`). The sections below describe the original design; §1's "Toggle UI" and the
> two-component split are superseded by this unified map.
>
> **Calibrated range (shipped):** the dome radius is no longer locked to the catalog. Each
> AP/pin has a **coverage-radius slider** (25–2000 m) that defaults to the model's
> advertised range and is **persisted per AP** (`network_health.range_meters`, nullable,
> migration `0011_*.sql`). Domes use `ap.rangeMeters ?? rangeFor(ap.model)`; switching
> model resets the slider to that model's advertised figure. This lets operators tune each
> AP to real-world reach (walls, height, interference) rather than the marketing number.
>
> **Address geocoding (shipped):** uses Nominatim (OSM, no key, CORS-enabled, hit only on
> explicit submit — within its ~1 req/sec policy; `// ponytail` marks the upgrade path).
> Two entry points: a **standalone "Find an address…" search** in the sidebar that
> recenters the map and drops a new pin at the result; and a **Locate button + Enter** on
> each pin's address field that moves that pin to the geocoded spot. Both recenter at
> zoom 16 and report "Address not found" on a miss.

---

## 1. Locked decisions

| Decision | Choice |
|---|---|
| Environment scale | Outdoor / area |
| Fidelity | Plausible-visual (no dBm accuracy claim) |
| Signal model | Simple distance falloff — no buildings, walls, or terrain in the math |
| Rendering | Flat 2.5D heatmap (Leaflet meter-radius circles), **not** 3D |
| Bands | Three concentric discs at **33% / 66% / 100%** of advertised range (Good → Fair → Weak) |
| Model → range | Seeded hand-edited catalog (`$lib/router-models.ts`); no spec API exists |
| Multiple routers | Yes; bands **stack visually** (no additive/blend math) |
| Per-pin model | Each pin selects its own model |
| Real APs | Show coverage **by default** in simulator mode (option **c**) |
| Real-AP range source | **Persisted per-AP `model`** on `network_health` (option **B**) → needs a migration |
| Add-location flow | Capture **and save** the chosen model when creating an AP |
| Toggle UI | Top-right corner of the Map page |
| Persistence of *sim-only* pins | None — sandbox, not saved |

### Devices
- **Sancom AP3000G** → 500 m advertised range. The only catalog entry at launch.
  Wi-Fi 6 outdoor AP, dual high-gain omni. Advertised range is unpublished; 500 m
  is the operator's figure — a calibration starting point, not a measured value.
- **Mikrotik CCR1036-8G-2S** → **excluded**. Wired Cloud Core Router, no WiFi radio,
  no coverage to draw.

---

## 2. Signal model (research-backed + the honest simplification)

Real Wi-Fi received power decays **logarithmically** with distance — the
[log-distance path loss model](https://en.wikipedia.org/wiki/Log-distance_path_loss_model):

```
PL(d) = PL(d₀) + 10·n·log₁₀(d/d₀) + Xσ
```

where `n` is the path-loss exponent (~2 free space, 3–5 with obstructions) and `Xσ`
is shadowing noise. Consequence: **equal-distance rings are NOT equal signal-quality
steps** — signal drops fast near the AP and slowly far out.

**This plan deliberately ignores that.** We draw bands at equal-distance thirds
(33/66/100%) because the chosen fidelity is *plausible-visual* and the model is
*distance-only*. The thirds are a legend convenience, not RSSI thresholds.

> `// ponytail: equal-distance thirds, not log-distance RSSI. Real falloff is`
> `// logarithmic (see plan §2). Upgrade path: replace the .frac thirds with`
> `// radii solved from PL(d) for target dBm cutoffs, exponent n per environment.`

**Upgrade path** (when/if decision-grade is ever needed): solve the log-distance
formula for the distance at each target RSSI cutoff (e.g. −67 dBm good, −75 fair,
−85 weak) given the model's tx power + antenna gain, and use *those* radii instead of
fixed fractions. Requires tx-power/gain data we don't currently have (not in any API;
FCC filings are PDFs) — out of scope now.

---

## 3. Schema change (option B — migration required)

Add one nullable column to `network_health` (`packages/db/src/schema/admin.ts`):

```ts
// Router/AP model id (catalog key in apps/admin/src/lib/router-models.ts).
// Drives the simulated coverage radius. Null = use the default model's range.
model: text('model'),
```

**Why store the id, not the range:** range lives only in the catalog, so editing the
catalog re-sizes every AP's dome automatically (single source of truth). An AP whose
stored `model` isn't in the catalog falls back to the default model.

**Migration workflow (per CLAUDE.md — keep `db:migrate` portable):**
1. Edit `packages/db/src/schema/admin.ts` (add the column above).
2. `bun run db:generate` → produces `packages/db/drizzle/00NN_*.sql`.
3. Make the generated SQL idempotent: `ADD COLUMN IF NOT EXISTS model text;`
4. `bun run db:migrate`, verify against a throwaway DB, **commit the generated SQL**.
5. Never hand-`ALTER` the live DB.

---

## 4. Files

### New
- `apps/admin/src/lib/router-models.ts` — catalog: `RouterModel { id, name, rangeMeters }`
  + `routerModels[]` (seed: Sancom AP3000G / 500 m) + a `DEFAULT_MODEL_ID` const and a
  `rangeFor(modelId): number` helper (catalog lookup → default fallback).
- `apps/admin/src/lib/components/feature/CoverageSimulator.svelte` — the simulator
  overlay/mode (Leaflet map, draggable sim pins, real-AP domes, control panel).

### Changed
- `packages/db/src/schema/admin.ts` — add `model` column (§3).
- `packages/db/drizzle/00NN_*.sql` — generated migration (idempotent).
- `apps/admin/src/lib/types.ts` — add `model: string | null` to `NetworkAp`.
- `apps/admin/src/lib/server/queries.ts`
  - `listNetworkHealth` — select + map the new `model` field onto `NetworkAp`.
  - `createNetworkPlace` — accept and insert `model`.
- `apps/admin/src/routes/(app)/map/+page.server.ts` — `addPlace` action reads `model`
  from the form, validates it against the catalog, passes to `createNetworkPlace`.
- `apps/admin/src/routes/(app)/map/+page.svelte` — host the top-right **mode toggle**
  (Live ↔ Simulate); render `NetworkMap` or `CoverageSimulator` accordingly.
- `apps/admin/src/lib/components/feature/AddPlaceDialog.svelte` — add a model `<select>`
  (catalog options) submitted as `model`; live MapPicker coverage preview optional (§6).
- `apps/admin/src/lib/components/feature/index.ts` — export `CoverageSimulator`.

> Note: the existing `MapPicker.svelte` already gives a draggable pin — reuse its
> pattern rather than rebuild pin logic.

---

## 5. CoverageSimulator behaviour

- **Base map:** same Leaflet + OSM tiles as `NetworkMap`/`MapPicker` (lazy-import in
  `onMount`, `mapInstance?.remove()` on teardown — match existing components).
- **Real APs (option c):** on load, draw coverage bands for every placed AP using
  `rangeFor(ap.model)` (null model → default). These are read-only context.
- **Sim pins:** an "Add router" button drops a new **draggable** pin; each pin has its
  own model `<select>`. Dragging redraws that pin's bands live (`marker.on('drag', …)`).
  Sim pins are a sandbox by default, but each carries a **"Save to network"** form that
  promotes the tested pin into a real AP (reuses `?/addPlace` with the pin's dragged
  lat/lng + chosen model), then drops the sandbox pin and reloads so it returns as a
  persisted dome. This is the simulate→commit path (Live mode has no test-first step).
- **Stacking:** all bands are translucent discs added to a single `L.layerGroup`;
  overlaps just render on top of each other (no blend math, per decision).
- **Control panel:** top-right card — mode is already toggled at page level; panel holds
  the per-pin model pickers, advertised-range readout, and the band legend.
- **Bands:** for each pin draw 3 `L.circle`s outer→inner (Weak 100% → Fair 66% → Good 33%
  of `rangeMeters`), `stroke:false`, `fillOpacity ~0.35`, colors
  `--color-blocked` / `--color-warning` / `--color-online`. Radius is in **meters**, so
  Leaflet auto-scales the discs on zoom.

## 6. Add-location flow
- `AddPlaceDialog` gains a model `<select>` (catalog), defaulting to `DEFAULT_MODEL_ID`,
  submitted as a `model` form field → saved on the new AP (§3/§4).
- Optional (cheap, nice): show the chosen model's coverage disc on the dialog's
  `MapPicker` as you place the pin. If it adds friction, skip — preview isn't required.

---

## 7. Out of scope / deferred (named on purpose)
- Buildings/terrain/walls affecting signal (Overture/OSM geometry researched — viable
  later; irrelevant under distance-only falloff). Upgrade to building-aware falloff is a
  separate fidelity step.
- Continuous radial gradient (canvas overlay) — only if banded discs read too chunky.
- Live AI/web model-spec lookup ("model not in list → fetch range") — add when the
  catalog outgrows hand-editing.
- Saving/sharing a sim layout, exporting coverage, multiple catalogs.
- Decision-grade RSSI math (§2 upgrade path).

## 8. Testing
- Unit: `rangeFor()` — known id → its range; unknown/null id → default range.
  (Plain assert-based check; matches the project's light test convention.)
- Manual: toggle to Simulate, confirm real APs show domes; add sim pins of different
  models; drag → bands follow; create an AP with a model → reload → dome persists.
- Migration: apply `00NN_*.sql` to a throwaway DB to confirm portability.

## 9. Risks / watch-items
- **Migration discipline** — must be idempotent and committed, or it breaks teammates'
  `db:migrate` (CLAUDE.md). Single additive nullable column keeps risk low.
- **Range realism** — 500 m is unverified marketing-style input; domes are illustrative.
  Surface this in UI copy ("advertised / illustrative") so operators don't over-trust it.
- **Scope creep toward 3D / physics** — explicitly parked in §7. Keep v1 flat + thirds.

---

## 10. Roadmap

Each phase ships something testable on its own; do them in order. Check items off as
they land.

### Phase 0 — Catalog + range math (no UI, no DB) ✅
- [x] `router-models.ts`: `RouterModel`, `routerModels[]` (Sancom AP3000G / 500 m),
      `DEFAULT_MODEL_ID`, `rangeFor(modelId)` (§4).
- [x] Unit check for `rangeFor()`: known id → range, unknown/null → default (§8).
- **Gate:** `rangeFor` test passes. ✅ (`router-models.test.ts`, 2 passing)

### Phase 1 — Schema + migration (DB) ✅
- [x] Add `model: text('model')` to `networkHealth` (§3).
- [x] `bun run db:generate` → `0010_normal_energizer.sql`; made `ADD COLUMN IF NOT EXISTS`.
- [x] `bun run db:migrate` applied; SQL committed-ready.
- **Gate:** idempotent additive nullable column. ✅

### Phase 2 — Wire model through the data layer ✅
- [x] `types.ts`: add `model: string | null` to `NetworkAp`.
- [x] `listNetworkHealth`: map `model` (select already returns all columns).
- [x] `createNetworkPlace`: accept + insert `model`.
- [x] `map/+page.server.ts` `addPlace`: read `model`, validate vs catalog (→ default), pass through.
- [x] `AddPlaceDialog`: model `<select>` (default `DEFAULT_MODEL_ID`) submitted as `model`.
- **Gate:** model round-trips form → DB → `NetworkAp`. ✅ (type-checked)

### Phase 3 — Coverage simulator ✅
- [x] `CoverageSimulator.svelte`: Leaflet map, real-AP domes via `rangeFor(ap.model)`,
      draggable sim pins with per-pin model `<select>`, 3-band discs, control panel (§5).
- [x] Export from `components/feature/index.ts`.
- [x] `map/+page.svelte`: top-right Live ↔ Simulate toggle; render the right component.
- **Gate:** code complete + type-checked. Manual smoke test pending (run `bun run dev:admin`).

### Phase 4 — Polish (optional, deferred)
- [ ] MapPicker live coverage preview in AddPlaceDialog (§6) — skip if it adds friction.
- [x] UI copy: "advertised / illustrative" disclaimer — done in simulator panel header.
