import { describe, it, expect } from 'vitest';
import { spendCreditsTx } from './credits';

/**
 * AC2 — `spendCreditsTx` persists the durable AP circuit-id string on the credit_ledger spend row
 * when provided (and null when omitted), without changing the existing conditional-debit behavior.
 * Fake Drizzle tx (no DB), mirroring apps/customer/src/lib/server/points.spec.ts's `recordingTx`.
 */
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

describe('spendCreditsTx — durable AP attribution (AC2)', () => {
	it('writes apCircuitId onto the ledger spend row when provided', async () => {
		const writes: unknown[] = [];
		// update…returning → [{balance}] (debit succeeded), then ledger insert…values.
		const tx = recordingTx([[{ balance: 50 }]], writes);
		const res = await spendCreditsTx(tx, {
			userId: 'u1',
			amount: 20,
			packageId: 3,
			apCircuitId: 'OLT-9 xpon 0/1/0/4'
		});
		expect(res).toEqual({ ok: true, balance: 50 });
		expect(writes[0]).toMatchObject({
			amount: -20,
			type: 'spend',
			apCircuitId: 'OLT-9 xpon 0/1/0/4'
		});
	});

	it('writes null apCircuitId when omitted (unattributed grant)', async () => {
		const writes: unknown[] = [];
		const tx = recordingTx([[{ balance: 30 }]], writes);
		await spendCreditsTx(tx, { userId: 'u1', amount: 20, packageId: 3 });
		expect(writes[0]).toMatchObject({ apCircuitId: null });
	});

	it('does not write a ledger row on insufficient balance (no attribution leak)', async () => {
		const writes: unknown[] = [];
		// update…returning → [] (conditional debit failed), then balanceInTx select → [{balance}].
		const tx = recordingTx([[], [{ balance: 5 }]], writes);
		const res = await spendCreditsTx(tx, {
			userId: 'u1',
			amount: 20,
			apCircuitId: 'CID'
		});
		expect(res).toEqual({ ok: false, reason: 'insufficient_balance', balance: 5 });
		expect(writes).toHaveLength(0);
	});
});
