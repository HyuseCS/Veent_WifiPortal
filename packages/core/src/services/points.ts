import { and, eq, sql } from 'drizzle-orm';
import { type DB, customerProfile, pointsLedger } from '@veent/db';
import { POINTS_LEDGER_TYPE } from '../config';
import type { Tx } from './credits';

/**
 * The loyalty-points wallet — a deliberate twin of `credits.ts`. Points live in their own
 * `customer_profile.points_balance` column + `points_ledger` table so they never share a balance
 * or an idempotency key with credits. Earning happens as a % of a verified top-up (in the SAME
 * transaction as the credit); spending redeems an access tier instead of credits.
 */

/** Current points balance for a user (0 if no profile row yet). */
export async function getPointsBalance(db: DB, userId: string): Promise<number> {
	const [row] = await db
		.select({ balance: customerProfile.pointsBalance })
		.from(customerProfile)
		.where(eq(customerProfile.userId, userId))
		.limit(1);
	return row ? Number(row.balance) : 0;
}

export interface EarnPointsInput {
	userId: string;
	/** Positive whole number of points to award. */
	amount: number;
	packageId?: number;
	/**
	 * Gateway transaction id — the idempotency key that stops a retried webhook from earning
	 * twice (unique in `points_ledger`). Required: points are only ever earned on a verified top-up.
	 */
	externalTransactionId: string;
}

export interface EarnPointsResult {
	/** false = this transaction already earned (idempotent no-op). */
	earned: boolean;
	balance: number;
}

/**
 * Award points and record a ledger row, atomically, inside a caller-owned transaction. Idempotent
 * on `externalTransactionId`: if a row with that id already exists, the balance is NOT touched and
 * `earned: false` is returned. Mirrors `addCreditsTx` — call it in the SAME tx as the credit so
 * points can never be earned without the top-up committing.
 */
export async function earnPointsTx(tx: Tx, input: EarnPointsInput): Promise<EarnPointsResult> {
	if (input.amount <= 0) throw new Error('earnPoints: amount must be positive');
	if (!input.externalTransactionId) {
		throw new Error('earnPoints: requires externalTransactionId (idempotency key)');
	}

	const inserted = await tx
		.insert(pointsLedger)
		.values({
			userId: input.userId,
			packageId: input.packageId,
			amount: input.amount,
			type: POINTS_LEDGER_TYPE.earn,
			externalTransactionId: input.externalTransactionId
		})
		.onConflictDoNothing({ target: pointsLedger.externalTransactionId })
		.returning({ id: pointsLedger.id });

	// Conflict → this external transaction already earned points.
	if (inserted.length === 0) {
		return { earned: false, balance: await pointsInTx(tx, input.userId) };
	}

	const [updated] = await tx
		.update(customerProfile)
		.set({ pointsBalance: sql`${customerProfile.pointsBalance} + ${input.amount}` })
		.where(eq(customerProfile.userId, input.userId))
		.returning({ balance: customerProfile.pointsBalance });

	return { earned: true, balance: updated ? Number(updated.balance) : 0 };
}

export interface SpendPointsResult {
	ok: boolean;
	/** Set when ok=false. */
	reason?: 'insufficient_points';
	balance: number;
}

/**
 * Redeem points for an access tier inside a caller-owned transaction, only if the balance covers
 * it. The conditional UPDATE (balance >= amount) prevents overspend under concurrency without a
 * lock — the exact mirror of `spendCreditsTx`. Use this when the spend must commit atomically with
 * another effect (the grant in `startPaidAccessAndBindDevice`).
 */
export async function spendPointsTx(
	tx: Tx,
	input: { userId: string; amount: number; packageId?: number }
): Promise<SpendPointsResult> {
	if (input.amount <= 0) throw new Error('spendPoints: amount must be positive');

	const [updated] = await tx
		.update(customerProfile)
		.set({ pointsBalance: sql`${customerProfile.pointsBalance} - ${input.amount}` })
		.where(
			and(
				eq(customerProfile.userId, input.userId),
				sql`${customerProfile.pointsBalance} >= ${input.amount}`
			)
		)
		.returning({ balance: customerProfile.pointsBalance });

	if (!updated) {
		return {
			ok: false,
			reason: 'insufficient_points',
			balance: await pointsInTx(tx, input.userId)
		};
	}

	await tx.insert(pointsLedger).values({
		userId: input.userId,
		packageId: input.packageId,
		amount: -input.amount,
		type: POINTS_LEDGER_TYPE.spend
	});

	return { ok: true, balance: Number(updated.balance) };
}

/** Redeem points in a standalone transaction. Thin wrapper around `spendPointsTx`. */
export async function spendPoints(
	db: DB,
	input: { userId: string; amount: number; packageId?: number }
): Promise<SpendPointsResult> {
	return db.transaction((tx) => spendPointsTx(tx, input));
}

async function pointsInTx(tx: Tx, userId: string) {
	const [row] = await tx
		.select({ balance: customerProfile.pointsBalance })
		.from(customerProfile)
		.where(eq(customerProfile.userId, userId))
		.limit(1);
	return row ? Number(row.balance) : 0;
}
