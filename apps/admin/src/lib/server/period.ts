/**
 * Period selector → date range. Shared by the Finance page load and its CSV export
 * endpoint so both interpret `?period=` identically.
 */
export type Period = '7d' | '30d' | '90d' | 'all';

const DAYS: Record<Exclude<Period, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

export function parsePeriod(raw: string | null): { period: Period; from?: Date; to?: Date } {
	const period: Period = raw === '7d' || raw === '90d' || raw === 'all' ? raw : '30d';
	if (period === 'all') return { period };
	const to = new Date();
	// Snap `from` to the START of the day N−1 days back, so the range covers N WHOLE calendar
	// days (today + the prior N−1) instead of a rolling-ms window. A rolling window starts
	// mid-day, leaving the first/last date_trunc buckets partial and under-reported.
	const from = new Date(to);
	from.setDate(from.getDate() - (DAYS[period] - 1));
	from.setHours(0, 0, 0, 0);
	return { period, from, to };
}

/** Day granularity for short ranges, week for the 90-day view (fewer, readable bars). */
export function granularityFor(period: Period): 'day' | 'week' | 'month' {
	return period === '90d' || period === 'all' ? 'week' : 'day';
}
