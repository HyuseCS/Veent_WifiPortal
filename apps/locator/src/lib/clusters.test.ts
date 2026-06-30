import { describe, it, expect } from 'vitest';
import { groupByCluster, distanceMeters } from './clusters';

const loc = (clusterName: string | null, lat: number, lng: number, id = 0) => ({
	id,
	name: `AP ${id}`,
	clusterName,
	lat,
	lng
});

describe('groupByCluster', () => {
	it('groups by clusterName and separates ungrouped APs', () => {
		const { clusters, singles } = groupByCluster(
			[loc('A', 0, 0, 1), loc('A', 0, 1, 2), loc(null, 5, 5, 3), loc('B', 10, 10, 4)],
			null
		);
		expect(clusters.map((c) => c.name)).toEqual(['A', 'B']); // alphabetical fallback
		expect(clusters[0].members).toHaveLength(2);
		expect(singles).toHaveLength(1);
		expect(singles[0].id).toBe(3);
	});

	it('orders clusters nearest-first to the visitor by centroid', () => {
		// "Far" centroid (10,10); "Near" centroid (0,0); visitor at (0,0).
		const { clusters } = groupByCluster([loc('Far', 10, 10, 1), loc('Near', 0, 0, 2)], {
			lat: 0,
			lng: 0
		});
		expect(clusters.map((c) => c.name)).toEqual(['Near', 'Far']);
	});

	it('orders ungrouped APs nearest-first too', () => {
		const { singles } = groupByCluster([loc(null, 10, 10, 1), loc(null, 0, 0, 2)], {
			lat: 0,
			lng: 0
		});
		expect(singles.map((s) => s.id)).toEqual([2, 1]); // nearer (id 2) first
	});

	it('computes the centroid as the mean of member coordinates', () => {
		const { clusters } = groupByCluster([loc('A', 0, 0, 1), loc('A', 2, 4, 2)], null);
		expect(clusters[0].lat).toBe(1);
		expect(clusters[0].lng).toBe(2);
	});
});

describe('distanceMeters', () => {
	it('is zero for identical points', () => {
		expect(distanceMeters(14.6, 120.98, 14.6, 120.98)).toBe(0);
	});

	it('approximates ~1.1km for a 0.01° latitude step', () => {
		const d = distanceMeters(14.6, 120.98, 14.61, 120.98);
		expect(d).toBeGreaterThan(1050);
		expect(d).toBeLessThan(1150);
	});
});
