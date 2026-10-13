/**
 * Shared OpenFreeMap basemap for all map components (CoverageMap, MapPicker, NetworkMap).
 * The add() returned by loadBasemap() reads document state — call only in browser context.
 */

/** Metro Manila centre — shown when no APs have coordinates yet. */
export const FALLBACK_CENTER: [number, number] = [14.5995, 120.9842];

export const BASEMAP_ATTRIBUTION =
	'<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

export function styleUrl(theme: string | undefined): string {
	return `https://tiles.openfreemap.org/styles/${theme === 'dark' ? 'dark' : 'positron'}`;
}

export async function loadBasemap() {
	const [, maplibregl, worker] = await Promise.all([
		import('@maplibre/maplibre-gl-leaflet'),
		import('maplibre-gl'),
		import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url')
	]);
	maplibregl.setWorkerUrl(worker.default);

	return (L: typeof import('leaflet'), map: import('leaflet').Map): (() => void) => {
		if (!document.createElement('canvas').getContext('webgl2')) return () => {};
		const theme = () => document.documentElement.dataset.theme;
		const layer = L.maplibreGL({
			style: styleUrl(theme()),
			attributionControl: { customAttribution: BASEMAP_ATTRIBUTION }
		}).addTo(map);
		const obs = new MutationObserver(() => layer.getMaplibreMap().setStyle(styleUrl(theme())));
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		return () => obs.disconnect();
	};
}
