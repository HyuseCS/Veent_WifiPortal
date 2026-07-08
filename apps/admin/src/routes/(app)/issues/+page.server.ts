import { fail } from '@sveltejs/kit';
import { MANAGER_ROLES, STAFF_STATUS, type StaffRole } from '@veent/core';
import { db } from '$lib/server/db';
import { requireManager } from '$lib/server/auth-guard';
import { listStaff, listNetworkHealth } from '$lib/server/queries';
import {
	listIssues,
	listIssuesForAssignee,
	listIssueEventsByIssue,
	isAssignee,
	createIssue,
	updateIssue,
	setIssueStatus,
	deleteIssue,
	isIssuePriority,
	isIssueStatus,
	type IssueInput
} from '$lib/server/issues';
import { markAllNotificationsRead, markNotificationRead } from '$lib/server/notifications';
import { notifyAssignees } from '$lib/server/issueNotify';
import type { Actions, PageServerLoad } from './$types';

/**
 * Role-aware load. Managers (owner / system_admin) get the full board plus the pickers
 * (active staff to assign, APs to link). Everyone else gets ONLY the issues assigned to
 * them — the read is scoped in the query, not just hidden in the UI. Access is enforced
 * here (and per-action below), never in the nav.
 */
export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	const canManage = MANAGER_ROLES.includes(user.role as StaffRole);

	if (canManage) {
		const [issues, staff, networks] = await Promise.all([
			listIssues(db),
			listStaff(db),
			listNetworkHealth(db)
		]);
		return {
			canManage,
			currentUserId: user.id,
			issues,
			// Timelines for the expanded-row preview, grouped by issue (one query, no N+1).
			events: await listIssueEventsByIssue(db, issues.map((i) => i.id)),
			assignableStaff: staff
				.filter((s) => s.status === STAFF_STATUS.active)
				.map((s) => ({ id: s.id, name: s.name, roleLabel: s.roleLabel })),
			networks: networks.map((n) => ({ id: n.id, name: n.name }))
		};
	}

	return {
		canManage,
		currentUserId: user.id,
		issues: await listIssuesForAssignee(db, user.id),
		events: {} as Record<number, import('$lib/server/issues').IssueEventRow[]>,
		assignableStaff: [] as { id: string; name: string; roleLabel: string }[],
		networks: [] as { id: string; name: string }[]
	};
};

const manage = (userId: string | undefined) =>
	requireManager(userId, 'You do not have permission to manage issues.');

function issueId(form: FormData): number | null {
	const id = Number(form.get('id'));
	return Number.isInteger(id) && id > 0 ? id : null;
}

function parseIssueInput(form: FormData): { input: IssueInput } | { error: string } {
	const title = String(form.get('issue-title') ?? '').trim();
	if (!title) return { error: 'Title is required.' };
	const description = String(form.get('issue-description') ?? '').trim() || null;

	const priority = String(form.get('issue-priority') ?? 'medium');
	if (!isIssuePriority(priority)) return { error: 'Invalid priority.' };

	const rawNetwork = String(form.get('issue-networkId') ?? '').trim();
	let networkId: number | null = null;
	if (rawNetwork) {
		const n = Number(rawNetwork);
		if (!Number.isInteger(n) || n <= 0) return { error: 'Invalid access point.' };
		networkId = n;
	}

	const rawDue = String(form.get('issue-dueDate') ?? '').trim();
	let dueDate: Date | null = null;
	if (rawDue) {
		// Parse as UTC midnight so it round-trips with issues.ts toDateInput() (which reads back
		// via toISOString/UTC) — a local parse would drift the date by a day in non-UTC zones.
		const d = new Date(`${rawDue}T00:00:00Z`);
		if (Number.isNaN(d.getTime())) return { error: 'Invalid due date.' };
		dueDate = d;
	}

	const assigneeIds = [...new Set(form.getAll('assigneeId').map((v) => String(v)).filter(Boolean))];
	return { input: { title, description, priority, networkId, dueDate, assigneeIds } };
}

