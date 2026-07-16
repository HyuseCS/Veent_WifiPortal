import { env as pub } from '$env/dynamic/public';
import { logger } from '$lib/server/logger';
import {
	fetchIssuesRaw,
	fetchLatestEventRaw,
	invalidate,
	isSentryConfigured,
	putIssueStatus,
	SENTRY_CREDENTIAL_KEYS
} from './client';
import { deriveKpis, mapEventDetail, mapIssue, mapTrend } from './map';
import type { IssueFilter, IssueStatus, SentryDashboard, SentryEventDetail, SentryIssue } from './types';

/**
 * Facade over the Sentry transport + mappers — the ONLY Sentry module the route imports. It
 * orchestrates the fetches, degrades each section independently (one failure never blanks the
 * whole page), and hands back finished view models. No component or page-server touches the
 * client or mapper directly.
 */

export { isSentryConfigured, SENTRY_CREDENTIAL_KEYS };
export type { SentryDashboard, SentryEventDetail, SentryIssue } from './types';

const log = logger('sentry');

/** Assemble the whole dashboard. Unresolved drives the KPIs; ignored fills the second tab. */
export async function getDashboard(): Promise<SentryDashboard> {
	const [unresolved, ignored] = await Promise.all([loadIssues('unresolved'), loadIssues('ignored')]);
	return {
		configured: true,
		kpis: deriveKpis(unresolved.data),
		issues: unresolved.data,
		ignoredIssues: ignored.data,
		dashboardUrl: pub.PUBLIC_SENTRY_DASHBOARD_URL || null,
		degraded: { issues: unresolved.degraded, ignored: ignored.degraded }
	};
}

/** Issues only — for the mobile /sentry/issues page. Same shape/loader as the dashboard's issues. */
export async function getIssues(): Promise<{
	configured: true;
	issues: SentryIssue[];
	ignoredIssues: SentryIssue[];
	degraded: { issues: boolean; ignored: boolean };
}> {
	const [unresolved, ignored] = await Promise.all([loadIssues('unresolved'), loadIssues('ignored')]);
	return {
		configured: true,
		issues: unresolved.data,
		ignoredIssues: ignored.data,
		degraded: { issues: unresolved.degraded, ignored: ignored.degraded }
	};
}

/**
 * Load one status's issues with BOTH sparkline windows. The 14d list is primary — it drives the
 * table and counts, and its failure degrades the section. The 24h list is best-effort: it's
 * harvested only for its per-issue sparkline and merged in by id (issues absent from the 24h
 * top-list keep an empty — correctly flat — 24h trend), so a 24h failure never blanks the table.
 */
async function loadIssues(status: IssueFilter): Promise<{ data: SentryIssue[]; degraded: boolean }> {
	const [primary, hourly] = await Promise.allSettled([
		fetchIssuesRaw(status, '14d'),
		fetchIssuesRaw(status, '24h')
	]);

	if (primary.status === 'rejected') {
		log.error('issues fetch failed', primary.reason);
		return { data: [], degraded: true };
	}

	const data = (Array.isArray(primary.value) ? primary.value : []).map(mapIssue);

	if (hourly.status === 'fulfilled') {
		const by24h = new Map<string, number[]>();
		for (const raw of Array.isArray(hourly.value) ? hourly.value : []) {
			const r = (raw ?? {}) as Record<string, unknown>;
			const id = typeof r.id === 'string' ? r.id : String(r.id ?? '');
			if (id) by24h.set(id, mapTrend(r.stats, '24h'));
		}
		for (const issue of data) issue.trend24h = by24h.get(issue.id) ?? [];
	} else {
		log.error('24h sparkline fetch failed (non-fatal)', hourly.reason);
	}

	return { data, degraded: false };
}

/** The latest event's detail for one issue — exception + stacktrace for the row-open modal. */
export async function getIssueEvent(id: string): Promise<SentryEventDetail> {
	return mapEventDetail(await fetchLatestEventRaw(id));
}

export const resolveIssue = (id: string) => setStatus(id, 'resolved');
export const ignoreIssue = (id: string) => setStatus(id, 'ignored');
/** Un-ignore: put a dismissed issue back into the open feed. */
export const restoreIssue = (id: string) => setStatus(id, 'unresolved');

async function setStatus(id: string, status: IssueStatus): Promise<void> {
	await putIssueStatus(id, status);
	invalidate(); // next load reflects the change instead of a 60s-stale list
}
