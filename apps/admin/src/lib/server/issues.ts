/**
 * Issues — admin CRUD over `admin_issue` + its `admin_issue_assignee` join. A manager
 * (owner / system_admin) files an issue, optionally links it to an Access Point, and
 * assigns it to one or more staff. Assignees work + resolve the issues assigned to them.
 *
 * View mappers derive StatusBadge tones here (the load/query layer), same as the other
 * admin tables — the Svelte side never re-derives tone from raw status.
 */
import { and, eq, inArray, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
	type DB,
	adminIssue,
	adminIssueAssignee,
	adminIssueEvent,
	adminUser,
	networkHealth
} from '@veent/db';
import {
	ISSUE_STATUS,
	ISSUE_PRIORITY,
	ISSUE_SOURCE,
	type IssueStatus,
	type IssuePriority,
	type IssueSource
} from '@veent/core';
import type { StatusTone } from '$lib/types';

/** A transaction handle (same query surface as DB), so event writes join the caller's tx. */
type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/** Timeline event types. Mirrors the `admin_issue_event_type_ck` CHECK constraint. */
export const ISSUE_EVENT = {
	created: 'created',
	statusChanged: 'status_changed',
	assigned: 'assigned',
	unassigned: 'unassigned',
	priorityChanged: 'priority_changed',
	comment: 'comment'
} as const;
export type IssueEventType = (typeof ISSUE_EVENT)[keyof typeof ISSUE_EVENT];

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
	source: IssueSource;
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
		source: r.source as IssueSource,
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

/** One timeline entry, fully server-derived (actor name + human summary) for rendering. */
export interface IssueEventRow {
	id: number;
	type: IssueEventType;
	/** Actor's display name, or 'System' when the actor row was removed. */
	actor: string;
	/** Human sentence describing the change (labels resolved here, never in Svelte). */
	summary: string;
	/** Free-text body: resolution note or (Phase 2) comment. Null for structural events. */
	note: string | null;
	createdAt: number;
}

/** Shared select for timeline reads: joins actor + (for assign events) the target user name. */
function selectEvents(db: DB) {
	const actor = alias(adminUser, 'evt_actor');
	const target = alias(adminUser, 'evt_target'); // for assigned/unassigned, toValue is a user id
	return db
		.select({
			id: adminIssueEvent.id,
			issueId: adminIssueEvent.issueId,
			type: adminIssueEvent.type,
			fromValue: adminIssueEvent.fromValue,
			toValue: adminIssueEvent.toValue,
			note: adminIssueEvent.note,
			createdAt: adminIssueEvent.createdAt,
			actorName: actor.name,
			targetName: target.name
		})
		.from(adminIssueEvent)
		.leftJoin(actor, eq(actor.id, adminIssueEvent.actorId))
		.leftJoin(target, eq(target.id, adminIssueEvent.toValue));
}

type EventQueryRow = Awaited<ReturnType<ReturnType<typeof selectEvents>['where']>>[number];

function mapEventRow(r: EventQueryRow): IssueEventRow {
	return {
		id: r.id,
		type: r.type as IssueEventType,
		actor: r.actorName ?? 'System',
		summary: eventSummary(r.type as IssueEventType, r.fromValue, r.toValue, r.targetName),
		note: r.note,
		createdAt: r.createdAt.getTime()
	};
}

/** Newest-first audit timeline for one incident, with actor + assignee names resolved. */
export async function listIssueEvents(db: DB, issueId: number): Promise<IssueEventRow[]> {
	const rows = await selectEvents(db)
		.where(eq(adminIssueEvent.issueId, issueId))
		.orderBy(desc(adminIssueEvent.createdAt), desc(adminIssueEvent.id));
	return rows.map(mapEventRow);
}

/**
 * Timelines for many incidents in one query, grouped by issue id (newest-first per issue).
 * Backs the manager board's expanded-row preview without an N+1 per row.
 */
export async function listIssueEventsByIssue(
	db: DB,
	issueIds: number[]
): Promise<Record<number, IssueEventRow[]>> {
	const grouped: Record<number, IssueEventRow[]> = {};
	if (issueIds.length === 0) return grouped;
	const rows = await selectEvents(db)
		.where(inArray(adminIssueEvent.issueId, issueIds))
		.orderBy(desc(adminIssueEvent.createdAt), desc(adminIssueEvent.id));
	for (const r of rows) {
		(grouped[r.issueId] ??= []).push(mapEventRow(r));
	}
	return grouped;
}

