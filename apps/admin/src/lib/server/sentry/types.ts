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
	/** Per-issue event-count sparkline, newest bucket last. Daily buckets over 14 days. */
	trend14d: number[];
	/** Same, hourly buckets over the last 24h. Empty when the issue had no recent events
	 * (absent from the 24h top-list) — a correct flat line, not a failure. */
	trend24h: number[];
}

/** One stack frame of the latest event's exception. */
export interface SentryStackFrame {
	/** Source file the frame points at, e.g. "app/routes/users/+page.server.ts". */
	filename: string;
	/** Enclosing function/scope, when Sentry has it. */
	function: string;
	/** 1-based source line, or null when the frame carries none. */
	lineNo: number | null;
	/** True for frames Sentry marks as our own code (vs. framework/node_modules). */
	inApp: boolean;
}

/**
 * The latest event of an issue, narrowed to what the detail modal renders — the "which file /
 * which line / how & why" the summary list omits. Fetched on demand when a row is opened.
 */
export interface SentryEventDetail {
	id: string;
	/** Exception class, e.g. "TypeError" (the "how"). */
	type: string;
	/** Exception message / value (the "why"). */
	value: string;
	culprit: string;
	/** Stack frames in Sentry's native order — most recent call LAST. */
	frames: SentryStackFrame[];
	/** Selected event tags (environment, release, server_name, …). */
	tags: { key: string; value: string }[];
	/** ISO timestamp of when this event occurred. */
	dateCreated: string;
}

/** The mutable statuses an owner can set from the admin page. `unresolved` is the un-ignore target. */
export type IssueStatus = 'resolved' | 'ignored' | 'unresolved';

/** Which issue list a load fetches: the open feed or the dismissed (ignored) archive. */
export type IssueFilter = 'unresolved' | 'ignored';

/** Everything the /sentry page renders when Sentry is configured — assembled by the facade. */
export interface SentryDashboard {
	configured: true;
	kpis: Kpi[];
	issues: SentryIssue[];
	/** The ignored (dismissed) issues — the "Ignored" tab of the same table. */
	ignoredIssues: SentryIssue[];
	/** The public "Open in Sentry" project URL (PUBLIC_SENTRY_DASHBOARD_URL), or null. */
	dashboardUrl: string | null;
	/** True per section when its fetch failed and it was degraded to empty. */
	degraded: { issues: boolean; ignored: boolean };
}
