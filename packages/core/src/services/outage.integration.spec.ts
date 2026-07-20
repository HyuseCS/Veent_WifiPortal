import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
	type DB,
	customerUser,
	customerProfile,
	networkSessions,
	networkHealth,
	packages
} from '@veent/db';
import { SESSION_STATUS } from '../config';
import { GUEST_BYPASS_TAG, type NetworkController } from '../integrations/network';
import { sweepOutagePauses } from './outage';
import { refreshNetworkHealth } from './networkHealth';

/**
 * REAL-Postgres integration tests for the outage sweep, run against an in-process PGlite instance so
 * the actual SQL WHERE clauses execute — the debounce (offline_since/online_since), the serving =
 * link AND wan_ok gate, the paid-only / not-already-paused filters, the roamer join, and FOR UPDATE.
 * The mocked-DB unit tests in outage.spec.ts can't reach any of that. Applies the project's real
 * migrations, so schema drift is caught too.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, '../../../db/drizzle');

// A no-op controller: pause() unbinds devices via network.revoke(); the roamer test also needs
// resolveApForMac. sampleHealth is added per-test for the refresh-driven case.
const revoke = vi.fn(async () => {});
const controller = (extra: Partial<NetworkController> = {}) =>
	({ revoke, ...extra }) as unknown as NetworkController;

let client: PGlite;
let db: DB;
let pkgId: number;

beforeAll(async () => {
	client = new PGlite();
	const raw = drizzle(client);
	await migrate(raw, { migrationsFolder: MIGRATIONS });
	db = raw as unknown as DB;
}, 60_000);

beforeEach(async () => {
	revoke.mockClear();
	// CASCADE clears customer_profile + network_sessions (both FK customer_user); RESTART IDENTITY
	// makes network_health ids deterministic per test. packages is re-seeded fresh below.
	await client.exec(
		'TRUNCATE "customer_user", "network_health", "packages" RESTART IDENTITY CASCADE;'
	);
	const [pkg] = await db
		.insert(packages)
		.values({ name: 'Tier', type: 'tier', creditCost: 10, pointsCost: 100, durationMinutes: 60 })
		.returning({ id: packages.id });
	pkgId = pkg.id;
});

/** Seed a customer_user + profile. Paid-active by default (package + future window). */
async function seedAccount(
	userId: string,
	opts: {
		packageId?: number | null;
		expiresAt?: Date | null;
		pausedAt?: Date | null;
		pausedReason?: 'user' | 'outage' | null;
		pausedNetworkId?: number | null;
	} = {}
) {
	await db.insert(customerUser).values({ id: userId, name: userId, email: `${userId}@t.local` });
	await db.insert(customerProfile).values({
		userId,
		accessPackageId: opts.packageId === undefined ? pkgId : opts.packageId,
		accessExpiresAt: opts.expiresAt === undefined ? new Date(Date.now() + 3_600_000) : opts.expiresAt,
		accessPausedAt: opts.pausedAt ?? null,
		accessPausedReason: opts.pausedReason ?? null,
		accessPausedNetworkId: opts.pausedNetworkId ?? null
	});
}

async function seedSession(userId: string, networkId: number | null, mac: string | null) {
	await db
		.insert(networkSessions)
		.values({ userId, macAddress: mac, networkId, status: SESSION_STATUS.active });
}

async function seedHealth(
	name: string,
	v: { online: boolean; wanOk?: boolean; offlineSince?: Date | null; onlineSince?: Date | null }
): Promise<number> {
	const [row] = await db
		.insert(networkHealth)
		.values({
			name,
			online: v.online,
			wanOk: v.wanOk ?? true,
			offlineSince: v.offlineSince ?? null,
			onlineSince: v.onlineSince ?? null
		})
		.returning({ id: networkHealth.id });
	return row.id;
}

async function profile(userId: string) {
	const [p] = await db.select().from(customerProfile).where(eq(customerProfile.userId, userId));
	return p;
}

