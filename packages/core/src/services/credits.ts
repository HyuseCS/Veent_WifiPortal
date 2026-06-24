import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { type DB, customerProfile, creditLedger } from '@veent/db';
import { LEDGER_TYPE, type LedgerType } from '../config';

/** A Drizzle transaction handle — the value passed to a `db.transaction(tx => …)`
 * callback. Lets a service run inside a caller-owned transaction (e.g. so a spend and
 * the session grant commit/roll back together) instead of opening its own. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * The id of the user's most recent ledger entry (0 if none). Captured right
 * before a checkout redirect as a watermark: the payment webhook later inserts a
 * `topup` row with a higher id, so the waiting room can detect *this* payment's
 * credit landing (`getTopupSince`) without knowing the gateway transaction id.
 */
export async function getLatestLedgerId(db: DB, userId: string): Promise<number> {
	const [row] = await db
		.select({ id: creditLedger.id })
		.from(creditLedger)
		.where(eq(creditLedger.userId, userId))
		.orderBy(desc(creditLedger.id))
		.limit(1);
	return row?.id ?? 0;
}

export interface TopupSettlement {
	/** A verified-payment credit has landed since the watermark. */
	settled: boolean;
	/** Credits added by that topup (0 until settled). */
	creditsAdded: number;
	/** Current balance, for the success screen. */
	balance: number;
}

/**
 * Has a `topup` credit landed for this user since `sinceLedgerId`? The waiting
 * room polls this after the user returns from the gateway; it flips to settled
 * the moment the verified webhook inserts the credit (business rule #3).
 */
export async function getTopupSince(
	db: DB,
	userId: string,
	sinceLedgerId: number
): Promise<TopupSettlement> {
	const [row] = await db
		.select({ amount: creditLedger.amount })
		.from(creditLedger)
		.where(
			and(
				eq(creditLedger.userId, userId),
				eq(creditLedger.type, LEDGER_TYPE.topup),
				gt(creditLedger.id, sinceLedgerId)
			)
		)
		.orderBy(desc(creditLedger.id))
		.limit(1);
	return {
		settled: !!row,
		creditsAdded: row ? Number(row.amount) : 0,
		balance: await getBalance(db, userId)
	};
}

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
 * Deducts credits for an access-tier purchase inside a caller-owned transaction, only
 * if the balance covers it. The conditional UPDATE (balance >= amount) prevents overspend
 * under concurrent requests without an explicit lock. Use this when the spend must commit
 * atomically with another effect (e.g. the grant in `startPaidAccessAndBindDevice`); use
 * `spendCredits` for a standalone spend.
 */
export async function spendCreditsTx(
	tx: Tx,
	input: { userId: string; amount: number; packageId?: number }
): Promise<SpendCreditsResult> {
	if (input.amount <= 0) throw new Error('spendCredits: amount must be positive');

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
}

/**
 * Deducts credits for an access-tier purchase, atomically and only if the balance
 * covers it. Standalone wrapper around `spendCreditsTx` in its own transaction.
 */
export async function spendCredits(
	db: DB,
	input: { userId: string; amount: number; packageId?: number }
): Promise<SpendCreditsResult> {
	return db.transaction((tx) => spendCreditsTx(tx, input));
}

async function balanceInTx(tx: Tx, userId: string) {
	const [row] = await tx
		.select({ balance: customerProfile.creditBalance })
		.from(customerProfile)
		.where(eq(customerProfile.userId, userId))
		.limit(1);
	return row ? Number(row.balance) : 0;
}
