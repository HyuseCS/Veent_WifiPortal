/**
 * Issues — admin CRUD over `admin_issue` + its `admin_issue_assignee` join. A manager
 * (owner / system_admin) files an issue, optionally links it to an Access Point, and
 * assigns it to one or more staff. Assignees work + resolve the issues assigned to them.
 *
 * View mappers derive StatusBadge tones here (the load/query layer), same as the other
 * admin tables — the Svelte side never re-derives tone from raw status.
 */
import { and, eq, inArray, desc } from 'drizzle-orm';
import {
	type DB,
	adminIssue,
	adminIssueAssignee,
	adminUser,
	networkHealth
} from '@veent/db';
import { ISSUE_STATUS, ISSUE_PRIORITY, type IssueStatus, type IssuePriority } from '@veent/core';
import type { StatusTone } from '$lib/types';

/** One staff member an issue is assigned to. */
export interface IssueAssignee {
	id: string;
	name: string;
}

/** An issue row for the admin views (badge tones + assignees resolved). */
export interface AdminIssueRow {
	id: number;
	title: string;
	description: string | null;
	status: IssueStatus;
	statusLabel: string;
	statusTone: StatusTone;
	priority: IssuePriority;
	priorityLabel: string;
	priorityTone: StatusTone;
	networkId: number | null;
	networkName: string | null;
	/** Due date as epoch ms (for sorting/display), null if none. */
	dueDate: number | null;
	/** Due date as a yyyy-mm-dd string for the edit form's <input type="date">. */
	dueDateInput: string;
	resolutionNote: string | null;
	assignees: IssueAssignee[];
	resolvedAt: number | null;
	createdAt: number;
	updatedAt: number;
}

/** Validated fields for a create/update (status + resolution are handled separately). */
export interface IssueInput {
	title: string;
	description: string | null;
	priority: IssuePriority;
	networkId: number | null;
	dueDate: Date | null;
	assigneeIds: string[];
}

const STATUS_LABEL: Record<IssueStatus, string> = {
	open: 'Open',
	in_progress: 'In Progress',
	resolved: 'Resolved'
};
const STATUS_TONE: Record<IssueStatus, StatusTone> = {
	open: 'blocked', // unresolved — draws the eye
	in_progress: 'warning', // in flight
	resolved: 'online' // done
};
const PRIORITY_LABEL: Record<IssuePriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const PRIORITY_TONE: Record<IssuePriority, StatusTone> = {
	high: 'blocked',
	medium: 'warning',
	low: 'online'
};

/** Sort rank so unresolved + high-priority float to the top of a manager's list. */
const STATUS_RANK: Record<IssueStatus, number> = { open: 0, in_progress: 1, resolved: 2 };
const PRIORITY_RANK: Record<IssuePriority, number> = { high: 0, medium: 1, low: 2 };

function toDateInput(d: Date | null): string {
	return d ? d.toISOString().slice(0, 10) : '';
}

function mapRow(r: typeof adminIssue.$inferSelect, assignees: IssueAssignee[]): AdminIssueRow {
	const status = r.status as IssueStatus;
	const priority = r.priority as IssuePriority;
	return {
		id: r.id,
		title: r.title,
		description: r.description,
		status,
		statusLabel: STATUS_LABEL[status] ?? r.status,
		statusTone: STATUS_TONE[status] ?? 'warning',
		priority,
		priorityLabel: PRIORITY_LABEL[priority] ?? r.priority,
		priorityTone: PRIORITY_TONE[priority] ?? 'warning',
		networkId: r.networkId,
		networkName: r.networkName,
		dueDate: r.dueDate ? r.dueDate.getTime() : null,
		dueDateInput: toDateInput(r.dueDate),
		resolutionNote: r.resolutionNote,
		assignees,
		resolvedAt: r.resolvedAt ? r.resolvedAt.getTime() : null,
		createdAt: r.createdAt.getTime(),
		updatedAt: r.updatedAt.getTime()
	};
}

/** Assignees (id + name) grouped by issue id, in one pass. */
async function assigneesByIssue(db: DB, issueIds: number[]): Promise<Map<number, IssueAssignee[]>> {
	const byIssue = new Map<number, IssueAssignee[]>();
	if (issueIds.length === 0) return byIssue;
	const rows = await db
		.select({
			issueId: adminIssueAssignee.issueId,
			id: adminUser.id,
			name: adminUser.name
		})
		.from(adminIssueAssignee)
		.innerJoin(adminUser, eq(adminUser.id, adminIssueAssignee.adminUserId))
		.where(inArray(adminIssueAssignee.issueId, issueIds));
	for (const row of rows) {
		const list = byIssue.get(row.issueId) ?? [];
		list.push({ id: row.id, name: row.name });
		byIssue.set(row.issueId, list);
	}
	return byIssue;
}

/** Unresolved + high priority first, then most recently created. */
function sortRows(rows: AdminIssueRow[]): AdminIssueRow[] {
	return rows.sort(
		(a, b) =>
			STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
			PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
			b.createdAt - a.createdAt
	);
}

async function hydrate(db: DB, rows: (typeof adminIssue.$inferSelect)[]): Promise<AdminIssueRow[]> {
	const assignees = await assigneesByIssue(
		db,
		rows.map((r) => r.id)
	);
	return sortRows(rows.map((r) => mapRow(r, assignees.get(r.id) ?? [])));
}

