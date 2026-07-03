import { describe, it, expect, vi } from 'vitest';
import { unbindAllDevices, reconcileGuestBindings, SESSION_STATUS } from '@veent/core';

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

/**
 * B3.1.2 — the safety net that makes the DB-first swallow above sound: `reconcileGuestBindings`
 * must drop any router binding whose MAC has no `active` session row (i.e. a binding a failed
 * revoke stranded, whose row is now `revoked`). Without this the "reconcileGuestBindings sweeps
 * any miss" comment is a lie and a stranded binding = free internet forever.
 */
describe('reconcileGuestBindings sweeps orphaned bindings (B3.1.2)', () => {
	it('revokes a binding with no active row, keeps one that is still active (case-insensitive)', async () => {
		// DB reports one active MAC (lowercase, as a router/DHCP may). The sweep does one select.
		const activeRows = [{ mac: 'aa:bb:cc:dd:ee:01' }];
		const db = {
			select: () => ({ from: () => ({ where: () => Promise.resolve(activeRows) }) })
		} as never;
		const revoke = vi.fn().mockResolvedValue(undefined);
		const network = {
			listGuestBindings: vi.fn().mockResolvedValue([
				{ macAddress: 'AA:BB:CC:DD:EE:01' }, // still active (case differs) — keep
				{ macAddress: 'AA:BB:CC:DD:EE:02' } // no active row — orphan, sweep it
			]),
			revoke
		} as never;

		const swept = await reconcileGuestBindings(db, network);

		expect(swept).toBe(1);
		expect(revoke).toHaveBeenCalledTimes(1); // ONLY the orphan
		expect(revoke).toHaveBeenCalledWith('AA:BB:CC:DD:EE:02');
	});
});
