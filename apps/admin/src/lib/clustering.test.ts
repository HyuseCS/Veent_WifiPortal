import { describe, it, expect } from 'vitest';
import { computeClusters, type ClusterableAp } from './clustering';

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
		const { clusters, clusteredIds } = computeClusters([
			ap({ id: 'a', ...NEAR_A }),
			ap({ id: 'b', ...NEAR_B })
		]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].members.map((m) => m.id).sort()).toEqual(['a', 'b']);
		expect(clusters[0].named).toBe(false);
		expect(clusters[0].name).toBe('Cluster 1');
		expect(clusteredIds.has('a')).toBe(true);
		expect(clusteredIds.has('b')).toBe(true);
	});

	it('leaves two distant unnamed APs ungrouped', () => {
		const { clusters, clusteredIds } = computeClusters([
			ap({ id: 'a', ...NEAR_A }),
			ap({ id: 'b', ...FAR })
		]);
		expect(clusters).toHaveLength(0);
		expect(clusteredIds.size).toBe(0);
	});

	it('keeps a lone *named* AP as a cluster', () => {
		const { clusters } = computeClusters([ap({ id: 'a', ...NEAR_A, clusterName: 'Lobby' })]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].named).toBe(true);
		expect(clusters[0].name).toBe('Lobby');
	});

	it('unions distant APs sharing a manual cluster name (hybrid auto+manual)', () => {
		const { clusters } = computeClusters([
			ap({ id: 'a', ...NEAR_A, clusterName: 'Campus' }),
			ap({ id: 'b', ...FAR, clusterName: 'Campus' })
		]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].name).toBe('Campus');
		expect(clusters[0].members.map((m) => m.id).sort()).toEqual(['a', 'b']);
	});

	it('mirrors a stored name onto an overlap-joined member that had none', () => {
		const { clusters } = computeClusters([
			ap({ id: 'a', ...NEAR_A, clusterName: 'Atrium' }),
			ap({ id: 'b', ...NEAR_B }) // overlaps a, no name of its own
		]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].name).toBe('Atrium');
		expect(clusters[0].named).toBe(true);
	});
});
