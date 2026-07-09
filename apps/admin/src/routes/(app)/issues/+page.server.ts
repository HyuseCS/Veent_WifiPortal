import { fail } from '@sveltejs/kit';
import { MANAGER_ROLES, STAFF_STATUS, type StaffRole } from '@veent/core';
import { db } from '$lib/server/db';
import { requireManager } from '$lib/server/auth-guard';
import { listStaff, listNetworkHealth } from '$lib/server/queries';
import {
	listIssues,
	listIssuesForAssignee,
	listOpenPool,
	listIssueEventsByIssue,
	isAssignee,
	getIssue,
	createIssue,
	updateIssue,
	setIssueStatus,
	takeIssue,
	deleteIssue,
	isIssuePriority,
	isIssueStatus,
	type IssueInput,
	type AdminIssueRow
} from '$lib/server/issues';
import { markAllNotificationsRead, markNotificationRead } from '$lib/server/notifications';
import { notifyAssignees } from '$lib/server/issueNotify';
import { getIssues as getSentryIssues, isSentryConfigured } from '$lib/server/sentry';
import type { SentryIssue } from '$lib/server/sentry';
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
		// The New-incident modal can also track a Sentry error (source='sentry') without leaving the
		// page, so managers get the unresolved-issue list for its picker. getIssues() degrades to []
		// internally (never throws), so a Sentry outage just empties the picker.
		const sentryConfigured = isSentryConfigured();
		const [issues, staff, networks, sentry] = await Promise.all([
			listIssues(db),
			listStaff(db),
			listNetworkHealth(db),
			sentryConfigured ? getSentryIssues() : Promise.resolve(null)
		]);
		return {
			canManage,
			currentUserId: user.id,
			issues,
			// Managers work the full board (which already lists the pool as "Open"); no separate pool feed.
			pool: [] as AdminIssueRow[],
			// Timelines for the expanded-row preview, grouped by issue (one query, no N+1).
			events: await listIssueEventsByIssue(db, issues.map((i) => i.id)),
			assignableStaff: staff
				.filter((s) => s.status === STAFF_STATUS.active)
				.map((s) => ({ id: s.id, name: s.name, roleLabel: s.roleLabel })),
			networks: networks.map((n) => ({ id: n.id, name: n.name })),
			sentryConfigured,
			// Full issue view models — the in-modal picker renders the same table the /sentry page does
			// (level/events/last-seen + expandable error detail), then snapshots the four track fields.
			sentryIssues: sentry?.issues ?? []
		};
	}

	const [issues, pool, networks] = await Promise.all([
		listIssuesForAssignee(db, user.id),
		listOpenPool(db), // the shared self-serve pool — every staff member can see + take from it
		// Same AP list the manager form uses, for the "Report an issue" self-report modal (?/selfReport)
		// — not a new exposure, the /networks page is already visible to every signed-in staff member.
		listNetworkHealth(db)
	]);
	return {
		canManage,
		currentUserId: user.id,
		issues,
		pool,
		events: {} as Record<number, import('$lib/server/issues').IssueEventRow[]>,
		assignableStaff: [] as { id: string; name: string; roleLabel: string }[],
		networks: networks.map((n) => ({ id: n.id, name: n.name })),
		sentryConfigured: false,
		sentryIssues: [] as SentryIssue[]
	};
};

const manage = (userId: string | undefined) =>
	requireManager(userId, 'You do not have permission to manage issues.');

function issueId(form: FormData): number | null {
	const id = Number(form.get('id'));
	return Number.isInteger(id) && id > 0 ? id : null;
}

// UTC midnight for "today", matching how due dates are parsed below (T00:00:00Z). Due dates on
// or after this are allowed; earlier ones are in the past.
function todayUtcMs(): number {
	const now = new Date();
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

// `existingDueMs` grandfathers an already-set past due date on edit: keeping an overdue incident's
// original date is fine, only NEWLY setting a past date is rejected.
function parseIssueInput(
	form: FormData,
	existingDueMs?: number | null
): { input: IssueInput } | { error: string } {
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
		// Reject deadlines in the past — unless this exact date was already on the incident (edit of
		// an existing overdue item), so managers can still edit without being forced to bump the date.
		if (d.getTime() < todayUtcMs() && d.getTime() !== existingDueMs) {
			return { error: 'Due date cannot be in the past.' };
		}
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

	/** Self-report: any signed-in staff member (not just owner/system_admin) can flag something
	 *  they noticed. Always unassigned — lands in the shared Open pool for anyone free to take —
	 *  regardless of what (if anything) was posted as assigneeId, so a tampered request can't
	 *  smuggle an assignment through this path. */
	selfReport: async (event) => {
		const userId = event.locals.user?.id;
		if (!userId) return fail(401, { action: 'selfReport', error: 'Not signed in.' });
		const form = await event.request.formData();
		const parsed = parseIssueInput(form);
		if ('error' in parsed) return fail(400, { action: 'selfReport', error: parsed.error });
		parsed.input.assigneeIds = [];
		const id = await createIssue(db, parsed.input, userId);
		return { ok: true, action: 'selfReport', id };
	},

	update: async (event) => {
		const denied = await manage(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const id = issueId(form);
		if (id == null) return fail(400, { action: 'update', error: 'Invalid issue.' });
		const existing = await getIssue(db, id);
		const parsed = parseIssueInput(form, existing?.dueDate ?? null);
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

	/** Take an unassigned open incident from the pool (self-assign). Any signed-in staff member may
	 *  — the pool is shared; `takeIssue` re-checks the still-open/still-unassigned invariant in-tx. */
	take: async (event) => {
		const userId = event.locals.user?.id;
		if (!userId) return fail(401, { action: 'take', error: 'Not signed in.' });
		const form = await event.request.formData();
		const id = issueId(form);
		if (id == null) return fail(400, { action: 'take', error: 'Invalid issue.' });
		const claimed = await takeIssue(db, id, userId);
		if (!claimed) return fail(409, { action: 'take', error: 'This incident was already taken.', id });
		return { ok: true, action: 'take', id };
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