/** Turn a raw event into a human sentence; labels resolved here so Svelte stays dumb. */
export function eventSummary(
	type: IssueEventType,
	from: string | null,
	to: string | null,
	targetName: string | null
): string {
	const statusLabel = (v: string | null) => (v ? (STATUS_LABEL[v as IssueStatus] ?? v) : '—');
	const priorityLabel = (v: string | null) => (v ? (PRIORITY_LABEL[v as IssuePriority] ?? v) : '—');
	const who = targetName ?? 'a former staff member';
	switch (type) {
		case ISSUE_EVENT.created:
			return 'Created this incident';
		case ISSUE_EVENT.statusChanged:
			return `Status: ${statusLabel(from)} → ${statusLabel(to)}`;
		case ISSUE_EVENT.priorityChanged:
			return `Priority: ${priorityLabel(from)} → ${priorityLabel(to)}`;
		case ISSUE_EVENT.assigned:
			return `Assigned ${who}`;
		case ISSUE_EVENT.unassigned:
			return `Unassigned ${who}`;
		case ISSUE_EVENT.comment:
			return 'Commented';
		default:
			return type;
	}
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

/**
 * Append one timeline event. Always called with the mutation's own `tx` so the event
 * commits atomically with the change it records (regression contract #3).
 */
async function recordEvent(
	tx: Tx,
	e: {
		issueId: number;
		actorId: string;
		type: IssueEventType;
		fromValue?: string | null;
		toValue?: string | null;
		note?: string | null;
	}
): Promise<void> {
	await tx.insert(adminIssueEvent).values({
		issueId: e.issueId,
		actorId: e.actorId,
		type: e.type,
		fromValue: e.fromValue ?? null,
		toValue: e.toValue ?? null,
		note: e.note ?? null
	});
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
				source: ISSUE_SOURCE.human, // manual filing; Sentry-tracked incidents use createIssueFromSentry (Phase 4)
				networkId: input.networkId,
				networkName,
				dueDate: input.dueDate,
				createdBy
			})
			.returning({ id: adminIssue.id });
		await recordEvent(tx, { issueId: issue.id, actorId: createdBy, type: ISSUE_EVENT.created });
		if (input.assigneeIds.length > 0) {
			await tx.insert(adminIssueAssignee).values(
				input.assigneeIds.map((adminUserId) => ({
					issueId: issue.id,
					adminUserId,
					assignedBy: createdBy
				}))
			);
			for (const adminUserId of input.assigneeIds) {
				await recordEvent(tx, {
					issueId: issue.id,
					actorId: createdBy,
					type: ISSUE_EVENT.assigned,
					toValue: adminUserId
				});
			}
		}
		return issue.id;
	});
}

/**
 * Update issue fields and reconcile the assignee set (diff add/remove) in one transaction.
 * Returns the newly-added assignee ids so the caller can notify them (email is a post-commit
 * side-effect, never inside this tx).
 */
export async function updateIssue(
	db: DB,
	id: number,
	input: IssueInput,
	actorId: string
): Promise<string[]> {
	const networkName = await apName(db, input.networkId);
	return db.transaction(async (tx) => {
		// Read the pre-update priority so we can record a diff event if it changed.
		const [before] = await tx
			.select({ priority: adminIssue.priority })
			.from(adminIssue)
			.where(eq(adminIssue.id, id))
			.limit(1);

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

		if (before && before.priority !== input.priority) {
			await recordEvent(tx, {
				issueId: id,
				actorId,
				type: ISSUE_EVENT.priorityChanged,
				fromValue: before.priority,
				toValue: input.priority
			});
		}

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
			for (const adminUserId of toRemove) {
				await recordEvent(tx, {
					issueId: id,
					actorId,
					type: ISSUE_EVENT.unassigned,
					toValue: adminUserId
				});
			}
		}
		if (toAdd.length > 0) {
			await tx
				.insert(adminIssueAssignee)
				.values(toAdd.map((adminUserId) => ({ issueId: id, adminUserId, assignedBy: actorId })));
			for (const adminUserId of toAdd) {
				await recordEvent(tx, {
					issueId: id,
					actorId,
					type: ISSUE_EVENT.assigned,
					toValue: adminUserId
				});
			}
		}
		return toAdd;
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
	return db.transaction(async (tx) => {
		const [before] = await tx
			.select({ status: adminIssue.status })
			.from(adminIssue)
			.where(eq(adminIssue.id, id))
			.limit(1);
		if (!before) return false;

		await tx
			.update(adminIssue)
			.set({
				status,
				resolutionNote: resolving ? (opts.resolutionNote ?? null) : null,
				resolvedBy: resolving ? opts.actorId : null,
				resolvedAt: resolving ? new Date() : null,
				updatedAt: new Date()
			})
			.where(eq(adminIssue.id, id));

		if (before.status !== status) {
			await recordEvent(tx, {
				issueId: id,
				actorId: opts.actorId,
				type: ISSUE_EVENT.statusChanged,
				fromValue: before.status,
				toValue: status,
				// keep the resolution note on the event so the timeline shows why it resolved
				note: resolving ? (opts.resolutionNote ?? null) : null
			});
		}
		return true;
	});
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
export function isIssueSource(v: string): v is IssueSource {
	return v === ISSUE_SOURCE.human || v === ISSUE_SOURCE.sentry;
}
