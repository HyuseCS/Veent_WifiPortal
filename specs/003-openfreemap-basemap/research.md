# Research: OpenFreeMap Basemap for Admin and Locator Maps

All items checked on 2026-10-12 against the installed or pinned versions. Library sources read from
`v2-veent/apps/parasat/node_modules` (`maplibre-gl` 6.7.0, `@maplibre/maplibre-gl-leaflet` 0.1.4,
the same versions this feature pins) and from this worktree's `node_modules/.bun` (Vite 8.0.16,
adapter-node 5.5.6, playwright-core 1.61.0).

## R1. Provider paths and headers

- Decision: allow-list these path families on `tiles.openfreemap.org` (live fetch):

  | Family                     | Example                                                              | Upstream `cache-control`                                         |
  | -------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
  | Style                      | `/styles/positron`, `/styles/dark`                                   | `public, max-age=86400`                                          |
  | TileJSON                   | `/planet`                                                            | `public, max-age=86400`                                          |
  | Vector tiles               | `/planet/20261004_113936_pt/14/13684/7581.pbf`                       | `public, max-age=315360000`, `content-encoding: gzip` when asked |
  | Relief (raster, maxzoom 6) | `/natural_earth/ne2sr/3/6/3.png`                                     | `public, max-age=315360000`                                      |
  | Fonts                      | `/fonts/Noto%20Sans%20Regular/0-255.pbf`                             | `public, max-age=604800`                                         |
  | Sprites                    | `/sprites/ofm_f384/ofm.json`, `ofm.png`, `ofm@2x.json`, `ofm@2x.png` | `public, max-age=315360000`                                      |

- Neither `positron` nor `dark` draws the `ne2_shaded` source, so no `/map/natural_earth/` request
  happens in practice. The path works (200) and stays in the allow-list.
- Both styles reference only `tiles.openfreemap.org`. Fonts used: `Noto Sans Regular`, `Bold`,
  `Italic`, one font per stack.
- The TileJSON `attribution` and `description` fields contain links to `openfreemap.org`,
  `openmaptiles.org` and `openstreetmap.org`. So the rewrite and the foreign-host check must look
  only at fetched-URL fields, not at the whole text.
- Version stamps (`20261004_113936_pt`, `ofm_f384`) change. The patterns match the stamp shape,
  not the value, so a new version passes with no code change. A new path shape fails closed (404,
  no basemap), which is the D10 "degrade, never leak" rule.
- Alternatives: a string replace over the whole JSON (rejected: would also rewrite attribution links
  and could not detect a foreign host); literal version paths (rejected: break on the next provider
  release).

## R2. Which origin goes into the rewritten URLs (FR-009)

- Decision: build the origin from the request `Host` header (strict pattern) and
  `x-forwarded-proto` (`https` or else `http`). Fall back to `event.url.origin` when Host is missing
  or invalid.
- Rationale: `compose.prod.yaml:98` sets `ORIGIN: ${LOCATOR_ORIGIN}`. adapter-node
  (`files/handler.js:101`, `base: origin || get_origin(req.headers)`) then uses that fixed origin
  for `event.url`, whatever address the phone used. `apps/locator/.env.example` gives
  `https://radius.veent.io` as the example. A style written with that origin fails before login,
  where only `10.210.54.133` is open. FR-009 asks for the address the device used. Node serves plain
  HTTP, so a request with no proxy header came in over `http`. A TLS proxy (Cloudflare) sets
  `x-forwarded-proto: https`.
- Alternatives: `event.url.origin` (rejected: works on one address only, fails FR-009). Unset
  `ORIGIN` and set adapter-node `HOST_HEADER`/`PROTOCOL_HEADER` (rejected: compose and env change,
  FR-015). Path-only URLs in the style (rejected: R3).
- Open (Validate F3, deferred by the user): how the public origin (for example `radius.veent.io`)
  reaches the VM is not known. If the proxy in front of it rewrites `Host` or does not send
  `x-forwarded-proto: https`, the public style holds internal or `http://` URLs. This needs a talk
  with devops. It blocks only the production deploy check on the public origin, not the build.

## R3. Relative URLs in a maplibre style

- Decision: the rewritten style carries absolute URLs.
- Rationale: `maplibre-gl` 6.7.0 `normalizeSpriteURL` runs `new URL(url)` and throws
  "Invalid sprite URL ..., must be absolute" before `transformRequest` sees it
  (`dist/maplibre-gl-dev.mjs:703`).
- Alternatives: a client `transformRequest` rewrite (rejected: FR-009 asks that the delivered style
  itself points at the locator, and D5 puts the rewrite on the server).

