# Implementation Plan: OpenFreeMap Basemap for Admin and Locator Maps

**Branch**: `fix/map-tiles-provider` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-openfreemap-basemap/spec.md`. Settled decisions D2, D4,
D5, D7, D8, D10 in `.stratum/decisions.md`.

## Summary

Replace the CARTO raster tile layer in every Leaflet map with an OpenFreeMap vector basemap drawn by
`maplibre-gl` through the `@maplibre/maplibre-gl-leaflet` bridge, the same way parasat does
(`v2-veent/apps/parasat/src/components/ui/BranchMap.astro`). Admin loads
`https://tiles.openfreemap.org/styles/{positron|dark}` directly (D7). The locator loads the same
styles from its own address through a new GET-only pass-through route, `/map/[...path]`, that
fetches an allow-listed path from `tiles.openfreemap.org`, rewrites the provider URLs in the style
and TileJSON to the address the device used, and sends long cache headers (D5, D8). The theme
switch keeps the existing `data-theme` MutationObserver and calls `setStyle()` on the maplibre map.

## Technical Context

**Language/Version**: TypeScript 5, Svelte 5 runes, SvelteKit 2 (`@sveltejs/kit` ^2.63), Vite 8.0.16.
Prod runtime is Node 22 (`Dockerfile` runtime stage runs `node build`).

**Primary Dependencies**: `leaflet` 1.9.4 (installed). New, pinned exact in both apps (D10):
`maplibre-gl` 6.7.0, `@maplibre/maplibre-gl-leaflet` 0.1.4 (peer range accepts maplibre ^6 and
leaflet ^1.9.3). Admin also keeps `leaflet.markercluster`.

**Storage**: N/A. No server store (D8).

**Testing**: Vitest 4 `server` project (node) for unit tests, run with `bunx vitest run <file>`
from the app dir. Admin Playwright e2e (`bun run test:e2e` in `apps/admin`, own preview server and
throwaway DB). Locator has no e2e harness, so its browser behaviour is checked by the agent
browser pass and the human check (quickstart).

**Target Platform**: Admin in desktop browsers. Locator in phone browsers, including a phone on the
hotspot before login. Locator server: Node 22 container on VM `10.210.54.133`, port 3003.

**Project Type**: Web apps in a bun monorepo (`apps/admin`, `apps/locator`).

**Performance Goals**: SC-004 (pre-login first open < 10 s, repeat < 3 s). SC-007 (theme switch < 2 s).

**Constraints**: Guest devices never contact the provider (FR-008). The pass-through is not an open
proxy (FR-010). No new env var (FR-015). No walled-garden change (SC-006). No logging of guest map
paths (D10).

**Scale/Scope**: 2 admin map screens (`/networks`, `/map`) plus the unused `MapPicker.svelte` component (D11), 1 locator page, 1 new route.

## Constitution Check

_GATE: checked before Phase 0 and again after Phase 1._

| Rule                                                     | Status                     | Note                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Admin scope first                                     | Pass                       | Locator work is in scope because issue #118 names it (spec Assumptions). No customer-app change.                                                                                                                                                   |
| II. One schema                                           | Pass                       | No schema change.                                                                                                                                                                                                                                  |
| III. Auth isolation                                      | Pass                       | No auth code touched. No cross-app import: each app gets its own copy of the basemap helper, as `apps/locator/src/lib/map.ts` already does.                                                                                                        |
| IV. High-risk paths                                      | Pass                       | No payment, credit, grant, webhook, auth or permission code. The new public route is an external-service call: tests first (T012) and a security note below.                                                                                       |
| V. Captive portal verified live                          | Pass, with a required gate | No walled-garden, probe or RouterOS change. The VM IP is a `walled-garden ip` row (all protocols, `packages/core/src/integrations/network/mikrotik.ts:1026`), so port 3003 is open before login. Live pre-login phone test is still a task (T022). |
| VI. Simplicity                                           | Pass                       | One helper per app replaces three copies of tile-layer plus observer code. No server cache, no config, no new env.                                                                                                                                 |
| bun only                                                 | Pass                       | `bun install`, `bunx vitest`, `bun run`.                                                                                                                                                                                                           |
| Env via `$env/dynamic/*`                                 | Pass                       | No env read added.                                                                                                                                                                                                                                 |
| Test first                                               | Pass                       | Every FR has a failing test task before its build task (tasks.md). FR-014 is a live test by nature.                                                                                                                                                |
| Browser-visible change needs agent pass plus human check | Pass                       | Quickstart sections 3 and 4.                                                                                                                                                                                                                       |
| Agents do not start dev servers                          | Pass                       | Quickstart asks the user to start the locator dev server. The admin e2e harness starts its own preview server, as it does today.                                                                                                                   |

