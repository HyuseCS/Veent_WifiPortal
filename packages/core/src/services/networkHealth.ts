import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { type DB, networkHealth, networkClientAttribution } from '@veent/db';
import type {
	NetworkController,
	DhcpLeaseEntry,
	HotspotActiveEntry
} from '../integrations/network';

// ── AP recognition constants (Phase A per-AP visibility) ───────────────────────────────────────
/** OUI prefix of the Suncomm AP3000G outdoor APs (uppercased MAC prefix). A lease whose MAC starts
 * with this is an AP. */
export const AP_MAC_OUI = 'E4:67:1E';
/** Hostname signature of the AP3000G firmware (`OAP3000G-*`). OR'd with the OUI match — either
 * signal alone recognises an AP. */
export const AP_HOSTNAME_RE = /^OAP3000G-/i;

/** True when a DHCP lease looks like an access point — by MAC OUI OR hostname signature. */
function isApLease(lease: DhcpLeaseEntry): boolean {
	if (lease.mac.toUpperCase().startsWith(AP_MAC_OUI)) return true;
	return lease.hostname != null && AP_HOSTNAME_RE.test(lease.hostname);
}

/**
 * Recognise access points among raw DHCP leases (OUI match OR hostname match), deduped by MAC
 * preferring the `bound` lease (a MAC can appear once per DHCP-server instance / in a transient
 * `waiting`/`offered` state). Pure — unit-testable without a DB.
 */
export function recognizeAccessPoints(leases: readonly DhcpLeaseEntry[]): DhcpLeaseEntry[] {
	const byMac = new Map<string, DhcpLeaseEntry>();
	for (const lease of leases) {
		if (!isApLease(lease)) continue;
		const mac = lease.mac.toUpperCase();
		const existing = byMac.get(mac);
		// Prefer a `bound` lease over any other state; otherwise first-seen wins.
		if (!existing || (existing.status !== 'bound' && lease.status === 'bound')) {
			byMac.set(mac, { ...lease, mac });
		}
	}
	return [...byMac.values()];
}

/** One AP row's grouping-relevant fields. */
export interface ApGroupRow {
	name: string;
	apCircuitId: string | null;
}

/**
 * Group AP rows by their Option 82 circuit-id. Only circuit-ids shared by 2+ APs form a group (a
 * shared ONU the router can't split). Rows with no circuit-id are never grouped. Pure.
 * Returns Map circuitId → member rows (each entry has 2+ members).
 */
export function computeApGroups<T extends ApGroupRow>(apRows: readonly T[]): Map<string, T[]> {
	const byCircuit = new Map<string, T[]>();
	for (const row of apRows) {
		const cid = row.apCircuitId;
		if (!cid) continue;
		const list = byCircuit.get(cid);
		if (list) list.push(row);
		else byCircuit.set(cid, [row]);
	}
	// Drop singletons — a group is 2+ APs on one ONU.
	for (const [cid, members] of byCircuit) {
		if (members.length < 2) byCircuit.delete(cid);
	}
	return byCircuit;
}

/**
 * Per-AP traffic rate (Mbps) from two cumulative byte samples (Section 5). Pure — the AC4 delta
 * math, unit-tested independently of the DB:
 *  - first sample (no previous byte total): rate is UNKNOWN → null (only the running total is
 *    stored so the next sample has a basis).
 *  - counter reset / session churn ⇒ negative delta ⇒ clamp to 0 (never fabricate a huge spike).
 *  - otherwise: (Δbytes × 8) / elapsedSec / 1e6, rounded.
 * `elapsedSec <= 0` (clock skew / same-instant re-sample) → null (can't divide).
 */
export function computeTrafficRateMbps(
	prevBytes: number | null | undefined,
	currBytes: number,
	elapsedSec: number
): number | null {
	if (prevBytes == null) return null;
	if (elapsedSec <= 0) return null;
	const deltaBits = Math.max(0, currBytes - prevBytes) * 8;
	return Math.round(deltaBits / elapsedSec / 1e6);
}

/**
 * The offline/online-since SET expressions for the serving-transition debounce, shared VERBATIM by
 * the interface upsert and the AP upsert (Regression contract #7 — the CASE logic is written once,
 * never hand-duplicated). `serving` = link up AND uplink reachable; `nowIso` is the ISO string
 * interpolated into the raw SQL (never a JS Date — Postgres rejects Date.toString()).
 */
