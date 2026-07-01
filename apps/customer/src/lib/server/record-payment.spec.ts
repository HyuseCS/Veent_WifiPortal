import { describe, it, expect } from 'vitest';
import { recordPaymentTransaction } from '@veent/core';

/**
 * Locks in the Finance reporting-integrity fix (SECURITY_RISKS R18): the webhook keys
 * payment_transactions on the Maya payment id, while the on-return poll / reconcile may key on
 * the checkout id — so the SAME payment can arrive under two different ids, both carrying the same
 * referenceNo. A partial unique index on reference_no now makes Postgres reject the divergent
 * duplicate; `recordPaymentTransaction` catches that unique violation (23505) and UPDATEs the
 * existing row instead of writing a second PAYMENT_SUCCESS (which would double-count settled
 * revenue). No DB — a fake records which path was taken and can simulate the index raising 23505.
 */
function fakeDb(insertError?: { code?: string }) {
	const calls = { updates: 0, inserts: 0 };
	const db = {
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
					return insertError ? Promise.reject(insertError) : Promise.resolve([]);
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
	it('inserts (upsert-on-id) when there is no conflict', async () => {
		const { db, calls } = fakeDb();
		await recordPaymentTransaction(db, evt(), attribution);
		expect(calls.inserts).toBe(1);
		expect(calls.updates).toBe(0);
	});

	it('collapses onto the existing row when the reference_no index rejects a different id', async () => {
		// Webhook already recorded this payment under its payment id; the poll now arrives keyed on
		// the checkout id → the partial unique index raises 23505 → update the existing row, no dupe.
		const { db, calls } = fakeDb({ code: '23505' });
		await recordPaymentTransaction(db, evt({ externalTransactionId: 'chk_999' }), attribution);
		expect(calls.updates).toBe(1); // collapsed — no divergent duplicate, no revenue double-count
	});

	it('rethrows a unique violation when the event has no referenceNo to collapse on', async () => {
		const { db } = fakeDb({ code: '23505' });
		await expect(
			recordPaymentTransaction(db, evt({ referenceNo: undefined }), attribution)
		).rejects.toMatchObject({ code: '23505' });
	});

	it('rethrows a non-unique-violation insert error', async () => {
		const { db } = fakeDb({ code: '08006' }); // connection failure, not a dedupe case
		await expect(recordPaymentTransaction(db, evt(), attribution)).rejects.toMatchObject({
			code: '08006'
		});
	});
});
