/**
 * Incident notifications — a per-entry read model. The feed itself is still derived (notifiable
 * timeline events on incidents the user is assigned to, not done by them), but read/unread is now
 * tracked per event in `admin_notification_read`: a user can mark individual notifications done and
 * still browse a history of read ones. Unread = a notifiable event with no read row for that user.
 *
 * The in-app feed and the assignment EMAIL are separate: email fires once, from the assign path in
 * the route action (best-effort, rate-limited); this module only reads + records read state.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
	type DB,
	adminIssue,
	adminIssueAssignee,
	adminIssueEvent,
	adminNotificationRead,
	adminUser
} from '@veent/db';
import { ISSUE_EVENT, type IssueEventType, eventSummary } from './issues';

/** Event types that notify an assignee. 'created' is excluded — the paired 'assigned' event
 *  is the signal that work landed on you; 'created' is just the manager filing it. */
export const NOTIFIABLE_EVENTS: IssueEventType[] = [
	ISSUE_EVENT.assigned,
	ISSUE_EVENT.unassigned,
	ISSUE_EVENT.statusChanged,
	ISSUE_EVENT.priorityChanged,
	ISSUE_EVENT.comment
];

/** One notification for the bell / history. `id` is the underlying event id (mark-read key). */
export interface NotificationRow {
	id: number;
	issueId: number;
	issueTitle: string;
	summary: string;
	createdAt: number;
	read: boolean;
	/** When it was marked read (epoch ms), or null if still unread. */
	readAt: number | null;
}

/** Feed predicate: notifiable events on MY incidents, not by me. Read-state is layered on top
 *  by the callers (a left-join to the read table). `is distinct from` so a null-actor (removed
 *  staff) event still counts. */
function notifWhere(userId: string) {
	return and(
		eq(adminIssueAssignee.adminUserId, userId),
		inArray(adminIssueEvent.type, NOTIFIABLE_EVENTS),
		sql`${adminIssueEvent.actorId} is distinct from ${userId}`
	);
}

/** Count of unread items (no read row) for the sidebar badge. */
export async function unreadCount(db: DB, userId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(adminIssueEvent)
		.innerJoin(adminIssueAssignee, eq(adminIssueAssignee.issueId, adminIssueEvent.issueId))
		.leftJoin(
			adminNotificationRead,
			and(
				eq(adminNotificationRead.userId, userId),
				eq(adminNotificationRead.eventId, adminIssueEvent.id)
			)
		)
		.where(and(notifWhere(userId), isNull(adminNotificationRead.eventId)));
	return row?.n ?? 0;
}

/**
 * Newest-first notifications. `unreadOnly` (default) powers the bell; pass false for the history
 * page (all notifiable items, read + unread, each flagged). Title + summary resolved here.
 */
export async function listNotifications(
	db: DB,
	userId: string,
	opts: { unreadOnly?: boolean; limit?: number } = {}
): Promise<NotificationRow[]> {
	const { unreadOnly = true, limit = 10 } = opts;
	const target = alias(adminUser, 'notif_target'); // assigned/unassigned toValue is a user id
	const rows = await db
		.select({
			id: adminIssueEvent.id,
			issueId: adminIssueEvent.issueId,
			issueTitle: adminIssue.title,
			type: adminIssueEvent.type,
			fromValue: adminIssueEvent.fromValue,
			toValue: adminIssueEvent.toValue,
			createdAt: adminIssueEvent.createdAt,
			targetName: target.name,
			readAt: adminNotificationRead.readAt
		})
		.from(adminIssueEvent)
		.innerJoin(adminIssueAssignee, eq(adminIssueAssignee.issueId, adminIssueEvent.issueId))
		.innerJoin(adminIssue, eq(adminIssue.id, adminIssueEvent.issueId))
		.leftJoin(target, eq(target.id, adminIssueEvent.toValue))
		.leftJoin(
			adminNotificationRead,
			and(
				eq(adminNotificationRead.userId, userId),
				eq(adminNotificationRead.eventId, adminIssueEvent.id)
			)
		)
		.where(unreadOnly ? and(notifWhere(userId), isNull(adminNotificationRead.eventId)) : notifWhere(userId))
		.orderBy(desc(adminIssueEvent.createdAt), desc(adminIssueEvent.id))
		.limit(limit);

	return rows.map((r) => ({
		id: r.id,
		issueId: r.issueId,
		issueTitle: r.issueTitle,
		summary: eventSummary(r.type as IssueEventType, r.fromValue, r.toValue, r.targetName),
		createdAt: r.createdAt.getTime(),
		read: r.readAt != null,
		readAt: r.readAt ? r.readAt.getTime() : null
	}));
}

/** Mark a single notification (event) read for this user. Idempotent (composite PK). The FK on
 *  eventId means only real events can be recorded, so a bogus id is a harmless no-op at worst. */
export async function markNotificationRead(
	db: DB,
	userId: string,
	eventId: number
): Promise<void> {
	await db.insert(adminNotificationRead).values({ userId, eventId }).onConflictDoNothing();
}

/** Mark every currently-unread notification read for this user (bulk "mark all read"). Bounded by
 *  the unread set (naturally small); inserts one read row per unread event. */
export async function markAllNotificationsRead(db: DB, userId: string): Promise<void> {
	const unread = await db
		.select({ eventId: adminIssueEvent.id })
		.from(adminIssueEvent)
		.innerJoin(adminIssueAssignee, eq(adminIssueAssignee.issueId, adminIssueEvent.issueId))
		.leftJoin(
			adminNotificationRead,
			and(
				eq(adminNotificationRead.userId, userId),
				eq(adminNotificationRead.eventId, adminIssueEvent.id)
			)
		)
		.where(and(notifWhere(userId), isNull(adminNotificationRead.eventId)));
	if (unread.length === 0) return;
	await db
		.insert(adminNotificationRead)
		.values(unread.map((u) => ({ userId, eventId: u.eventId })))
		.onConflictDoNothing();
}
