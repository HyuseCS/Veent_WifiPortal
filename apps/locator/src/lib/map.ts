/**
 * Leaflet tile config for the public locator map. Mirrors apps/admin/src/lib/map.ts but the
 * two apps stay decoupled (copied, not shared) — the locator deploys publicly while admin
 * runs behind a tunnel, so the public repo pulls in no admin internals.
 *
 * Basemaps match admin exactly — Voyager (light) / Dark Matter (dark) — so the public map reads
 * the same as /admin/map: a warm, non-stark backdrop rather than a pure white/black one. This is a
 * copy (not an import) on purpose: the locator deploys publicly while admin runs behind a tunnel,
 * so the public repo pulls in no admin internals. tileUrl() reads the same `data-theme` attribute
 * admin does (set by the locator's pre-paint script + Sun/Dark toggle); call only in browser.
 */

/** Metro Manila centre — shown when no AP has coordinates yet. */
export const FALLBACK_CENTER: [number, number] = [14.5995, 120.9842];

/** CARTO tile subdomains. */
export const TILE_SUBDOMAINS = 'abcd';

/** Attribution shown in the Leaflet attribution control. */
export const TILE_ATTRIBUTION = '&copy; OpenStreetMap, &copy; CARTO';

/**
 * CARTO basemap for the current theme — Voyager (light) / Dark Matter (dark), the same pair admin
 * uses. Voyager's warm cream base and Dark Matter's charcoal keep the map off pure white/black.
 * Reads document state — call only in browser context (onMount / MutationObserver).
 */
export function tileUrl(): string {
	const dark = document.documentElement.dataset.theme === 'dark';
	return dark
		? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
		: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
}
