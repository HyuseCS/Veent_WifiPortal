import { rangeFor, type RouterModel } from '$lib/router-models';
import { domesOverlap } from '$lib/reach';

/**
 * Coverage-overlap clustering for the NetworkMap. Pure (no Svelte, no Leaflet) so it's
 * unit-testable and can't drift from the server's join guard — both lean on the same
 * `domesOverlap` primitive in `$lib/reach`.
 */

/** Minimal AP shape the clusterer needs. `NetworkAp` satisfies it. */
export interface ClusterableAp {
	id: string;
	latitude: string | null;
	longitude: string | null;
	model: string | null;
	rangeMeters: number | null;
	clusterName: string | null;
}

export interface Cluster<T extends ClusterableAp = ClusterableAp> {
	/** Stable key = first-placed member's id. */
	key: string;
	name: string;
	/** True if any member carries a stored clusterName (vs. the auto-number fallback). */
	named: boolean;
	members: T[];
}

export interface ClusteringResult<T extends ClusterableAp = ClusterableAp> {
	clusters: Cluster<T>[];
	clusteredIds: Set<string>;
}

/**
 * Connected components of the coverage-overlap graph: two APs are linked when their
 * domes overlap (centres closer than the sum of radii). Components of ≥2 APs become
 * named clusters; lone APs stay ungrouped unless the operator named them. The displayed
 * name is the first member's stored clusterName (mirrored across members on rename),
 * else an auto-number. APs the operator hand-assigned to the same named cluster are
 * unioned too, even without dome overlap (hybrid auto + manual).
 *
 * `placed` must already be filtered to APs with coordinates.
 *
 * ponytail: O(n²) pair scan + union-find — fine for tens of APs; swap for a spatial grid
 * only at hundreds.
 */
export function computeClusters<T extends ClusterableAp>(
	placed: T[],
	models: RouterModel[]
): ClusteringResult<T> {
	const aps = placed.map((ap) => ({
		ap,
		lat: Number(ap.latitude),
		lng: Number(ap.longitude),
		r: ap.rangeMeters ?? rangeFor(models, ap.model)
	}));
	const parent = aps.map((_, i) => i);
	const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
	for (let i = 0; i < aps.length; i++) {
		for (let j = i + 1; j < aps.length; j++) {
			if (domesOverlap(aps[i].lat, aps[i].lng, aps[i].r, aps[j].lat, aps[j].lng, aps[j].r)) {
				parent[find(i)] = find(j);
			}
		}
	}
	// Manual edges: APs the operator hand-assigned to the same named cluster are unioned too.
	const byName = new Map<string, number>();
	for (let i = 0; i < aps.length; i++) {
		const name = aps[i].ap.clusterName;
		if (!name) continue;
		const first = byName.get(name);
		if (first === undefined) byName.set(name, i);
		else parent[find(i)] = find(first);
	}
	// Group member indices by root, preserving placed order for stable labels.
	const groups = new Map<number, number[]>();
	for (let i = 0; i < aps.length; i++) {
		const root = find(i);
		const g = groups.get(root);
		if (g) g.push(i);
		else groups.set(root, [i]);
	}
	const clusters: Cluster<T>[] = [];
	const clusteredIds = new Set<string>();
	let n = 0;
	for (const idxs of groups.values()) {
		const members = idxs.map((i) => aps[i].ap);
		const stored = members.find((m) => m.clusterName)?.clusterName ?? null;
		// A lone AP is a cluster only if the operator named it (an existing DB cluster);
		// otherwise it's just an ungrouped singleton.
		if (idxs.length < 2 && !stored) continue;
		n++;
		clusters.push({
			key: members[0].id,
			name: stored ?? `Cluster ${n}`,
			named: stored !== null,
			members
		});
		for (const m of members) clusteredIds.add(m.id);
	}
	return { clusters, clusteredIds };
}
