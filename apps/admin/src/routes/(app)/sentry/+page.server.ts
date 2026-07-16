import { fail, type RequestEvent } from '@sveltejs/kit';
import { STAFF_STATUS } from '@veent/core';
import { db } from '$lib/server/db';
import { logger } from '$lib/server/logger';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { listStaff } from '$lib/server/queries';
import { createIssueFromSentry, isIssuePriority, type IssueInput } from '$lib/server/issues';
import { notifyAssignees } from '$lib/server/issueNotify';
import {
	getDashboard,
	ignoreIssue,
	isSentryConfigured,
	resolveIssue,
	restoreIssue
} from '$lib/server/sentry';
import { validateSentrySnapshot } from '$lib/server/sentry/map';
import { parseDueDate } from '$lib/server/formValidation';
import type { Actions, PageServerLoad } from './$types';

const log = logger('sentry');

/**
 * The staff a viewer can assign when tracking a Sentry error as an incident. Any signed-in staff
 * member who can reach the Sentry page may track (same auth model as resolve/ignore), so this is
 * always loaded. Shared by the dashboard load AND the mobile /sentry/issues load.
 */
export async function _trackContext() {
	const assignableStaff = (await listStaff(db))
		.filter((s) => s.status === STAFF_STATUS.active)
		.map((s) => ({ id: s.id, name: s.name, roleLabel: s.roleLabel }));
	return { assignableStaff };
}

/** Delegate to the facade for the dashboard; layer on the track-form context. Unconfigured → an
 *  EmptyState on the page, never a 500. */
export const load: PageServerLoad = async () => {
	const ctx = await _trackContext();
	if (!isSentryConfigured()) return { configured: false as const, ...ctx };
	return { ...(await getDashboard()), ...ctx };
};

/** Shared staff-auth + rate-limit + id-parse guard for both mutations; runs the given Sentry call. */
async function mutate(event: RequestEvent, action: string, run: (id: string) => Promise<void>) {
	// Any signed-in active staff member may triage issues. hooks.server.ts only populates
	// locals.user for ACTIVE staff (loads don't run on POST, so we re-check here), so its presence
	// IS the authorization — a disabled or unauthenticated request has no user and is refused.
	if (!event.locals.user?.id) return fail(401, { action, error: 'Not signed in.' });
	if (!isSentryConfigured()) return fail(503, { action, error: 'Sentry API not configured.' });

	const rl = await rateLimit('admin_sentry_mutate', clientIp(event), 30, 15 * 60 * 1000);
	if (!rl.allowed) return fail(429, { action, error: 'Too many attempts. Please wait a few minutes.' });

	const id = String((await event.request.formData()).get('id') ?? '').trim();
	if (!id) return fail(400, { action, error: 'Missing issue id.' });

	try {
		await run(id);
		return { action, ok: true };
	} catch (err) {
		log.error(`${action} failed`, err);
		return fail(502, { action, error: 'Sentry request failed. Try again.' });
	}
}

/** Keep only ids that are currently ACTIVE staff — never trust the posted assignee list. */
async function validAssignees(ids: string[]): Promise<string[]> {
	if (ids.length === 0) return [];
	const active = new Set(
		(await listStaff(db)).filter((s) => s.status === STAFF_STATUS.active).map((s) => s.id)
	);
	return ids.filter((id) => active.has(id));
}

export const actions: Actions = {
	resolve: (event) => mutate(event, 'resolve', resolveIssue),
	ignore: (event) => mutate(event, 'ignore', ignoreIssue),
	restore: (event) => mutate(event, 'restore', restoreIssue),

	/**
	 * Track a Sentry error as an assigned incident. Any signed-in active staff member may track (same
	 * auth model as resolve/ignore — locals.user presence IS the authorization). Snapshots the Sentry
	 * fields onto a source='sentry' incident and notifies the assignees — but does NOT change the
	 * error's status in Sentry, so it stays in the feed (dismissal via ?/ignore is separate).
	 */
	track: async (event) => {
		const userId = event.locals.user?.id;
		if (!userId) return fail(401, { action: 'track', error: 'Not signed in.' });

		// Same throttle as resolve/ignore — track creates an incident + fires notifications, so it
		// needs the same abuse ceiling. Keyed per signed-in user (30 tracks / 15 min).
		const rl = await rateLimit('admin_sentry_track', userId, 30, 15 * 60 * 1000);
		if (!rl.allowed) return fail(429, { action: 'track', error: 'Too many attempts. Please wait a few minutes.' });

		const form = await event.request.formData();
		const sentryIssueId = String(form.get('sentryIssueId') ?? '').trim();
		if (!sentryIssueId) return fail(400, { action: 'track', error: 'Missing Sentry issue.' });

		// The snapshot fields are client-supplied hidden inputs; the permalink is later rendered as
		// an href. Reject non-https permalinks / malformed ids / oversized titles loudly — the legit
		// UI always posts an https permalink straight from the Sentry API (H1: stored-XSS guard).
		const snapshot = validateSentrySnapshot({
			issueId: sentryIssueId,
			shortId: String(form.get('sentryShortId') ?? ''),
			permalink: String(form.get('sentryPermalink') ?? ''),
			title: String(form.get('sentryTitle') ?? '')
		});
		if (!snapshot) return fail(400, { action: 'track', error: 'Invalid Sentry permalink.' });
		const { shortId, permalink, title: sentryTitle } = snapshot;

		const title = String(form.get('issue-title') ?? '').trim();
		if (!title) return fail(400, { action: 'track', error: 'Title is required.' });
		const description = String(form.get('issue-description') ?? '').trim() || null;

		const priority = String(form.get('issue-priority') ?? 'medium');
		if (!isIssuePriority(priority)) return fail(400, { action: 'track', error: 'Invalid priority.' });

		// Same due-date rules as the incident form (UTC midnight + past-date rejection) — previously
		// track NaN-checked only and silently accepted past dates (M4a).
		const due = parseDueDate(String(form.get('issue-dueDate') ?? ''));
		if ('error' in due) return fail(400, { action: 'track', error: due.error });
		const dueDate = due.dueDate;

		const assigneeIds = await validAssignees([
			...new Set(form.getAll('assigneeId').map((v) => String(v)).filter(Boolean))
		]);

		const input: IssueInput = { title, description, priority, networkId: null, dueDate, assigneeIds };
		let id: number;
		try {
			id = await createIssueFromSentry(
				db,
				{ issueId: sentryIssueId, shortId, permalink, title: sentryTitle },
				input,
				userId!
			);
		} catch (err) {
			// The partial unique index on sentry_issue_id (source='sentry') is the race-safe guard
			// against duplicate incidents — a 23505 here means this error is already tracked.
			if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
				return fail(409, { action: 'track', error: 'This Sentry issue is already tracked as an incident.' });
			}
			throw err;
		}
		// Notify assignees (email + in-app), same as a manual incident. Post-commit, best-effort,
		// fire-and-forget so the serial sends don't delay the response (never throws) — L2.
		void notifyAssignees(assigneeIds, event.locals.user!, { id, title }, event.url.origin);
		return { action: 'track', ok: true, id };
	}
};
