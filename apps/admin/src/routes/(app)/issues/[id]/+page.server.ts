import { error, fail } from '@sveltejs/kit';
import { MANAGER_ROLES, type StaffRole } from '@veent/core';
import { db } from '$lib/server/db';
import { requireManager } from '$lib/server/auth-guard';
import {
	getIssue,
	listIssueEvents,
	isAssignee,
	addComment,
	setIssueStatus,
	isIssueStatus
} from '$lib/server/issues';
import type { Actions, PageServerLoad } from './$types';

/**
 * Per-incident detail. Role-scoped in the LOAD, not the UI: a manager (owner / system_admin) may
 * open any incident; anyone else only one they're assigned to. Both the missing-id and the
 * unauthorized case return 404 (never 403) so the page can't be used to probe which ids exist.
 */
export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	const id = Number(event.params.id);
	if (!Number.isInteger(id) || id <= 0) throw error(404, 'Incident not found.');

	const canManage = MANAGER_ROLES.includes(user.role as StaffRole);
	const issue = await getIssue(db, id);
	if (!issue) throw error(404, 'Incident not found.');
	if (!canManage && !(await isAssignee(db, id, user.id))) throw error(404, 'Incident not found.');

	return { issue, events: await listIssueEvents(db, id), canManage, currentUserId: user.id };
};

export const actions: Actions = {
	/** Post a comment. Allowed for a manager OR a verified assignee of THIS incident (same
	 *  anti-IDOR gate as the status change on the board). */
	comment: async (event) => {
		const userId = event.locals.user?.id;
		const id = Number(event.params.id);
		if (!userId || !Number.isInteger(id) || id <= 0) return fail(400, { error: 'Invalid request.' });

		const notManager = await requireManager(userId, '');
		if (notManager && !(await isAssignee(db, id, userId))) {
			return fail(403, { error: 'You can only comment on incidents assigned to you.' });
		}

		const form = await event.request.formData();
		const body = String(form.get('body') ?? '').trim();
		if (!body) return fail(400, { error: 'Comment cannot be empty.' });
		if (body.length > 2000) return fail(400, { error: 'Comment is too long (2000 characters max).' });

		await addComment(db, id, userId, body);
		return { ok: true };
	},

	/** Change status. Same manager-OR-assignee-of-this-incident gate as `comment`. Resolving may
	 *  carry an optional resolution note; setIssueStatus records the change on the timeline. */
	updateStatus: async (event) => {
		const userId = event.locals.user?.id;
		const id = Number(event.params.id);
		if (!userId || !Number.isInteger(id) || id <= 0) return fail(400, { error: 'Invalid request.' });

		const notManager = await requireManager(userId, '');
		if (notManager && !(await isAssignee(db, id, userId))) {
			return fail(403, { error: 'You can only update incidents assigned to you.' });
		}

		const form = await event.request.formData();
		const status = String(form.get('status') ?? '');
		if (!isIssueStatus(status)) return fail(400, { error: 'Invalid status.' });

		const resolutionNote = String(form.get('resolutionNote') ?? '').trim() || null;
		await setIssueStatus(db, id, status, { resolutionNote, actorId: userId });
		return { ok: true };
	}
};
