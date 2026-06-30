/**
 * Sidebar cluster grouping for the locator map. Pure (no Svelte / Leaflet) so it's unit-testable,
 * mirroring admin's `$lib/clustering.ts`. Groups locations by their operator-assigned `clusterName`
 * (the same value admin mirrors to the DB); ungrouped locations come back separately. Both sections
 * are ordered nearest-first to the visitor when their position is known, else alphabetically.
 */

/** Minimal shape the grouper needs — the locator's PublicLocation satisfies it. */
export interface Groupable {
	name: string;
	clusterName: string | null;
	lat: number;
	lng: number;
}

export interface ClusterGroup<T extends Groupable> {
	name: string;
	members: T[];
	/** Centroid of the members — the point used for distance-to-visitor ordering. */
	lat: number;
	lng: number;
}

export interface GroupedLocations<T extends Groupable> {
	clusters: ClusterGroup<T>[];
	singles: T[];
}

/** Great-circle distance in metres (Haversine). Mirrors admin's `$lib/geo.ts`. */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(bLat - aLat);
	const dLng = toRad(bLng - aLng);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

export function groupByCluster<T extends Groupable>(
	locations: T[],
	userLoc: { lat: number; lng: number } | null
): GroupedLocations<T> {
	const byName = new Map<string, T[]>();
	const singles: T[] = [];
	for (const l of locations) {
		if (l.clusterName) {
			const arr = byName.get(l.clusterName);
			if (arr) arr.push(l);
			else byName.set(l.clusterName, [l]);
		} else {
			singles.push(l);
		}
	}
	const clusters: ClusterGroup<T>[] = [...byName].map(([name, members]) => ({
		name,
		members,
		lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
		lng: members.reduce((s, m) => s + m.lng, 0) / members.length
	}));

	if (userLoc) {
		const d = (lat: number, lng: number) => distanceMeters(userLoc.lat, userLoc.lng, lat, lng);
		clusters.sort((a, b) => d(a.lat, a.lng) - d(b.lat, b.lng));
		singles.sort((a, b) => d(a.lat, a.lng) - d(b.lat, b.lng));
	} else {
		clusters.sort((a, b) => a.name.localeCompare(b.name));
		singles.sort((a, b) => a.name.localeCompare(b.name));
	}
	return { clusters, singles };
}
