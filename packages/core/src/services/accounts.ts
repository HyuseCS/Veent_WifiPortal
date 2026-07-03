import { and, eq, inArray } from 'drizzle-orm';
import { type DB, customerProfile, customerUser, networkSessions } from '@veent/db';
import type { NetworkController } from '../integrations/network';
import { SESSION_STATUS } from '../config';

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

/** Drop router firewall grants for any active sessions held by these users.
 * The DB cascade can't reach the router, so a deleted user's device would stay
 * online unless we revoke its MAC first. */
async function revokeActiveMacs(db: DB, network: NetworkController, ids: string[]): Promise<void> {
	const active = await db
		.select({ mac: networkSessions.macAddress })
		.from(networkSessions)
		.where(
			and(inArray(networkSessions.userId, ids), eq(networkSessions.status, SESSION_STATUS.active))
		);
	// Best-effort per-MAC: a single router error must not abort the sweep and block the
	// delete/block that follows. Once the rows are gone, reconcileGuestBindings drops any
	// router binding a failed revoke left behind (no active row backs it).
	for (const { mac } of active) {
		if (!mac) continue;
		try {
			// Hard delete: cut the device fully (any tag) — a deleted account must leave no binding,
			// and a spoofer riding an admin bypass on this MAC shouldn't survive the delete.
			await network.revoke(mac, { all: true });
		} catch {
			// reconcileGuestBindings sweeps the orphaned router binding on the next cron.
		}
	}
}

/**
 * Hard-delete customers: revoke their live router grants, then delete the
 * better-auth `customer_user` rows. The delete cascades to profile, credit
 * ledger, network sessions, and the auth session/account rows (every FK is
 * `onDelete: 'cascade'`). Returns the number actually removed.
 */
export async function deleteCustomers(
	db: DB,
	network: NetworkController,
	ids: string[]
): Promise<number> {
	if (ids.length === 0) return 0;
	await revokeActiveMacs(db, network, ids);
	const removed = await db
		.delete(customerUser)
		.where(inArray(customerUser.id, ids))
		.returning({ id: customerUser.id });
	return removed.length;
}

/** Wipe the entire customer base. Revokes all live grants first. Caller is
 *  responsible for authorization (owner-only + step-up verification). */
export async function wipeCustomers(db: DB, network: NetworkController): Promise<number> {
	const ids = (await db.select({ id: customerUser.id }).from(customerUser)).map((r) => r.id);
	return deleteCustomers(db, network, ids);
}
