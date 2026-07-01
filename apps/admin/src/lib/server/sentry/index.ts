import { env as pub } from '$env/dynamic/public';
import { logger } from '$lib/server/logger';
import {
	fetchIssuesRaw,
	fetchLatestEventRaw,
	fetchStatsRaw,
	invalidate,
	isSentryConfigured,
	putIssueStatus
} from './client';
import { deriveKpis, mapEventDetail, mapIssue, mapVolume } from './map';
import type {
	IssueStatus,
	SentryDashboard,
	SentryEventDetail,
	SentryIssue,
	SentryVolumePoint
} from './types';

/**
 * Facade over the Sentry transport + mappers — the ONLY Sentry module the route imports. It
 * orchestrates the fetches, degrades each section independently (one failure never blanks the
 * whole page), and hands back finished view models. No component or page-server touches the
 * client or mapper directly.
 */

export { isSentryConfigured };
export type { SentryDashboard, SentryEventDetail, SentryIssue } from './types';

const log = logger('sentry');

/** Assemble the whole dashboard. Issues + stats load in parallel; each degrades on its own. */
export async function getDashboard(): Promise<SentryDashboard> {
	const [issues, volume] = await Promise.all([loadIssues(), loadVolume()]);
	return {
		configured: true,
		kpis: deriveKpis(issues.data, volume.data),
		issues: issues.data,
		volume: volume.data,
		dashboardUrl: pub.PUBLIC_SENTRY_DASHBOARD_URL || null,
		degraded: { issues: issues.degraded, volume: volume.degraded }
	};
}

async function loadIssues(): Promise<{ data: SentryIssue[]; degraded: boolean }> {
	try {
		const raw = await fetchIssuesRaw();
		const list = Array.isArray(raw) ? raw : [];
		return { data: list.map(mapIssue), degraded: false };
	} catch (err) {
		log.error('issues fetch failed', err);
		return { data: [], degraded: true };
	}
}

async function loadVolume(): Promise<{ data: SentryVolumePoint[]; degraded: boolean }> {
	try {
		return { data: mapVolume(await fetchStatsRaw()), degraded: false };
	} catch (err) {
		log.error('stats fetch failed', err);
		return { data: [], degraded: true };
	}
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
