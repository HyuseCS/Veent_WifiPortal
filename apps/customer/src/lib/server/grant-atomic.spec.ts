import { describe, it, expect, vi } from 'vitest';
import { startPaidAccessAndBindDevice } from '@veent/core';

/**
 * Atomicity guard for the paid-grant flow (business rule #1): spend + account-window extend +
 * device bind + router grant must commit/roll back together, so a failed router grant never
 * leaves a user charged with no access. The real rollback is Drizzle's job; what *we* must
 * guarantee is that a grant failure propagates OUT of `db.transaction` (rejects) instead of
 * being swallowed — which is exactly what makes Drizzle roll the spend back. These tests verify
 * that boundary with a fake transaction, no DB required.
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

// Awaited statements, in order, for a successful paid bind of a NEW device:
//   spend: balance update→[{balance}], ledger insert→[]
//   bind:  profile FOR UPDATE→[{accessExpiresAt}], window update→[], existing-binding select→[]
//          (none), active-rows select→[] (none to evict), insert binding→[{id}], mirror update→[]
//   then network.grant() runs (not a tx statement).
const bindAwaits = (balance: number, id: number) => [
	[{ balance }],
	[],
	[{ accessExpiresAt: null }],
	[],
	[],
	[],
	[{ id }],
	[]
];

describe('startPaidAccessAndBindDevice atomicity', () => {
	it('rolls back (rejects) when the router grant fails — spend never commits alone', async () => {
		const db = fakeDb(bindAwaits(80, 1));
		const network = {
			grant: vi.fn().mockRejectedValue(new Error('router unreachable')),
			revoke: vi.fn()
		} as never;

		await expect(startPaidAccessAndBindDevice(db, network, input)).rejects.toThrow(
			'router unreachable'
		);
		// The grant was attempted (so the spend ran first, inside the same transaction).
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
	});

	it('returns ok with the new window when spend + grant both succeed', async () => {
		const db = fakeDb(bindAwaits(60, 9));
		const network = { grant: vi.fn().mockResolvedValue(undefined), revoke: vi.fn() } as never;

		const res = await startPaidAccessAndBindDevice(db, network, input);
		expect(res.ok).toBe(true);
		expect(res.balance).toBe(60);
		expect(res.accessExpiresAt).toBeInstanceOf(Date);
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
	});

	it('returns ok:false on insufficient balance and never attempts the grant', async () => {
		// spend update matches no row→[] (insufficient), then balanceInTx select→[{balance}].
		const db = fakeDb([[], [{ balance: 5 }]]);
		const network = { grant: vi.fn(), revoke: vi.fn() } as never;

		const res = await startPaidAccessAndBindDevice(db, network, input);
		expect(res.ok).toBe(false);
		expect(res.reason).toBe('insufficient_balance');
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).not.toHaveBeenCalled();
	});

	it('throws BEFORE spending when the package has non-positive minutes (B3.4)', async () => {
		// A zero-minute package must never charge credits for a zero-length window. The guard fires
		// before the transaction opens, so no spend and no grant happen — the throw is what the
		// callers surface as "credits were not charged".
		const transaction = vi.fn();
		const db = { transaction } as never;
		const network = { grant: vi.fn(), revoke: vi.fn() } as never;

		await expect(
			startPaidAccessAndBindDevice(db, network, { ...input, durationMinutes: 0 })
		).rejects.toThrow(/non-positive durationMinutes/);

		expect(transaction).not.toHaveBeenCalled();
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).not.toHaveBeenCalled();
	});
});