Post-design re-check: no change. Complexity Tracking is empty.

## Design

### Admin maps (US1)

1. `apps/admin/src/lib/map.ts` keeps `FALLBACK_CENTER` and replaces `TILE_SUBDOMAINS`,
   `TILE_ATTRIBUTION`, `tileUrl()` with:
   - `BASEMAP_ATTRIBUTION`: the FR-006 HTML string (parasat text, three links).
   - `styleUrl(theme: string | undefined)`: `https://tiles.openfreemap.org/styles/dark` when
     `theme === 'dark'`, else `.../styles/positron`. Pure, so it is unit-testable.
   - `loadBasemap()`: lazy loader. One `Promise.all` of `import('@maplibre/maplibre-gl-leaflet')`
     (side effect: registers `L.maplibreGL` on the Leaflet object), `import('maplibre-gl')`,
     `import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url')`. Calls
     `maplibregl.setWorkerUrl(url)` (without it a production build 404s the worker, parasat note).
     Resolves to `add(L, map) => cleanup`. `add` creates
     `L.maplibreGL({ style: styleUrl(theme), attributionControl: { customAttribution: BASEMAP_ATTRIBUTION } })`,
     adds it to the map, and starts a `data-theme` MutationObserver that calls
     `layer.getMaplibreMap().setStyle(styleUrl(theme))`. `cleanup` disconnects the observer.
     If `addTo` throws (no WebGL), `add` returns a no-op cleanup so pins and controls still work.
2. Each map (`CoverageMap.svelte`, `networkMap.controller.ts`, and the unused `MapPicker.svelte`, D11)
   removes its `L.tileLayer` and its observer, sets `maxZoom: 19` on `L.map(...)` (it lived on the
   removed tile layer; without it Leaflet zoom is unbounded), and calls
   `loadBasemap().then((add) => { if (!cancelled) stop = add(L, map); })` after the map exists.
   Not awaited: pins render at once and the basemap fades in when maplibre arrives. Cleanup calls
   `stop?.()` before `map.remove()`.
3. Lazy loading: the maplibre modules are only reached through `loadBasemap()`, which runs inside
   `onMount` (components) or `init()` (controller). Vite splits them into their own chunks, so
   non-map pages do not download them.
4. Draw order (FR-004): the bridge puts its canvas in Leaflet's `tilePane` (z-index 200) by
   default. Domes (`domes` pane, 400), overlays (400), markers (600), tooltips, popups and controls
   stay above it. No pane change.
5. Clicks: the bridge default `interactive: false` leaves pointer events to Leaflet, so
   NetworkMap's double-click pin drop (US1 AS3) and MapPicker's click-to-pick are unchanged.
6. Theme flip during style load: `setStyle(url)` takes the diff path, and
   `Map._diffStyle` aborts the previous in-flight style request (`maplibre-gl` 6.7.0
   `dist/maplibre-gl-dev.mjs:25228`). The last flip wins. Checked again in the browser pass.
7. No `maplibre-gl.css` import, same as parasat. The browser pass confirms the canvas sizes right.

### Locator map (US2, US3)