## R4. Bridge behaviour (`@maplibre/maplibre-gl-leaflet` 0.1.4)

- Default options `pane: "tilePane"`, `interactive: false`, `padding: 0.1`. The canvas sits in the
  tile pane, under domes (400), overlays (400) and markers (600). Clicks go to Leaflet.
- `getAttribution()` returns `options.attributionControl.customAttribution` when it is set. The
  OpenFreeMap styles carry no source attribution, so the custom string is required (parasat note).
- It registers `L.maplibreGL` on `LeafletModule.default`, the same object the apps get from
  `(await import('leaflet')).default`.
- `getMaplibreMap()` returns the maplibre map, so the theme switch is `setStyle(url)` on it.
- Type augmentation of `leaflet` ships in `dist/leaflet-maplibre-gl.d.mts`, so `L.maplibreGL` is
  typed once the module is imported.

## R5. Theme switch and the flip-while-loading edge case

- Decision: `getMaplibreMap().setStyle(styleUrl(...))` from the existing `data-theme` observer.
- Rationale: `setStyle` with a URL goes to `_diffStyle`, which aborts the previous in-flight style
  request first, and falls back to a full rebuild if the current style is not loaded yet
  (`dist/maplibre-gl-dev.mjs:25162`, `:25228`). The last call wins, and both styles share sources,
  sprite and glyphs, so the diff keeps the loaded tiles.
- Alternatives: remove and re-add the bridge layer (rejected: new WebGL context per flip, flicker,
  attribution churn).

## R6. Lazy loading and the worker URL

- Decision: copy parasat's five-import shape minus the CSS: `leaflet` stays imported where it is
  today; `loadBasemap()` imports the bridge, `maplibre-gl` and
  `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` in one `Promise.all`, then calls
  `setWorkerUrl` before `addTo`.
- Rationale: maplibre 6 computes the worker URL from `import.meta.url` at runtime, which the bundler
  cannot see, so a production build 404s the worker without `setWorkerUrl`. `?worker&url` (not bare
  `?url`) because the worker imports `./maplibre-gl-shared.mjs`.
- Risk: Vite 8's worker plugin has no SSR exclusion for `?worker&url` (`vite:worker` in
  `dist/node/chunks/node.js`). The SvelteKit SSR build sees the dynamic import too. Expected to
  emit a worker asset and build fine, but not proven. T009 (admin) and T018 (locator) prove it
  with `bun run build` and a `find` for the worker asset, and stop if it does not build. Fallback if the SSR build rejects it: start `loadBasemap()` with
  `if (import.meta.env.SSR) throw new Error('client only')`; Vite replaces the constant at build
  time and drops the worker import from the SSR bundle.
- Not awaited by the map: pins render first; the basemap appears when maplibre arrives.

## R7. Body encoding and size

- Decision: read the upstream body with `arrayBuffer()` and serve it with no `content-encoding`.
- Rationale: Node 22 fetch (undici) decodes gzip, so forwarding upstream `content-encoding` or
  `content-length` would corrupt the response. Buffering makes the 8 s timeout cover the whole
  transfer.
- Cost: the phone downloads raw `.pbf` (roughly 2 to 3 times the gzip size) over the hotspot LAN.
  SC-004 is the gate. If the phone test misses it, the upgrade is to stream the raw upstream body
  with its encoding. That is a `ponytail:` marker in `mapProxy.ts`.

## R8. Timeout value

- Decision: `AbortSignal.timeout(8000)`.
- Rationale: FR-013 says an answer within 10 s. 8 s on fetch plus body leaves room for the response
  write. Timeout gives 504, other network errors 502.

## R9. Pre-login reachability of port 3003

- Decision: no router change.
- Rationale: `PORTAL_LAN_IPS` includes `10.210.54.133` (`apps/admin/scripts/walled-garden-config.ts:115`).
  It is provisioned as a `/ip hotspot walled-garden ip` row, which is `dst-address` only, all
  protocols and ports (comment at `packages/core/src/integrations/network/mikrotik.ts:1027`, `add`
  call with only `action=accept` and `dst-address` at `:1104-1108`). Port 3003 is
  therefore open before login. The live phone test confirms it (constitution V).

## R10. Logging of map paths (D10)

- Decision: skip `Sentry.sentryHandle()` for `/map/` in `hooks.server.ts`, and pass
  `shouldCreateSpanForRequest` to `browserTracingIntegration` in `hooks.client.ts`.
- Rationale: `sentryHandle` creates a sampled transaction per request with the URL path.
  `scrubEvent` (`packages/core/src/observability.ts`) strips query strings, not paths. Vector tiles
  load inside the maplibre worker, which browser tracing does not see, but the style, sprite, glyph
  and relief requests run on the main thread. Also avoids hundreds of sampled transactions per
  locator session.
