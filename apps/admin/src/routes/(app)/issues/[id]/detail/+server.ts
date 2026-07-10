import { error, json, type RequestEvent } from '@sveltejs/kit';
import { getAdminRole, ISSUE_STATUS, MANAGER_ROLES } from '@veent/core';
import { db } from '$lib/server/db';
import { getIssue, listIssueEvents, isAssignee } from '$lib/server/issues';
import type { RequestHandler } from './$types';

/**
 * Read-only { issue, events } for the assignee-side detail MODAL — same data the full
 * /issues/[id] page loads, fetched on demand so a card click doesn't navigate away. Endpoints
 * don't run the page load, so role is re-derived here (not trusted from the client).
 *
 * Authorization mirrors that page (manager OR assignee-of-this-issue), PLUS: a still-unclaimed
 * pool incident (zero assignees) is readable by any signed-in staff — listOpenPool() already
 * sends its full summary to everyone, so this adds no new secrecy boundary, only its timeline.
 * Missing/unauthorized both 404 (never 403), so the endpoint can't be used to probe which ids exist.
 */
export const GET: RequestHandler = async (event: RequestEvent) => {
	const userId = event.locals.user?.id;
	if (!userId) throw error(401, 'Not signed in.');

	const id = Number(event.params.id);
	if (!Number.isInteger(id) || id <= 0) throw error(404, 'Incident not found.');

	const issue = await getIssue(db, id);
	if (!issue) throw error(404, 'Incident not found.');

	const role = await getAdminRole(db, userId);
	const canManage = !!role && MANAGER_ROLES.includes(role);
	// Parity with listOpenPool() = OPEN *and* unassigned. A resolved/in-progress incident whose
	// assignees were later removed must NOT fall back into the shared pool audience (M3).
	const isPoolItem = issue.assignees.length === 0 && issue.status === ISSUE_STATUS.open;
	if (!canManage && !isPoolItem && !(await isAssignee(db, id, userId))) {
		throw error(404, 'Incident not found.');
	}

	return json(
		{ issue, events: await listIssueEvents(db, id) },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