function sinceTransitionSet(serving: boolean, nowIso: string) {
	// The SET reads the PRE-update (existing) row's serving state; the JS `serving` picks the branch.
	// COALESCE backfills a legacy/seeded row that carried no stamp so the sweep's non-NULL need holds.
	const wasServing = sql`(${networkHealth.online} = true AND ${networkHealth.wanOk} = true)`;
	return {
		offlineSinceOnUpdate: serving
			? sql`NULL`
			: sql`CASE WHEN ${wasServing} THEN ${nowIso} ELSE COALESCE(${networkHealth.offlineSince}, ${nowIso}) END`,
		onlineSinceOnUpdate: serving
			? sql`CASE WHEN NOT ${wasServing} THEN ${nowIso} ELSE COALESCE(${networkHealth.onlineSince}, ${nowIso}) END`
			: sql`NULL`
	};
}

/**
 * Refreshes `network_health` from the controller's live sample (link/users/
 * throughput per interface). Upserts by interface name and prunes rows the router
 * no longer reports — so the table reflects the live router, replacing the seeded
 * sample APs. A no-op when the controller can't sample (e.g. the dev stub), which
 * leaves any seeded rows untouched.
 *
 * Phase A: additionally recognises physical access points from the DHCP lease table (OLT-inserted
 * Option 82 agent-circuit-id), attributes hotspot clients per-AP, pings each AP for liveness, and
 * upserts one AP row per MAC. The AP portion is fully guarded — a controller without
 * `listDhcpLeases` (stub) or a router hiccup degrades to interface-only refresh with AP rows
 * untouched.
 *
 * `uptimePct` and `latencyMs` aren't part of the light interface sample: uptime is a coarse 100/0
 * from link state. Returns the number of interfaces written (AP rows are not counted — the return
 * contract is unchanged).
 */
export async function refreshNetworkHealth(db: DB, network: NetworkController): Promise<number> {
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
		// a WAN outage on an up-link AP still starts the pause debounce.
		const { offlineSinceOnUpdate, onlineSinceOnUpdate } = sinceTransitionSet(serving, nowIso);
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

	// ── AP portion (Phase A) — guarded + degradable ─────────────────────────────────────────────
	// Shared WAN reachability from the interface sample (all interfaces share one uplink probe).
	const sharedWanOk = samples.length > 0 ? (samples[0].wanReachable ?? true) : true;
	const apNames: string[] = [];
	let apScanRan = false;
	if (network.listDhcpLeases) {
		try {
			apNames.push(...(await refreshAccessPoints(db, network, now, nowIso, sharedWanOk)));
			apScanRan = true;
		} catch {
			// Router hiccup / lease-table unavailable → degrade to interface-only refresh. AP rows are
			// left untouched (the prune below restricts to mac IS NULL when the scan didn't run).
			apScanRan = false;
		}
	}

	// Drop auto-discovered rows the router didn't report this round (e.g. the seeded sample APs, or a
	// disappeared AP). Operator-placed pins (coordinates set) are kept regardless. When the AP scan
	// did NOT run, additionally restrict the delete to `mac IS NULL` rows so a stub/failed scan can
	// never wipe the AP rows (Regression contracts #2, #5; R2).
	const names = [...samples.map((s) => s.name), ...apNames];
	if (names.length > 0) {
		const keepByName = notInArray(networkHealth.name, names);
		const predicate = apScanRan
			? and(keepByName, isNull(networkHealth.latitude))
			: and(keepByName, isNull(networkHealth.latitude), isNull(networkHealth.mac));
		await db.delete(networkHealth).where(predicate);
	}

	return samples.length;
}

/**
 * The AP portion of a health refresh (Phase A). Recognises APs from the lease table, keeps the
 * client-attribution cache current, attributes hotspot clients per circuit-id, pings each AP for
 * liveness, and upserts one AP row per MAC. Returns the AP row names written this cycle (for the
 * prune name-set). Throws on a router error so the caller can degrade to interface-only.
 */
