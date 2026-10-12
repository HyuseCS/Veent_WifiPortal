---
description: 'Tasks for 003 OpenFreeMap basemap (issue #118)'
---

# Tasks: OpenFreeMap Basemap for Admin and Locator Maps

**Input**: `specs/003-openfreemap-basemap/` (plan.md, spec.md, research.md, data-model.md,
contracts/locator-map-passthrough.md, quickstart.md)

**Tests**: Required. Constitution "test first". Each FR has a test task that fails before its build
task. Run unit tests with `bunx vitest run <file>` from the app dir, never `bun test`.

**Security**: Tasks marked `SEC` touch a public endpoint, an external service or guest data. See the
plan's security note.

**D12 = B** (user): in-memory fixed-window counter in `mapProxy.ts`, key client IP, 429 when over (research R14; tasks T026, T027). The live router check for the key is T028, before merge. D11 = A: `MapPicker.svelte` (no importer) gets the same swap, verified by check and build only.

## FR to test map

| FR                                          | Test task                                                                 | Build task               |
| ------------------------------------------- | ------------------------------------------------------------------------- | ------------------------ |
| FR-001 admin light/dark                     | T002, T003                                                                | T005, T006, T007, T008   |
| FR-002 locator light/dark                   | T011                                                                      | T015, T016               |
| FR-003 live theme switch                    | T003 (admin), T019 browser pass (locator, empty Playwright scaffold only) | T005, T015               |
| FR-004 overlays above basemap               | T003                                                                      | T006, T007, T016         |
| FR-005 no CARTO requests                    | T002, T011 (source guard), T003 (network)                                 | T005 to T008, T015, T016 |
| FR-006 attribution                          | T002, T011, T003                                                          | T005, T015               |
| FR-007 admin direct to OpenFreeMap          | T002, T003                                                                | T005                     |
| FR-008 locator delivers all parts           | T011, T012                                                                | T013, T014, T015         |
| FR-009 URLs point at the used address       | T012                                                                      | T013                     |
| FR-010 allow-list, read methods only        | T012                                                                      | T013, T014               |
| FR-011 no guest headers upstream            | T012                                                                      | T013                     |
| FR-012 no store, cache headers              | T012                                                                      | T013                     |
| FR-013 bounded error time                   | T012 (server), T019 (page keeps working)                                  | T013                     |
| FR-014 pre-login on a real phone            | T022 (live)                                                               | T013 to T016             |
| FR-015 no key, env or `.env.example` change | T023                                                                      | none                     |
| US1 AS3 double-click pin drop unchanged     | T004                                                                      | T007                     |

## Phase 1: Setup

- [ ] T001 Add `"maplibre-gl": "6.7.0"` and `"@maplibre/maplibre-gl-leaflet": "0.1.4"` (exact, no caret) to `dependencies` in `apps/admin/package.json` and `apps/locator/package.json`, run the install at the repo root with the CI and Dockerfile bun version: `bunx bun@1.3.14 install` (local bun is 1.4.3; `.github/workflows/ci.yml:14` and `Dockerfile:18` pin 1.3.14), then `bunx bun@1.3.14 install --frozen-lockfile` must exit 0. Commit both `package.json` files with `bun.lock`.

## Phase 2: Foundational

T001 is the only shared prerequisite. No other foundational work.

---

## Phase 3: User Story 1 - Admin maps show a basemap again (P1) MVP

**Goal**: `/networks` coverage map and `/map` network map show the OpenFreeMap basemap in both
themes, switch live, and never call CARTO. The unused `MapPicker.svelte` gets the same swap (D11).

**Independent test**: T003 e2e plus quickstart sections 5 and 6 for the admin rows.

### Tests (write first, see them fail)

