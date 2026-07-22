import { describe, it, expect } from 'vitest';
import { spendPointsTx } from './points';

/**
 * AC2 — `spendPointsTx` persists the durable AP circuit-id string on the points_ledger spend row
 * when provided (and null when omitted). Fake Drizzle tx (no DB), mirroring the credit-wallet twin.
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

describe('spendPointsTx — durable AP attribution (AC2)', () => {
	it('writes apCircuitId onto the ledger spend row when provided', async () => {
		const writes: unknown[] = [];
		const tx = recordingTx([[{ balance: 40 }]], writes);
		const res = await spendPointsTx(tx, {
			userId: 'u1',
			amount: 10,
			packageId: 2,
			apCircuitId: 'OLT-9 xpon 0/1/0/4',
			apNameSnapshot: 'AP-Pabayo'
		});
		expect(res).toEqual({ ok: true, balance: 40 });
		expect(writes[0]).toMatchObject({
			amount: -10,
			type: 'spend',
			apCircuitId: 'OLT-9 xpon 0/1/0/4',
			apNameSnapshot: 'AP-Pabayo'
		});
	});

	it('writes null apCircuitId + apNameSnapshot when omitted', async () => {
		const writes: unknown[] = [];
		const tx = recordingTx([[{ balance: 40 }]], writes);
		await spendPointsTx(tx, { userId: 'u1', amount: 10, packageId: 2 });
		expect(writes[0]).toMatchObject({ apCircuitId: null, apNameSnapshot: null });
	});

	it('does not write a ledger row on insufficient points', async () => {
		const writes: unknown[] = [];
		const tx = recordingTx([[], [{ balance: 3 }]], writes);
		const res = await spendPointsTx(tx, { userId: 'u1', amount: 10, apCircuitId: 'CID' });
		expect(res).toEqual({ ok: false, reason: 'insufficient_points', balance: 3 });
		expect(writes).toHaveLength(0);
	});
});
