/**
 * OpenFreeMap basemap for the public locator map. Mirrors apps/admin/src/lib/map.ts but the
 * two apps stay decoupled (copied, not shared) — the locator deploys publicly while admin
 * runs behind a tunnel, so the public repo pulls in no admin internals.
 */

/** Metro Manila centre — shown when no AP has coordinates yet. */
export const FALLBACK_CENTER: [number, number] = [14.5995, 120.9842];

export const BASEMAP_ATTRIBUTION =
	'<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

export function styleUrl(theme: string | undefined, origin: string): string {
	return `${origin}/map/styles/${theme === 'dark' ? 'dark' : 'positron'}`;
}

export async function loadBasemap() {
	const [, maplibregl, { default: workerUrl }] = await Promise.all([
		import('@maplibre/maplibre-gl-leaflet'),
		import('maplibre-gl'),
		import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url')
	]);
	maplibregl.setWorkerUrl(workerUrl);

	return (L: typeof import('leaflet'), map: import('leaflet').Map): (() => void) => {
		if (!document.createElement('canvas').getContext('webgl2')) return () => {};
		const style = () => styleUrl(document.documentElement.dataset.theme, location.origin);
		const layer = L.maplibreGL({
			style: style(),
			attributionControl: { customAttribution: BASEMAP_ATTRIBUTION }
		}).addTo(map);
		const obs = new MutationObserver(() => layer.getMaplibreMap().setStyle(style()));
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		return () => obs.disconnect();
	};
}
