import { FREE_TIME_COOLDOWN_HOURS, FREE_TIME_MINUTES } from '../config';

export interface FreeTimeStatus {
	eligible: boolean;
	/** Minutes granted when a free session starts. */
	durationMinutes: number;
	/** When the user becomes eligible again (null if eligible now). */
	nextEligibleAt: Date | null;
}

/**
 * Free Time rule: 15 min per 12-hour cooldown window. Pure function so it's
 * trivially testable and usable in both load() and actions.
 */
export function getFreeTimeStatus(
	lastFreeSessionAt: Date | null | undefined,
	now: Date = new Date(),
	// Operator-tunable (admin Session Limits); defaults to the config constants so existing
	// callers and tests keep working without passing limits.
	limits: { freeTimeMinutes: number; freeTimeCooldownHours: number } = {
		freeTimeMinutes: FREE_TIME_MINUTES,
		freeTimeCooldownHours: FREE_TIME_COOLDOWN_HOURS
	}
): FreeTimeStatus {
	if (!lastFreeSessionAt) {
		return { eligible: true, durationMinutes: limits.freeTimeMinutes, nextEligibleAt: null };
	}
	const nextEligibleAt = new Date(
		lastFreeSessionAt.getTime() + limits.freeTimeCooldownHours * 60 * 60 * 1000
	);
	const eligible = now >= nextEligibleAt;
	return {
		eligible,
		durationMinutes: limits.freeTimeMinutes,
		nextEligibleAt: eligible ? null : nextEligibleAt
	};
}
