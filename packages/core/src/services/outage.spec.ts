import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Orchestration tests for the outage auto-pause sweep. `pauseAccountAccess`/`resumeAccountAccess`
 * are mocked so their own DB I/O doesn't run — we assert ONLY the sweep's decisions: which accounts
 * it pauses (and with what reason/AP tag) and which it resumes. The debounce, paid-only, and
 * not-already-paused filters live in the SQL WHERE clauses, so they're enforced by the DB, not this
 * JS — a real-DB integration test would be needed to exercise those (noted as a follow-up).
 */
const { pauseAccountAccess, resumeAccountAccess } = vi.hoisted(() => ({
	pauseAccountAccess: vi.fn(async () => ({ ok: true })),
	resumeAccountAccess: vi.fn(async () => ({ ok: true }))
}));
vi.mock('./sessions', () => ({ pauseAccountAccess, resumeAccountAccess }));

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

const network = {} as never;
const NOW = new Date('2026-07-03T12:00:00Z');

describe('sweepOutagePauses', () => {
	beforeEach(() => {
		pauseAccountAccess.mockClear();
		resumeAccountAccess.mockClear();
	});

	it('pauses paid guests on a down AP (tagged outage + AP id) and resumes those whose AP recovered', async () => {
		// Awaited statements in order: down APs → victims(AP1) → still-down set → outage-paused list.
		const db = fakeDb([
			[{ id: 1 }], // down APs past the debounce: AP 1
			[{ userId: 'u1' }], // paid, active victims on AP 1
			[{ id: 1 }], // still-down set: AP 1 is still offline
			[
				{ userId: 'u2', apId: 2 }, // paused for AP 2, which recovered → resume
				{ userId: 'u3', apId: 1 } // paused for AP 1, still down → keep
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
			[], // still-down set: empty
			[{ userId: 'u9', apId: 42 }] // paused for an AP that's no longer offline (recovered/pruned)
		]);

		const res = await sweepOutagePauses(db, network, NOW);

		expect(pauseAccountAccess).not.toHaveBeenCalled();
		expect(resumeAccountAccess).toHaveBeenCalledWith(db, 'u9', NOW);
		expect(res).toEqual({ pausedAps: 0, paused: 0, resumed: 1 });
	});

	it('keeps every outage-pause while all their APs are still down (no premature resume)', async () => {
		const db = fakeDb([
			[], // no APs newly cross the debounce this tick
			[{ id: 1 }, { id: 2 }], // still-down: APs 1 and 2
			[
				{ userId: 'a', apId: 1 },
				{ userId: 'b', apId: 2 }
			]
		]);

		const res = await sweepOutagePauses(db, network, NOW);

		expect(resumeAccountAccess).not.toHaveBeenCalled();
		expect(res).toEqual({ pausedAps: 0, paused: 0, resumed: 0 });
	});
});
