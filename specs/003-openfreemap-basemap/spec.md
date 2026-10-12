# Feature Specification: OpenFreeMap Basemap for Admin and Locator Maps

**Feature Branch**: `fix/map-tiles-provider`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "GitHub issue #118. Replace the CARTO basemap tiles (CARTO now needs an API key) in the admin app and the locator app with OpenFreeMap."

Settled decisions for this feature are D2, D4, D5, D7 and D8 in `.stratum/decisions.md`. This spec does
not reopen them.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Admin maps show a basemap again (Priority: P1)

An operator opens an admin page with a map: the coverage map (`/networks`) or the network map
(`/map`). The unused location picker component (`MapPicker.svelte`, no page shows it) gets the same
basemap change so no old-provider code is left (D11). Today the background map does not load, because the old basemap
provider now needs an API key. After this change, the operator sees a working street map under the
access point pins, coverage domes and links, in light mode and in dark mode. When the operator
switches the theme, the basemap changes to match, and the pins, view and selection stay as they are.

**Why this priority**: Operators use these maps every day to place and manage access points. With
no basemap, a pin has no street context, and a new access point cannot be placed with confidence.

**Independent Test**: Open each of the two admin map screens in a browser, in light mode and in
dark mode. Each shows street detail under the overlays, shows the new attribution, and makes no
request to the old provider.

**Acceptance Scenarios**:

1. **Given** an operator is signed in to admin in light mode, **When** they open the coverage map
   or the network map, **Then** a light street basemap shows under all
   overlays within the screen's normal load time.
2. **Given** an admin map is open in light mode, **When** the operator switches to dark mode,
   **Then** the basemap changes to a dark style with no page reload, and the map keeps its center,
   zoom, pins, domes, popups and selection.
3. **Given** the network map is open, **When** the operator double-clicks a point on the basemap
   to drop a pin, **Then** the pin's coordinates are set exactly as before this change.
4. **Given** the network map shows coverage domes and pins, **When** the basemap has loaded,
   **Then** the domes, pins and popups draw above the basemap, never under it.
5. **Given** any admin map is open, **When** the operator looks at the attribution corner,
   **Then** it credits OpenFreeMap, OpenMapTiles and OpenStreetMap, and does not credit CARTO.

---

### User Story 2 - Locator map works after hotspot login (Priority: P2)

A guest who is already signed in to the hotspot (or any visitor on a normal internet connection)
opens the public access point locator. They see the street basemap with the access point pins, in
light and dark mode, and the map follows the locator's theme toggle. All map data reaches the
guest's device from the locator's own address, not from the map provider.

**Why this priority**: The locator is the guest-facing way to find the nearest access point. It is
second to admin because guests have the access point list even without a basemap, but the map is
its main view.

**Independent Test**: In an agent browser on a normal connection, open the locator. The basemap
shows in light and dark mode, the theme toggle switches it live, and the browser's network log
shows map requests only to the locator's own address.

**Acceptance Scenarios**:

1. **Given** a visitor opens the locator, **When** the page loads, **Then** a street basemap shows
   under the access point pins, in the theme the locator is set to.
2. **Given** the locator map is open, **When** the visitor flips the theme toggle, **Then** the
   basemap switches style live, and the pins, view and open popup stay.
3. **Given** the locator map is open, **When** the visitor pans and zooms anywhere, including far
   out to country scale, **Then** every map request from the device goes to the locator's own
   address and none goes to the map provider directly.
4. **Given** a visitor has opened the locator once, **When** they open it again, **Then** the map
   parts they already loaded come from their device's own cache and are not fetched again.

---

### User Story 3 - Locator map works before hotspot login (Priority: P3)

A guest's phone is connected to the hotspot but not signed in yet. The guest opens the locator from
the captive portal (or types its address). The basemap and pins show, the same as after login.
Before login, the router only lets the phone reach allowed addresses; the locator's address is
already one of them, and no map provider address is added.

**Why this priority**: This is the hardest path and needs a live test on a real phone. It comes
third because P1 and P2 deliver value on their own, and this story uses the same locator behavior
as P2, tested in a captive environment.

**Independent Test**: On a real phone connected to the hotspot and not signed in, open the locator
at the address the captive portal uses. The basemap shows in light and dark mode. No walled-garden
entry was added for this feature.

**Acceptance Scenarios**:

1. **Given** a real phone on the hotspot before login, **When** the guest opens the locator,
   **Then** the basemap and the pins show, at the same quality as after login.
2. **Given** the locator was opened at its pre-login address, **When** the map loads its style and
   map data, **Then** every address inside them points at that same pre-login address, so no
   request goes to a host the router blocks.
3. **Given** the walled garden as it is before this feature, **When** the feature ships, **Then**
   the walled garden has no new host and no new IP for map data.

---

### Edge Cases

- **Map provider unreachable or slow**: the admin and locator pages still load, the pins, list and
  controls still work, and the basemap area stays blank. No error page, no crash. The locator
  returns an error for the failed map request within a bounded time instead of hanging.
- **Request for a path that is not a map path**: the locator refuses it and does not fetch it from
  the provider or from any other host. It cannot be used to reach other sites.
- **Theme flip while the style is still loading**: the map ends in the style of the final theme,
  with no mixed or doubled basemap.
- **Device without hardware map rendering support** (for example an old phone or a limited captive
  portal browser): the pins and list still show; the basemap area may stay blank.
- **Provider publishes a new map data version**: a device that cached the old map description
  picks up the new version within one day and does not keep asking for removed map data.
- **Country-scale zoom**: the low-zoom shaded relief layer that the style uses also comes through
  the locator, so a guest zoomed far out before login still sees a basemap.
