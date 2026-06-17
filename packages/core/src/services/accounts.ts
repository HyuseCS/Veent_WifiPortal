import { eq } from 'drizzle-orm';
import { type DB, customerProfile } from '@veent/db';

export interface Account {
	userId: string;
	balance: number;
	blocked: boolean;
	lastFreeSessionAt: Date | null;
}

/** Reads a customer's portal-domain account row (null if no profile yet). */
export async function getAccount(db: DB, userId: string): Promise<Account | null> {
	const [row] = await db
		.select({
			balance: customerProfile.creditBalance,
			blocked: customerProfile.blocked,
			lastFreeSessionAt: customerProfile.lastFreeSessionAt
		})
		.from(customerProfile)
		.where(eq(customerProfile.userId, userId))
		.limit(1);
	if (!row) return null;
	return {
		userId,
		balance: Number(row.balance),
		blocked: row.blocked,
		lastFreeSessionAt: row.lastFreeSessionAt
	};
}

/** Sets/clears the admin block flag for a user. */
export async function setBlocked(db: DB, userId: string, blocked: boolean): Promise<void> {
	await db.update(customerProfile).set({ blocked }).where(eq(customerProfile.userId, userId));
}
