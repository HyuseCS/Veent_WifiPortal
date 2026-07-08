import { describe, it, expect, vi } from 'vitest';
import { startPaidAccessAndBindDevice, startFreeAccessAndBindDevice } from '@veent/core';

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
// propagates a thrown error (a real tx would roll back on that throw). `state.inTransaction`
// is true only while the callback executes, so a grant mock can record whether it ran INSIDE
// the transaction boundary — the exact regression these specs exist to catch: asserting only
// "grant was called" would stay green if the grant moved back outside db.transaction.
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
		const { db, state } = fakeDb(bindAwaits(80, 1));
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
		// The grant was attempted (so the spend ran first, inside the same transaction).
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
		expect(grantInTx).toBe(true); // inside db.transaction — a failure can still roll the spend back
	});

	it('returns ok with the new window when spend + grant both succeed', async () => {
		const { db, state } = fakeDb(bindAwaits(60, 9));
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
		expect(res.balance).toBe(60);
		expect(res.accessExpiresAt).toBeInstanceOf(Date);
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
		expect(grantInTx).toBe(true);
	});

	it('returns ok:false on insufficient balance and never attempts the grant', async () => {
		// spend update matches no row→[] (insufficient), then balanceInTx select→[{balance}].
		const { db } = fakeDb([[], [{ balance: 5 }]]);
		const network = { grant: vi.fn(), revoke: vi.fn() } as never;

		const res = await startPaidAccessAndBindDevice(db, network, input);
		expect(res.ok).toBe(false);
		expect(res.reason).toBe('insufficient_balance');
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).not.toHaveBeenCalled();
	});

	it('throws BEFORE spending when the package has non-positive or NaN minutes (B3.4)', async () => {
		// A zero-minute (or NaN — a corrupt row would compute an Invalid Date expiry) package must
		// never charge credits. The guard fires before the transaction opens, so no spend and no
		// grant happen — the throw is what the callers surface as "credits were not charged".
		const transaction = vi.fn();
		const db = { transaction } as never;
		const network = { grant: vi.fn(), revoke: vi.fn() } as never;

		await expect(
			startPaidAccessAndBindDevice(db, network, { ...input, durationMinutes: 0 })
		).rejects.toThrow(/invalid durationMinutes/);
		await expect(
			startPaidAccessAndBindDevice(db, network, { ...input, durationMinutes: NaN })
		).rejects.toThrow(/invalid durationMinutes/);

		expect(transaction).not.toHaveBeenCalled();
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).not.toHaveBeenCalled();
	});
});

/**
 * Same atomicity guard for the FREE path: the cooldown claim (`last_free_session_at`), the bind,
 * and the router grant must roll back together. Before this, the claim committed in its own
 * transaction before a separate grant, so a router blip burned the user's free-time eligibility
 * for the full cooldown while giving them no access. These verify the grant failure now
 * propagates OUT of `db.transaction` (so Drizzle rolls the claim back), mirroring the paid tests.
 */
const freeInput = { userId: 'u1', macAddress: 'AA:BB:CC:DD:EE:FF' };

// Awaited statements, in order, for a successful FREE bind of a NEW device:
//   claim: cooldown UPDATE…returning→[{userId}] (won the claim)
//   bind:  profile FOR UPDATE→[{accessExpiresAt}], window update→[], existing-binding select→[],
//          active-rows select→[] (none to evict), insert binding→[{id}], mirror update→[]
//   then network.grant() runs (not a tx statement).
const freeBindAwaits = (id: number) => [
	[{ userId: 'u1' }],
	[{ accessExpiresAt: null }],
	[],
	[],
	[],
	[{ id }],
	[]
];

describe('startFreeAccessAndBindDevice atomicity', () => {
	it('rolls back (rejects) when the router grant fails — the cooldown claim never commits alone', async () => {
		const { db, state } = fakeDb(freeBindAwaits(1));
		let grantInTx: boolean | null = null;
		const network = {
			grant: vi.fn().mockImplementation(() => {
				grantInTx = state.inTransaction;
				return Promise.reject(new Error('router unreachable'));
			}),
			revoke: vi.fn()
		} as never;

		await expect(startFreeAccessAndBindDevice(db, network, freeInput)).rejects.toThrow(
			'router unreachable'
		);
		// The grant was attempted inside the same transaction as the claim.
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
		expect(grantInTx).toBe(true); // inside db.transaction — a failure can still roll the claim back
	});

	it('returns ok with the new window when the claim + grant both succeed', async () => {
		const { db, state } = fakeDb(freeBindAwaits(4));
		let grantInTx: boolean | null = null;
		const network = {
			grant: vi.fn().mockImplementation(() => {
				grantInTx = state.inTransaction;
				return Promise.resolve(undefined);
			}),
			revoke: vi.fn()
		} as never;

		const res = await startFreeAccessAndBindDevice(db, network, freeInput);
		expect(res.ok).toBe(true);
		expect(res.accessExpiresAt).toBeInstanceOf(Date);
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).toHaveBeenCalledOnce();
		expect(grantInTx).toBe(true);
	});

	it('returns ok:false not_eligible on an active cooldown and never attempts the grant', async () => {
		// cooldown claim matches no row→[] (still in cooldown), then the re-read select→[{lastFreeSessionAt}].
		const { db } = fakeDb([[], [{ lastFreeSessionAt: new Date() }]]);
		const network = { grant: vi.fn(), revoke: vi.fn() } as never;

		const res = await startFreeAccessAndBindDevice(db, network, freeInput);
		expect(res.ok).toBe(false);
		expect(res.reason).toBe('not_eligible');
		expect((network as { grant: ReturnType<typeof vi.fn> }).grant).not.toHaveBeenCalled();
	});
});
