import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { type DB, networkHealth, networkClientAttribution } from '@veent/db';
import type {
	NetworkController,
	NetworkApSample,
	DhcpLeaseEntry,
	HotspotActiveEntry
} from '../integrations/network';
import {
	refreshNetworkHealth,
	resolveNetworkIdForMac,
	resolveNetworkIdByApName,
	computeApGroups,
	computeTrafficRateMbps,
	recognizeAccessPoints
} from './networkHealth';

/**
 * REAL-Postgres integration tests for the Phase A per-AP visibility refresh, run against an
 * in-process PGlite instance so the actual SQL (mac-keyed upsert, prune predicate, attribution-cache
 * ON CONFLICT, the name-collision pre-check, the resolveNetworkIdForMac cache fast path) executes.
 * Applies the project's real migrations (incl. 0047), so schema/migration drift is caught too.
 * Scenario names match the plan's Verification Evidence gates (G1–G10, G12, G15) verbatim.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, '../../../db/drizzle');

/** Configurable fake controller. `sampleHealth` defaults to [] so the AP portion always runs. */
function fake(cfg: {
	samples?: NetworkApSample[];
	leases?: DhcpLeaseEntry[];
	active?: HotspotActiveEntry[];
	ping?: Record<string, number | null>;
	resolveApForMac?: (mac: string) => Promise<string | null>;
	omitSampleHealth?: boolean;
	omitLeases?: boolean;
	omitPing?: boolean;
	omitActive?: boolean;
}): NetworkController {
	const c: Partial<NetworkController> = {
		name: 'fake',
		revoke: async () => {},
		grant: async () => {}
	};
	if (!cfg.omitSampleHealth) c.sampleHealth = async () => cfg.samples ?? [];
	if (!cfg.omitLeases) c.listDhcpLeases = async () => cfg.leases ?? [];
	if (!cfg.omitActive) c.listHotspotActive = async () => cfg.active ?? [];
	if (!cfg.omitPing)
		c.pingHosts = async (addresses) =>
			addresses.map((address) => ({ address, aliveMs: cfg.ping?.[address] ?? null }));
	if (cfg.resolveApForMac) c.resolveApForMac = cfg.resolveApForMac;
	return c as NetworkController;
}

const apLease = (o: Partial<DhcpLeaseEntry> & { mac: string }): DhcpLeaseEntry => ({
	address: '10.0.0.1',
	hostname: 'OAP3000G-1',
	agentCircuitId: 'C1',
	status: 'bound',
	...o
});

let client: PGlite;
let db: DB;

beforeAll(async () => {
	client = new PGlite();
	const raw = drizzle(client);
	await migrate(raw, { migrationsFolder: MIGRATIONS });
	db = raw as unknown as DB;
}, 60_000);

beforeEach(async () => {
	await client.exec(
		'TRUNCATE "network_health", "network_client_attribution" RESTART IDENTITY CASCADE;'
	);
});

async function apRows() {
	return db.select().from(networkHealth).orderBy(asc(networkHealth.id));
}

