import type { Kpi } from '$lib/types';
import type { SentryEventDetail, SentryIssue } from './types';

/**
 * Pure raw-JSON → view-model functions. No fetch, no env, no I/O — so this is the one place
 * Sentry's payload quirks (numeric-string counts, outcome-grouped stats series) are absorbed,
 * and it's trivially unit-testable (see map.test.ts).
 */

function str(v: unknown): string {
	return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Sentry returns count/userCount as either a number or a numeric string — coerce, never NaN. */
function num(v: unknown): number {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
	return Number.isFinite(n) ? n : 0;
}

/**
 * Extract one sparkline series from an issue's `stats` field. Sentry shapes it as
 * `{ "14d": [[unixSeconds, count], …] }` keyed by the requested statsPeriod; we keep only the
 * counts (newest last). A missing period or ragged/garbled payload degrades to [] — a flat line,
 * never a throw. Each call fetches ONE period, so an issue carries at most one populated key.
 */
export function mapTrend(stats: unknown, period: '24h' | '14d'): number[] {
	const series = (stats as Record<string, unknown> | null)?.[period];
	if (!Array.isArray(series)) return [];
	return series.map((bucket) => num(Array.isArray(bucket) ? bucket[1] : undefined));
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
		permalink: str(r.permalink),
		// Populated per-fetch: the 14d list fills trend14d, the 24h list fills trend24h. The
		// facade merges the 24h series onto the primary (14d) issues by id.
		trend14d: mapTrend(r.stats, '14d'),
		trend24h: mapTrend(r.stats, '24h')
	};
}

interface RawFrame {
	filename?: string;
	function?: string;
	lineNo?: number | null;
	inApp?: boolean;
}
interface RawException {
	type?: string;
	value?: string;
	stacktrace?: { frames?: RawFrame[] };
}
interface RawEvent {
	id?: string;
	culprit?: string;
	dateCreated?: string;
	entries?: { type?: string; data?: { values?: RawException[] } }[];
	tags?: { key?: string; value?: string }[];
	metadata?: { type?: string; value?: string };
}

/**
 * Narrow the raw "latest event" payload to the detail view model. Sentry nests the exception under
 * entries[type=exception].data.values — the last value is the raised exception (earlier ones are
 * its causes). Frames keep Sentry's native order (most recent call last). Missing pieces degrade to
 * empty; metadata is the fallback for type/value when the exception entry is absent.
 */
export function mapEventDetail(raw: unknown): SentryEventDetail {
	const r = (raw ?? {}) as RawEvent;
	const values = r.entries?.find((e) => e.type === 'exception')?.data?.values ?? [];
	const exc = values[values.length - 1] ?? {};
	const frames = (exc.stacktrace?.frames ?? []).map((f) => ({
		filename: str(f.filename),
		function: str(f.function),
		lineNo: typeof f.lineNo === 'number' ? f.lineNo : null,
		inApp: Boolean(f.inApp)
	}));
	const tags = (r.tags ?? [])
		.map((t) => ({ key: str(t.key), value: str(t.value) }))
		.filter((t) => t.key);
	return {
		id: str(r.id),
		type: str(exc.type) || str(r.metadata?.type),
		value: str(exc.value) || str(r.metadata?.value),
		culprit: str(r.culprit),
		frames,
		tags,
		dateCreated: str(r.dateCreated)
	};
}

/** Headline metrics derived from the already-mapped issues. */
export function deriveKpis(issues: SentryIssue[]): Kpi[] {
	// Issues are capped at 25 by the query, so ">= 25" is reported honestly as "25+".
	const openIssues = issues.length >= 25 ? '25+' : String(issues.length);
	// Sum the 14d sparkline buckets across open issues — the same series the rows render, so the
	// KPI and the trends can never disagree. Scoped to open issues (not all-time, not resolved).
	const events14d = issues.reduce((sum, i) => sum + i.trend14d.reduce((a, b) => a + b, 0), 0);
	const usersAffected = issues.reduce((sum, i) => sum + i.userCount, 0);
	return [
		{ label: 'Open issues', value: openIssues },
		{ label: 'Events (14d)', value: events14d.toLocaleString('en-US') },
		{ label: 'Users affected', value: usersAffected.toLocaleString('en-US') }
	];
}
