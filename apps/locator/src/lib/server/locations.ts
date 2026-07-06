/**
 * Public locator data. Reads ONLY what the public map is allowed to show — name,
 * address, online status, and coordinates. Internal telemetry (uptime, latency,
 * users, throughput) is never selected here, so it can't leak to an unauthenticated
 * client. Do NOT swap this for admin's `listNetworkHealth`, which returns telemetry.
 */
import { and, asc, isNotNull } from 'drizzle-orm';
import { type DB, networkHealth, isNetworkHealthStale } from '@veent/db';

export interface PublicLocation {
	id: number;
	name: string;
	address: string | null;
	online: boolean;
	lat: number;
	lng: number;
	/** Operator-assigned cluster grouping (mirrored from admin's map). null = ungrouped. */
	clusterName: string | null;
}

/** Access points that have coordinates set, for plotting on the map. */
export async function listPublicLocations(db: DB): Promise<PublicLocation[]> {
	const rows = await db
		.select({
			id: networkHealth.id,
			name: networkHealth.name,
			address: networkHealth.address,
			online: networkHealth.online,
			// Internal-only: drives the staleness derivation below; never returned to the client.
			lastSampleAt: networkHealth.lastSampleAt,
			latitude: networkHealth.latitude,
			longitude: networkHealth.longitude,
			clusterName: networkHealth.clusterName
		})
		.from(networkHealth)
		.where(and(isNotNull(networkHealth.latitude), isNotNull(networkHealth.longitude)))
		.orderBy(asc(networkHealth.name));

	// numeric columns come back as strings; the map needs numbers.
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		address: r.address,
		// B3.5: a row with no fresh sample within the ceiling is shown offline on the public map
		// rather than a stale, confidently-wrong "online". Same derivation admin uses, so the two
		// surfaces agree. lastSampleAt itself is not exposed.
		online: r.online && !isNetworkHealthStale(r.lastSampleAt),
		lat: Number(r.latitude),
		lng: Number(r.longitude),
		clusterName: r.clusterName
	}));
}