async function refreshAccessPoints(
	db: DB,
	network: NetworkController,
	now: Date,
	nowIso: string,
	sharedWanOk: boolean
): Promise<string[]> {
	const leases = await network.listDhcpLeases!();
	const apLeases = recognizeAccessPoints(leases);

	// Attribution-cache upkeep: every lease (guest OR AP) carrying a NON-EMPTY circuit-id refreshes
	// its cache row. A blank/absent circuit-id (unicast renewal that omits Option 82) never
	// overwrites a cached value (AC6) — we simply skip those leases.
	for (const lease of leases) {
		const cid = lease.agentCircuitId;
		if (!cid) continue;
		await db
			.insert(networkClientAttribution)
			.values({ mac: lease.mac.toUpperCase(), circuitId: cid, updatedAt: now })
			.onConflictDoUpdate({
				target: networkClientAttribution.mac,
				set: { circuitId: cid, updatedAt: now }
			});
	}

	// Per-circuit-id attributed device counts + byte sums from the active hotspot clients: circuit-id
	// from the client's CURRENT lease when present, else the durable cache. Devices with no
	// circuit-id from either source are unattributed (network-wide only, AC7).
	const byCircuit = await aggregateByCircuit(db, network, leases);

	// Liveness: ping every AP's leased IP in parallel (provider bounds + never throws). When the
	// controller can't ping, fall back to lease `status === 'bound'` (discovery-only liveness).
	const pingByAddress = new Map<string, number | null>();
	if (network.pingHosts && apLeases.length > 0) {
		const results = await network.pingHosts(apLeases.map((l) => l.address));
		for (const r of results) pingByAddress.set(r.address, r.aliveMs);
	}

	// Previous byte totals + sample times (Section 5 traffic delta basis), keyed on MAC.
	const prevByMac = new Map<string, { trafficBytes: number | null; lastSampleAt: Date | null }>();
	if (apLeases.length > 0) {
		const rows = await db
			.select({
				mac: networkHealth.mac,
				trafficBytes: networkHealth.trafficBytes,
				lastSampleAt: networkHealth.lastSampleAt
			})
			.from(networkHealth)
			.where(inArray(networkHealth.mac, apLeases.map((l) => l.mac.toUpperCase())));
		for (const r of rows) {
			if (r.mac) prevByMac.set(r.mac, { trafficBytes: r.trafficBytes, lastSampleAt: r.lastSampleAt });
		}
	}

	const names: string[] = [];
	for (const lease of apLeases) {
		const mac = lease.mac.toUpperCase();
		const aliveMs = network.pingHosts ? (pingByAddress.get(lease.address) ?? null) : null;
		const online = network.pingHosts ? aliveMs != null : lease.status === 'bound';
		const latencyMs = aliveMs == null ? null : Math.round(aliveMs);
		const serving = online && sharedWanOk;
		const name = await resolveApName(db, mac, lease.hostname);

		// Per-AP traffic (Section 5): sum this circuit-id's attributed hotspot bytes, then rate it
		// against the row's previous byte total + sample time. Null byte sum (firmware hides counters)
		// ⇒ throughput null + trafficBytes untouched → the card shows "—" (honest AC4 degradation).
		const agg = lease.agentCircuitId ? byCircuit.get(lease.agentCircuitId) : undefined;
		const currBytes = agg?.bytes ?? null;
		const prev = prevByMac.get(mac);
		let throughputMbps: number | null = null;
		let trafficBytes: number | null = null;
		if (currBytes != null) {
			trafficBytes = currBytes;
			const elapsedSec = prev?.lastSampleAt
				? (now.getTime() - prev.lastSampleAt.getTime()) / 1000
				: 0;
			throughputMbps = computeTrafficRateMbps(prev?.trafficBytes, currBytes, elapsedSec);
		}

		const vals = {
			name,
			mac,
			apCircuitId: lease.agentCircuitId,
			attributionSource: 'circuit-id' as const,
			online,
			wanOk: sharedWanOk,
			users: agg?.users ?? 0,
			latencyMs,
			uptimePct: online ? '100.00' : '0.00',
			throughputMbps,
			trafficBytes,
			lastSampleAt: now,
			offlineSince: serving ? null : now,
			onlineSince: serving ? now : null
		};
		const { offlineSinceOnUpdate, onlineSinceOnUpdate } = sinceTransitionSet(serving, nowIso);
		// Second collision layer (checklist 2.6 / constraint E3). `resolveApName`'s pre-check is a
		// SELECT, so a concurrent refresh can claim the name between that read and this INSERT (TOCTOU)
		// — and the `target: mac` conflict clause does NOT absorb a `network_health_name_key` violation.
		// Retry ONCE with the MAC-tail suffix; a second collision propagates (F3): `refreshAccessPoints`
		// throws and the caller degrades that cycle to interface-only. No loop, nothing swallowed.
		let writtenName = vals.name;
		try {
			await upsertApRow(db, vals, currBytes, offlineSinceOnUpdate, onlineSinceOnUpdate);
		} catch (e) {
			if (!isNameUniqueViolation(e)) throw e;
			// Suffix the name that just failed. When the pre-check already suffixed it, this yields
			// `<base> (<tail>) (<tail>)` — expected and bounded, since there is exactly one retry.
			writtenName = `${vals.name} (${mac.slice(-5).replace(':', '')})`;
			await upsertApRow(
				db,
				{ ...vals, name: writtenName },
				currBytes,
				offlineSinceOnUpdate,
				onlineSinceOnUpdate
			);
		}
		// Push the name ACTUALLY written, not the pre-retry one: the prune below deletes auto-discovered
		// rows whose name isn't in this set, so recording a never-written name would delete the row we
		// just wrote in this very cycle (destroying its offline/online debounce state and traffic basis).
		names.push(writtenName);
	}
	return names;
}

