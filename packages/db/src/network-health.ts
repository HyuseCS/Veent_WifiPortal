/**
 * B3.5 — read-side staleness for `network_health`.
 *
 * The write path (`refreshNetworkHealth`) only touches `last_sample_at` when a live sample
 * actually lands; when the router reports no hotspot interfaces the sample is empty and nothing
 * is written, so the row keeps its last-known `online` value forever. Rather than change the
 * (deliberately conservative) write path, both readers derive staleness here: a row whose last
 * successful sample is older than the ceiling is shown stale/offline instead of a confidently
 * wrong "Healthy".
 *
 * The refresh endpoint is cron-driven at ~1/min (see the admin health-refresh route's example
 * crontab), so 3 missed cycles ≈ the data is no longer trustworthy.
 * ponytail: 3× the 1-min refresh cron; widen if the cron cadence changes.
 *
 * Shared by admin (`listNetworkHealth`) and the public locator (`listPublicLocations`) — the one
 * definition keeps the two surfaces from disagreeing about whether an AP is live.
 */
export const NETWORK_HEALTH_STALE_MS = 3 * 60_000;

/** True when a health row's last successful sample is older than the stale ceiling (or absent). */
export function isNetworkHealthStale(
	lastSampleAt: Date | null | undefined,
	now: Date = new Date()
): boolean {
	if (!lastSampleAt) return true;
	return now.getTime() - lastSampleAt.getTime() > NETWORK_HEALTH_STALE_MS;
}
