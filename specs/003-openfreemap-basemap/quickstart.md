# Quickstart: validate the OpenFreeMap basemap

Run from the worktree root unless a step says otherwise. Contract: [contracts/locator-map-passthrough.md](./contracts/locator-map-passthrough.md).
Rules: [data-model.md](./data-model.md).

## 0. Prerequisites

- `bun install` done after T001 (both apps list `maplibre-gl` 6.7.0 and
  `@maplibre/maplibre-gl-leaflet` 0.1.4).
- Admin e2e: local Postgres test DB as in `docs/project/testing.md` (default
  `postgres://root:root@localhost:5432/radius_admin_test`) and `bunx playwright install chromium`
  in `apps/admin`.
- Locator dev server: the user starts it with `bun run dev:locator` (needs `apps/locator/.env` with
  `DATABASE_URL`). It listens on `http://localhost:5172`. Agents do not start it.
- Admin dev server for the visual pass: the user starts `bun run dev:admin` and signs in (with 2FA)
  inside the agent browser window.

## 1. Unit tests

```sh
cd apps/admin && bunx vitest run src/lib/map.test.ts
cd apps/locator && bunx vitest run src/lib/map.test.ts src/lib/server/mapProxy.test.ts
```

Expected: all pass. Before the build tasks they must fail (missing exports, CARTO still in source).
Never use `bun test`.

## 2. Build gates and the worker asset

```sh
bun run check
bun run build
find apps/admin/build apps/locator/build -name '*maplibre-gl-worker*'
bun run test
```

Expected: check, build and test pass. `find` prints at least one worker file for each app (proves
`?worker&url` bundles in both the client and SSR builds, research R6).

## 3. Admin e2e

```sh
cd apps/admin && bun run test:e2e -- basemap.e2e.ts
```

Expected: pass. The spec stubs `tiles.openfreemap.org` and aborts any `cartocdn` request.

## 4. Locator pass-through, curl checks (dev server running)

```sh
B=http://localhost:5172
curl -s $B/map/styles/positron | grep -o '"\(sprite\|glyphs\|url\)":"[^"]*"'
curl -s -H 'Host: 10.210.54.133:3003' $B/map/styles/dark | grep -o 'https\?://[^"]*' | sort -u
curl -s -H 'x-forwarded-proto: https' $B/map/styles/dark | grep -o '"sprite":"[^"]*"'
curl -s $B/map/planet | grep -o '"tiles":\[[^]]*\]'
curl -s -D - -o /dev/null $B/map/styles/positron | grep -i 'cache-control\|content-type'
```

Expected:

1. `sprite`, `glyphs` and source `url` all start with `http://localhost:5172/map/`.
2. Every URL starts with `http://10.210.54.133:3003/map/` (no `tiles.openfreemap.org`).
3. `"sprite":"https://localhost:5172/map/sprites/..."`.
4. `"tiles":["http://localhost:5172/map/planet/<stamp>/{z}/{x}/{y}.pbf"]`.
5. `cache-control: public, max-age=86400`, `content-type: application/json`.

Take `<stamp>` from line 4, then:

```sh
S=<stamp>
for p in planet/$S/14/13684/7581.pbf natural_earth/ne2sr/3/6/3.png \
  'fonts/Noto%20Sans%20Regular/0-255.pbf' sprites/ofm_f384/ofm.json sprites/ofm_f384/ofm@2x.png; do
  echo "== $p"; curl -s -D - -o /dev/null "$B/map/$p" | grep -i '^HTTP\|cache-control\|content-type\|content-encoding'
done
```

Expected for each: `200`, `cache-control: public, max-age=31536000, immutable`, the content type
from data-model.md, and no `content-encoding` line. (If the sprite stamp changed, take it from the
`sprite` value in step 1.)

Refusals:

```sh
for p in etc/passwd styles/liberty '..%2Fstyles/positron' 'fonts/..%2F..%2Fx/0-255.pbf' \
  'https://example.com/' 'planet%2F..%2Fstyles/positron'; do
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "$B/map/$p"
done
curl -s -o /dev/null -w 'POST %{http_code}\n' -X POST $B/map/styles/positron
curl -s -o /dev/null -w 'PUT %{http_code}\n' -X PUT $B/map/styles/positron
```

Expected: every path gives `404`. POST gives `403` or `405`. PUT gives `405`. That no upstream request
is made for a refused path, and that no guest header is forwarded, is proven by the fetch spy in
`mapProxy.test.ts` (step 1), not by curl.

## 5. Agent browser pass (SC-001, SC-002, SC-003, SC-007)

Use the agent's Playwright Chromium. Log every request (`page.on('request')`) for the whole session.
Set the theme before load with `localStorage.setItem('radius-admin-theme', 'light')` (admin) or
`'radius-locator-theme'` (locator), then reload.

