import { describe, it, expect } from 'vitest';
import { domesOverlap, reachesAny } from './reach';

// Two points ~55 m apart (5th decimal of latitude ≈ 1.1 m).
const A = { lat: 14.6, lng: 121.0 };
const NEAR = { lat: 14.6005, lng: 121.0 }; // ~55 m from A
const FAR = { lat: 14.7, lng: 121.0 }; // ~11 km from A

describe('domesOverlap', () => {
	it('overlaps when centres are closer than the sum of radii', () => {
		expect(domesOverlap(A.lat, A.lng, 500, NEAR.lat, NEAR.lng, 500)).toBe(true);
	});

	it('does not overlap when centres are farther than the sum of radii', () => {
		expect(domesOverlap(A.lat, A.lng, 500, FAR.lat, FAR.lng, 500)).toBe(false);
	});

	it('is symmetric', () => {
		expect(domesOverlap(A.lat, A.lng, 500, NEAR.lat, NEAR.lng, 100)).toBe(
			domesOverlap(NEAR.lat, NEAR.lng, 100, A.lat, A.lng, 500)
		);
	});
});

describe('reachesAny', () => {
	it('is false for an empty member list', () => {
		expect(reachesAny(A.lat, A.lng, 500, [])).toBe(false);
	});

	it('is true when at least one member dome overlaps', () => {
		const members = [
			{ lat: FAR.lat, lng: FAR.lng, range: 500 },
			{ lat: NEAR.lat, lng: NEAR.lng, range: 500 }
		];
		expect(reachesAny(A.lat, A.lng, 500, members)).toBe(true);
	});

	it('is false when no member dome overlaps', () => {
		const members = [{ lat: FAR.lat, lng: FAR.lng, range: 500 }];
		expect(reachesAny(A.lat, A.lng, 500, members)).toBe(false);
	});
});
