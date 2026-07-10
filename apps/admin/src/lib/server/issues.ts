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
	comment: 'comment',
	noteEdited: 'note_edited'
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
	/** Sentry origin snapshot — null for human incidents. */
	sentryIssueId: string | null;
	sentryShortId: string | null;
	sentryPermalink: string | null;
	sentryTitle: string | null;
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

/**
 * Assignment-aware display of the raw status. "Open" means *unowned* (in the self-serve pool);
 * the moment anyone is assigned it reads "Assigned". The raw enum stays open→in_progress→resolved —
 * ownership is derived from the assignee join, never a fourth status value (can't drift). This is
 * the ONE place badge label/tone is decided, for every view (board, detail, My-incidents).
 */
function deriveStatusDisplay(
	status: IssueStatus,
	hasAssignee: boolean
): { label: string; tone: StatusTone } {
	if (status === ISSUE_STATUS.resolved) return { label: 'Resolved', tone: 'online' };
	if (status === ISSUE_STATUS.inProgress) {
		return { label: hasAssignee ? 'Assigned · In Progress' : 'In Progress', tone: 'warning' };
	}
	// open
	return hasAssignee
		? { label: 'Assigned', tone: 'warning' } // owned, not yet started
		: { label: 'Open', tone: 'blocked' }; // unowned — the pool; draws the eye
}
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
	const display = deriveStatusDisplay(status, assignees.length > 0);
	return {
		id: r.id,
		title: r.title,
		description: r.description,
		status,
		statusLabel: display.label,
		statusTone: display.tone,
		priority,
		priorityLabel: PRIORITY_LABEL[priority] ?? r.priority,
		priorityTone: PRIORITY_TONE[priority] ?? 'warning',
		source: r.source as IssueSource,
		sentryIssueId: r.sentryIssueId,
		sentryShortId: r.sentryShortId,
		sentryPermalink: r.sentryPermalink,
		sentryTitle: r.sentryTitle,
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

/** One issue by id, fully hydrated (badges + assignees). Null if it doesn't exist. Backs the
 *  detail route; role-scoping is enforced by the caller (manager: any, assignee: own only). */
export async function getIssue(db: DB, id: number): Promise<AdminIssueRow | null> {
	const rows = await db.select().from(adminIssue).where(eq(adminIssue.id, id)).limit(1);
	if (rows.length === 0) return null;
	const [row] = await hydrate(db, rows);
	return row ?? null;
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

/**
 * The self-serve "Open pool": open incidents nobody has taken yet, visible to ALL staff so a free
 * responder can pick one up. `// ponytail:` filter after hydrate — the open set is small, so a
 * NOT-EXISTS subquery is premature; reuse the same hydrate the other reads use.
 */
export async function listOpenPool(db: DB): Promise<AdminIssueRow[]> {
	const rows = await db.select().from(adminIssue).where(eq(adminIssue.status, ISSUE_STATUS.open));
	const hydrated = await hydrate(db, rows);
	return hydrated.filter((r) => r.assignees.length === 0);
}

/**
 * Self-assign an unassigned open incident ("take it from the pool"). Re-checks the pool invariant
 * INSIDE the tx — status still `open` AND still zero assignees — so two simultaneous takers can't
 * both win; the loser gets `false`. Records the `assigned` event atomically. Self-take, so no
 * notification (actor == assignee). Returns true iff this call claimed it.
 */
export async function takeIssue(db: DB, issueId: number, userId: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		// Lock the incident row so two simultaneous takers serialize: the second waits here, then
		// re-reads below and sees the first's assignee — without the lock both could pass the checks
		// and both insert (different adminUserId → the composite PK doesn't stop it).
		const [issue] = await tx
			.select({ status: adminIssue.status })
			.from(adminIssue)
			.where(eq(adminIssue.id, issueId))
			.limit(1)
			.for('update');
		if (!issue || issue.status !== ISSUE_STATUS.open) return false;

		const existing = await tx
			.select({ adminUserId: adminIssueAssignee.adminUserId })
			.from(adminIssueAssignee)
			.where(eq(adminIssueAssignee.issueId, issueId))
			.limit(1);
		if (existing.length > 0) return false; // already taken

		await tx
			.insert(adminIssueAssignee)
			.values({ issueId, adminUserId: userId, assignedBy: userId });
		await recordEvent(tx, {
			issueId,
			actorId: userId,
			type: ISSUE_EVENT.assigned,
			toValue: userId
		});
		return true;
	});
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
		case ISSUE_EVENT.noteEdited:
			return 'Updated the resolution note';
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

/** The four Sentry fields snapshotted onto a tracked incident. */
export interface SentrySnapshot {
	issueId: string;
	shortId: string;
	permalink: string;
	title: string;
}

/**
 * Track a Sentry error as an assigned incident. Snapshots the four Sentry fields so the incident
 * still links back + reads correctly after the error ages out of Sentry's feed. source='sentry',
 * no AP link. Deliberately does NOT change the error's status in Sentry — it stays in the feed
 * (dismissal is a separate, explicit triage action). Returns the new incident id.
 */
export async function createIssueFromSentry(
	db: DB,
	snapshot: SentrySnapshot,
	input: IssueInput,
	createdBy: string
): Promise<number> {
	return db.transaction(async (tx) => {
		const [issue] = await tx
			.insert(adminIssue)
			.values({
				title: input.title,
				description: input.description,
				priority: input.priority,
				source: ISSUE_SOURCE.sentry,
				sentryIssueId: snapshot.issueId,
				sentryShortId: snapshot.shortId,
				sentryPermalink: snapshot.permalink,
				sentryTitle: snapshot.title,
				dueDate: input.dueDate,
				createdBy
			})
			.returning({ id: adminIssue.id });
		// The origin is on the created event's note so it reads in the timeline.
		await recordEvent(tx, {
			issueId: issue.id,
			actorId: createdBy,
			type: ISSUE_EVENT.created,
			note: `Tracked from Sentry ${snapshot.shortId}`
		});
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

/** Outcome of a setIssueStatus call: a row changed, nothing changed, or the id was not found. */
export type SetIssueStatusResult = 'updated' | 'unchanged' | 'not_found';

/**
 * Change an issue's status. Resolving stamps resolvedBy/resolvedAt + the note; moving
 * back to open/in_progress clears them.
 *
 * Same-status is NOT always a no-op: when the issue is already `resolved` and the caller submits a
 * DIFFERENT resolution note, this is a note edit — persist the new note (+ updatedAt) and record a
 * `note_edited` audit event so resolution metadata is never mutated without a trail (H2). A truly
 * unchanged submit still touches nothing.
 *
 * Returns 'updated' when a row changed, 'unchanged' when nothing changed, 'not_found' when the id
 * does not exist (callers map that to fail(404)).
 */
export async function setIssueStatus(
	db: DB,
	id: number,
	status: IssueStatus,
	opts: { resolutionNote?: string | null; actorId: string }
): Promise<SetIssueStatusResult> {
	const resolving = status === ISSUE_STATUS.resolved;
	return db.transaction(async (tx) => {
		const [before] = await tx
			.select({ status: adminIssue.status, resolutionNote: adminIssue.resolutionNote })
			.from(adminIssue)
			.where(eq(adminIssue.id, id))
			.limit(1);
		if (!before) return 'not_found';

		if (before.status === status) {
			// No status transition. The only meaningful same-status edit is changing the resolution
			// note on an already-resolved incident (both UIs offer exactly this). Anything else is a
			// true no-op — touching resolvedBy/resolvedAt without a status_changed event would mutate
			// resolution metadata with no audit trail.
			const newNote = opts.resolutionNote ?? null;
			if (resolving && newNote !== before.resolutionNote) {
				await tx
					.update(adminIssue)
					.set({ resolutionNote: newNote, updatedAt: new Date() })
					.where(eq(adminIssue.id, id));
				await recordEvent(tx, {
					issueId: id,
					actorId: opts.actorId,
					type: ISSUE_EVENT.noteEdited,
					note: newNote
				});
				return 'updated';
			}
			return 'unchanged';
		}

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

		await recordEvent(tx, {
			issueId: id,
			actorId: opts.actorId,
			type: ISSUE_EVENT.statusChanged,
			fromValue: before.status,
			toValue: status,
			// keep the resolution note on the event so the timeline shows why it resolved
			note: resolving ? (opts.resolutionNote ?? null) : null
		});
		return 'updated';
	});
}

export async function deleteIssue(db: DB, id: number): Promise<void> {
	await db.delete(adminIssue).where(eq(adminIssue.id, id));
}

/**
 * Append a comment to an incident's timeline (a `comment` event whose `note` is the body).
 * Single insert — no tx needed. Comments are notifiable, so assignees pick them up in the feed
 * automatically (no email — that's assignment-only). Returns nothing.
 */
export async function addComment(
	db: DB,
	issueId: number,
	actorId: string,
	body: string
): Promise<void> {
	await db
		.insert(adminIssueEvent)
		.values({ issueId, actorId, type: ISSUE_EVENT.comment, note: body });
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