/** All issues (manager view). */
export async function listIssues(db: DB): Promise<AdminIssueRow[]> {
	const rows = await db.select().from(adminIssue).orderBy(desc(adminIssue.createdAt));
	return hydrate(db, rows);
}

/** Issues assigned to one staff member (assignee "My Issues" view). */
export async function listIssuesForAssignee(db: DB, userId: string): Promise<AdminIssueRow[]> {
	const mine = await db
		.select({ issueId: adminIssueAssignee.issueId })
		.from(adminIssueAssignee)
		.where(eq(adminIssueAssignee.adminUserId, userId));
	const ids = mine.map((m) => m.issueId);
	if (ids.length === 0) return [];
	const rows = await db.select().from(adminIssue).where(inArray(adminIssue.id, ids));
	return hydrate(db, rows);
}

/** True if `userId` is assigned to `issueId`. Backs the assignee-scoped status guard. */
export async function isAssignee(db: DB, issueId: number, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ issueId: adminIssueAssignee.issueId })
		.from(adminIssueAssignee)
		.where(
			and(eq(adminIssueAssignee.issueId, issueId), eq(adminIssueAssignee.adminUserId, userId))
		)
		.limit(1);
	return !!row;
}

/** Look up the current display name of an AP, to snapshot onto the issue. */
async function apName(db: DB, networkId: number | null): Promise<string | null> {
	if (networkId == null) return null;
	const [row] = await db
		.select({ name: networkHealth.name })
		.from(networkHealth)
		.where(eq(networkHealth.id, networkId))
		.limit(1);
	return row?.name ?? null;
}

/** Create an issue + its assignment rows in one transaction. Returns the new id. */
export async function createIssue(db: DB, input: IssueInput, createdBy: string): Promise<number> {
	const networkName = await apName(db, input.networkId);
	return db.transaction(async (tx) => {
		const [issue] = await tx
			.insert(adminIssue)
			.values({
				title: input.title,
				description: input.description,
				priority: input.priority,
				networkId: input.networkId,
				networkName,
				dueDate: input.dueDate,
				createdBy
			})
			.returning({ id: adminIssue.id });
		if (input.assigneeIds.length > 0) {
			await tx.insert(adminIssueAssignee).values(
				input.assigneeIds.map((adminUserId) => ({
					issueId: issue.id,
					adminUserId,
					assignedBy: createdBy
				}))
			);
		}
		return issue.id;
	});
}

/** Update issue fields and reconcile the assignee set (diff add/remove) in one transaction. */
export async function updateIssue(
	db: DB,
	id: number,
	input: IssueInput,
	actorId: string
): Promise<void> {
	const networkName = await apName(db, input.networkId);
	await db.transaction(async (tx) => {
		await tx
			.update(adminIssue)
			.set({
				title: input.title,
				description: input.description,
				priority: input.priority,
				networkId: input.networkId,
				networkName,
				dueDate: input.dueDate,
				updatedAt: new Date()
			})
			.where(eq(adminIssue.id, id));

		const existing = await tx
			.select({ adminUserId: adminIssueAssignee.adminUserId })
			.from(adminIssueAssignee)
			.where(eq(adminIssueAssignee.issueId, id));
		const current = new Set(existing.map((e) => e.adminUserId));
		const target = new Set(input.assigneeIds);

		const toRemove = [...current].filter((u) => !target.has(u));
		const toAdd = [...target].filter((u) => !current.has(u));

		if (toRemove.length > 0) {
			await tx
				.delete(adminIssueAssignee)
				.where(
					and(
						eq(adminIssueAssignee.issueId, id),
						inArray(adminIssueAssignee.adminUserId, toRemove)
					)
				);
		}
		if (toAdd.length > 0) {
			await tx
				.insert(adminIssueAssignee)
				.values(toAdd.map((adminUserId) => ({ issueId: id, adminUserId, assignedBy: actorId })));
		}
	});
}

/**
 * Change an issue's status. Resolving stamps resolvedBy/resolvedAt + the note; moving
 * back to open/in_progress clears them. Returns true if a row changed.
 */
export async function setIssueStatus(
	db: DB,
	id: number,
	status: IssueStatus,
	opts: { resolutionNote?: string | null; actorId: string }
): Promise<boolean> {
	const resolving = status === ISSUE_STATUS.resolved;
	const updated = await db
		.update(adminIssue)
		.set({
			status,
			resolutionNote: resolving ? (opts.resolutionNote ?? null) : null,
			resolvedBy: resolving ? opts.actorId : null,
			resolvedAt: resolving ? new Date() : null,
			updatedAt: new Date()
		})
		.where(eq(adminIssue.id, id))
		.returning({ id: adminIssue.id });
	return updated.length > 0;
}

export async function deleteIssue(db: DB, id: number): Promise<void> {
	await db.delete(adminIssue).where(eq(adminIssue.id, id));
}

/** Whitelist guards for the hand-written form parsers. */
export function isIssueStatus(v: string): v is IssueStatus {
	return v === ISSUE_STATUS.open || v === ISSUE_STATUS.inProgress || v === ISSUE_STATUS.resolved;
}
export function isIssuePriority(v: string): v is IssuePriority {
	return v === ISSUE_PRIORITY.low || v === ISSUE_PRIORITY.medium || v === ISSUE_PRIORITY.high;
}
