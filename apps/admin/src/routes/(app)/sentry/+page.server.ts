import { fail, type RequestEvent } from '@sveltejs/kit';
import { STAFF_STATUS } from '@veent/core';
import { db } from '$lib/server/db';
import { logger } from '$lib/server/logger';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { listStaff } from '$lib/server/queries';
import { createIssueFromSentry, isIssuePriority, type IssueInput } from '$lib/server/issues';
import { notifyAssignees } from '$lib/server/issueNotify';
import { getDashboard, ignoreIssue, isSentryConfigured, resolveIssue } from '$lib/server/sentry';
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

	/**
	 * Track a Sentry error as an assigned incident. Any signed-in active staff member may track (same
	 * auth model as resolve/ignore — locals.user presence IS the authorization). Snapshots the Sentry
	 * fields onto a source='sentry' incident and notifies the assignees — but does NOT change the
	 * error's status in Sentry, so it stays in the feed (dismissal via ?/ignore is separate).
	 */
	track: async (event) => {
		const userId = event.locals.user?.id;
		if (!userId) return fail(401, { action: 'track', error: 'Not signed in.' });

		const form = await event.request.formData();
		const sentryIssueId = String(form.get('sentryIssueId') ?? '').trim();
		const shortId = String(form.get('sentryShortId') ?? '').trim();
		const permalink = String(form.get('sentryPermalink') ?? '').trim();
		const sentryTitle = String(form.get('sentryTitle') ?? '').trim();
		if (!sentryIssueId) return fail(400, { action: 'track', error: 'Missing Sentry issue.' });

		const title = String(form.get('issue-title') ?? '').trim();
		if (!title) return fail(400, { action: 'track', error: 'Title is required.' });
		const description = String(form.get('issue-description') ?? '').trim() || null;

		const priority = String(form.get('issue-priority') ?? 'medium');
		if (!isIssuePriority(priority)) return fail(400, { action: 'track', error: 'Invalid priority.' });

		const rawDue = String(form.get('issue-dueDate') ?? '').trim();
		let dueDate: Date | null = null;
		if (rawDue) {
			// UTC midnight, matching the incident form parser (round-trips with toDateInput).
			const d = new Date(`${rawDue}T00:00:00Z`);
			if (Number.isNaN(d.getTime())) return fail(400, { action: 'track', error: 'Invalid due date.' });
			dueDate = d;
		}

		const assigneeIds = await validAssignees([
			...new Set(form.getAll('assigneeId').map((v) => String(v)).filter(Boolean))
		]);

		const input: IssueInput = { title, description, priority, networkId: null, dueDate, assigneeIds };
		const id = await createIssueFromSentry(
			db,
			{ issueId: sentryIssueId, shortId, permalink, title: sentryTitle },
			input,
			userId!
		);
		// Notify assignees (email + in-app), same as a manual incident. Post-commit, best-effort.
		await notifyAssignees(assigneeIds, event.locals.user!, { id, title }, event.url.origin);
		return { action: 'track', ok: true, id };
	}
};