/** Keep only ids that are currently ACTIVE staff — never trust the posted assignee list
 *  (guards against assigning to inactive/removed users, which would also break the FK). */
async function validAssignees(ids: string[]): Promise<string[]> {
	if (ids.length === 0) return [];
	const active = new Set(
		(await listStaff(db)).filter((s) => s.status === STAFF_STATUS.active).map((s) => s.id)
	);
	return ids.filter((id) => active.has(id));
}

export const actions: Actions = {
	create: async (event) => {
		const denied = await manage(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const parsed = parseIssueInput(form);
		if ('error' in parsed) return fail(400, { action: 'create', error: parsed.error });
		parsed.input.assigneeIds = await validAssignees(parsed.input.assigneeIds);
		const id = await createIssue(db, parsed.input, event.locals.user!.id);
		// Every assignee on a fresh incident is newly-assigned → notify them all (minus self).
		await notifyAssignees(
			parsed.input.assigneeIds,
			event.locals.user!,
			{ id, title: parsed.input.title },
			event.url.origin
		);
		return { ok: true, action: 'create', id };
	},

	update: async (event) => {
		const denied = await manage(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const id = issueId(form);
		if (id == null) return fail(400, { action: 'update', error: 'Invalid issue.' });
		const parsed = parseIssueInput(form);
		if ('error' in parsed) return fail(400, { action: 'update', error: parsed.error, id });
		parsed.input.assigneeIds = await validAssignees(parsed.input.assigneeIds);
		const added = await updateIssue(db, id, parsed.input, event.locals.user!.id);
		// Only NEW assignees get an email (updateIssue returns the diff), never on every edit.
		await notifyAssignees(added, event.locals.user!, { id, title: parsed.input.title }, event.url.origin);
		return { ok: true, action: 'update', id };
	},

	remove: async (event) => {
		const denied = await manage(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const id = issueId(form);
		if (id == null) return fail(400, { action: 'remove', error: 'Invalid issue.' });
		await deleteIssue(db, id);
		return { ok: true, action: 'remove', id };
	},

	/** Status change: allowed for a manager OR a verified assignee of THIS specific issue. */
	updateStatus: async (event) => {
		const userId = event.locals.user?.id;
		const form = await event.request.formData();
		const id = issueId(form);
		if (id == null) return fail(400, { action: 'updateStatus', error: 'Invalid issue.' });
		const status = String(form.get('status') ?? '');
		if (!isIssueStatus(status)) {
			return fail(400, { action: 'updateStatus', error: 'Invalid status.' });
		}

		// Anti-IDOR: non-managers may only touch issues they are actually assigned to.
		const notManager = await manage(userId);
		if (notManager && (!userId || !(await isAssignee(db, id, userId)))) {
			return fail(403, {
				action: 'updateStatus',
				error: 'You can only update issues assigned to you.'
			});
		}

		const resolutionNote = String(form.get('resolutionNote') ?? '').trim() || null;
		await setIssueStatus(db, id, status, { resolutionNote, actorId: userId! });
		return { ok: true, action: 'updateStatus', id };
	},

	/** Mark ALL of the current user's incident notifications read. Any signed-in staff member may
	 *  clear their OWN feed — no manager gate; read state is per-user. */
	markAllRead: async (event) => {
		const userId = event.locals.user?.id;
		if (!userId) return fail(401, { action: 'markAllRead', error: 'Not signed in.' });
		await markAllNotificationsRead(db, userId);
		return { ok: true, action: 'markAllRead' };
	},

	/** Mark ONE notification (by its event id) read for the current user. */
	markOne: async (event) => {
		const userId = event.locals.user?.id;
		if (!userId) return fail(401, { action: 'markOne', error: 'Not signed in.' });
		const form = await event.request.formData();
		const eventId = Number(form.get('eventId'));
		if (!Number.isInteger(eventId) || eventId <= 0) {
			return fail(400, { action: 'markOne', error: 'Invalid notification.' });
		}
		await markNotificationRead(db, userId, eventId);
		return { ok: true, action: 'markOne' };
	}
};