- [ ] T002 [P] [US1] Create `apps/admin/src/lib/map.test.ts` (server project). Cases: `styleUrl('dark')` is `https://tiles.openfreemap.org/styles/dark`; `styleUrl('light')` and `styleUrl(undefined)` are `https://tiles.openfreemap.org/styles/positron` (FR-001, FR-007); `BASEMAP_ATTRIBUTION` equals the data-model.md string exactly and does not contain `CARTO` (FR-006); source guard: `import.meta.glob('/src/**/*.{ts,svelte}', { query: '?raw', import: 'default', eager: true })`, skip this test file's own key, and expect no file to contain `cartocdn` or `CARTO` (FR-005). Run `cd apps/admin && bunx vitest run src/lib/map.test.ts`: must fail (no `styleUrl` export; `CARTO` and `cartocdn` in `src/lib/map.ts` and `src/lib/networkMap.controller.ts`).
- [ ] T003 [P] [US1] Create `apps/admin/e2e/basemap.e2e.ts`. Setup per test: `page.addInitScript` sets `localStorage['radius-admin-theme']='light'`; `page.route('https://tiles.openfreemap.org/**')` records the URL and fulfils `{"version":8,"sources":{},"layers":[{"id":"bg","type":"background","paint":{"background-color":"#ccc"}}]}` with `content-type: application/json` and `access-control-allow-origin: *`; `page.route(/cartocdn\.com/)` records the URL and aborts. For each of `/networks` (wait for `OAP3000G-C` as in `networks.e2e.ts`) and `/map`: (a) `.leaflet-tile-pane .maplibregl-canvas` has count 1; (b) a recorded request ends with `/styles/positron` (FR-001, FR-007); (c) `.leaflet-marker-pane .vpin` count > 0, and computed `z-index` of `.leaflet-tile-pane` is below `.leaflet-marker-pane` and, on `/map`, below `.leaflet-domes-pane` (FR-004); (d) `.leaflet-control-attribution` contains `OpenFreeMap`, `OpenMapTiles`, `OpenStreetMap` and not `CARTO` (FR-006); (e) store `.vpin` count and `.leaflet-map-pane` `style.transform`, set `window.__noReload = true`, run `document.documentElement.dataset.theme = 'dark'`, then `expect.poll(..., { timeout: 2000 })` sees a request ending `/styles/dark` (FR-003, SC-007), `window.__noReload` is still true, `.vpin` count and map-pane transform are unchanged, canvas count is still 1; (f) recorded CARTO requests equal `[]` (FR-005). Run `cd apps/admin && bun run test:e2e -- basemap.e2e.ts`: must fail (no maplibre canvas, CARTO requests). If after T009 the canvas never appears on Linux, add `test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } })` in this file only (research R11).
- [ ] T004 [US1] Add a test to `apps/admin/e2e/basemap.e2e.ts` (after T003, same file, same OpenFreeMap stub): on `/map`, wait for `.leaflet-tile-pane .maplibregl-canvas`, double-click an empty map point, expect the pin panel to show and `input[name="latitude"]` and `input[name="longitude"]` to hold numbers (US1 AS3). On the old code it fails at the canvas wait; after T007 it fails only if the basemap canvas captures pointer events.

### Build

