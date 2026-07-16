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
	// Interpolated into the raw `sql` CASE templates below as an ISO string, NOT the Date object:
	// Drizzle serializes a bare Date in a `sql` template via `.toString()` ("… GMT+0800 (Philippine
	// Standard Time)"), which real Postgres rejects ("time zone not recognized") — the whole upsert
	// then throws and no health row is ever written. The column-mapped `vals` (lastSampleAt etc.)
	// already send ISO; match that here.
	const nowIso = now.toISOString();

	for (const s of samples) {
		// "Serving" folds LINK state together with WAN reachability: an AP with a live radio but a dead
		// uplink isn't actually serving guests, so the outage debounce must treat it as down. `online`
		// stays the raw link state (admin display); `wan_ok` is the shared uplink-probe result. Absent
		// probe (stub/older sample) → assume reachable, so a missing signal never fabricates an outage.
		const wanOk = s.wanReachable ?? true;
		const serving = s.online && wanOk;
		const vals = {
			online: s.online,
			wanOk,
			users: s.users,
			throughputMbps: s.throughputMbps,
			uptimePct: s.online ? '100.00' : '0.00',
			latencyMs: s.latencyMs ?? null,
			lastSampleAt: now,
			// New-row value (no conflict): a freshly-seen AP is "down since now" / "up since now".
			offlineSince: serving ? null : now,
			onlineSince: serving ? now : null
		};
		// offline_since/online_since track the SERVING transition (link AND uplink), not just link, so
		// a WAN outage on an up-link AP still starts the pause debounce. The SET expression reads the
		// pre-update (existing) row's online+wan_ok; the JS `serving` decides which branch is written.
		// COALESCE backfills a row that was already not-serving / already-serving but carried no stamp
		// (seeded/legacy, or predating this feature) so the sweep's non-NULL requirement is satisfied.
		const wasServing = sql`(${networkHealth.online} = true AND ${networkHealth.wanOk} = true)`;
		const offlineSinceOnUpdate = serving
			? sql`NULL`
			: sql`CASE WHEN ${wasServing} THEN ${nowIso} ELSE COALESCE(${networkHealth.offlineSince}, ${nowIso}) END`;
		const onlineSinceOnUpdate = serving
			? sql`CASE WHEN NOT ${wasServing} THEN ${nowIso} ELSE COALESCE(${networkHealth.onlineSince}, ${nowIso}) END`
			: sql`NULL`;
		// Upsert on the unique `name`: one round-trip, and two concurrent sweeps can't create
		// duplicate rows for the same AP (the select-then-insert this replaced could).
		await db
			.insert(networkHealth)
			.values({ name: s.name, ...vals })
			.onConflictDoUpdate({
				target: networkHealth.name,
				set: { ...vals, offlineSince: offlineSinceOnUpdate, onlineSince: onlineSinceOnUpdate }
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
