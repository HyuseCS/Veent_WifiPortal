/**
 * Period selector → date range. Shared by the Finance page load and its CSV export
 * endpoint so both interpret `?period=` identically.
 */
export type Period = '7d' | '30d' | '90d' | 'all';

const DAYS: Record<Exclude<Period, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

// The finance timestamp columns are now `timestamptz` (real instants) — the per-column migration
// corrected each column to store the true moment regardless of the writer's convention. So the
// boundaries here are REAL Manila-day instants: we take the Manila calendar day (via Intl, correct
// even when the app process runs in UTC while the DB session stays Manila), build its wall-clock
// boundary, then convert to the equivalent UTC instant. Manila has NO DST, so this is a fixed
// −8h offset (UTC+8) from the Manila wall-clock — no timezone table lookup needed.
const MANILA_TZ = 'Asia/Manila';
// Fixed Manila offset (UTC+8, no DST). A Manila wall-clock instant equals its UTC instant minus 8h.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

function manilaYmd(d: Date): { y: number; m: number; day: number } {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: MANILA_TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(d);
	const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
	return { y: get('year'), m: get('month'), day: get('day') };
}

export function parsePeriod(raw: string | null): { period: Period; from?: Date; to?: Date } {
	const period: Period = raw === '7d' || raw === '90d' || raw === 'all' ? raw : '30d';
	if (period === 'all') return { period };
	// Real Manila-day instants covering N WHOLE days (today + the prior N−1). Build the Manila
	// wall-clock boundary via Date.UTC(...), then subtract the fixed +8h Manila offset to get the
	// true UTC instant of that Manila moment. Day underflow (day − (N−1)) rolls months/years
	// correctly. Against timestamptz columns these compare as real instants, so money rows and
	// session/free-time rows (previously ~8h skewed) now window together.
	const { y, m, day } = manilaYmd(new Date());
	const to = new Date(Date.UTC(y, m - 1, day, 23, 59, 59, 999) - MANILA_OFFSET_MS);
	const from = new Date(
		Date.UTC(y, m - 1, day - (DAYS[period] - 1), 0, 0, 0, 0) - MANILA_OFFSET_MS
	);
	return { period, from, to };
}

/** Day granularity for short ranges, week for the 90-day view (fewer, readable bars). */
export function granularityFor(period: Period): 'day' | 'week' | 'month' {
	return period === '90d' || period === 'all' ? 'week' : 'day';
}