1. `apps/locator/src/lib/map.ts` gets the same shape as admin with one difference:
   `styleUrl(theme, origin)` returns `${origin}/map/styles/{positron|dark}`, and `add` passes
   `location.origin`. The style URL is absolute (maplibre needs absolute sprite URLs, see research R3).
2. `apps/locator/src/routes/+page.svelte` swaps its tile layer and `themeObs` for `loadBasemap()`
   the same way, and sets `maxZoom: 19` on `L.map`.
3. Pass-through, split for testing:
   - `apps/locator/src/lib/server/mapProxy.ts`: allow-list rules, URL rewrite, request origin,
     and `proxyMap(url: URL, request: Request): Promise<Response>`.
   - `apps/locator/src/routes/map/[...path]/+server.ts`: exports only `GET`, which calls
     `proxyMap(url, request)`. SvelteKit answers HEAD with the GET handler and returns 405 for other
     methods without running it.
   - Path: the raw `url.pathname` after `/map/`, matched against anchored regexes (contract). The
     upstream URL is the fixed constant `https://tiles.openfreemap.org/` plus the matched path. The
     query string is dropped. No match: 404, no fetch.
   - Upstream fetch: global `fetch` (not `event.fetch`), headers `{ accept: '*/*' }` only, so no
     guest cookie, referrer, client address or user agent is sent (FR-011).
     `redirect: 'error'` (a redirect cannot move the request to another host).
     `signal: AbortSignal.timeout(8000)` covers the fetch and the body read, so a slow provider
     gets an answer before 10 s (FR-013).
   - Response: the body is read with `arrayBuffer()` (Node fetch has already decoded gzip). New
     headers only: `content-type` from the rule (never copied from upstream), `cache-control` from
     the rule. No upstream header is forwarded (no `content-encoding`, `content-length`,
     `set-cookie`). Upstream 404 gives 404, other upstream errors 502, timeout 504, all with
     `cache-control: no-store`.
   - Rewrite (style and TileJSON only): parse JSON and change the fields that the map fetches:
     `sprite` (string, or array of `{ url }`), `glyphs`, `sources.*.url`, `sources.*.tiles[]`,
     `tiles[]`. A value starting with `https://tiles.openfreemap.org/` becomes
     `${origin}/map/` plus the rest. Any other value in those fields: 502, nothing served (D10,
     degrade, never leak). Attribution and description strings are not touched (they hold links,
     not fetched URLs).
   - Origin (FR-009): `Host` request header if it matches
     `^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$`, scheme `https` when
     `x-forwarded-proto` is `https`, else `http`. If the Host header is missing or invalid, use
     `url.origin`. `event.url.origin` alone is wrong in prod: compose sets `ORIGIN` for the locator,
     and adapter-node then ignores the request host (research R2).
4. D10, no logging of guest map paths:
   - `apps/locator/src/hooks.server.ts`: requests whose path starts with `/map/` skip
     `Sentry.sentryHandle()`; `securityHeaders` still runs.
   - `apps/locator/src/hooks.client.ts`: `Sentry.browserTracingIntegration({ shouldCreateSpanForRequest })`
     returns false for same-origin `/map/` URLs.
   - The route has no `console.*` call.

### Security note

Tasks that touch an external service, a public endpoint or guest data: T012, T013, T014, T017.

1. Public endpoint `/map/*` on the unauthenticated locator, reachable before login. It is not an
   open proxy: fixed upstream host constant, anchored path allow-list with no `/`, `.` segments or
   encoded slashes in free parts, GET and HEAD only, query dropped, `redirect: 'error'`. A refused
   request makes no outbound call (SC-005, unit-tested with a fetch spy).
2. Guest data: the outbound request is built from scratch. No cookie, referer, `x-forwarded-for`,
   user agent or client IP leaves the VM (FR-011). OpenFreeMap sees only the VM's IP.
3. Response integrity: content type comes from the allow-list rule, so a changed upstream response
   cannot be served as HTML from the locator origin. `X-Content-Type-Options: nosniff` is already
   set by `hooks.server.ts`. A style or TileJSON that names another host in a fetched-URL field is
   refused, so a guest device is never sent to a host the router blocks or that the guest did not
   choose.
