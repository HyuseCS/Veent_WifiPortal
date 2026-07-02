import { describe, it, expect } from 'vitest';
import { creditCheckoutIfUnsettled } from '@veent/core';
import { packages, paymentCheckouts } from '@veent/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/**
 * Credit-claim transition guard: the reconcile cron blind-expires aged pending checkouts
 * WITHOUT asking the gateway, and the claim used to refuse status='expired' — so a late
 * gateway-verified paid webhook no-oped and the buyer stayed charged with no credits.
 * The claim now accepts {pending,expired}→settled. These specs pin that transition AND the
 * money invariants around it (S1: exactly-once crediting under races/replays; the amount and
 * package guards still refuse). No DB — the fake models the claim UPDATE as atomic: whichever
 * caller reaches it first flips the shared row to settled, everyone after misses.
 */
function fakeDb(
	checkout: { status: string; amount: string } | null,
	opts: { pkgCredits?: number | null } = {}
) {
	const pkgCredits = opts.pkgCredits === undefined ? 5 : opts.pkgCredits;
	const state = {
		checkout,
		claimWheres: [] as SQL[],
		ledgerKeys: new Set<string>(), // external_transaction_id idempotency (second guard)
		ledgerInserts: 0
	};

	const tx = {
		update: (tbl: unknown) => ({
			set: () => ({
				where: (cond: SQL) => {
					if (tbl === paymentCheckouts) {
						state.claimWheres.push(cond);
						// Postgres serializes the claim UPDATE: a row still in {pending, expired}
						// matches exactly one caller, which flips it to settled.
						const c = state.checkout;
						const wins = !!c && (c.status === 'pending' || c.status === 'expired');
						if (c && wins) c.status = 'settled';
						return {
							returning: () => Promise.resolve(wins ? [{ id: 'chk_1', amount: c!.amount }] : [])
						};
					}
					// customerProfile balance bump inside addCreditsTx
					return { returning: () => Promise.resolve([{ balance: 100 }]) };
				}
			})
		}),
		select: () => ({
			from: (tbl: unknown) => ({
				where: () => ({
					limit: () => {
						if (tbl === paymentCheckouts)
							return Promise.resolve(state.checkout ? [{ id: 'chk_1' }] : []);
						if (tbl === packages)
							return Promise.resolve(pkgCredits === null ? [] : [{ credits: pkgCredits }]);
						return Promise.resolve([{ balance: 100 }]); // balanceInTx re-read
					}
				})
			})
		}),
		insert: () => ({
			values: (v: { externalTransactionId?: string }) => ({
				onConflictDoNothing: () => ({
					returning: () => {
						if (v.externalTransactionId && state.ledgerKeys.has(v.externalTransactionId)) {
							return Promise.resolve([]); // replayed txn id → idempotent no-op
						}
						if (v.externalTransactionId) state.ledgerKeys.add(v.externalTransactionId);
						state.ledgerInserts++;
						return Promise.resolve([{ id: state.ledgerInserts }]);
					}
				})
			})
		})
	};

	const db = { transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as never;
	return { db, state };
}

const args = {
	checkoutId: 'chk_1',
	userId: 'u1',
	packageId: 7,
	externalTransactionId: 'pay_1',
	amountMinor: 10000 // matches the checkout's recorded ₱100.00
};

describe('creditCheckoutIfUnsettled — {pending,expired}→settled claim', () => {
	it('credits a pending checkout (webhook happy path unchanged)', async () => {
		const { db, state } = fakeDb({ status: 'pending', amount: '100.00' });
		const r = await creditCheckoutIfUnsettled(db, args);
		expect(r.credited).toBe(true);
		expect(state.checkout!.status).toBe('settled');
		expect(state.ledgerInserts).toBe(1);
	});

	it('credits a blind-expired checkout on a late gateway-verified paid event', async () => {
		const { db, state } = fakeDb({ status: 'expired', amount: '100.00' });
		const r = await creditCheckoutIfUnsettled(db, args);
		expect(r.credited).toBe(true);
		expect(state.checkout!.status).toBe('settled');
		expect(state.ledgerInserts).toBe(1);
		// Pin the claim's status filter itself: a revert to pending-only drops 'expired' here.
		const { params } = new PgDialect().sqlToQuery(state.claimWheres[0]);
		expect(params).toEqual(expect.arrayContaining(['pending', 'expired']));
	});

	it('no-ops (already_settled) on a webhook replay after the credit landed', async () => {
		const { db, state } = fakeDb({ status: 'expired', amount: '100.00' });
		await creditCheckoutIfUnsettled(db, args);
		const replay = await creditCheckoutIfUnsettled(db, args);
		expect(replay).toEqual({ credited: false, reason: 'already_settled' });
		expect(state.ledgerInserts).toBe(1); // S1: exactly one credit, ever
	});

	it('credits exactly once when two claims race on an expired checkout (S1)', async () => {
		const { db, state } = fakeDb({ status: 'expired', amount: '100.00' });
		const [a, b] = await Promise.all([
			creditCheckoutIfUnsettled(db, args),
			creditCheckoutIfUnsettled(db, args)
		]);
		expect([a.credited, b.credited].filter(Boolean)).toHaveLength(1);
		const loser = a.credited ? b : a;
		expect(loser.reason).toBe('already_settled');
		expect(state.ledgerInserts).toBe(1);
	});

	it('amount mismatch: keeps the claim (stops retries) but refuses to credit', async () => {
		const { db, state } = fakeDb({ status: 'expired', amount: '100.00' });
		const r = await creditCheckoutIfUnsettled(db, { ...args, amountMinor: 9999 });
		expect(r).toEqual({ credited: false, reason: 'amount_mismatch' });
		expect(state.checkout!.status).toBe('settled'); // claimed — no retry loop
		expect(state.ledgerInserts).toBe(0);
	});

	it('unknown package: settles without crediting', async () => {
		const { db, state } = fakeDb({ status: 'expired', amount: '100.00' }, { pkgCredits: null });
		const r = await creditCheckoutIfUnsettled(db, args);
		expect(r).toEqual({ credited: false, reason: 'unknown_package' });
		expect(state.ledgerInserts).toBe(0);
	});

	it('never credits a payment with no checkout row', async () => {
		const { db, state } = fakeDb(null);
		const r = await creditCheckoutIfUnsettled(db, args);
		expect(r).toEqual({ credited: false, reason: 'no_checkout' });
		expect(state.ledgerInserts).toBe(0);
	});
});
