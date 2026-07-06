import { eq } from 'drizzle-orm';
import { type DB, appSettings } from '@veent/db';
import {
	FREE_TIME_MINUTES,
	FREE_TIME_COOLDOWN_HOURS,
	MAX_DEVICES_PER_ACCOUNT,
	POINTS_EARN_RATE
} from '../config';

/**
 * Operator-tunable session limits, read from the `app_settings` singleton (admin Content
 * Management → Session Limits) with the @veent/core config constants as the fallback. So the
 * system always has sane values — even before the row exists or if the read fails.
 */
export interface SessionLimits {
	maxDevicesPerAccount: number;
	freeTimeMinutes: number;
	freeTimeCooldownHours: number;
	/** Loyalty-points earn rate, whole-number percent of each top-up (10 = 10%). */
	pointsEarnRate: number;
}

/** Compile-time defaults, also the fallback when the DB row/read is unavailable. */
export const DEFAULT_SESSION_LIMITS: SessionLimits = {
	maxDevicesPerAccount: MAX_DEVICES_PER_ACCOUNT,
	freeTimeMinutes: FREE_TIME_MINUTES,
	freeTimeCooldownHours: FREE_TIME_COOLDOWN_HOURS,
	pointsEarnRate: POINTS_EARN_RATE
};

// Short in-memory cache so the hot paths (every bind / free-time check) don't query per call.
// Settings change rarely; a few seconds of staleness is harmless. Per-process — each app
// instance refreshes within the TTL after an admin edit (no cross-process bust needed).
const CACHE_TTL_MS = 30_000;
let cache: { at: number; limits: SessionLimits } | null = null;

/** Current session limits (cached). Falls back to the constants on a missing row or DB error. */
export async function getSessionLimits(db: DB): Promise<SessionLimits> {
	const now = Date.now();
	if (cache && now - cache.at < CACHE_TTL_MS) return cache.limits;
	try {
		const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
		const limits: SessionLimits = row
			? {
					maxDevicesPerAccount: row.maxDevicesPerAccount,
					freeTimeMinutes: row.freeTimeMinutes,
					freeTimeCooldownHours: row.freeTimeCooldownHours,
					pointsEarnRate: row.pointsEarnRate
				}
			: DEFAULT_SESSION_LIMITS;
		cache = { at: now, limits };
		return limits;
	} catch {
		// Transient DB issue — last-known-good, else compile-time defaults. Never throw on a
		// settings read (it sits in front of grants/free-time and must not break them).
		return cache?.limits ?? DEFAULT_SESSION_LIMITS;
	}
}

/** Upsert the singleton settings row and bust this process's cache so the change is prompt. */
export async function updateSessionLimits(db: DB, input: SessionLimits): Promise<void> {
	const set = { ...input, updatedAt: new Date() };
	await db
		.insert(appSettings)
		.values({ id: 1, ...set })
		.onConflictDoUpdate({ target: appSettings.id, set });
	cache = null;
}
