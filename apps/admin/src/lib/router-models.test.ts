import { describe, it, expect } from 'vitest';
import { rangeFor, defaultModelId, FALLBACK_RANGE, type RouterModel } from './router-models';

// Catalog ordered as listRouterModels returns it (lowest sortOrder first → the default).
const MODELS: RouterModel[] = [
	{ id: 'suncomm-ap3000g', name: 'Suncomm AP3000G', rangeMeters: 200 },
	{ id: 'long-range', name: 'Long Range', rangeMeters: 800 }
];

describe('rangeFor', () => {
	it('returns the catalog range for a known id', () => {
		expect(rangeFor(MODELS, 'suncomm-ap3000g')).toBe(200);
		expect(rangeFor(MODELS, 'long-range')).toBe(800);
	});

	it('falls back to the default (first) model for null/unknown ids', () => {
		const fallback = MODELS[0].rangeMeters;
		expect(rangeFor(MODELS, null)).toBe(fallback);
		expect(rangeFor(MODELS, undefined)).toBe(fallback);
		expect(rangeFor(MODELS, 'not-a-real-model')).toBe(fallback);
	});

	it('uses FALLBACK_RANGE when the catalog is empty', () => {
		expect(rangeFor([], 'anything')).toBe(FALLBACK_RANGE);
		expect(rangeFor([], null)).toBe(FALLBACK_RANGE);
	});
});

describe('defaultModelId', () => {
	it('is the first (lowest sortOrder) model', () => {
		expect(defaultModelId(MODELS)).toBe('suncomm-ap3000g');
	});

	it('is empty for an empty catalog', () => {
		expect(defaultModelId([])).toBe('');
	});
});
