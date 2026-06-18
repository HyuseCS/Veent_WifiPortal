import { eq, notInArray } from 'drizzle-orm';
import { type DB, networkHealth } from '@veent/db';
import type { NetworkController } from '../integrations/network';

/**
 * Refreshes `network_health` from the controller's live sample (link/users/
 * throughput per interface). Upserts by interface name and prunes rows the router
 * no longer reports — so the table reflects the live router, replacing the seeded
 * sample APs. A no-op when the controller can't sample (e.g. the dev stub), which
 * leaves any seeded rows untouched.
 *
 * `uptimePct` and `latencyMs` aren't part of the light sample: we set uptime to a
 * coarse 100/0 from link state and leave latency null (no per-AP ping). Returns the
 * number of interfaces written.
 */
export async function refreshNetworkHealth(
	db: DB,
	network: NetworkController
): Promise<number> {
	if (!network.sampleHealth) return 0;
	const samples = await network.sampleHealth();
	const now = new Date();

	for (const s of samples) {
		const vals = {
			online: s.online,
			users: s.users,
			throughputMbps: s.throughputMbps,
			uptimePct: s.online ? '100.00' : '0.00',
			latencyMs: null,
			lastSampleAt: now
		};
		const [existing] = await db
			.select({ id: networkHealth.id })
			.from(networkHealth)
			.where(eq(networkHealth.name, s.name))
			.limit(1);
		if (existing) {
			await db.update(networkHealth).set(vals).where(eq(networkHealth.id, existing.id));
		} else {
			await db.insert(networkHealth).values({ name: s.name, ...vals });
		}
	}

	// Drop anything the router didn't report this round (e.g. the seeded sample APs).
	const names = samples.map((s) => s.name);
	if (names.length > 0) {
		await db.delete(networkHealth).where(notInArray(networkHealth.name, names));
	}
	return samples.length;
}