/**
 * The AP-row upsert, keyed on the unique `mac` (physical-AP identity) so an AP-lease IP change
 * updates the same row (AC8). On conflict, `trafficBytes` is only overwritten when a fresh counter
 * sum exists (the `sql` fallback keeps the prior basis when counters are absent this cycle).
 *
 * Extracted from `refreshAccessPoints` purely so the name-collision retry path is directly testable
 * (the TOCTOU window is unreachable through the public flow — nothing runs between the pre-check and
 * the insert). Behaviour-preserving move. **Test-only internal export** — not part of the
 * `@veent/core` public contract despite flowing through the `services/index.ts` barrel.
 */
export async function upsertApRow(
	db: DB,
	vals: typeof networkHealth.$inferInsert,
	currBytes: number | null,
	offlineSinceOnUpdate: ReturnType<typeof sinceTransitionSet>['offlineSinceOnUpdate'],
	onlineSinceOnUpdate: ReturnType<typeof sinceTransitionSet>['onlineSinceOnUpdate']
): Promise<void> {
	await db
		.insert(networkHealth)
		.values(vals)
		.onConflictDoUpdate({
			target: networkHealth.mac,
			set: {
				name: vals.name,
				apCircuitId: vals.apCircuitId,
				attributionSource: vals.attributionSource,
				online: vals.online,
				wanOk: vals.wanOk,
				users: vals.users,
				latencyMs: vals.latencyMs,
				uptimePct: vals.uptimePct,
				throughputMbps: vals.throughputMbps,
				trafficBytes:
					currBytes != null
						? currBytes
						: sql`${networkHealth.trafficBytes}`,
				lastSampleAt: vals.lastSampleAt,
				offlineSince: offlineSinceOnUpdate,
				onlineSince: onlineSinceOnUpdate
			}
		});
}

/**
 * True when an error is the `network_health_name_key` unique violation (SQLSTATE 23505) raised by
 * the AP upsert — the one error the once-retry handles. Everything else must propagate.
 *
 * drizzle-orm wraps driver errors in `DrizzleQueryError`, so the SQLSTATE lives on the `cause` chain
 * — walk it bounded (self, `.cause`, `.cause.cause`), mirroring `reconcilePayments.ts`. The
 * constraint name field differs by driver: postgres.js exposes `constraint_name`, PGlite /
 * node-postgres-shaped errors expose `constraint`; check both on the same walk. NEVER substring-match
 * the message.
 *
 * When no constraint field appears anywhere on the chain, code `23505` alone suffices: on this
 * statement `onConflictDoUpdate({ target: mac })` already absorbs `network_health_mac_key`, leaving
 * `network_health_name_key` as the only unique index the insert can trip. (`network_health_pkey` is
 * theoretically reachable under sequence drift, but both drivers attach the constraint field, so
 * such an error is correctly rejected by the constraint check above rather than retried.)
 *
 * **Test-only internal export** — not part of the `@veent/core` public contract.
 */
export function isNameUniqueViolation(e: unknown): boolean {
	type PgLike = { code?: string; constraint?: string; constraint_name?: string; cause?: unknown };
	let code: string | undefined;
	let constraint: string | undefined;
	let node: unknown = e;
	for (let depth = 0; depth < 3 && node != null && typeof node === 'object'; depth++) {
		const n = node as PgLike;
		code ??= n.code;
		constraint ??= n.constraint_name ?? n.constraint;
		node = n.cause;
	}
	if (code !== '23505') return false;
	return constraint == null || constraint === 'network_health_name_key';
}

