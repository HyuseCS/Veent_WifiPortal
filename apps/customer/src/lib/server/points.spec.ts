import { describe, it, expect } from 'vitest';
import { earnPointsTx, spendPointsTx } from '@veent/core';

/**
 * Unit tests for the loyalty-points wallet primitives (the credit-wallet twin). These verify the
 * two invariants the money paths depend on: earning is IDEMPOTENT on externalTransactionId (a
 * retried webhook can't double-earn), and spending is a conditional debit that refuses to overspend
 * and writes a negative ledger row. Exercised through the caller-owned-tx entry points with a fake
 * Drizzle tx — no DB — mirroring `grant-atomic.spec.ts`.
 */

// A chainable Drizzle-query stand-in that (a) yields one queued result per awaited statement, in
// call order, and (b) records every `.values(...)` payload so a test can assert what was written.
function recordingTx(results: unknown[], writes: unknown[]) {
	const queue = [...results];
	const proxy: unknown = new Proxy(function () {}, {
		get(_t, prop) {
			if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(queue.shift());
			return (arg: unknown) => {
				if (prop === 'values' && arg !== undefined) writes.push(arg);
				return proxy;
			};
		}
	});
	return proxy as never;
}

describe('earnPointsTx', () => {
	it('awards points and updates the balance on a fresh transaction', async () => {
		// ledger insert…returning → [{id}] (not a conflict), then balance update…returning → [{balance}].
		const writes: unknown[] = [];
		const tx = recordingTx([[{ id: 1 }], [{ balance: 12 }]], writes);
		const res = await earnPointsTx(tx, {
			userId: 'u1',
			amount: 5,
			packageId: 3,
			externalTransactionId: 'txn_abc'
		});
		expect(res).toEqual({ earned: true, balance: 12 });
		// The ledger row carries the positive amount, the earn type, and the idempotency key.
		expect(writes[0]).toMatchObject({ amount: 5, type: 'earn', externalTransactionId: 'txn_abc' });
	});

	it('is idempotent: a conflicting externalTransactionId earns nothing and leaves the balance', async () => {
		// ledger insert…returning → [] (unique conflict), then pointsInTx select → [{balance}].
		const writes: unknown[] = [];
		const tx = recordingTx([[], [{ balance: 5 }]], writes);
		const res = await earnPointsTx(tx, {
			userId: 'u1',
			amount: 5,
			externalTransactionId: 'txn_abc'
		});
		expect(res).toEqual({ earned: false, balance: 5 });
	});

	it('rejects a non-positive amount', async () => {
		const tx = recordingTx([], []);
		await expect(
			earnPointsTx(tx, { userId: 'u1', amount: 0, externalTransactionId: 't' })
		).rejects.toThrow(/positive/);
	});

	it('requires an idempotency key (points are only earned on a verified top-up)', async () => {
		const tx = recordingTx([], []);
		await expect(
			earnPointsTx(tx, { userId: 'u1', amount: 5, externalTransactionId: '' })
		).rejects.toThrow(/idempotency/);
	});
});

describe('spendPointsTx', () => {
	it('debits and writes a negative ledger row when the balance covers it', async () => {
		// conditional balance update…returning → [{balance}] (won), then ledger insert.
		const writes: unknown[] = [];
		const tx = recordingTx([[{ balance: 3 }], []], writes);
		const res = await spendPointsTx(tx, { userId: 'u1', amount: 8, packageId: 7 });
		expect(res).toEqual({ ok: true, balance: 3 });
		expect(writes[0]).toMatchObject({ amount: -8, type: 'spend', packageId: 7 });
	});

	it('refuses to overspend: no row updated → insufficient_points, no ledger row', async () => {
		// conditional update matches no row → [] (balance < amount), then pointsInTx select → [{balance}].
		const writes: unknown[] = [];
		const tx = recordingTx([[], [{ balance: 2 }]], writes);
		const res = await spendPointsTx(tx, { userId: 'u1', amount: 8 });
		expect(res).toEqual({ ok: false, reason: 'insufficient_points', balance: 2 });
		// Nothing was written to the ledger on the refusal.
		expect(writes).toHaveLength(0);
	});

	it('rejects a non-positive amount', async () => {
		const tx = recordingTx([], []);
		await expect(spendPointsTx(tx, { userId: 'u1', amount: -1 })).rejects.toThrow(/positive/);
	});
});
