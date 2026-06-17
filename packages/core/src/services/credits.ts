import { and, eq, sql } from 'drizzle-orm';
import { type DB, customerProfile, creditLedger } from '@veent/db';
import { LEDGER_TYPE, type LedgerType } from '../config';

/** Current credit balance for a user (0 if no profile row yet). */
export async function getBalance(db: DB, userId: string): Promise<number> {
	const [row] = await db
		.select({ balance: customerProfile.creditBalance })
		.from(customerProfile)
		.where(eq(customerProfile.userId, userId))
		.limit(1);
	return row ? Number(row.balance) : 0;
}

export interface AddCreditsInput {
	userId: string;
	/** Positive number of credits to add. */
	amount: number;
	type: Extract<LedgerType, 'topup' | 'promo' | 'refund'>;
	packageId?: number;
	/**
	 * Gateway transaction id. REQUIRED for `topup` — it's the idempotency key that
	 * stops a retried webhook from crediting twice (unique in the DB).
	 */
	externalTransactionId?: string;
}

export interface AddCreditsResult {
	/** false = this transaction was already applied (idempotent no-op). */
	credited: boolean;
	balance: number;
}

/**
 * Adds credits and records a ledger row, atomically. Idempotent on
 * `externalTransactionId`: if a row with that id already exists, the balance is
 * NOT touched and `credited: false` is returned. This is the core guard behind
 * business rule #3 (credits added only once, on verified payment).
 */
export async function addCredits(db: DB, input: AddCreditsInput): Promise<AddCreditsResult> {
	if (input.amount <= 0) throw new Error('addCredits: amount must be positive');
	if (input.type === LEDGER_TYPE.topup && !input.externalTransactionId) {
		throw new Error('addCredits: topup requires externalTransactionId (idempotency key)');
	}

	return db.transaction(async (tx) => {
		const inserted = await tx
			.insert(creditLedger)
			.values({
				userId: input.userId,
				packageId: input.packageId,
				amount: input.amount,
				type: input.type,
				externalTransactionId: input.externalTransactionId
			})
			.onConflictDoNothing({ target: creditLedger.externalTransactionId })
			.returning({ id: creditLedger.id });

		// Conflict → this external transaction was already processed.
		if (input.externalTransactionId && inserted.length === 0) {
			return { credited: false, balance: await balanceInTx(tx, input.userId) };
		}

		const [updated] = await tx
			.update(customerProfile)
			.set({ creditBalance: sql`${customerProfile.creditBalance} + ${input.amount}` })
			.where(eq(customerProfile.userId, input.userId))
			.returning({ balance: customerProfile.creditBalance });

		return { credited: true, balance: updated ? Number(updated.balance) : 0 };
	});
}

export interface SpendCreditsResult {
	ok: boolean;
	/** Set when ok=false. */
	reason?: 'insufficient_balance';
	balance: number;
}

/**
 * Deducts credits for an access-tier purchase, atomically and only if the balance
 * covers it. The conditional UPDATE (balance >= amount) prevents overspend under
 * concurrent requests without an explicit lock.
 */
export async function spendCredits(
	db: DB,
	input: { userId: string; amount: number; packageId?: number }
): Promise<SpendCreditsResult> {
	if (input.amount <= 0) throw new Error('spendCredits: amount must be positive');

	return db.transaction(async (tx) => {
		const [updated] = await tx
			.update(customerProfile)
			.set({ creditBalance: sql`${customerProfile.creditBalance} - ${input.amount}` })
			.where(
				and(
					eq(customerProfile.userId, input.userId),
					sql`${customerProfile.creditBalance} >= ${input.amount}`
				)
			)
			.returning({ balance: customerProfile.creditBalance });

		if (!updated) {
			return {
				ok: false,
				reason: 'insufficient_balance',
				balance: await balanceInTx(tx, input.userId)
			};
		}

		await tx.insert(creditLedger).values({
			userId: input.userId,
			packageId: input.packageId,
			amount: -input.amount,
			type: LEDGER_TYPE.spend
		});

		return { ok: true, balance: Number(updated.balance) };
	});
}

async function balanceInTx(tx: Parameters<Parameters<DB['transaction']>[0]>[0], userId: string) {
	const [row] = await tx
		.select({ balance: customerProfile.creditBalance })
		.from(customerProfile)
		.where(eq(customerProfile.userId, userId))
		.limit(1);
	return row ? Number(row.balance) : 0;
}
