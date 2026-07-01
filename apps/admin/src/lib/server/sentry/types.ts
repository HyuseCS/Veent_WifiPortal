import type { Kpi } from '$lib/types';

/**
 * The narrowed view models the /sentry page consumes. Nothing downstream (route, components)
 * ever sees a raw Sentry API payload — the client fetches it, the mapper narrows it to these
 * shapes, and this file is the single source of shape truth shared across all Sentry modules.
 */

/** A Sentry issue, narrowed to what the dashboard renders. */
export interface SentryIssue {
	id: string;
	/** Human short id, e.g. "RADIUS-ADMIN-3F". */
	shortId: string;
	title: string;
	culprit: string;
	/** Sentry level: error | warning | info | fatal | … (kept as a string; the UI tones the known ones). */
	level: string;
	/** Total events in the issue (Sentry returns this as a numeric string). */
	count: number;
	/** Distinct users affected. */
	userCount: number;
	/** ISO timestamp of the most recent event. */
	lastSeen: string;
	status: string;
	/** Deep-link into sentry.io for this single issue. */
	permalink: string;
}

/** One bucket of the error-volume trend (one interval of the stats series). */
export interface SentryVolumePoint {
	label: string;
	count: number;
}

/** The mutable statuses an owner can set from the admin page. */
export type IssueStatus = 'resolved' | 'ignored';

/** Everything the /sentry page renders when Sentry is configured — assembled by the facade. */
export interface SentryDashboard {
	configured: true;
	kpis: Kpi[];
	issues: SentryIssue[];
	volume: SentryVolumePoint[];
	/** The public "Open in Sentry" project URL (PUBLIC_SENTRY_DASHBOARD_URL), or null. */
	dashboardUrl: string | null;
	/** True per section when its fetch failed and it was degraded to empty. */
	degraded: { issues: boolean; volume: boolean };
}
