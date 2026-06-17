import { eq } from 'drizzle-orm';
import { type DB, rateLimits } from '@veent/db';
import { GRACE_RATE_LIMIT_PER_HOUR } from '../config';

export interface RateLimitKey {
	macAddress?: string;
	phoneNumber?: string;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	/** When the window resets (only meaningful when blocked). */
	retryAt: Date | null;
}

/**
 * Sliding-window-ish counter keyed by device MAC or phone number. One row per
 * identifier: attempts reset once the window since the last attempt lapses.
 * Used to cap grace-period grants (default 3/hr) and OTP sends.
 *
 * Provide exactly one identifier per call (mac OR phone).
 */
export async function consumeRateLimit(
	db: DB,
	opts: { key: RateLimitKey; max?: number; windowMs?: number; now?: Date }
): Promise<RateLimitResult> {
	const max = opts.max ?? GRACE_RATE_LIMIT_PER_HOUR;
	const windowMs = opts.windowMs ?? 60 * 60 * 1000; // 1 hour
	const now = opts.now ?? new Date();

	const { macAddress, phoneNumber } = opts.key;
	if (!macAddress && !phoneNumber) throw new Error('consumeRateLimit: a key is required');
	const column = macAddress ? rateLimits.macAddress : rateLimits.phoneNumber;
	const value = (macAddress ?? phoneNumber) as string;

	return db.transaction(async (tx) => {
		const [row] = await tx.select().from(rateLimits).where(eq(column, value)).limit(1);

		// First ever attempt for this identifier.
		if (!row) {
			await tx.insert(rateLimits).values({ macAddress, phoneNumber, attempts: 1, lastAttemptAt: now });
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
