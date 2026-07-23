/**
 * Period selector → date range. Shared by the Finance page load and its CSV export
 * endpoint so both interpret `?period=` identically.
 */
export type Period = '7d' | '30d' | '90d' | 'all';

const DAYS: Record<Exclude<Period, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

// The finance timestamp columns are `timestamp WITHOUT time zone`. The money sources
// (payment_transactions, credit_ledger, points_ledger) are written by `defaultNow()` under a
// Manila DB session, so they store Manila WALL-CLOCK. postgres.js binds a JS Date boundary as its
// UTC value against those bare columns, so to compare apples-to-apples the boundary Date's UTC
// wall-clock must SPELL the intended Manila day boundary — built below via Date.UTC on the Manila
// calendar day (extracted with Intl, so this is correct even when the app process runs in UTC,
// e.g. a prod container, while the DB session stays Manila).
//
// ponytail: known gap — network_sessions.startedAt is written with a JS Date (UTC wall-clock),
// not defaultNow(), so free-time/session rows are skewed ~8h from the money rows and this boundary
// can't be right for both. The real fix is migrating these columns to timestamptz (billing-path
// schema change, tracked separately); this function is correct for the revenue sources.
const MANILA_TZ = 'Asia/Manila';

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
	// Manila calendar boundaries covering N WHOLE days (today + the prior N−1). Date.UTC is used so
	// each boundary's toISOString() (what postgres.js sends) spells the Manila wall-clock instant;
	// day underflow (day − (N−1)) rolls months/years correctly.
	const { y, m, day } = manilaYmd(new Date());
	const to = new Date(Date.UTC(y, m - 1, day, 23, 59, 59, 999));
	const from = new Date(Date.UTC(y, m - 1, day - (DAYS[period] - 1), 0, 0, 0, 0));
	return { period, from, to };
}

/** Day granularity for short ranges, week for the 90-day view (fewer, readable bars). */
export function granularityFor(period: Period): 'day' | 'week' | 'month' {
	return period === '90d' || period === 'all' ? 'week' : 'day';
}
