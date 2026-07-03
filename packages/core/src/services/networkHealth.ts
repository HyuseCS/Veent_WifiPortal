import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
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
			latencyMs: s.latencyMs ?? null,
			lastSampleAt: now,
			// New-row value (no conflict): a freshly-seen offline AP is "down since now".
			offlineSince: s.online ? null : now
		};
		// On update, offline_since must track the transition, not overwrite it: stamp `now` only on
		// the online→offline edge, keep the existing stamp while it stays down (so the debounce
		// measures total downtime), and clear it on recovery. `network_health.offline_since` in the
		// SET refers to the pre-update (existing) row; the JS `s.online` decides the branch.
		const offlineSinceOnUpdate = s.online
			? sql`NULL`
			: sql`CASE WHEN ${networkHealth.online} = true THEN ${now} ELSE ${networkHealth.offlineSince} END`;
		// Upsert on the unique `name`: one round-trip, and two concurrent sweeps can't create
		// duplicate rows for the same AP (the select-then-insert this replaced could).
		await db
			.insert(networkHealth)
			.values({ name: s.name, ...vals })
			.onConflictDoUpdate({
				target: networkHealth.name,
				set: { ...vals, offlineSince: offlineSinceOnUpdate }
			});
	}

	// Drop auto-discovered rows the router didn't report this round (e.g. the seeded
	// sample APs). Operator-placed pins (those with coordinates) are kept regardless —
	// they're manually curated map locations, not live router interfaces, so the
	// interface sweep must never delete them.
	const names = samples.map((s) => s.name);
	if (names.length > 0) {
		await db
			.delete(networkHealth)
			.where(and(notInArray(networkHealth.name, names), isNull(networkHealth.latitude)));
	}
	return samples.length;
}

/**
 * Resolve an AP name — a router interface name (what `resolveApForMac` returns) OR a display
 * name — to its `network_health` id. Prefers the operator-set `interface_name` binding so a
 * named map pin can track a specific interface, then falls back to the display `name`.
 * Returns null when nothing matches; AP attribution is always best-effort.
 */
export async function resolveNetworkIdByApName(db: DB, apName: string): Promise<number | null> {
	if (!apName) return null;
	const [byIface] = await db
		.select({ id: networkHealth.id })
		.from(networkHealth)
		.where(eq(networkHealth.interfaceName, apName))
		.limit(1);
	if (byIface) return byIface.id;
	const [byName] = await db
		.select({ id: networkHealth.id })
		.from(networkHealth)
		.where(eq(networkHealth.name, apName))
		.limit(1);
	return byName?.id ?? null;
}

/**
 * Resolve the AP a device MAC is currently on to a `network_health` id, via the controller's
 * MAC→AP lookup. Never throws — returns null when the controller can't map it (wired client,
 * dev stub, no `resolveApForMac`) or no AP row matches.
 */
export async function resolveNetworkIdForMac(
	db: DB,
	network: NetworkController,
	macAddress: string
): Promise<number | null> {
	if (!network.resolveApForMac) return null;
	try {
		const apName = await network.resolveApForMac(macAddress);
		if (!apName) return null;
		return await resolveNetworkIdByApName(db, apName);
	} catch {
		return null;
	}
}