- **Guest cookies or identity**: requests the locator sends to the provider carry no guest
  cookies, referrer or forwarded client address.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: All admin maps (coverage map, network map, and the unused location picker component) MUST show the OpenFreeMap
  light basemap in light mode and the OpenFreeMap dark basemap in dark mode.
- **FR-002**: The locator map MUST show the same light and dark OpenFreeMap basemaps, following the
  locator's own theme setting.
- **FR-003**: In both apps, a theme switch MUST change the basemap live, with no page reload, and
  MUST keep the map's view, overlays, popups and selection.
- **FR-004**: Overlays (pins, coverage domes, links, popups, controls) MUST draw above the basemap
  in every admin map and in the locator.
- **FR-005**: Admin and locator pages MUST NOT make any request to the old basemap provider.
- **FR-006**: Both apps MUST show the attribution "OpenFreeMap, © OpenMapTiles, Data from
  OpenStreetMap" with links, and MUST NOT credit CARTO.
- **FR-007**: Admin maps MUST load the basemap directly from OpenFreeMap (decision D7).
- **FR-008**: The locator MUST deliver every part of the basemap (style, map data description,
  map data, low-zoom relief images, fonts, icons) to the guest's device from the locator's own
  address. The guest's device MUST NOT contact the map provider (decision D5).
- **FR-009**: Every address inside the style and the map data description that the locator
  delivers MUST point at the address the device used to open the locator, so the map works on the
  pre-login address and on any other address the locator is opened from.
- **FR-010**: The locator MUST pass through only OpenFreeMap's own map paths for the light and dark
  styles, map data description and map data, low-zoom relief images, fonts and icons, and only for
  read requests. Any other path or method MUST be refused without contacting any outside host.
- **FR-011**: Requests the locator sends to the map provider MUST NOT carry the guest's cookies,
  referrer or client address.
- **FR-012**: The locator MUST NOT store map data on the server (decision D8). It MUST send cache
  instructions so each device keeps its own copy: map data, relief images, fonts and icons cached
  long term; the style and the map data description refreshed at least once per day.
- **FR-013**: If the provider fails or times out, the locator MUST return an error for that map
  request within 10 seconds, and the locator page MUST keep working without the basemap.
- **FR-014**: The locator map MUST work before hotspot login on a real captive device, with no
  new walled-garden host or IP (decision D4 and the D5 note).
- **FR-015**: The feature MUST NOT need an API key, a new environment variable or a `.env.example`
  change.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On each of the 2 admin map screens and the locator, the basemap shows in light mode
  and in dark mode: 6 of 6 screen and theme pairs pass in an agent browser pass and a human check.
- **SC-002**: A network log of a full session on each map screen (open, pan, zoom from street to
  country scale, theme switch) shows 0 requests to the old provider.
- **SC-003**: A network log of a locator session shows 0 map requests (style, map data, relief
  images, fonts, icons) from the device to any host other than the locator's own address.
- **SC-004**: On a real phone before hotspot login, the locator basemap shows in under 10 seconds
  on first open and in under 3 seconds on a repeat open.
- **SC-005**: 100% of requests to the locator for non-map paths, other hosts or non-read methods are
  refused, and none of them reaches an outside host.
- **SC-006**: The walled garden after the feature has the same entries as before it (0 added).
- **SC-007**: A theme switch changes the basemap in under 2 seconds with no page reload on every map
  screen.

## Assumptions

- The provider, styles, client rendering approach and attribution text are settled by D2, the same
  pattern the parasat app uses (`v2-veent/apps/parasat/src/components/ui/BranchMap.astro`). This
  adds two new client packages to both admin and locator: `maplibre-gl` and
  `@maplibre/maplibre-gl-leaflet`, on top of the existing Leaflet 1.9 maps.
- OpenFreeMap needs no key and has no request cap, and its terms allow this use with the
  attribution in FR-006.
- All OpenFreeMap map parts for the two styles live on one host, `tiles.openfreemap.org`. Checked on
  2026-10-12: the styles use five path families (styles, map data description and its
  version-stamped map data, low-zoom relief images, fonts, icons). The provider itself caches the
  map data description for one day.
- The locator server can reach `tiles.openfreemap.org` over the internet.
- The VM `10.210.54.133` (the locator's pre-login address) is already allowed before login by the
  router rule `veent-admin:portal`. No walled-garden change is needed. The live pre-login phone test
  is still required (constitution V).
- No content security policy limits image or connection hosts in admin or locator today (both set
  only `frame-ancestors`), so the new map parts load without a policy change.
- Admin operators' browsers contact OpenFreeMap directly (D7). That is an accepted exposure:
  operators are staff on a normal internet connection, not guests.
- A device that cannot do hardware map rendering shows pins and the list with no basemap. No raster
  fallback is added.
- The light basemap looks paler than the old warm light style. That is accepted.
- Work in `apps/locator/` is in scope because issue #118 names it (constitution I).
- Browser-visible changes get an agent browser pass and a human check (constitution workflow).

## Out of Scope

- A server-side tile store or cache on the VM (rejected in D8).
- Adding Cloudflare IPs or `tiles.openfreemap.org` to the walled garden (rejected in D5).
- Routing admin maps through the VM (rejected in D7).
- A raster fallback basemap for devices that cannot render the vector map.
- Self-hosting OpenFreeMap data.
- Changes to the customer app.
- Updating `apps/locator/3d_map_feature_leaflet_osm.md`, an old design note that still names CARTO.
- Restyling pins, domes, popups or controls beyond keeping them above the basemap.
