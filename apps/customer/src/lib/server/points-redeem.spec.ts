import { describe, it, expect, vi } from 'vitest';
import { startPaidAccessAndBindDevice } from '@veent/core';

/**
 * Atomicity guard for REDEEMING points (the credits-spend twin). `startPaidAccessAndBindDevice`
 * with `currency: 'points'` must debit the points wallet, extend the window, bind the device, and
 * grant — all in ONE transaction — so a failed router grant never leaves a user with points spent
 * and no access (business rule #1). Same fake-tx harness as `grant-atomic.spec.ts`; the only
 * difference from the credits path is which wallet is debited, so the failure boundary must behave
 * identically. No DB required.
 */

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
	const state = { inTransaction: false };
	const db = {
		transaction: async (fn: (tx: unknown) => unknown) => {
			state.inTransaction = true;
			try {
				return await fn(fakeTx(results));
			} finally {
				state.inTransaction = false;
			}
		}
	} as never;
	return { db, state };
}

const input = {
	userId: 'u1',
	macAddress: 'AA:BB:CC:DD:EE:FF',
	packageId: 7,
	amount: 8,
	durationMinutes: 30,
	currency: 'points' as const
};

// Awaited statements, in order, for a successful POINTS-paid bind of a NEW device. Identical shape
// to the credits path (spendPointsTx mirrors spendCreditsTx):
//   spend: points balance update→[{balance}], ledger insert→[]
//   bind:  profile FOR UPDATE→[{accessExpiresAt}], window update→[], existing-binding select→[],
//          active-rows select→[], insert binding→[{id}], mirror update→[]
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

describe('startPaidAccessAndBindDevice — points redemption', () => {
	it('rolls back (rejects) when the router grant fails — points never spent alone', async () => {
		const { db, state } = fakeDb(bindAwaits(20, 1));
		let grantInTx: boolean | null = null;
		const network = {
			grant: vi.fn().mockImplementation(() => {
				grantInTx = state.inTransaction;
				return Promise.reject(new Error('router unreachable'));
			}),
			revoke: vi.fn()
		} as never;

		await expect(startPaidAccessAndBindDevice(db, network, input)).rejects.toThrow(
			'router unreachable'
		);
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
		expect(grantInTx).toBe(true); // inside db.transaction — a failure can still roll the debit back
	});

	it('returns ok with the new window when the points debit + grant both succeed', async () => {
		const { db, state } = fakeDb(bindAwaits(12, 9));
		let grantInTx: boolean | null = null;
		const network = {
			grant: vi.fn().mockImplementation(() => {
				grantInTx = state.inTransaction;
				return Promise.resolve(undefined);
			}),
			revoke: vi.fn()
		} as never;

		const res = await startPaidAccessAndBindDevice(db, network, input);
		expect(res.ok).toBe(true);
		expect(res.balance).toBe(12);
		expect(res.accessExpiresAt).toBeInstanceOf(Date);
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
		expect(grantInTx).toBe(true);
	});

	it('returns ok:false insufficient_points and never attempts the grant', async () => {
		// points update matches no row→[] (insufficient), then pointsInTx select→[{balance}].
		const { db } = fakeDb([[], [{ balance: 3 }]]);
		const network = { grant: vi.fn(), revoke: vi.fn() } as never;

		const res = await startPaidAccessAndBindDevice(db, network, input);
		expect(res.ok).toBe(false);
		expect(res.reason).toBe('insufficient_points');
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).not.toHaveBeenCalled();
	});
});
