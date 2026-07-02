import { describe, it, expect } from 'vitest';
import { trendDirection } from './trend';

describe('trendDirection', () => {
	it('reads a rising / falling tail against the earlier mean', () => {
		expect(trendDirection([1, 1, 1, 10])).toBe('up');
		expect(trendDirection([10, 10, 10, 1])).toBe('down');
	});

	it('treats sub-15% wiggle and short/flat series as flat', () => {
		expect(trendDirection([100, 100, 105])).toBe('flat'); // +5% vs mean → noise
		expect(trendDirection([5])).toBe('flat'); // too short
		expect(trendDirection([0, 0, 0])).toBe('flat'); // all zero
	});

	it('rises from a zero baseline when the latest bucket has events', () => {
		expect(trendDirection([0, 0, 3])).toBe('up');
	});
});
