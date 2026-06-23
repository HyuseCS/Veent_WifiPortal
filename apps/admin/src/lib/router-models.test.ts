import { describe, it, expect } from 'vitest';
import { rangeFor, routerModels, DEFAULT_MODEL_ID } from './router-models';

describe('rangeFor', () => {
	it('returns the catalog range for a known id', () => {
		expect(rangeFor('sancom-ap3000g')).toBe(500);
	});

	it('falls back to the default model for null/unknown ids', () => {
		const fallback = routerModels.find((m) => m.id === DEFAULT_MODEL_ID)!.rangeMeters;
		expect(rangeFor(null)).toBe(fallback);
		expect(rangeFor(undefined)).toBe(fallback);
		expect(rangeFor('not-a-real-model')).toBe(fallback);
	});
});