4. Client-controlled input reflected in responses: `Host` and `x-forwarded-proto` decide the origin
   written into the style. Host is checked against a strict pattern (no `/`, `@`, quotes or spaces),
   so it cannot inject JSON or a path. A forged Host only changes the response the sender gets.
   Shared caches key on host, and the style path has no file extension, which Cloudflare does not
   cache by default.
5. Availability: no server store (D8). Each request holds at most one tile body (largest vector tile
   is well under 1 MB) for at most 8 s. No rate limit is added. The VM already serves the locator
   publicly; this adds no new amplification beyond one upstream fetch per guest request.
6. Logging: map paths reveal where a guest looks. They are kept out of Sentry traces (server and
   browser) and are not logged (D10).
7. Admin: operator browsers contact `tiles.openfreemap.org` directly (D7, accepted exposure). No CSP
   change is needed: both apps set only `frame-ancestors`.
8. No secrets, keys or env vars (FR-015). No change to auth, the walled garden, compose or the
   Dockerfile.

## Project Structure

### Documentation (this feature)

```text
specs/003-openfreemap-basemap/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── locator-map-passthrough.md
├── checklists/            # from the spec phase
└── tasks.md
```

### Source Code (repository root)

```text
apps/admin/
├── package.json                                   # + maplibre-gl 6.7.0, @maplibre/maplibre-gl-leaflet 0.1.4
├── e2e/basemap.e2e.ts                             # new: FR-001/003/004/005/006/007 in a real browser
└── src/lib/
    ├── map.ts                                     # styleUrl, BASEMAP_ATTRIBUTION, loadBasemap
    ├── map.test.ts                                # new: unit + no-CARTO source guard
    ├── networkMap.controller.ts                   # tile layer -> basemap
    └── components/feature/
        ├── CoverageMap.svelte                     # tile layer -> basemap
        └── MapPicker.svelte                       # unused (D11): same swap, check and build only
apps/locator/
├── package.json                                   # + same two deps
└── src/
    ├── hooks.server.ts                            # skip Sentry for /map/
    ├── hooks.client.ts                            # no browser spans for /map/
    ├── lib/
    │   ├── map.ts                                 # styleUrl(theme, origin), BASEMAP_ATTRIBUTION, loadBasemap
    │   ├── map.test.ts                            # new
    │   └── server/
    │       ├── mapProxy.ts                        # new: allow-list, rewrite, origin, proxyMap
    │       └── mapProxy.test.ts                   # new
    └── routes/
        ├── +page.svelte                           # tile layer -> basemap
        └── map/[...path]/+server.ts               # new: GET only
bun.lock                                           # updated by bun install
```

**Structure Decision**: Existing app layout. Server-only logic goes in `apps/locator/src/lib/server/`
(the client Vitest project excludes it, the server project runs it). No shared package: the two
apps keep separate copies, matching the existing `map.ts` comment and constitution III.

## Complexity Tracking

None.

## Validate

Date: 2026-10-12. Verdict: CONDITIONAL

| Check                     | Verdict | Findings       |
| ------------------------- | ------- | -------------- |
| 1. Setup and dependencies | CONCERN | F8             |
| 2. Test coverage per FR   | CONCERN | F1, F4, F5, F7 |
| 3. Breaking changes       | PASS    | none           |
| 4. Security and privacy   | CONCERN | F2, F3, F6, F9 |

Verified against the code: the VM is a `walled-garden ip` row with only `action=accept` and
`dst-address` (`packages/core/src/integrations/network/mikrotik.ts:1104-1108`, `PORTAL_LAN_IPS` in
`apps/admin/scripts/walled-garden-config.ts:113-116`). adapter-node uses `ORIGIN` for `event.url`
(`handler.js:101`), and the `Host` header reaches the `Request`. The Sentry SvelteKit server SDK
turns off incoming request spans, and its sampler drops HTTP client spans that have no parent, so
skipping `sentryHandle` keeps `/map/` paths out of server traces. A plain Vite 8.0.16 SSR build of
`maplibre-gl-worker.mjs?worker&url` exits 0 and emits a worker asset (SvelteKit build still
unproven, T009/T018 gate it). Headless Chromium 1228 (Playwright 1.61.0) has WebGL2 with
default args. The removed exports have 4 callers, all tasked (T006, T007, T008, T016).

