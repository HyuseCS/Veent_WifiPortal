# Decisions: #118 replace CARTO map tiles

- D2 (pre-grill, 2026-10-12): use OpenFreeMap vector styles (`positron` light, `dark` dark) through
  `maplibre-gl` and `@maplibre/maplibre-gl-leaflet`, the same way parasat does. No key, no cap.
  Rejected: keep CARTO with the free key (1M/month cap, key to manage); Stadia (paid for commercial).
- D4 (Q1): the locator map must work before hotspot login. Add the needed hosts (locator host if not
  already open, `tiles.openfreemap.org` and any style/font/sprite hosts) to the walled garden through
  `setup:router`, then test on a real phone before login. Rejected: O1 (after login only, no
  walled-garden change).
- D5 (Q2): the locator server proxies OpenFreeMap (style, map data, fonts, sprites) from its own
  address with a cache, so the walled garden needs no Cloudflare IPs. Rejected: O4 (allow the shared
  Cloudflare IPs `104.26.6.23`, `104.26.7.23`, `172.67.74.56`, which leaks other sites pre-login).
- D7 (Q4): admin maps load OpenFreeMap directly (like parasat); only the locator goes through the
  VM. Rejected: O8 (admin also through the VM).
- D8 (Q5): no server-side store. The locator passes each request through and sends long cache
  headers, so each phone caches its own copy (refines D5's "with a cache"). Rejected: O10 (capped
  in-memory server cache).
- Note (from D5): the VM `10.210.54.133` is already open before login (router NAT `veent-admin:portal`),
  so D4 needs no new walled-garden host. D4 still requires the live pre-login phone test.
- Grill done (2026-10-12): user agreed the decision list D2, D4, D5, D7, D8 as the shared
  understanding. Next: spec.
- D10 (spec gate, 2026-10-12): user agreed spec 003. Plan defaults accepted: pin `maplibre-gl`
  6.7.0 and `@maplibre/maplibre-gl-leaflet` 0.1.4 (same as parasat); the locator does not log guest
  map paths; a new upstream host in the styles is refused by the pass-through (degrade, never leak).
- D11 (Q8): `MapPicker.svelte` (no importer) gets the same tile swap as the other admin maps but is
  not tested on screen. Spec screen list and SC-001 drop from 8 to 6 screen/theme pairs. Rejected:
  O16 (delete it).
- D13 (2026-10-13): drop the `/map/*` rate limit (reverses D12). T026, T027 and T028 skipped, no
  code written. Measured input kept for later: one guest peaks at 147 `/map/` requests in 10 s
  (T019). Rejected: O1 (keep it, `MAP_LIMIT` for 30 guests = 8820 per 10 s). Plan, research R14
  and quickstart still name D12: drift for Close.
