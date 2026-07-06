import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Orchestration tests for the outage auto-pause sweep. `pauseAccountAccess`/`resumeAccountAccess`
 * and the MAC→AP resolver are mocked so their own I/O doesn't run — we assert ONLY the sweep's
 * decisions: which accounts it pauses (and with what reason/AP tag) and which it resumes. The
 * debounce, paid-only, and not-already-paused filters live in the SQL WHERE clauses, so they're
 * enforced by the DB, not this JS — a real-DB integration test would be needed to exercise those.
 */
const { pauseAccountAccess, resumeAccountAccess } = vi.hoisted(() => ({
	pauseAccountAccess: vi.fn(async () => ({ ok: true })),
	resumeAccountAccess: vi.fn(async () => ({ ok: true }))
}));
vi.mock('./sessions', () => ({ pauseAccountAccess, resumeAccountAccess }));

// MAC→AP resolver (the roamer re-check). Default: 'roam' is currently on AP 2, everything else null.
const { resolveNetworkIdForMac } = vi.hoisted(() => ({
	resolveNetworkIdForMac: vi.fn(async (_db: unknown, _net: unknown, mac: string) =>
		mac === 'roam' ? 2 : null
	)
}));
vi.mock('./networkHealth', () => ({ resolveNetworkIdForMac }));

import { sweepOutagePauses } from './outage';

// Chainable Drizzle stand-in: every builder method returns the proxy; awaiting a query shifts the
// next queued result (one per awaited statement, in call order). Same pattern as grant-atomic.spec.
function fakeDb(results: unknown[]) {
	const queue = [...results];
	const proxy: unknown = new Proxy(function () {}, {
		get(_t, prop) {
			if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(queue.shift() ?? []);
			return () => proxy;
		}
	});
	return proxy as never;
}

// Stub controller (no resolveApForMac) → the roamer re-check is a no-op; the sweep never queries the
// online-AP set or the resolver, and falls back to the stored bind-time network_id.
const network = {} as never;
const NOW = new Date('2026-07-03T12:00:00Z');

describe('sweepOutagePauses', () => {
	beforeEach(() => {
		pauseAccountAccess.mockClear();
		resumeAccountAccess.mockClear();
		resolveNetworkIdForMac.mockClear();
	});

	it('pauses paid guests on a down AP (tagged outage + AP id) and resumes those whose AP recovered', async () => {
		// Awaited statements in order: down APs → victims(AP1) → not-recovered set → outage-paused list.
		const db = fakeDb([
			[{ id: 1 }], // down APs past the debounce: AP 1
			[{ userId: 'u1', macAddress: null }], // paid, active victims on AP 1
			[{ id: 1 }], // not-recovered set: AP 1 is still offline
			[
				{ userId: 'u2', apId: 2, pausedAt: NOW }, // paused for AP 2, which recovered → resume
				{ userId: 'u3', apId: 1, pausedAt: NOW } // paused for AP 1, still down → keep
			]
		]);

		const res = await sweepOutagePauses(db, network, NOW);

		// Paused the victim, tagged outage + the down AP's id.
		expect(pauseAccountAccess).toHaveBeenCalledTimes(1);
		expect(pauseAccountAccess).toHaveBeenCalledWith(db, network, 'u1', NOW, {
			reason: 'outage',
			networkId: 1
		});

		// Resumed only the account whose AP is no longer down.
		expect(resumeAccountAccess).toHaveBeenCalledTimes(1);
		expect(resumeAccountAccess).toHaveBeenCalledWith(db, 'u2', NOW);

		expect(res).toEqual({ pausedAps: 1, paused: 1, resumed: 1 });
	});

	it('no down APs → pauses nothing, but still resumes an outage-paused account whose AP is gone', async () => {
		const db = fakeDb([
			[], // no down APs → the victims query never runs
			[], // not-recovered set: empty
			[{ userId: 'u9', apId: 42, pausedAt: NOW }] // paused for an AP no longer offline (recovered/pruned)
		]);

		const res = await sweepOutagePauses(db, network, NOW);

		expect(pauseAccountAccess).not.toHaveBeenCalled();
		expect(resumeAccountAccess).toHaveBeenCalledWith(db, 'u9', NOW);
		expect(res).toEqual({ pausedAps: 0, paused: 0, resumed: 1 });
	});

	it('keeps every outage-pause while all their APs are still not recovered (no premature resume)', async () => {
		const db = fakeDb([
			[], // no APs newly cross the debounce this tick
			[{ id: 1 }, { id: 2 }], // not-recovered: APs 1 and 2 (still down, or up too recently)
			[
				{ userId: 'a', apId: 1, pausedAt: NOW },
				{ userId: 'b', apId: 2, pausedAt: NOW }
			]
		]);

		const res = await sweepOutagePauses(db, network, NOW);

		expect(resumeAccountAccess).not.toHaveBeenCalled();
		expect(res).toEqual({ pausedAps: 0, paused: 0, resumed: 0 });
	});

	it('skips a guest who roamed onto a healthy AP (does not pause/unbind working service)', async () => {
		// Live controller → the sweep queries the online-AP set and re-checks each device's MAC.
		const liveNetwork = { resolveApForMac: () => 'whatever' } as never;
		const db = fakeDb([
			[{ id: 1 }], // down AP 1
			[{ id: 2 }], // online-AP set: AP 2 is up
			[
				{ userId: 'u1', macAddress: 'roam' }, // device now on AP 2 (online) → skip
				{ userId: 'u2', macAddress: 'stuck' } // device resolves nowhere → pause
			],
			[{ id: 1 }], // not-recovered set
			[] // no outage-paused accounts
		]);

		const res = await sweepOutagePauses(db, liveNetwork, NOW);

		expect(resolveNetworkIdForMac).toHaveBeenCalled();
		expect(pauseAccountAccess).toHaveBeenCalledTimes(1);
		expect(pauseAccountAccess).toHaveBeenCalledWith(db, liveNetwork, 'u2', NOW, {
			reason: 'outage',
			networkId: 1
		});
		expect(res).toEqual({ pausedAps: 1, paused: 1, resumed: 0 });
	});

	it('releases a pause held past the dead-AP cap even though its AP is still not recovered', async () => {
		const stale = new Date(NOW.getTime() - 7 * 60 * 60 * 1000); // 7h ago > 6h default cap
		const db = fakeDb([
			[], // no down APs
			[{ id: 1 }], // not-recovered: AP 1 is still down
			[{ userId: 'old', apId: 1, pausedAt: stale }] // stranded on a (seemingly) dead AP
		]);

		const res = await sweepOutagePauses(db, network, NOW);

		expect(resumeAccountAccess).toHaveBeenCalledWith(db, 'old', NOW);
		expect(res).toEqual({ pausedAps: 0, paused: 0, resumed: 1 });
	});
});