F1. plan.md:85, tasks.md:64, tasks.md:102 Catching an `addTo` throw does not make no-WebGL safe.
Leaflet `_layerAdd` binds the bridge's `move`/`zoom*`/`resize` handlers before `onAdd`. maplibre
6.7.0 throws `GPUInitializationError` in the `Map` constructor, so `_glMap` stays unset and every
pan or zoom then throws in `_update`/`_transformGL`. quickstart.md:134-135 checks load only. ->
In `add`, return a no-op when `document.createElement('canvas').getContext('webgl2')` is null,
before creating the layer. Extend quickstart section 5 edge 3 to pan and zoom with no page errors.
F2. data-model.md:40-46, plan.md:131-136, tasks.md:92 The rewrite checks only `sprite`, `glyphs`,
`sources.*.url`, `sources.*.tiles[]`, `tiles[]`. A GeoJSON `sources.*.data` URL or a video
`sources.*.urls[]` on a new host would reach guests unchecked, against D10. -> Also refuse (502)
any string under `sources.*` that starts with a scheme or `//` and is not on
`https://tiles.openfreemap.org/`. Add a T012 case 7 entry with a GeoJSON `data` on another host.
F3. plan.md:137-141, quickstart.md:48-65, quickstart.md:151-177 FR-009 on the public HTTPS origin
is not checked. If the proxy in front of the public locator rewrites `Host` or does not send
`x-forwarded-proto: https`, the style holds internal or `http://` URLs and the public map is blank
(mixed content). -> User input: how the public origin reaches the VM. Add a post-deploy step to
T022: `curl -s https://<public origin>/map/styles/dark | grep -o '"sprite":"[^"]*"'` must start
with `https://<public origin>/map/`.
F4. tasks.md:104, tasks.md:126 T017 (D10 hooks) has no test that can fail. T023 only reads the
code. -> Add `apps/locator/src/hooks.server.test.ts` before T017: mock `@sentry/sveltekit`, expect
`sentryHandle`'s handler not called for `/map/x` and called for `/`. Or the user accepts review-only.
F5. plan.md:31-33, tasks.md:24, tasks.md:106, quickstart.md:132-133 Locator FR-003, FR-004 and
FR-013 ("page keeps working") rely on the manual pass. The provider-down edge case runs on admin
only. -> Add to T019: `page.route('**/map/**', (r) => r.abort())`, reload, the pins and the list
work. Manual-only FR-003 and FR-004 for the locator are accepted.
F6. plan.md:145-146 `shouldCreateSpanForRequest` stops spans, not breadcrumbs. Browser fetch
breadcrumbs for main-thread `/map/` requests (style, sprite, glyphs, relief tiles) go out with any
later error event. -> In T017, add `beforeBreadcrumb` in `hooks.client.ts` that drops breadcrumbs
whose `data.url` path starts with `/map/`.
F7. tasks.md:93 T012 case 8 checks that a list of headers is absent. -> Assert the outgoing headers
equal exactly `{ accept: '*/*' }`, so `forwarded`, `x-forwarded-host` or `cf-connecting-ip` also fail it.
F8. tasks.md:41 Local bun is 1.4.3. CI (`.github/workflows/ci.yml:14`) and the Dockerfile
(`Dockerfile:18`) use 1.3.14 with `--frozen-lockfile`. -> Run T001 with bun 1.3.14, or confirm
that the CI install step passes on the PR before T009.
F9. plan.md:169-171 Public `/map/*` has no body-size cap and no rate limit (accepted in the plan).
-> No change unless the user wants a 502 when upstream `content-length` is over 2 MB.
