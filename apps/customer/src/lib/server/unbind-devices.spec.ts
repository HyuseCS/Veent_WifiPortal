import { describe, it, expect, vi } from 'vitest';
import { unbindAllDevices, SESSION_STATUS } from '@veent/core';

/**
 * B3.1 — `unbindAllDevices` ("disconnect all devices" / pause) must be DB-first: each row is
 * marked `revoked` BEFORE the router revoke, and a failed revoke is swallowed so the loop
 * continues. The old router-first order threw out of the loop on the first controller error,
 * stranding that row (and every later one) as `active` — free internet forever. reconcileGuestBindings
 * later sweeps any router binding a failed revoke leaves behind.
 */

// Chainable Drizzle stand-in used as `db` directly (no transaction here). Every builder method
// returns the proxy; awaiting yields the next queued result. `.set(payload)` is recorded so we
// can assert every row was marked revoked even when the router revoke throws.
function fakeDb(results: unknown[]) {
	const queue = [...results];
	const setCalls: Array<Record<string, unknown>> = [];
	const proxy: unknown = new Proxy(function () {}, {
		get(_t, prop) {
			if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(queue.shift());
			if (prop === 'set')
				return (payload: Record<string, unknown>) => {
					setCalls.push(payload);
					return proxy;
				};
			return () => proxy;
		}
	});
	return { db: proxy as never, setCalls };
}

describe('unbindAllDevices DB-first ordering (B3.1)', () => {
	it('revokes every row in the DB and never throws even when the router revoke fails', async () => {
		const active = [
			{ id: 1, macAddress: 'AA:BB:CC:DD:EE:01' },
			{ id: 2, macAddress: 'AA:BB:CC:DD:EE:02' }
		];
		// Awaited statements in order: the initial select (→active), then one update per row.
		const { db, setCalls } = fakeDb([active, undefined, undefined]);
		const network = { revoke: vi.fn().mockRejectedValue(new Error('router unreachable')) } as never;

		const count = await unbindAllDevices(db, network, 'u1');

		expect(count).toBe(2); // both rows dropped despite the router errors
		// Revoke was attempted for BOTH devices — proves it continued past the first failure.
		const revoke = (network as { revoke: ReturnType<typeof vi.fn> }).revoke;
		expect(revoke).toHaveBeenCalledTimes(2);
		expect(revoke).toHaveBeenCalledWith('AA:BB:CC:DD:EE:01');
		expect(revoke).toHaveBeenCalledWith('AA:BB:CC:DD:EE:02');
		// Every row was marked revoked in the DB (the update ran before each failing revoke).
		expect(setCalls).toHaveLength(2);
		expect(setCalls.every((c) => c.status === SESSION_STATUS.revoked)).toBe(true);
	});
});
