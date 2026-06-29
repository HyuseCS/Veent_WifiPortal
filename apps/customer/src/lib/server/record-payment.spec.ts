import { describe, it, expect } from 'vitest';
import { recordPaymentTransaction } from '@veent/core';

/**
 * Locks in the Finance reporting-integrity fix (SECURITY_RISKS R18): the webhook keys
 * payment_transactions on the Maya payment id, while the on-return poll / reconcile may key on
 * the checkout id — so the SAME payment can arrive under two different ids. `recordPaymentTransaction`
 * dedupes on `referenceNo` (identical across both paths): if a row already exists for that
 * referenceNo under a DIFFERENT id, it UPDATEs that row instead of INSERTing a divergent duplicate
 * (which would double-count settled revenue). No DB — a fake records which path was taken.
 */
function fakeDb(existing: { id: string } | null) {
	const calls = { selects: 0, updates: 0, inserts: 0 };
	const db = {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => {
						calls.selects++;
						return Promise.resolve(existing ? [existing] : []);
					}
				})
			})
		}),
		update: () => ({
			set: () => ({
				where: () => {
					calls.updates++;
					return Promise.resolve([]);
				}
			})
		}),
		insert: () => ({
			values: () => ({
				onConflictDoUpdate: () => {
					calls.inserts++;
					return Promise.resolve([]);
				}
			})
		})
	} as never;
	return { db, calls };
}

const attribution = { userId: 'u1', packageId: 1, networkId: null };
const evt = (overrides: Record<string, unknown> = {}) =>
	({
		externalTransactionId: 'pay_123',
		referenceId: 'ref-abc',
		status: 'paid',
		amountMinor: 10000,
		currency: 'PHP',
		referenceNo: 'ref-abc',
		...overrides
	}) as never;

describe('recordPaymentTransaction — referenceNo dedupe (R18)', () => {
	it('inserts (upsert-on-id) when no row exists for the referenceNo', async () => {
		const { db, calls } = fakeDb(null);
		await recordPaymentTransaction(db, evt(), attribution);
		expect(calls.inserts).toBe(1);
		expect(calls.updates).toBe(0);
	});

	it('UPDATEs the existing row when a different id already holds the same referenceNo', async () => {
		// Webhook recorded under the payment id; the poll now arrives keyed on the checkout id.
		const { db, calls } = fakeDb({ id: 'chk_999' });
		await recordPaymentTransaction(db, evt({ externalTransactionId: 'pay_123' }), attribution);
		expect(calls.updates).toBe(1);
		expect(calls.inserts).toBe(0); // no divergent duplicate → no revenue double-count
	});

	it('falls through to the id upsert when the SAME id already holds the referenceNo (resend)', async () => {
		const { db, calls } = fakeDb({ id: 'pay_123' });
		await recordPaymentTransaction(db, evt({ externalTransactionId: 'pay_123' }), attribution);
		expect(calls.inserts).toBe(1);
		expect(calls.updates).toBe(0);
	});

	it('skips the dedupe lookup entirely when the event has no referenceNo', async () => {
		const { db, calls } = fakeDb(null);
		await recordPaymentTransaction(db, evt({ referenceNo: undefined }), attribution);
		expect(calls.selects).toBe(0);
		expect(calls.inserts).toBe(1);
	});
});