- Alternatives: a `tracesSampler` in `sentryOptions` (rejected: needs a change in `packages/core`
  shared by all apps).

## R11. Headless Chromium and WebGL (admin e2e)

- Decision: no launch-arg change in `apps/admin/playwright.config.ts` unless T003 shows a blank map.
- Rationale: playwright-core 1.61.0 adds `--enable-unsafe-swiftshader` on its Chromium launch path
  (`lib/coreBundle.js:42530`). A second path adds it only on macOS (`:42734`). T003 is written
  first and run before the build; if `.maplibregl-canvas` never appears on Linux after the build,
  add `launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }` to the
  e2e spec with `test.use`, not to the shared config.
- The e2e stubs `tiles.openfreemap.org` with `page.route` (the harness never touches live
  providers). The stub must send `access-control-allow-origin: *`, because maplibre fetches the style
  cross-origin.

## R12. maplibre CSS

- Decision: no `maplibre-gl.css` import, same as parasat. The browser pass checks that the canvas
  fills the map and has no stray controls.

## R13. Admin "location picker" (D11, settled: A)

- `apps/admin/src/lib/components/feature/MapPicker.svelte` is imported nowhere (not in
  `components/feature/index.ts`, no route). Only two admin map screens render today: `/networks`
  (`CoverageMap`) and `/map` (`NetworkMap`). D11 = A: MapPicker gets the same swap (T008), verified
  by check and build only. The spec now counts 2 admin screens and 6 screen and theme pairs
  (SC-001), and US1 AS3 uses NetworkMap's double-click pin drop (T004).

## R14. Rate limit key for `/map/*` (Validate F9)

- The user asked for a rate limit on the locator pass-through. D12 = B (user): an in-memory
  fixed-window counter in `mapProxy.ts`, not `consumeRateLimit`
  (`packages/core/src/services/rateLimit.ts`), which takes one DB transaction with a row lock per
  call, all on one row here, and pulls the `@veent/core` barrel that the locator avoids.
- Key: the client address (`event.getClientAddress()`, with `::ffff:` stripped, as `clientIp` in
  `apps/admin/src/lib/server/rateLimit.ts:14`). On the hotspot this is one address for every guest:
  the router masquerades `src-address=10.210.0.0/18` and the only exemption is
  `no-nat-admin-vm` for port 3002 (`docs/mikrotik/admin-bypass-troubleshooting.md:33-42`). Port 3003
  has no exemption, so the locator sees the gateway (`10.210.0.1`) for all hotspot guests. This is
  read from the docs, not from a live `/ip firewall nat print` (constitution V asks for a live check
  of router data). The public path has no `ADDRESS_HEADER` for the locator (`compose.prod.yaml:87-98`),
  so all public traffic shares the proxy's address too (F3 open).
- So in practice the key gives one bucket for the whole hotspot. The limit is a cap on the total
  map load from the hotspot, not a per-guest cap. A per-guest key would need a router NAT change,
  which is out of scope.
- Limit: set from a measurement, not a guess. T019 counts the `/map/` requests in one single-client
  session (pan, then zoom from street level to zoom 3 and back, quickstart section 5 step 5) and the
  peak requests in any 10 s. The limit is that peak, times the expected number of guests on the
  map at once, times 2 as margin. The number is written here after T019.
- D13 (2026-10-13): the user dropped the rate limit. There is no `MAP_LIMIT` and no rate-limit
  code. T019 measured one guest at a peak of 147 `/map/` requests in 10 s, kept for later.

## R15. Upstream keep-alive (issue #123, PR #122)

- Fact: on the venue ISP path, every new TLS handshake from the VM to the provider's Cloudflare
  addresses (104.26.\*, 172.67.\*) takes about 4.4 s. DNS 0.05 s, connect 0.12 s, TLS 4.46 s. The
  same IP with another SNI is also slow. MTU is fine. 104.16.\* and Google are fast. The router
  has no rule on those addresses.
- Cause of the miss: Node `fetch` drops idle connections after 4 s. The first theme flip after a
  pause paid a new handshake and took about 4.6 s (SC-007 miss).
- Decision: pass one shared `undici` `Agent` (`keepAliveTimeout: 60_000`, `undici` 6.29.0 pinned
  exact) as `dispatcher` to the upstream fetch in `mapProxy.ts`. A `ponytail:` note marks it as a
  workaround for the ISP stall.
- Measured: two requests 10 s apart made 2 connects without the Agent and 1 with it, on Node 22.22.3
  and 24.14.1. The connection was still reused after a 50 s gap.
