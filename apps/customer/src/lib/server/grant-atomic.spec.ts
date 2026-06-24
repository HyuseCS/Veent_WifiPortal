import { describe, it, expect, vi } from 'vitest';
import { startPaidSession } from '@veent/core';

/**
 * Atomicity guard for the paid-grant flow (business rule #1): spend + session grant must
 * commit/roll back together, so a failed router grant never leaves a user charged with no
 * access. The real rollback is Drizzle's job; what *we* must guarantee is that a grant
 * failure propagates OUT of `db.transaction` (rejects) instead of being swallowed — which
 * is exactly what makes Drizzle roll the spend back. These tests verify that boundary with
 * a fake transaction, no DB required.
 */

// A chainable Drizzle-query stand-in: every builder method returns the same proxy, and
// awaiting it yields the next queued result (one per awaited statement, in call order).
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

// Fake db whose transaction(fn) runs the callback against the fake tx and — crucially —
// propagates a thrown error (a real tx would roll back on that throw).
function fakeDb(results: unknown[]) {
	return { transaction: (fn: (tx: unknown) => unknown) => fn(fakeTx(results)) } as never;
}

const input = {
	userId: 'u1',
	macAddress: 'AA:BB:CC:DD:EE:FF',
	packageId: 7,
	amount: 20,
	durationMinutes: 180
};

describe('startPaidSession atomicity', () => {
	it('rolls back (rejects) when the router grant fails — spend never commits alone', async () => {
		// Awaits in order: spend update→[{balance}], spend ledger insert→[], session
		// existing-check→[] (none), session insert→[{id}], then grant() throws and the
		// catch does one compensating update→[].
		const db = fakeDb([[{ balance: 80 }], [], [], [{ id: 1 }], []]);
		const network = {
			grant: vi.fn().mockRejectedValue(new Error('router unreachable')),
			revoke: vi.fn()
		} as never;

		await expect(startPaidSession(db, network, input)).rejects.toThrow('router unreachable');
		// The grant was attempted (so the spend ran first, inside the same transaction).
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
	});

	it('returns ok with the session when spend + grant both succeed', async () => {
		// spend update→[{balance}], ledger insert→[], session existing-check→[], session
		// insert→[{session}]; grant resolves; no resolveApForMac → attribution skipped.
		const db = fakeDb([[{ balance: 60 }], [], [], [{ id: 9, macAddress: input.macAddress }]]);
		const network = { grant: vi.fn().mockResolvedValue(undefined), revoke: vi.fn() } as never;

		const res = await startPaidSession(db, network, input);
		expect(res.ok).toBe(true);
		expect(res.balance).toBe(60);
		expect(res.session).toMatchObject({ id: 9 });
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
	});

	it('returns ok:false on insufficient balance and never attempts the grant', async () => {
		// spend update matches no row→[] (insufficient), then balanceInTx select→[{balance}].
		const db = fakeDb([[], [{ balance: 5 }]]);
		const network = { grant: vi.fn(), revoke: vi.fn() } as never;

		const res = await startPaidSession(db, network, input);
		expect(res.ok).toBe(false);
		expect(res.reason).toBe('insufficient_balance');
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).not.toHaveBeenCalled();
	});
});
