import { describe, it, expect, vi } from 'vitest';
import { sweepAdminAccess } from '@veent/core';

/**
 * B3.2 — mutual exclusion across the admin-bypass expiry. `sweepAdminAccess` reaps admin bindings
 * past the 4h cap (delegated to the controller) and, for each reaped MAC that STILL backs a live
 * guest window, restores its guest binding so a dual-role device doesn't go dark. The account window
 * is the source of truth (checked via hasLiveAccessForMac).
 */

// Chainable awaitable db stand-in: each awaited query yields the next queued result (one per
// hasLiveAccessForMac call). Any builder method returns the proxy; awaiting drains the queue.
function fakeDb(results: unknown[]) {
	const queue = [...results];
	const proxy: unknown = new Proxy(function () {}, {
		get(_t, prop) {
			if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(queue.shift());
			return () => proxy;
		}
	});
	return proxy as never;
}

describe('sweepAdminAccess', () => {
	it('restores a guest binding for a reaped MAC with a live window, skips one without', async () => {
		const reaped = ['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02'];
		const sweepAdminBindings = vi.fn().mockResolvedValue(reaped);
		const grant = vi.fn().mockResolvedValue(undefined);
		const network = { sweepAdminBindings, grant } as never;
		// One query per reaped MAC: the first has a live window (non-empty), the second does not.
		const db = fakeDb([[{ id: 1 }], []]);

		const count = await sweepAdminAccess(db, network, 240);

		expect(count).toBe(2); // both reaped
		expect(sweepAdminBindings).toHaveBeenCalledWith({ maxAgeMs: 240 * 60_000 });
		// Only the live-window MAC is restored — a guest binding (no tag → veent-portal).
		expect(grant).toHaveBeenCalledTimes(1);
		expect(grant).toHaveBeenCalledWith({ macAddress: 'AA:BB:CC:DD:EE:01', durationMinutes: 0 });
	});

	it('is a no-op (0, no query) when the controller cannot sweep admin bindings', async () => {
		const grant = vi.fn();
		const count = await sweepAdminAccess(fakeDb([]), { grant } as never, 240);
		expect(count).toBe(0);
		expect(grant).not.toHaveBeenCalled();
	});
});
