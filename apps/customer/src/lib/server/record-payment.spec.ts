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
	const calls = {
		updates: 0,
		inserts: 0,
		// Captured for the AC1 durable-attribution assertions: the row handed to insert().values()
		// and the `set` object handed to onConflictDoUpdate (the update path).
		insertedRow: undefined as Record<string, unknown> | undefined,
		updateSet: undefined as Record<string, unknown> | undefined
	};
	const db = {
		update: () => ({
			set: (s: Record<string, unknown>) => ({
				where: () => {
					calls.updates++;
					calls.updateSet = s;
					return Promise.resolve([]);
				}
			})
		}),
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				calls.insertedRow = row;
				return {
					onConflictDoUpdate: (arg: { set: Record<string, unknown> }) => {
						calls.inserts++;
						calls.updateSet = arg.set;
						return insertError ? Promise.reject(insertError) : Promise.resolve([]);
					}
				};
			}
		})
	} as never;
	return { db, calls };
}

const attribution = {
	userId: 'u1',
	packageId: 1,
	networkId: null,
	apCircuitId: 'OLT-9 xpon 0/1/0/4',
	apNameSnapshot: 'AP-Pabayo'
};
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

describe('recordPaymentTransaction — durable AP attribution (AC1)', () => {
	it('persists apCircuitId on the inserted row', async () => {
		const { db, calls } = fakeDb();
		await recordPaymentTransaction(db, evt(), attribution);
		expect(calls.insertedRow?.apCircuitId).toBe('OLT-9 xpon 0/1/0/4');
	});

	it('persists apCircuitId INSERT-only — never in the onConflict update set (location fixed at checkout)', async () => {
		const { db, calls } = fakeDb();
		await recordPaymentTransaction(db, evt(), attribution);
		// The location twin (networkId) is INSERT-only by design; apCircuitId must follow the same
		// rule so a later Maya resend / status transition can't overwrite the checkout-time AP fact.
		expect(calls.updateSet).toBeDefined();
		expect(calls.updateSet).not.toHaveProperty('apCircuitId');
		expect(calls.updateSet).not.toHaveProperty('networkId');
	});

	it('records null apCircuitId when the checkout was unattributed', async () => {
		const { db, calls } = fakeDb();
		await recordPaymentTransaction(db, evt(), { ...attribution, apCircuitId: null });
		expect(calls.insertedRow?.apCircuitId).toBeNull();
	});

	it('persists the frozen apNameSnapshot on the inserted row', async () => {
		const { db, calls } = fakeDb();
		await recordPaymentTransaction(db, evt(), attribution);
		expect(calls.insertedRow?.apNameSnapshot).toBe('AP-Pabayo');
	});

	it('persists apNameSnapshot INSERT-only — never in the onConflict update set (name frozen at checkout)', async () => {
		const { db, calls } = fakeDb();
		await recordPaymentTransaction(db, evt(), attribution);
		expect(calls.updateSet).toBeDefined();
		expect(calls.updateSet).not.toHaveProperty('apNameSnapshot');
	});

	it('records null apNameSnapshot when the checkout had no resolvable name', async () => {
		const { db, calls } = fakeDb();
		await recordPaymentTransaction(db, evt(), { ...attribution, apNameSnapshot: null });
		expect(calls.insertedRow?.apNameSnapshot).toBeNull();
	});
});
