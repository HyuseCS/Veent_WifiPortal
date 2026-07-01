import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
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
	// Resolve the lookup predicate, the columns to stamp on a first-attempt insert, and the
	// matching unique-index target for the upsert. Each key type uses its own column pair, so
	// counters never collide across key types.
	let predicate: SQL | undefined;
	let insertValues: Partial<typeof rateLimits.$inferInsert>;
	let conflictTarget: PgColumn | PgColumn[];
	if (scope && identifier) {
		predicate = and(eq(rateLimits.scope, scope), eq(rateLimits.identifier, identifier));
		insertValues = { scope, identifier };
		conflictTarget = [rateLimits.scope, rateLimits.identifier];
	} else if (macAddress) {
		predicate = eq(rateLimits.macAddress, macAddress);
		insertValues = { macAddress };
		conflictTarget = rateLimits.macAddress;
	} else if (phoneNumber) {
		predicate = eq(rateLimits.phoneNumber, phoneNumber);
		insertValues = { phoneNumber };
		conflictTarget = rateLimits.phoneNumber;
	} else {
		throw new Error('consumeRateLimit: a key is required (mac, phone, or scope+identifier)');
	}

	return db.transaction(async (tx) => {
		// Ensure a counter row exists for this key BEFORE locking it. The per-key unique index
		// (migration 0026) makes this insert-if-absent race-safe: under a burst of concurrent
		// first attempts exactly one row is created and the rest no-op, instead of the old
		// SELECT-then-INSERT inserting several un-constrained duplicate rows. The placeholder
		// (0 attempts, epoch timestamp) reads as an expired window below, so the first real
		// attempt still starts the count at 1.
		await tx
			.insert(rateLimits)
			.values({ ...insertValues, attempts: 0, lastAttemptAt: new Date(0) })
			.onConflictDoNothing({ target: conflictTarget });

		// FOR UPDATE serializes concurrent consumers on this one row, so the check-then-increment
		// below is atomic — the old lost-update race (N requests all read `attempts`, all pass the
		// cap check, all write back) that let bursts bypass the limit is closed.
		const [row] = await tx.select().from(rateLimits).where(predicate).for('update').limit(1);

		const windowExpired = now.getTime() - row.lastAttemptAt.getTime() >= windowMs;

		// Window lapsed (or fresh placeholder) → start a new window at the first attempt.
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
