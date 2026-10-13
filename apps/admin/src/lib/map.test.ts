import { describe, it, expect } from 'vitest';
import { BASEMAP_ATTRIBUTION, styleUrl } from './map';

const ATTRIBUTION =
	'<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

describe('basemap style', () => {
	it('uses the dark style for the dark theme', () => {
		expect(styleUrl('dark')).toBe('https://tiles.openfreemap.org/styles/dark');
	});

	it('uses positron for light and unset themes', () => {
		expect(styleUrl('light')).toBe('https://tiles.openfreemap.org/styles/positron');
		expect(styleUrl(undefined)).toBe('https://tiles.openfreemap.org/styles/positron');
	});

	it('credits OpenFreeMap, OpenMapTiles and OpenStreetMap, not CARTO', () => {
		expect(BASEMAP_ATTRIBUTION).toBe(ATTRIBUTION);
		expect(BASEMAP_ATTRIBUTION).not.toContain('CARTO');
	});
});

describe('source guard', () => {
	it('has no CARTO reference in admin source', () => {
		const files = import.meta.glob('/src/**/*.{ts,svelte}', {
			query: '?raw',
			import: 'default',
			eager: true
		}) as Record<string, string>;
		const offenders = Object.entries(files)
			.filter(([path]) => !path.endsWith('/src/lib/map.test.ts'))
			.filter(([, src]) => /cartocdn|CARTO/.test(src))
			.map(([path]) => path);
		expect(offenders).toEqual([]);
	});
});