- [ ] T005 [US1] In `apps/admin/src/lib/map.ts`: keep `FALLBACK_CENTER`; remove `TILE_SUBDOMAINS`, `TILE_ATTRIBUTION`, `tileUrl`; add `BASEMAP_ATTRIBUTION` (exact string from data-model.md), `styleUrl(theme: string | undefined)` and `loadBasemap()` as in plan.md "Admin maps" item 1 (one `Promise.all` of the bridge, `maplibre-gl` and `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url`; `setWorkerUrl` before `addTo`; returns `add(L, map) => cleanup`; `add` first checks `document.createElement('canvas').getContext('webgl2')` and returns a no-op cleanup without creating the layer when it is `null` (no try/catch around `addTo`, Validate F1); the observer watches `data-theme` and calls `getMaplibreMap().setStyle(styleUrl(...))`). Update the file's header comment so it no longer names CARTO. T002 unit cases for `styleUrl` and attribution pass (the source guard still fails until T007 removes the CARTO comment in the controller).
- [ ] T006 [P] [US1] In `apps/admin/src/lib/components/feature/CoverageMap.svelte`: drop the `tile` variable, `L.tileLayer(...)` and its observer; add `maxZoom: 19` to the `L.map(...)` options; after `renderMarkers()` call `loadBasemap().then((add) => { if (!cancelled) stop = add(L, m); })`; cleanup runs `stop?.()` then `map?.remove()`. Import only `FALLBACK_CENTER` and `loadBasemap` from `$lib/map`.
- [ ] T007 [P] [US1] In `apps/admin/src/lib/networkMap.controller.ts`: replace the tile layer and `tileObs` with `private stopBasemap?: () => void`, set by `loadBasemap().then((add) => { if (!this.cancelled) this.stopBasemap = add(L, map); })` after the panes exist; add `maxZoom: 19` to `L.map(...)`; `destroy()` calls `this.stopBasemap?.()` before `this.map?.remove()`; update the import from `$lib/map`. Keep the `domes` pane and everything else as is.
- [ ] T008 [US1] In `apps/admin/src/lib/components/feature/MapPicker.svelte`, make the same swap as T006: drop `L.tileLayer(...)` and its observer, add `maxZoom: 19` to `L.map(...)`, call `loadBasemap().then((add) => { if (!cancelled) stop = add(L, map); })` after the map exists, run `stop?.()` in the existing `cleanup` before `map.remove()`, import only `FALLBACK_CENTER` and `loadBasemap` from `$lib/map`. Not shown on any screen (D11), so no browser test: verified by T002's source guard and T009's `bun run check` and `bun run build`.
- [ ] T009 [US1] Admin gates, from `apps/admin`: `bunx vitest run src/lib/map.test.ts` (all pass, guard included), `bun run check`, `bun run build`, `find build -name '*maplibre-gl-worker*'` prints a file (research R6: SSR build accepts `?worker&url`; if the build fails here, stop and report), `bun run test:e2e -- basemap.e2e.ts` passes. Commit T002 to T008 paths.
- [ ] T010 [US1] Agent browser pass for the admin rows of `specs/003-openfreemap-basemap/quickstart.md` section 5 (light, dark, flip, rapid flip, provider down, no WebGL, `/map` double-click). User starts `bun run dev:admin` and signs in. Record results here.

**Checkpoint**: US1 done and shippable alone (admin needs no locator change).

---

## Phase 4: User Story 2 - Locator map works after hotspot login (P2)

**Goal**: The locator shows the basemap in both themes, switches live, and every map request goes to
the locator's own address.

**Independent test**: T012 unit tests, quickstart sections 4 and 5 for the locator.

### Tests (write first, see them fail)

