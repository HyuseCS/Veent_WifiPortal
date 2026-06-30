import { describe, it, expect } from 'vitest';
import { computeClusters, type ClusterableAp } from './clustering';
import type { RouterModel } from './router-models';

// Every test AP sets an explicit rangeMeters override, so the catalog is never consulted
// for the fallback — an empty catalog is enough to satisfy the signature here.
const MODELS: RouterModel[] = [];

// Helper: build a placeable AP. Coords as strings (the DB/NetworkAp shape).
function ap(over: Partial<ClusterableAp> & { id: string; lat: number; lng: number }): ClusterableAp {
	return {
		id: over.id,
		latitude: String(over.lat),
		longitude: String(over.lng),
		model: over.model ?? null,
		rangeMeters: over.rangeMeters ?? 500,
		clusterName: over.clusterName ?? null
	};
}

const NEAR_A = { lat: 14.6, lng: 121.0 };
const NEAR_B = { lat: 14.6005, lng: 121.0 }; // ~55 m from A → domes (500 m) overlap
const FAR = { lat: 14.7, lng: 121.0 }; // ~11 km away → no overlap

describe('computeClusters', () => {
	it('groups two overlapping APs into one cluster', () => {
		const { clusters, clusteredIds } = computeClusters(
			[ap({ id: 'a', ...NEAR_A }), ap({ id: 'b', ...NEAR_B })],
			MODELS
		);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].members.map((m) => m.id).sort()).toEqual(['a', 'b']);
		expect(clusters[0].named).toBe(false);
		expect(clusters[0].name).toBe('Cluster 1');
		expect(clusteredIds.has('a')).toBe(true);
		expect(clusteredIds.has('b')).toBe(true);
	});

	it('leaves two distant unnamed APs ungrouped', () => {
		const { clusters, clusteredIds } = computeClusters(
			[ap({ id: 'a', ...NEAR_A }), ap({ id: 'b', ...FAR })],
			MODELS
		);
		expect(clusters).toHaveLength(0);
		expect(clusteredIds.size).toBe(0);
	});

	it('keeps a lone *named* AP as a cluster', () => {
		const { clusters } = computeClusters([ap({ id: 'a', ...NEAR_A, clusterName: 'Lobby' })], MODELS);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].named).toBe(true);
		expect(clusters[0].name).toBe('Lobby');
	});

	it('unions distant APs sharing a manual cluster name (hybrid auto+manual)', () => {
		const { clusters } = computeClusters(
			[ap({ id: 'a', ...NEAR_A, clusterName: 'Campus' }), ap({ id: 'b', ...FAR, clusterName: 'Campus' })],
			MODELS
		);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].name).toBe('Campus');
		expect(clusters[0].members.map((m) => m.id).sort()).toEqual(['a', 'b']);
	});

	it('mirrors a stored name onto an overlap-joined member that had none', () => {
		const { clusters } = computeClusters(
			[ap({ id: 'a', ...NEAR_A, clusterName: 'Atrium' }), ap({ id: 'b', ...NEAR_B })],
			MODELS
		);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].name).toBe('Atrium');
		expect(clusters[0].named).toBe(true);
	});

	it('derives a missing radius from the RouterModel catalog', () => {
		// Both APs omit rangeMeters (null), so the overlap radius must come from the catalog entry
		// for their model — not the explicit-override path the other tests exercise.
		const mk = (id: string, c: { lat: number; lng: number }): ClusterableAp => ({
			id,
			latitude: String(c.lat),
			longitude: String(c.lng),
			model: 'wide',
			rangeMeters: null,
			clusterName: null
		});
		// 500 m catalog radius → the ~55 m-apart domes overlap → one cluster.
		const wide: RouterModel[] = [{ id: 'wide', name: 'Wide', rangeMeters: 500 }];
		expect(computeClusters([mk('a', NEAR_A), mk('b', NEAR_B)], wide).clusters).toHaveLength(1);
		// Same coords, 10 m catalog radius → domes can't reach → no cluster. Proves the radius is
		// read from the matching catalog entry, not a constant.
		const tiny: RouterModel[] = [{ id: 'wide', name: 'Wide', rangeMeters: 10 }];
		expect(computeClusters([mk('a', NEAR_A), mk('b', NEAR_B)], tiny).clusters).toHaveLength(0);
	});
});
