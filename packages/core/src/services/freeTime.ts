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
	now: Date = new Date()
): FreeTimeStatus {
	if (!lastFreeSessionAt) {
		return { eligible: true, durationMinutes: FREE_TIME_MINUTES, nextEligibleAt: null };
	}
	const nextEligibleAt = new Date(
		lastFreeSessionAt.getTime() + FREE_TIME_COOLDOWN_HOURS * 60 * 60 * 1000
	);
	const eligible = now >= nextEligibleAt;
	return {
		eligible,
		durationMinutes: FREE_TIME_MINUTES,
		nextEligibleAt: eligible ? null : nextEligibleAt
	};
}