- [ ] T011 [P] [US2] Create `apps/locator/src/lib/map.test.ts` (server project). Cases: `styleUrl('dark', 'http://10.210.54.133:3003')` is `http://10.210.54.133:3003/map/styles/dark`; `styleUrl('light', o)` and `styleUrl(undefined, o)` end `/map/styles/positron`; no result contains `tiles.openfreemap.org` (FR-002, FR-008); `BASEMAP_ATTRIBUTION` equals the data-model.md string and has no `CARTO` (FR-006); source guard over `/src/**/*.{ts,svelte}` as in T002, skipping its own key (FR-005). Run `cd apps/locator && bunx vitest run src/lib/map.test.ts`: must fail.
- [ ] T012 [P] [US2] SEC. Create `apps/locator/src/lib/server/mapProxy.test.ts` (server project). Stub upstream with `vi.stubGlobal('fetch', vi.fn(...))` returning `new Response(...)`; restore after each test. Call `proxyMap(new URL(...), new Request(...))`, and import the route module for the method case. Cases:
  1. Accepted paths, each gives 200 and exactly one fetch to `https://tiles.openfreemap.org/<path>`: `styles/positron`, `styles/dark`, `planet`, `planet/20261004_113936_pt/14/13684/7581.pbf`, `natural_earth/ne2sr/3/6/3.png`, `fonts/Noto%20Sans%20Regular/0-255.pbf`, `fonts/Noto%20Sans%20Bold/256-511.pbf`, `sprites/ofm_f384/ofm.json`, `sprites/ofm_f384/ofm@2x.png` (FR-008, FR-010).
  2. Refused paths, each gives 404 and zero fetch calls: `''`, `etc/passwd`, `styles/liberty`, `styles/positron/x`, `..%2Fstyles/positron`, `planet%2F..%2Fstyles/positron`, `fonts/..%2F..%2Fx/0-255.pbf`, `fonts/a/b/0-255.pbf`, `planet/latest/1/2/3.pbf`, `sprites/ofm_f384%2F..%2Fx.json`, `https:/example.com/x` (FR-010, SC-005). Plain `..` segments are not test cases: the URL parser removes them before the route sees the path.
  3. Query dropped: `/map/styles/positron?u=https://example.com` fetches `https://tiles.openfreemap.org/styles/positron` with no `?`.
  4. Route module `apps/locator/src/routes/map/[...path]/+server.ts` exports exactly `['GET']` (FR-010 read only; SvelteKit then returns 405 for other methods).
  5. Rewrite with `Host: 10.210.54.133:3003`: style `sprite`, `glyphs`, `sources.openmaptiles.url`, `sources.ne2_shaded.tiles[0]` all start `http://10.210.54.133:3003/map/` with the provider path and placeholders kept; TileJSON `tiles[0]` becomes `http://10.210.54.133:3003/map/planet/20261004_113936_pt/{z}/{x}/{y}.pbf`; TileJSON `attribution` with its three provider links is unchanged; sprite as an array of `{ id, url }` is rewritten too (FR-009).
  6. `x-forwarded-proto: https` gives `https://<host>/map/...`; invalid Host values `evil.com/x`, `a"b`, `x@y` fall back to the URL origin (FR-009).
  7. Foreign host refused, 502: `glyphs` on `https://other.example/...`; a source `url` on `https://tiles.openfreemap.org.evil.com/planet`; TileJSON `tiles[0]` on another host; a GeoJSON source `{ type: 'geojson', data: 'https://other.example/a.geojson' }`; a video source with `urls: ['//other.example/v.mp4']`; upstream body not valid JSON (D10, Validate F2). A GeoJSON source whose `data` is `https://tiles.openfreemap.org/x.geojson` is rewritten to `http://<host>/map/x.geojson`.
  8. Outbound request: the incoming request carries `cookie`, `referer`, `x-forwarded-for`, `x-real-ip`, `forwarded`, `cf-connecting-ip`, `user-agent`, `authorization`; the fetch `init.headers` deep-equals exactly `{ accept: '*/*' }`, and `init.redirect === 'error'` (FR-011, Validate F7).
  9. Response headers: `cache-control` is `public, max-age=86400` for the style and TileJSON and `public, max-age=31536000, immutable` for tile, relief, font and sprite paths; `content-type` comes from the rule even when the stub sends `text/html`; the stub's `content-encoding`, `content-length`, `set-cookie` and `etag` are absent (FR-012).
  10. Errors: `vi.spyOn(AbortSignal, 'timeout')` is called with a value of 10000 or less and its signal is the `init.signal` passed to fetch; fetch rejecting with `new DOMException('x', 'TimeoutError')` gives 504; rejecting with `TypeError` gives 502; upstream 404 gives 404; upstream 500 gives 502; every error response has `cache-control: no-store` (FR-013).
      Run `cd apps/locator && bunx vitest run src/lib/server/mapProxy.test.ts`: must fail (module missing).

### Build