describe('outage sweep (real Postgres)', () => {
	it('refreshNetworkHealth stamps a WAN outage (link up, uplink dead) and the sweep pauses the guest', async () => {
		// Link is up but the uplink probe failed → the AP is NOT serving; refresh must stamp offline_since.
		const net = controller({
			async sampleHealth() {
				return [{ name: 'ap1', online: true, wanReachable: false, users: 0, throughputMbps: 0 }];
			}
		});
		await refreshNetworkHealth(db, net);
		const [ap] = await db
			.select({ id: networkHealth.id, wanOk: networkHealth.wanOk, off: networkHealth.offlineSince })
			.from(networkHealth)
			.where(eq(networkHealth.name, 'ap1'));
		expect(ap.wanOk).toBe(false);
		expect(ap.off).not.toBeNull(); // not serving → down-since stamped despite online=true

		await seedAccount('u1');
		await seedSession('u1', ap.id, 'aa:bb');

		const res = await sweepOutagePauses(db, net, new Date(), { downMs: 0 });
		expect(res.paused).toBe(1);

		const p = await profile('u1');
		expect(p.accessPausedAt).not.toBeNull();
		expect(p.accessPausedReason).toBe('outage');
		expect(p.accessPausedNetworkId).toBe(ap.id);
		// device was unbound (router revoke + session marked revoked)
		expect(revoke).toHaveBeenCalledWith('aa:bb', { tag: GUEST_BYPASS_TAG });
		const [s] = await db.select().from(networkSessions).where(eq(networkSessions.userId, 'u1'));
		expect(s.status).toBe(SESSION_STATUS.revoked);
	});

	it('does NOT pause a free (no-package) account or an already-paused one on the down AP', async () => {
		const now = new Date('2026-07-03T12:00:00Z');
		const apId = await seedHealth('ap1', {
			online: false,
			offlineSince: new Date(now.getTime() - 10 * 60_000)
		});
		await seedAccount('free', { packageId: null }); // paid-only filter excludes
		await seedSession('free', apId, 'f1');
		await seedAccount('already', { pausedAt: new Date(now.getTime() - 60_000), pausedReason: 'user' });
		await seedSession('already', apId, 'a1');

		const res = await sweepOutagePauses(db, controller(), now, { downMs: 3 * 60_000 });
		expect(res.paused).toBe(0);
		expect((await profile('already')).accessPausedReason).toBe('user'); // untouched
	});

	it('keeps a held guest paused until their AP is confirmed up for upMs, then resumes', async () => {
		const now = new Date('2026-07-03T12:00:00Z');
		// AP back online but only just now → within the up-debounce.
		const apId = await seedHealth('ap1', { online: true, onlineSince: new Date(now.getTime() - 30_000) });
		await seedAccount('h', {
			expiresAt: new Date(now.getTime() + 20 * 60_000),
			pausedAt: new Date(now.getTime() - 5 * 60_000),
			pausedReason: 'outage',
			pausedNetworkId: apId
		});

		let res = await sweepOutagePauses(db, controller(), now, { upMs: 2 * 60_000 });
		expect(res.resumed).toBe(0);
		expect((await profile('h')).accessPausedAt).not.toBeNull();

		// Now it has been up well past upMs → resume, restoring the held window.
		await db
			.update(networkHealth)
			.set({ onlineSince: new Date(now.getTime() - 10 * 60_000) })
			.where(eq(networkHealth.id, apId));
		res = await sweepOutagePauses(db, controller(), now, { upMs: 2 * 60_000 });
		expect(res.resumed).toBe(1);
		expect((await profile('h')).accessPausedAt).toBeNull();
	});

	it('releases a pause held past the dead-AP cap even though the AP is still down', async () => {
		const now = new Date('2026-07-03T12:00:00Z');
		const apId = await seedHealth('ap1', {
			online: false,
			offlineSince: new Date(now.getTime() - 8 * 60 * 60_000)
		});
		await seedAccount('stuck', {
			expiresAt: new Date(now.getTime() + 20 * 60_000),
			pausedAt: new Date(now.getTime() - 7 * 60 * 60_000), // 7h > 6h default cap
			pausedReason: 'outage',
			pausedNetworkId: apId
		});
		const res = await sweepOutagePauses(db, controller(), now, { maxPauseMs: 6 * 60 * 60_000 });
		expect(res.resumed).toBe(1);
		expect((await profile('stuck')).accessPausedAt).toBeNull();
	});

	it('G13: outage sweep still pauses a guest on a down AP ROW (Phase A AP rows present)', async () => {
		// Regression #7 / Risk R3: an auto-discovered AP row (mac + circuit-id + attributionSource set)
		// participates in the sweep exactly like an interface row — a ping-dead AP pauses its guests.
		const now = new Date('2026-07-03T12:00:00Z');
		const [ap] = await db
			.insert(networkHealth)
			.values({
				name: 'OAP3000G-1',
				mac: 'E4:67:1E:00:00:01',
				apCircuitId: 'OLT-9:0/1/0/4',
				attributionSource: 'circuit-id',
				online: false,
				wanOk: true,
				offlineSince: new Date(now.getTime() - 10 * 60_000)
			})
			.returning({ id: networkHealth.id });
		await seedAccount('u-ap');
		await seedSession('u-ap', ap.id, 'ap-guest');
		const res = await sweepOutagePauses(db, controller(), now, { downMs: 3 * 60_000 });
		expect(res.paused).toBe(1);
		expect((await profile('u-ap')).accessPausedNetworkId).toBe(ap.id);
	});

	it('skips a guest whose device has roamed onto a fully-serving AP', async () => {
		const now = new Date('2026-07-03T12:00:00Z');
		const down = await seedHealth('ap1', {
			online: false,
			offlineSince: new Date(now.getTime() - 10 * 60_000)
		});
		await seedHealth('ap2', { online: true, wanOk: true, onlineSince: new Date(now.getTime() - 60_000) });

		await seedAccount('roamer');
		await seedSession('roamer', down, 'roam'); // bound to down AP, but now on ap2
		await seedAccount('stuck');
		await seedSession('stuck', down, 'stay'); // still on the down AP

		// Live controller: 'roam' currently resolves to ap2's interface name, 'stay' resolves nowhere.
		const net = controller({
			resolveApForMac: async (mac: string) => (mac === 'roam' ? 'ap2' : null)
		});
		const res = await sweepOutagePauses(db, net, now, { downMs: 3 * 60_000 });

		expect(res.paused).toBe(1); // only the stuck guest
		expect((await profile('roamer')).accessPausedAt).toBeNull();
		expect((await profile('stuck')).accessPausedAt).not.toBeNull();
	});
});
