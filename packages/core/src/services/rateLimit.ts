import { and, eq, type SQL } from 'drizzle-orm';
import { type DB, rateLimits } from '@veent/db';
import { GRACE_RATE_LIMIT_PER_HOUR } from '../config';

export interface RateLimitKey {
	macAddress?: string;
	phoneNumber?: string;
	/** Generic limiter namespace (e.g. 'admin_email') — pair with `identifier`. Use this
	 * instead of mac/phone for non-OTP limiters; rows never share a column pair, so a scope
	 * can't collide with a mac/phone counter. */
	scope?: string;
	/** The keyed value within `scope` (e.g. the recipient email). */
	identifier?: string;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	/** When the window resets (only meaningful when blocked). */
	retryAt: Date | null;
}

/**
 * Sliding-window-ish counter keyed by device MAC, phone number, or a generic
 * (scope, identifier) pair. One row per key: attempts reset once the window since the
 * last attempt lapses. Used to cap grace-period grants, OTP sends, and admin email.
 *
 * Provide exactly one key per call: `macAddress`, `phoneNumber`, or `scope`+`identifier`.
 */
export async function consumeRateLimit(
	db: DB,
	opts: { key: RateLimitKey; max?: number; windowMs?: number; now?: Date }
): Promise<RateLimitResult> {
	const max = opts.max ?? GRACE_RATE_LIMIT_PER_HOUR;
	const windowMs = opts.windowMs ?? 60 * 60 * 1000; // 1 hour
	const now = opts.now ?? new Date();

	const { macAddress, phoneNumber, scope, identifier } = opts.key;
	// Resolve the lookup predicate + the columns to stamp on a first-attempt insert. Each
	// key type uses its own column pair, so counters never collide across key types.
	let predicate: SQL | undefined;
	let insertValues: Partial<typeof rateLimits.$inferInsert>;
	if (scope && identifier) {
		predicate = and(eq(rateLimits.scope, scope), eq(rateLimits.identifier, identifier));
		insertValues = { scope, identifier };
	} else if (macAddress) {
		predicate = eq(rateLimits.macAddress, macAddress);
		insertValues = { macAddress };
	} else if (phoneNumber) {
		predicate = eq(rateLimits.phoneNumber, phoneNumber);
		insertValues = { phoneNumber };
	} else {
		throw new Error('consumeRateLimit: a key is required (mac, phone, or scope+identifier)');
	}

	return db.transaction(async (tx) => {
		const [row] = await tx.select().from(rateLimits).where(predicate).limit(1);

		// First ever attempt for this key.
		if (!row) {
			await tx.insert(rateLimits).values({ ...insertValues, attempts: 1, lastAttemptAt: now });
			return { allowed: true, remaining: max - 1, retryAt: null };
		}

		const windowExpired = now.getTime() - row.lastAttemptAt.getTime() >= windowMs;

		// Window lapsed → start a fresh window.
		if (windowExpired) {
			await tx
				.update(rateLimits)
				.set({ attempts: 1, lastAttemptAt: now })
				.where(eq(rateLimits.id, row.id));
			return { allowed: true, remaining: max - 1, retryAt: null };
		}

		// Within window but over the cap → block.
		if (row.attempts >= max) {
			return {
				allowed: false,
				remaining: 0,
				retryAt: new Date(row.lastAttemptAt.getTime() + windowMs)
			};
		}

		// Within window, under the cap → consume one.
		await tx
			.update(rateLimits)
			.set({ attempts: row.attempts + 1, lastAttemptAt: now })
			.where(eq(rateLimits.id, row.id));
		return { allowed: true, remaining: max - 1 - row.attempts, retryAt: null };
	});
}
