/**
 * Shared Leaflet tile configuration for all map components (CoverageMap, MapPicker, NetworkMap).
 * tileUrl() reads document state — call only in browser context (onMount / MutationObserver).
 */

/** Metro Manila centre — shown when no APs have coordinates yet. */
export const FALLBACK_CENTER: [number, number] = [14.5995, 120.9842];

/** CARTO tile subdomains. */
export const TILE_SUBDOMAINS = 'abcd';

/** Attribution shown in the Leaflet attribution control. */
export const TILE_ATTRIBUTION = '&copy; OpenStreetMap, &copy; CARTO';

/**
 * Returns the CARTO basemap tile URL for the current admin theme.
 * Voyager in light mode; dark_all in dark mode.
 */
export function tileUrl(): string {
	const dark = document.documentElement.dataset.theme === 'dark';
	return dark
		? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
		: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
}
