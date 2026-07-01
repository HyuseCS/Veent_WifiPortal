import type { Kpi } from '$lib/types';
import type { SentryIssue, SentryVolumePoint } from './types';

/**
 * Pure raw-JSON → view-model functions. No fetch, no env, no I/O — so this is the one place
 * Sentry's payload quirks (numeric-string counts, outcome-grouped stats series) are absorbed,
 * and it's trivially unit-testable (see map.test.ts).
 */

const STATS_FIELD = 'sum(times_seen)';

function str(v: unknown): string {
	return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Sentry returns count/userCount as either a number or a numeric string — coerce, never NaN. */
function num(v: unknown): number {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
	return Number.isFinite(n) ? n : 0;
}

/** Narrow one raw Sentry issue to the view model. Unknown/garbled fields degrade to empty/0. */
export function mapIssue(raw: unknown): SentryIssue {
	const r = (raw ?? {}) as Record<string, unknown>;
	return {
		id: str(r.id),
		shortId: str(r.shortId),
		title: str(r.title),
		culprit: str(r.culprit),
		level: str(r.level) || 'error',
		count: num(r.count),
		userCount: num(r.userCount),
		lastSeen: str(r.lastSeen),
		status: str(r.status),
		permalink: str(r.permalink)
	};
}

interface StatsGroup {
	by?: { outcome?: string };
	series?: Record<string, number[]>;
}
interface StatsResponse {
	intervals?: string[];
	groups?: StatsGroup[];
}

/** Compact, timezone-stable day label ("Jul 1") so SSR/client and tests agree regardless of TZ. */
function fmtDay(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/**
 * Turn the stats_v2 outcome-grouped response into a single per-interval series: the `accepted`
 * group (events Sentry actually ingested). Aligns each interval to its series value; a missing
 * accepted group or ragged series degrades to zeros, never throws.
 */
export function mapVolume(raw: unknown): SentryVolumePoint[] {
	const r = (raw ?? {}) as StatsResponse;
	const intervals = r.intervals ?? [];
	const accepted = r.groups?.find((g) => g.by?.outcome === 'accepted');
	const series = accepted?.series?.[STATS_FIELD] ?? [];
	return intervals.map((iso, i) => ({ label: fmtDay(iso), count: num(series[i]) }));
}

/** Headline metrics derived from the already-mapped issues + volume. */
export function deriveKpis(issues: SentryIssue[], volume: SentryVolumePoint[]): Kpi[] {
	// Issues are capped at 25 by the query, so ">= 25" is reported honestly as "25+".
	const openIssues = issues.length >= 25 ? '25+' : String(issues.length);
	const events14d = volume.reduce((sum, p) => sum + p.count, 0);
	const usersAffected = issues.reduce((sum, i) => sum + i.userCount, 0);
	return [
		{ label: 'Open issues', value: openIssues },
		{ label: 'Events (14d)', value: events14d.toLocaleString('en-US') },
		{ label: 'Users affected', value: usersAffected.toLocaleString('en-US') }
	];
}