/**
 * Per-circuit-id aggregate (device count + attributed byte sum) from the active hotspot clients.
 * Circuit-id resolves from the client's current lease when it carries one, else the durable
 * attribution cache. Unattributed devices (no circuit-id from either source) are excluded (AC7).
 * `bytes` is null for a circuit-id when ANY attributed client's counters are absent (firmware hides
 * them) — never coerce a missing counter to 0 (AC4 degradation signal). No-op when the controller
 * can't list active clients.
 */
async function aggregateByCircuit(
	db: DB,
	network: NetworkController,
	leases: readonly DhcpLeaseEntry[]
): Promise<Map<string, { users: number; bytes: number | null }>> {
	const agg = new Map<string, { users: number; bytes: number | null }>();
	if (!network.listHotspotActive) return agg;
	const active: HotspotActiveEntry[] = await network.listHotspotActive();
	if (active.length === 0) return agg;

	const leaseCircuitByMac = new Map<string, string>();
	for (const lease of leases) {
		if (lease.agentCircuitId) leaseCircuitByMac.set(lease.mac.toUpperCase(), lease.agentCircuitId);
	}

	// MACs whose circuit-id isn't known from a current lease → look up the durable cache in one pass.
	const needCache = active
		.map((a) => a.mac.toUpperCase())
		.filter((mac) => !leaseCircuitByMac.has(mac));
	const cacheCircuitByMac = new Map<string, string>();
	if (needCache.length > 0) {
		const rows = await db
			.select({ mac: networkClientAttribution.mac, circuitId: networkClientAttribution.circuitId })
			.from(networkClientAttribution)
			.where(inArray(networkClientAttribution.mac, needCache));
		for (const r of rows) cacheCircuitByMac.set(r.mac, r.circuitId);
	}

	for (const a of active) {
		const mac = a.mac.toUpperCase();
		const cid = leaseCircuitByMac.get(mac) ?? cacheCircuitByMac.get(mac);
		if (!cid) continue; // unattributed → network-wide only
		const entry = agg.get(cid) ?? { users: 0, bytes: 0 as number | null };
		entry.users += 1;
		// A missing counter poisons the whole circuit's byte sum to null — honest "unavailable".
		if (a.bytesIn == null || a.bytesOut == null) entry.bytes = null;
		else if (entry.bytes != null) entry.bytes += a.bytesIn + a.bytesOut;
		agg.set(cid, entry);
	}
	return agg;
}

/**
 * Deterministic, collision-free display name for an AP row. Base is the DHCP hostname (else
 * `AP <mac>`). If that name is already taken by a DIFFERENT row (an interface row, or another AP
 * sharing a hostname), disambiguate with the MAC tail — `<base> (<last-5-of-mac>)` — so the unique
 * `network_health_name_key` index rejects the upsert in the common case.
 *
 * This pre-check is the FIRST of two layers: a cheap SELECT that avoids most collisions outright. It
 * does NOT replace the upsert-level once-retry (checklist 2.6 / E3) — being a read, it leaves a
 * TOCTOU window in which a concurrent refresh claims the name before this AP's INSERT lands. The
 * retry around `upsertApRow` is the second layer that covers that window.
 */
