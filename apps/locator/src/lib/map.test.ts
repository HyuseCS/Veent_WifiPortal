import { describe, expect, it } from 'vitest';
import { BASEMAP_ATTRIBUTION, styleUrl } from './map';

const ORIGIN = 'http://10.210.54.133:3003';

describe('styleUrl', () => {
	it('dark theme uses the dark style on the given origin', () => {
		expect(styleUrl('dark', ORIGIN)).toBe(`${ORIGIN}/map/styles/dark`);
	});

	it('light and missing theme use positron', () => {
		expect(styleUrl('light', ORIGIN)).toMatch(/\/map\/styles\/positron$/);
		expect(styleUrl(undefined, ORIGIN)).toMatch(/\/map\/styles\/positron$/);
	});

	it('never points at the provider', () => {
		for (const t of ['dark', 'light', undefined]) {
			expect(styleUrl(t, ORIGIN)).not.toContain('tiles.openfreemap.org');
		}
	});
});

describe('BASEMAP_ATTRIBUTION', () => {
	it('matches the data-model string and has no CARTO', () => {
		expect(BASEMAP_ATTRIBUTION).toBe(
			'<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
		);
		expect(BASEMAP_ATTRIBUTION).not.toContain('CARTO');
	});
});

describe('source guard', () => {
	it('no source file references the old tile provider', () => {
		const files = import.meta.glob('/src/**/*.{ts,svelte}', {
			query: '?raw',
			import: 'default',
			eager: true
		}) as Record<string, string>;
		const offenders = Object.entries(files)
			.filter(([key]) => key !== '/src/lib/map.test.ts')
			.filter(([, src]) => src.includes('cartocdn') || src.includes('CARTO'))
			.map(([key]) => key);
		expect(offenders).toEqual([]);
	});
});
