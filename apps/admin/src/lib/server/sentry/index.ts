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
import type { IssueStatus, SentryDashboard, SentryEventDetail, SentryIssue } from './types';

/**
 * Facade over the Sentry transport + mappers — the ONLY Sentry module the route imports. It
 * orchestrates the fetches, degrades each section independently (one failure never blanks the
 * whole page), and hands back finished view models. No component or page-server touches the
 * client or mapper directly.
 */

export { isSentryConfigured, SENTRY_CREDENTIAL_KEYS };
export type { SentryDashboard, SentryEventDetail, SentryIssue } from './types';

const log = logger('sentry');

/** Assemble the whole dashboard. */
export async function getDashboard(): Promise<SentryDashboard> {
	const issues = await loadIssues();
	return {
		configured: true,
		kpis: deriveKpis(issues.data),
		issues: issues.data,
		dashboardUrl: pub.PUBLIC_SENTRY_DASHBOARD_URL || null,
		degraded: { issues: issues.degraded }
	};
}

/** Issues only — for the mobile /sentry/issues page. Same shape/loader as the dashboard's issues. */
export async function getIssues(): Promise<{
	configured: true;
	issues: SentryIssue[];
	degraded: { issues: boolean };
}> {
	const { data, degraded } = await loadIssues();
	return { configured: true, issues: data, degraded: { issues: degraded } };
}

/**
 * Load the unresolved issues with BOTH sparkline windows. The 14d list is primary — it drives the
 * table, counts and KPIs, and its failure degrades the section. The 24h list is best-effort: it's
 * harvested only for its per-issue sparkline and merged in by id (issues absent from the 24h
 * top-list keep an empty — correctly flat — 24h trend), so a 24h failure never blanks the table.
 */
async function loadIssues(): Promise<{ data: SentryIssue[]; degraded: boolean }> {
	const [primary, hourly] = await Promise.allSettled([fetchIssuesRaw('14d'), fetchIssuesRaw('24h')]);

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

async function setStatus(id: string, status: IssueStatus): Promise<void> {
	await putIssueStatus(id, status);
	invalidate(); // next load reflects the change instead of a 60s-stale list
}