async function resolveApName(db: DB, mac: string, hostname: string | null): Promise<string> {
	const base = hostname && hostname.trim() ? hostname.trim() : `AP ${mac}`;
	const [clash] = await db
		.select({ mac: networkHealth.mac })
		.from(networkHealth)
		.where(eq(networkHealth.name, base))
		.limit(1);
	// No row with that name, or the row is THIS AP's own row (same MAC) → keep the base name.
	if (!clash || clash.mac === mac) return base;
	return `${base} (${mac.slice(-5).replace(':', '')})`;
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
 * Resolve the AP a device MAC is currently on to a `network_health` id. Never throws — returns
 * null when nothing maps.
 *
 * Phase A: a fast path tries the client-attribution cache first — MAC → circuit-id → the AP row(s)
 * carrying that circuit-id, returning the DETERMINISTIC lowest-id member (so a shared-ONU group
 * resolves stably to one representative AP). On a cache miss (or no AP row for the circuit-id), it
 * falls through to today's router lookup (`resolveApForMac` → `resolveNetworkIdByApName`)
 * byte-for-byte — the external contract is unchanged (Regression #4).
 */
export async function resolveNetworkIdForMac(
	db: DB,
	network: NetworkController,
	macAddress: string
): Promise<number | null> {
	const mac = macAddress.toUpperCase();
	// Fast path: durable attribution cache → AP row(s) sharing the circuit-id → lowest id.
	try {
		const [cached] = await db
			.select({ circuitId: networkClientAttribution.circuitId })
			.from(networkClientAttribution)
			.where(eq(networkClientAttribution.mac, mac))
			.limit(1);
		if (cached) {
			const [ap] = await db
				.select({ id: networkHealth.id })
				.from(networkHealth)
				.where(eq(networkHealth.apCircuitId, cached.circuitId))
				.orderBy(networkHealth.id)
				.limit(1);
			if (ap) return ap.id;
		}
	} catch {
		// Cache lookup failed — fall through to the router path (best-effort).
	}
	// Fallback: today's router MAC→AP lookup, unchanged.
	if (!network.resolveApForMac) return null;
	try {
		const apName = await network.resolveApForMac(macAddress);
		if (!apName) return null;
		return await resolveNetworkIdByApName(db, apName);
	} catch {
		return null;
	}
}

/**
 * Read-time label for a durable AP circuit-id string (purchase/grant attribution display).
 * - `null` circuit-id → `'Unattributed'` (AP was unresolvable at purchase/grant time).
 * - circuit-id that still matches a live `network_health` AP row → that AP's current friendly
 *   name (so the label tracks a later rename — the join key is the immutable circuit-id).
 * - circuit-id with no matching AP row (pruned/decommissioned) → the raw circuit-id string as-is
 *   (never blank, never an opaque numeric id).
 *
 * Pure read, no side effects. Best-effort by contract: attribution is advisory staff-review data,
 * never a gate. `?mac=`/AP signals remain client-influenceable — this label is NOT tamper-proof.
 */
export async function resolveApCircuitLabel(
	db: DB,
	circuitId: string | null
): Promise<string> {
	if (!circuitId) return 'Unattributed';
	const [ap] = await db
		.select({ name: networkHealth.name })
		.from(networkHealth)
		.where(eq(networkHealth.apCircuitId, circuitId))
		.orderBy(networkHealth.id)
		.limit(1);
	return ap?.name ?? circuitId;
}

/**
 * Resolve the durable AP circuit-id STRING a device MAC is currently on. The string twin of
 * `resolveNetworkIdForMac` — returns the immutable circuit-id fact (for durable attribution
 * storage) instead of a `network_health.id` reference. Never throws — returns null when nothing
 * maps (every failure path is internally caught), so callers can resolve it BEFORE opening a
 * money-moving/access-granting transaction without any risk of blocking or rolling it back (AC6).
 *
 * Fast path: the client-attribution cache (MAC → circuit-id) already holds the raw string — return
 * it directly, no router call. Fallback: today's router MAC→AP lookup, then read that AP row's
 * `apCircuitId`. Avoids a second live MikroTik round-trip on the common (cache-hit) path.
 */
export async function resolveCircuitIdForMac(
	db: DB,
	network: NetworkController,
	macAddress: string
): Promise<string | null> {
	const mac = macAddress.toUpperCase();
	// Fast path: durable attribution cache holds the circuit-id string directly.
	try {
		const [cached] = await db
			.select({ circuitId: networkClientAttribution.circuitId })
			.from(networkClientAttribution)
			.where(eq(networkClientAttribution.mac, mac))
			.limit(1);
		if (cached?.circuitId) return cached.circuitId;
	} catch {
		// Cache lookup failed — fall through to the router path (best-effort).
	}
	// Fallback: router MAC→AP lookup → that AP row's stored circuit-id string.
	if (!network.resolveApForMac) return null;
	try {
		const apName = await network.resolveApForMac(macAddress);
		if (!apName) return null;
		const [byIface] = await db
			.select({ apCircuitId: networkHealth.apCircuitId })
			.from(networkHealth)
			.where(eq(networkHealth.interfaceName, apName))
			.limit(1);
		if (byIface?.apCircuitId != null) return byIface.apCircuitId;
		const [byName] = await db
			.select({ apCircuitId: networkHealth.apCircuitId })
			.from(networkHealth)
			.where(eq(networkHealth.name, apName))
			.limit(1);
		return byName?.apCircuitId ?? null;
	} catch {
		return null;
	}
}