- [ ] T013 [US2] SEC. Create `apps/locator/src/lib/server/mapProxy.ts`: `UPSTREAM = 'https://tiles.openfreemap.org/'`; the rules table exactly as in data-model.md (pattern, type, cache, rewrite); origin per data-model.md "Request origin"; rewrite of the listed fields plus every absolute-URL string directly under `sources.*` (data-model.md "Rewritten fields"), returning 502 on any non-provider value; `proxyMap(url, request)` per contracts/locator-map-passthrough.md (path = `url.pathname` after `/map/`, global `fetch(UPSTREAM + path, { headers: { accept: '*/*' }, redirect: 'error', signal: AbortSignal.timeout(8000) })`, `arrayBuffer()` body, fresh headers only, 404/502/504 with `no-store`). No `console.*`. Add a `// ponytail:` note on the buffered, uncompressed body (research R7). T012 cases 1 to 3 and 5 to 10 pass.
- [ ] T014 [US2] SEC. Create `apps/locator/src/routes/map/[...path]/+server.ts` exporting only `GET: RequestHandler = ({ url, request }) => proxyMap(url, request)`. T012 case 4 passes.
- [ ] T015 [P] [US2] In `apps/locator/src/lib/map.ts`: keep `FALLBACK_CENTER`; replace `TILE_SUBDOMAINS`, `TILE_ATTRIBUTION`, `tileUrl` with `BASEMAP_ATTRIBUTION`, `styleUrl(theme, origin)` and `loadBasemap()` (same as T005, WebGL2 check before the layer included, but `add` uses `styleUrl(document.documentElement.dataset.theme, location.origin)`). Update the header comment so it no longer names CARTO. T011 unit cases for `styleUrl` and attribution pass.
- [ ] T016 [US2] In `apps/locator/src/routes/+page.svelte`: drop `themeObs`, `L.tileLayer(...)` and its observer; add `maxZoom: 19` to `L.map(...)`; after the markers are added call `loadBasemap().then((add) => { if (!cancelled) stopBasemap = add(L, mapInstance!); })`; cleanup runs `stopBasemap?.()` before `mapInstance?.remove()`; update the comments that name CARTO and the import. T011 source guard passes.
- [ ] T017 [P] [US2] SEC (D10). In `apps/locator/src/hooks.server.ts`: requests with `event.url.pathname.startsWith('/map/')` skip `Sentry.sentryHandle()` and still get `securityHeaders`. In `apps/locator/src/hooks.client.ts`: `Sentry.browserTracingIntegration({ shouldCreateSpanForRequest: (u) => !new URL(u, location.href).pathname.startsWith('/map/') })`, and in the same `Sentry.init` a `beforeBreadcrumb` that returns `null` when `breadcrumb.data?.url` resolves (against `location.href`) to a path starting with `/map/` (Validate F6). No unit test (hook wiring needs Sentry and `$env`; the user accepted this, Validate F4); checked in T023.
- [ ] T018 [US2] Locator gates, from `apps/locator`: `bunx vitest run` (all pass), `bun run check`, `bun run build`, `find build -name '*maplibre-gl-worker*'` prints a file. Then `specs/003-openfreemap-basemap/quickstart.md` section 4 curl checks against the dev server the user started. Commit T011 to T017 paths.
- [ ] T019 [US2] Agent browser pass for the locator rows of `specs/003-openfreemap-basemap/quickstart.md` section 5: light, dark, live flip with view and open popup kept (FR-003 locator; the locator has only an empty Playwright scaffold), zero map requests off the locator host (SC-003), relief at zoom 3, repeat open from cache (US2 AS4), rapid flip, no WebGL with pan and zoom and zero page errors. Provider down (FR-013, Validate F5): `page.route('**/map/**', (r) => r.abort())`, reload, pins and the list show and work. Record the `/map/` request count and the 10 s peak from the pan and zoom step (research R14, input for D12). Record results here.
- [ ] T026 [US2] SEC (D12). In `apps/locator/src/lib/server/mapProxy.test.ts`, add cases for `overMapLimit(ip, now)`: calls up to `MAP_LIMIT` in one 10 s window return false; the next returns true; a different IP is counted on its own; a call at window start + 10 s returns false again. Add a route case: `GET` returns 429 with `cache-control: no-store` and `retry-after: 10` when over, and makes no upstream request. Show the cases fail.
- [ ] T027 [US2] SEC (D12). In `mapProxy.ts`: export `MAP_LIMIT` (the number from research R14, set after T019) and `overMapLimit(ip, now = Date.now())`, a fixed 10 s window over a module `Map<string, number>` that is cleared when the window rolls over. In `routes/map/[...path]/+server.ts`: `GET` reads `getClientAddress()` with `::ffff:` stripped, returns 429 (`cache-control: no-store`, `retry-after: 10`, empty body) when `overMapLimit` is true, else `proxyMap(url, request)`. Add a `// ponytail:` note: per-process memory, resets on restart, one bucket for the whole hotspot (research R14). T026 cases pass; rerun T018 gates. Commit T026 and T027 paths.

**Checkpoint**: US2 done. Works on any address the locator is opened from.

---

## Phase 5: User Story 3 - Locator map works before hotspot login (P3)

**Goal**: The same locator map on a real phone before login, with no walled-garden change.