Screens (3 screens, 6 screen and theme pairs, SC-001): admin `http://localhost:5173/networks`
(CoverageMap) and `/map` (NetworkMap), locator `http://localhost:5172/`. `MapPicker.svelte` is on no
screen (D11) and is not part of this pass.
(Use the admin dev URL the user's server prints if the port differs.)

For each screen, in light and then dark:

1. Screenshot after load. A street basemap shows under the pins, domes and controls.
2. `document.querySelectorAll('.leaflet-tile-pane .maplibregl-canvas').length === 1`.
3. Attribution corner text contains `OpenFreeMap`, `OpenMapTiles`, `OpenStreetMap` and not `CARTO`.
4. Flip the theme with the real control (admin: sidebar Mode buttons; locator: the sun/moon
   toggle). Time from click to the new style response: under 2000 ms. Screenshot after 2 s: the
   other style shows, the same pins, the same view, an open popup is still open, and there is still
   exactly one `.maplibregl-canvas`. No navigation event fired.
5. Pan, then zoom from street level out to zoom 3 (country scale) and back.

After the session:

- Admin: zero requests whose URL contains `cartocdn`. Style requests go to
  `https://tiles.openfreemap.org/styles/positron` and `/styles/dark`.
- Locator: zero requests to any host other than `localhost:5172` for map parts (style, `planet`,
  tiles, `natural_earth`, fonts, sprites). Zero to `tiles.openfreemap.org` or `cartocdn`. Relief
  requests (`/map/natural_earth/...`) appear at zoom 3 or lower and return 200.
- Locator repeat open: reload the page. Tile, font and sprite requests are served from the browser
  cache (DevTools "(disk cache)" or CDP `Network.requestServedFromCache`), not from the server.

Edge cases:

1. Rapid flip: flip the theme three times within 300 ms, ending on dark. After 2 s the dark style
   shows and there is one canvas.
2. Provider down, admin: `page.route('**/tiles.openfreemap.org/**', (r) => r.abort())`, reload. The
   page loads, pins and controls work, the basemap area is blank, no error page.
3. No WebGL: launch Chromium with `--disable-webgl --disable-3d-apis`, open the locator and one admin
   map. Pins, list and controls show. No error page.
4. Admin `/map`: double-click an empty map point. A new pin and the pin panel appear, as before.

## 6. Human check (SC-001)

The user looks at each pair and ticks it:

| Screen                         | Light | Dark | Theme flip keeps view, pins, popup |
| ------------------------------ | ----- | ---- | ---------------------------------- |
| Admin `/networks` coverage map | [ ]   | [ ]  | [ ]                                |
| Admin `/map` network map       | [ ]   | [ ]  | [ ]                                |
| Locator `/`                    | [ ]   | [ ]  | [ ]                                |

Also: pins and domes sit above the map, attribution credits OpenFreeMap, OpenMapTiles and
OpenStreetMap, the light map is paler than before (accepted).

## 7. Pre-login phone test (FR-014, SC-004, SC-006)

The user runs this on the real hotspot. Constitution V.

1. Baseline the walled garden in the router terminal, before deploying:
   `/ip hotspot walled-garden print count-only` and
   `/ip hotspot walled-garden ip print count-only`. Write both numbers down.
2. Deploy this branch's locator to the VM `10.210.54.133` with the current manual docker deploy
   (the user owns deploys). The locator must answer on `http://10.210.54.133:3003/`.
3. On the phone: forget the hotspot network, join it again, do not sign in. Close the captive
   sheet if it opens.
4. In the phone's browser, type `http://10.210.54.133:3003/` and start a stopwatch. Stop it when
   the street basemap shows under the pins. Pass: under 10 s. If it fails, first check whether the
   page itself painted late: `apps/locator/src/routes/layout.css:4` imports Google Fonts, a host
   that is blocked before login (not a map request, out of scope for this feature).
5. Reload the page with the stopwatch. Pass: basemap shows in under 3 s.
6. Tap the theme toggle. Pass: the other style shows in under 2 s, the pins stay.
7. Pinch out to the whole Philippines and further. Pass: land and relief still show.
8. On the router, find the phone's IP with `/ip hotspot host print` (the phone MAC can change on
   rejoin, so use the row that matches the phone now). Check it is not logged in:
   `/ip hotspot active print` has no row for that IP.
9. Check the phone did not reach the provider:
   `/ip firewall connection print where src-address~"<phone IP>" and (dst-address~"104.26." or dst-address~"172.67.")`.
   Pass: no rows.
10. Repeat step 1. Pass: both counts equal the baseline (SC-006).
11. Optional: repeat steps 4 to 6 inside the captive mini-browser if it can open the address.

Record each pass or fail with the times in the T-task notes in `tasks.md`.
