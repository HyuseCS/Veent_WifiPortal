import { describe, it, expect } from 'vitest';
import { consumeRateLimit } from '@veent/core';

/**
 * Covers the generic (scope, identifier) key path added for admin email limiting — that it
 * allows a fresh key, blocks once the per-window cap is hit, and reports a retry time. The
 * window/cap algorithm itself is shared with the OTP limiter; this pins the scoped path's
 * allow/block behavior using a fake transaction (no DB).
 */

// Chainable Drizzle stand-in: every builder method returns the proxy; awaiting it yields
// the next queued result, one per awaited statement in call order.
function fakeTx(results: unknown[]) {
	const queue = [...results];
	const proxy: unknown = new Proxy(function () {}, {
		get(_t, prop) {
			if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(queue.shift());
			return () => proxy;
		}
	});
	return proxy;
}
function fakeDb(results: unknown[]) {
	return { transaction: (fn: (tx: unknown) => unknown) => fn(fakeTx(results)) } as never;
}

const key = { scope: 'admin_email', identifier: 'a@b.com' };
const now = new Date('2026-06-24T00:00:00Z');

describe('consumeRateLimit (scoped key)', () => {
	it('allows + seeds the counter on a first attempt (no existing row)', async () => {
		// select → no row; insert seeds the row.
		const db = fakeDb([[], []]);
		const res = await consumeRateLimit(db, { key, max: 5, now });
		expect(res.allowed).toBe(true);
		expect(res.remaining).toBe(4);
		expect(res.retryAt).toBeNull();
	});

	it('blocks once attempts reach the cap within the window', async () => {
		// select → existing row already at the cap, last attempt just now (window not lapsed).
		const db = fakeDb([[{ id: 1, attempts: 5, lastAttemptAt: now }]]);
		const res = await consumeRateLimit(db, { key, max: 5, windowMs: 60_000, now });
		expect(res.allowed).toBe(false);
		expect(res.remaining).toBe(0);
		expect(res.retryAt).toEqual(new Date(now.getTime() + 60_000));
	});

	it('consumes one when under the cap within the window', async () => {
		// select → existing row under cap; update bumps the count.
		const db = fakeDb([[{ id: 1, attempts: 2, lastAttemptAt: now }], []]);
		const res = await consumeRateLimit(db, { key, max: 5, windowMs: 60_000, now });
		expect(res.allowed).toBe(true);
		expect(res.remaining).toBe(2); // max - 1 - attempts = 5 - 1 - 2
	});

	it('throws when no key is provided', async () => {
		const db = fakeDb([]);
		await expect(consumeRateLimit(db, { key: {}, max: 5 })).rejects.toThrow(/key is required/);
	});
});