describe('per-AP visibility refresh (real Postgres)', () => {
	it('G1: seeding a synthetic AP-signature DHCP lease creates a new network_health row', async () => {
		const net = fake({
			leases: [
				apLease({ mac: 'e4:67:1e:aa:bb:cc', address: '10.0.0.5', agentCircuitId: 'OLT-9:0/1/0/4' })
			]
		});
		await refreshNetworkHealth(db, net);
		const rows = await apRows();
		expect(rows).toHaveLength(1);
		expect(rows[0].mac).toBe('E4:67:1E:AA:BB:CC'); // uppercased, keyed on MAC
		expect(rows[0].apCircuitId).toBe('OLT-9:0/1/0/4');
		expect(rows[0].attributionSource).toBe('circuit-id');
		expect(rows[0].name).toBe('OAP3000G-1');
	});

	it('G1b: recognizes an AP by hostname signature even with a foreign OUI', async () => {
		const aps = recognizeAccessPoints([
			{ mac: 'AA:BB:CC:00:11:22', address: '10.0.0.9', hostname: 'OAP3000G-X', agentCircuitId: 'C9', status: 'bound' },
			{ mac: 'DE:AD:BE:EF:00:00', address: '10.0.0.8', hostname: 'some-phone', agentCircuitId: null, status: 'bound' }
		]);
		expect(aps).toHaveLength(1);
		expect(aps[0].mac).toBe('AA:BB:CC:00:11:22');
	});

	it('G2: two AP fixtures, one ping-alive one not, differ in online', async () => {
		const net = fake({
			leases: [
				apLease({ mac: 'E4:67:1E:00:00:01', address: '10.0.0.11', hostname: 'OAP3000G-A', agentCircuitId: 'CA' }),
				apLease({ mac: 'E4:67:1E:00:00:02', address: '10.0.0.12', hostname: 'OAP3000G-B', agentCircuitId: 'CB' })
			],
			ping: { '10.0.0.11': 3, '10.0.0.12': null }
		});
		await refreshNetworkHealth(db, net);
		const rows = await apRows();
		const a = rows.find((r) => r.mac === 'E4:67:1E:00:00:01')!;
		const b = rows.find((r) => r.mac === 'E4:67:1E:00:00:02')!;
		expect(a.online).toBe(true);
		expect(a.latencyMs).toBe(3);
		expect(b.online).toBe(false);
		expect(b.offlineSince).not.toBeNull();
	});

	it('G3: devices attributed to AP-1 do not count toward AP-2', async () => {
		const net = fake({
			leases: [
				apLease({ mac: 'E4:67:1E:00:00:01', address: '10.0.0.11', hostname: 'OAP3000G-A', agentCircuitId: 'CA' }),
				apLease({ mac: 'E4:67:1E:00:00:02', address: '10.0.0.12', hostname: 'OAP3000G-B', agentCircuitId: 'CB' }),
				// two guests on CA, one on CB
				{ mac: 'AA:00:00:00:00:01', address: '10.0.1.1', hostname: null, agentCircuitId: 'CA', status: 'bound' },
				{ mac: 'AA:00:00:00:00:02', address: '10.0.1.2', hostname: null, agentCircuitId: 'CA', status: 'bound' },
				{ mac: 'BB:00:00:00:00:01', address: '10.0.2.1', hostname: null, agentCircuitId: 'CB', status: 'bound' }
			],
			active: [
				{ mac: 'AA:00:00:00:00:01', address: '10.0.1.1', bytesIn: null, bytesOut: null },
				{ mac: 'AA:00:00:00:00:02', address: '10.0.1.2', bytesIn: null, bytesOut: null },
				{ mac: 'BB:00:00:00:00:01', address: '10.0.2.1', bytesIn: null, bytesOut: null }
			],
			ping: { '10.0.0.11': 2, '10.0.0.12': 2 }
		});
		await refreshNetworkHealth(db, net);
		const rows = await apRows();
		const a = rows.find((r) => r.apCircuitId === 'CA')!;
		const b = rows.find((r) => r.apCircuitId === 'CB')!;
		expect(a.users).toBe(2);
		expect(b.users).toBe(1);
		// resolveNetworkIdForMac attributes each guest to its own AP.
		expect(await resolveNetworkIdForMac(db, net, 'AA:00:00:00:00:01')).toBe(a.id);
		expect(await resolveNetworkIdForMac(db, net, 'BB:00:00:00:00:01')).toBe(b.id);
	});

	it('G4: identical circuit-id fixtures form one AP group', async () => {
		const net = fake({
			leases: [
				apLease({ mac: 'E4:67:1E:00:00:0A', address: '10.0.0.21', hostname: 'OAP3000G-P', agentCircuitId: 'SHARED' }),
				apLease({ mac: 'E4:67:1E:00:00:0B', address: '10.0.0.22', hostname: 'OAP3000G-Q', agentCircuitId: 'SHARED' })
			],
			ping: { '10.0.0.21': 2, '10.0.0.22': 2 }
		});
		await refreshNetworkHealth(db, net);
		const rows = await apRows();
		expect(rows.every((r) => r.apCircuitId === 'SHARED')).toBe(true);
		const groups = computeApGroups(rows.map((r) => ({ name: r.name, apCircuitId: r.apCircuitId })));
		expect(groups.size).toBe(1);
		expect(groups.get('SHARED')).toHaveLength(2);
	});

	it('G5: blank circuit-id renewal keeps prior attribution', async () => {
		const guestMac = 'AA:00:00:00:00:09';
		// First refresh: guest lease carries C1 → cache set.
		await refreshNetworkHealth(
			db,
			fake({
				leases: [
					apLease({ mac: 'E4:67:1E:00:00:31', address: '10.0.0.31', agentCircuitId: 'C1' }),
					{ mac: guestMac, address: '10.0.9.9', hostname: null, agentCircuitId: 'C1', status: 'bound' }
				],
				active: [{ mac: guestMac, address: '10.0.9.9', bytesIn: null, bytesOut: null }],
				ping: { '10.0.0.31': 2 }
			})
		);
		// Second refresh: guest lease now carries a BLANK circuit-id (unicast renewal) → cache untouched.
		await refreshNetworkHealth(
			db,
			fake({
				leases: [
					apLease({ mac: 'E4:67:1E:00:00:31', address: '10.0.0.31', agentCircuitId: 'C1' }),
					{ mac: guestMac, address: '10.0.9.9', hostname: null, agentCircuitId: null, status: 'bound' }
				],
				active: [{ mac: guestMac, address: '10.0.9.9', bytesIn: null, bytesOut: null }],
				ping: { '10.0.0.31': 2 }
			})
		);
		const [cache] = await db
			.select()
			.from(networkClientAttribution)
			.where(eq(networkClientAttribution.mac, guestMac));
		expect(cache.circuitId).toBe('C1');
		const rows = await apRows();
		expect(rows.find((r) => r.apCircuitId === 'C1')!.users).toBe(1); // still attributed via cache
	});

	it('G6: never-attributed device counts network-wide only', async () => {
		const net = fake({
			leases: [
				apLease({ mac: 'E4:67:1E:00:00:41', address: '10.0.0.41', agentCircuitId: 'C1' }),
				{ mac: 'AA:00:00:00:00:41', address: '10.0.4.1', hostname: null, agentCircuitId: null, status: 'bound' }
			],
			active: [{ mac: 'AA:00:00:00:00:41', address: '10.0.4.1', bytesIn: null, bytesOut: null }],
			ping: { '10.0.0.41': 2 }
		});
		await refreshNetworkHealth(db, net);
		const rows = await apRows();
		expect(rows.find((r) => r.apCircuitId === 'C1')!.users).toBe(0);
		// The unattributed device has no AP row and no cache entry.
		expect(await resolveNetworkIdForMac(db, fake({}), 'AA:00:00:00:00:41')).toBeNull();
	});

	it('G7: AP lease IP change updates the same MAC-keyed row', async () => {
		const mac = 'E4:67:1E:00:00:51';
		await refreshNetworkHealth(db, fake({ leases: [apLease({ mac, address: '10.0.0.51', agentCircuitId: 'C1' })], ping: { '10.0.0.51': 2 } }));
		await refreshNetworkHealth(db, fake({ leases: [apLease({ mac, address: '10.0.0.77', agentCircuitId: 'C1' })], ping: { '10.0.0.77': 5 } }));
		const rows = await apRows();
		expect(rows).toHaveLength(1);
		expect(rows[0].latencyMs).toBe(5); // updated in place
	});

	it('G8: absent AP keeps lastSampleAt; pinned/skipped-scan rows survive prune', async () => {
		const mac = 'E4:67:1E:00:00:61';
		await refreshNetworkHealth(db, fake({ leases: [apLease({ mac, address: '10.0.0.61', agentCircuitId: 'C1' })], ping: { '10.0.0.61': 2 } }));
		const before = (await apRows())[0];
		// Case 1: AP scan SKIPPED (controller has no listDhcpLeases) but interface sample present → the
		// mac-restricted prune must NOT wipe the AP row.
		await refreshNetworkHealth(
			db,
			fake({ omitLeases: true, samples: [{ name: 'vlan70 hotspot', online: true, users: 0, throughputMbps: 3 }] })
		);
		let rows = await apRows();
		const kept = rows.find((r) => r.mac === mac)!;
		expect(kept).toBeTruthy();
		expect(kept.lastSampleAt.getTime()).toBe(before.lastSampleAt.getTime()); // untouched
		// Case 2: pinned AP (latitude set) survives even when the AP scan runs and no longer reports it.
		await db.update(networkHealth).set({ latitude: '14.5', longitude: '121.0' }).where(eq(networkHealth.mac, mac));
		await refreshNetworkHealth(db, fake({ leases: [] })); // scan ran, AP gone
		rows = await apRows();
		expect(rows.find((r) => r.mac === mac)).toBeTruthy();
	});

	it('G9: cache-backed resolveNetworkIdForMac returns AP id (lowest-id for groups)', async () => {
		const guestMac = 'AA:00:00:00:00:99';
		const net = fake({
			leases: [
				apLease({ mac: 'E4:67:1E:00:00:71', address: '10.0.0.71', hostname: 'OAP3000G-P', agentCircuitId: 'GRP' }),
				apLease({ mac: 'E4:67:1E:00:00:72', address: '10.0.0.72', hostname: 'OAP3000G-Q', agentCircuitId: 'GRP' }),
				{ mac: guestMac, address: '10.0.9.1', hostname: null, agentCircuitId: 'GRP', status: 'bound' }
			],
			active: [{ mac: guestMac, address: '10.0.9.1', bytesIn: null, bytesOut: null }],
			ping: { '10.0.0.71': 2, '10.0.0.72': 2 }
		});
		await refreshNetworkHealth(db, net);
		const rows = await apRows();
		const lowest = Math.min(...rows.map((r) => r.id));
		expect(await resolveNetworkIdForMac(db, net, guestMac)).toBe(lowest);
	});

	it('G10: cache-miss falls back to router path; stub refresh leaves seeds untouched', async () => {
		// Seed an interface row (as a real seeded/interface row: mac NULL).
		await db.insert(networkHealth).values({ name: 'vlan70 hotspot' });
		const [iface] = await db.select().from(networkHealth).where(eq(networkHealth.name, 'vlan70 hotspot'));
		// Unknown MAC → no cache → router resolveApForMac returns the interface name.
		const net = fake({ resolveApForMac: async () => 'vlan70 hotspot' });
		expect(await resolveNetworkIdForMac(db, net, 'FF:FF:FF:00:00:01')).toBe(iface.id);
		// Stub refresh (no sampleHealth, like the real stub) is a no-op — seeded row untouched.
		await refreshNetworkHealth(db, fake({ omitSampleHealth: true }));
		const rows = await apRows();
		expect(rows).toHaveLength(1);
		expect(rows[0].name).toBe('vlan70 hotspot');
	});

	it('G12: interface-name resolution for customer attribution unchanged', async () => {
		await db.insert(networkHealth).values({ name: 'vlan70 hotspot' });
		const [iface] = await db.select().from(networkHealth).where(eq(networkHealth.name, 'vlan70 hotspot'));
		expect(await resolveNetworkIdByApName(db, 'vlan70 hotspot')).toBe(iface.id);
		// interfaceName binding wins over name.
		await db.update(networkHealth).set({ interfaceName: 'ether5' }).where(eq(networkHealth.id, iface.id));
		expect(await resolveNetworkIdByApName(db, 'ether5')).toBe(iface.id);
	});

	it('G15: traffic delta math + degradation to null', async () => {
		// Pure delta math.
		expect(computeTrafficRateMbps(null, 1000, 60)).toBeNull(); // first sample
		expect(computeTrafficRateMbps(1000, 1000, 60)).toBe(0); // no change
		expect(computeTrafficRateMbps(1000, 500, 60)).toBe(0); // negative delta clamps to 0
		expect(computeTrafficRateMbps(0, 7_500_000, 60)).toBe(1); // 7.5MB×8 / 60s / 1e6 = 1 Mbps
		expect(computeTrafficRateMbps(1000, 2000, 0)).toBeNull(); // no elapsed time

		// Degradation path: null counters → throughput stays null (card shows "—").
		const mac = 'E4:67:1E:00:00:81';
		const guest = 'AA:00:00:00:00:81';
		await refreshNetworkHealth(
			db,
			fake({
				leases: [apLease({ mac, address: '10.0.0.81', agentCircuitId: 'C1' }), { mac: guest, address: '10.0.8.1', hostname: null, agentCircuitId: 'C1', status: 'bound' }],
				active: [{ mac: guest, address: '10.0.8.1', bytesIn: null, bytesOut: null }],
				ping: { '10.0.0.81': 2 }
			})
		);
		let row = (await apRows()).find((r) => r.mac === mac)!;
		expect(row.throughputMbps).toBeNull();
		expect(row.trafficBytes).toBeNull();

		// Counters present across two refreshes → throughput computed from the delta.
		const withBytes = (bytes: number) =>
			fake({
				leases: [apLease({ mac, address: '10.0.0.81', agentCircuitId: 'C1' }), { mac: guest, address: '10.0.8.1', hostname: null, agentCircuitId: 'C1', status: 'bound' }],
				active: [{ mac: guest, address: '10.0.8.1', bytesIn: bytes, bytesOut: 0 }],
				ping: { '10.0.0.81': 2 }
			});
		await refreshNetworkHealth(db, withBytes(0)); // first sample: basis stored, throughput null
		row = (await apRows()).find((r) => r.mac === mac)!;
		expect(row.trafficBytes).toBe(0);
		// Backdate lastSampleAt by 60s so the next refresh has a measurable elapsed window.
		await db.update(networkHealth).set({ lastSampleAt: new Date(Date.now() - 60_000) }).where(eq(networkHealth.mac, mac));
		await refreshNetworkHealth(db, withBytes(7_500_000));
		row = (await apRows()).find((r) => r.mac === mac)!;
		expect(row.trafficBytes).toBe(7_500_000);
		expect(row.throughputMbps).toBe(1);
	});
});
