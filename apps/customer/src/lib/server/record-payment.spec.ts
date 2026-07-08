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
 *
 * Error shape matters: drizzle-orm wraps driver errors (DrizzleQueryError), putting the
 * SQLSTATE on the CAUSE chain, not `.code` — the wrapped-shape cases below are what the
 * webhook path actually sees in production; the bare `.code` case pins driver-direct errors.
 */
function fakeDb(insertError?: unknown) {
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
		// Bare `.code` shape: what a driver-direct error (and the older drizzle) carries.
		const { db, calls } = fakeDb({ code: '23505' });
		await recordPaymentTransaction(db, evt({ externalTransactionId: 'chk_999' }), attribution);
		expect(calls.updates).toBe(1); // collapsed — no divergent duplicate, no revenue double-count
	});

	it('collapses when the 23505 arrives wrapped drizzle-style (SQLSTATE on error.cause)', async () => {
		// Production shape: drizzle-orm wraps the postgres error in DrizzleQueryError, so the
		// SQLSTATE is on .cause.code, NOT .code. With only the bare-.code check, this branch was
		// dead in production — the webhook rethrew, 500'd, and Maya retried in a loop.
		const wrapped = Object.assign(new Error('duplicate key value violates unique constraint'), {
			cause: { code: '23505' }
		});
		const { db, calls } = fakeDb(wrapped);
		await recordPaymentTransaction(db, evt({ externalTransactionId: 'chk_999' }), attribution);
		expect(calls.updates).toBe(1);
	});

	it('collapses when the SQLSTATE sits two causes deep (bounded cause-chain walk)', async () => {
		const doublyWrapped = { cause: { cause: { code: '23505' } } };
		const { db, calls } = fakeDb(doublyWrapped);
		await recordPaymentTransaction(db, evt({ externalTransactionId: 'chk_999' }), attribution);
		expect(calls.updates).toBe(1);
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