**Independent test**: quickstart section 7.

- [ ] T020 [US3] User, before deploy: record the walled-garden counts (`specs/003-openfreemap-basemap/quickstart.md` section 7 step 1). Record them here.
- [ ] T021 [US3] User: deploy this branch's locator to VM `10.210.54.133` with the current manual docker deploy (`specs/003-openfreemap-basemap/quickstart.md` section 7 step 2).
- [ ] T022 [US3] User with agent guidance: live phone test, `specs/003-openfreemap-basemap/quickstart.md` section 7 steps 3 to 11 (FR-014, SC-004, SC-006). Record the times and pass or fail here.

---

## Phase 6: Polish and cross-cutting

- [ ] T023 Review checks: (1) `git diff --name-only origin/staging...HEAD` lists no `.env*`, `compose*.yaml`, `Dockerfile`, `apps/admin/scripts/walled-garden-config.ts` or `apps/customer/` path (FR-015, SC-006); (2) `git diff origin/staging...HEAD -- apps | grep -n '^+.*\$env'` prints nothing (FR-015); (3) `grep -n 'console\.' apps/locator/src/lib/server/mapProxy.ts 'apps/locator/src/routes/map/[...path]/+server.ts'` prints nothing, and T017's two hooks exclude `/map/` (D10); (4) `git diff origin/staging...HEAD | grep -n '^+\s*//'` shows no new narrating comments (only `ponytail:` markers and header updates).
- [ ] T024 Repo gates from the root: `bun run check`, `bun run test`, `bun run build`, `bunx eslint $(git diff --name-only origin/staging...HEAD -- apps)` and `bunx prettier --check $(git diff --name-only origin/staging...HEAD -- apps specs/003-openfreemap-basemap)`.
- [ ] T028 User, before merge, on the radius network (constitution V, Validate F9): run `/ip firewall nat print where action=masquerade` and `/ip firewall nat print where action=accept`. Confirm `10.210.0.0/18` is masqueraded and no exemption covers locator port 3003. Paste the output here. If guests are not masqueraded, the key is per guest: recheck `MAP_LIMIT` against research R14 before merge.
- [ ] T025 User: human check, `specs/003-openfreemap-basemap/quickstart.md` section 6 (SC-001). Record the ticks here.

---

## Dependencies and execution order

- T001 blocks everything.
- US1: T002 and T003 in parallel, then T004 (same file as T003). T005 needs T001 and T002 to T004. T006 and T007 in parallel after T005. T008 after T005. T009 after T002 to T008. T010 after T009.
- US2: T011 and T012 in parallel. T013 after T011 and T012. T014 after T013. T015 after T011 and T012, in parallel with T013. T016 after T015. T017 any time after T001. T018 after T011 to T017. T019 after T018. T026 after T019. T027 after T026.
- US3: T020 before T021. T021 after T027. T022 after T021.
- Polish: T023 and T024 after US1 and US2. T025 after T010 and T019. T028 any time before merge; it does not block the build.
- US1 and US2 share no file, so they can run in parallel after T001.

## Parallel examples

```text
US1 tests:  T002 (apps/admin/src/lib/map.test.ts) | T003 (apps/admin/e2e/basemap.e2e.ts)
US1 build:  T006 (CoverageMap.svelte) | T007 (networkMap.controller.ts)          after T005
US2 tests:  T011 (apps/locator/src/lib/map.test.ts) | T012 (mapProxy.test.ts)
US2 build:  T013 -> T014 (proxy) | T015 -> T016 (client) | T017 (hooks)
Cross:      all of US1 | all of US2
```

## Implementation strategy

1. MVP: T001, then US1 (T002 to T010). Admin maps work again. Can ship alone.
2. US2 (T011 to T019): locator after login, through the pass-through.
3. US3 (T020 to T022): live pre-login test on the VM.
4. Polish (T023 to T025), then PR to `staging`.

## Notes

- Commit each finished, verified task with exact paths. No `git add -A`. No AI attribution.
- Subagents that write code get the `[PONYTAIL]` directive and the no-comments rule.
- `docs/project/architecture.md:74` lists UI libs without maplibre. Not in the spec, so not tasked.
