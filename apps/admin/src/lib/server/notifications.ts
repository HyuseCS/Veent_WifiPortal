/**
 * Incident notifications — a watermark-derived feed, no per-notification rows. A staff member's
 * unread items are the timeline events on incidents they're assigned to that (a) are a notifiable
 * type, (b) weren't done by them, and (c) are newer than their `notifications_seen_at` watermark.
 * "Mark all read" just bumps the watermark to now(); the counts recompute from the event table.
 *
 * The in-app feed and the assignment EMAIL are separate: email fires once, from the assign path in
 * the route action (best-effort, rate-limited); this module only reads.
 */
import { and, desc, eq, inArray, gt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
	type DB,
	adminIssue,
	adminIssueAssignee,
	adminIssueEvent,
	adminProfile,
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

/** One notification for the bell dropdown. */
export interface NotificationRow {
	id: number;
	issueId: number;
	issueTitle: string;
	summary: string;
	createdAt: number;
}

/** SQL predicate shared by the count + list: notifiable events on MY incidents, not by me,
 *  newer than my watermark. `is distinct from` so a null-actor (removed staff) event still counts;
 *  `coalesce(..., epoch)` so a null watermark (never opened) treats everything as unread. */
function unreadWhere(userId: string) {
	return and(
		eq(adminIssueAssignee.adminUserId, userId),
		inArray(adminIssueEvent.type, NOTIFIABLE_EVENTS),
		sql`${adminIssueEvent.actorId} is distinct from ${userId}`,
		gt(adminIssueEvent.createdAt, sql`coalesce(${adminProfile.notificationsSeenAt}, to_timestamp(0))`)
	);
}

/** Count of unread incident-activity items for the sidebar badge (one indexed query). */
export async function unreadCount(db: DB, userId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(adminIssueEvent)
		.innerJoin(
			adminIssueAssignee,
			eq(adminIssueAssignee.issueId, adminIssueEvent.issueId)
		)
		.innerJoin(adminProfile, eq(adminProfile.userId, userId))
		.where(unreadWhere(userId));
	return row?.n ?? 0;
}

/** Newest-first unread items for the bell dropdown (issue title + human summary resolved here). */
export async function listNotifications(
	db: DB,
	userId: string,
	limit = 10
): Promise<NotificationRow[]> {
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
			targetName: target.name
		})
		.from(adminIssueEvent)
		.innerJoin(adminIssueAssignee, eq(adminIssueAssignee.issueId, adminIssueEvent.issueId))
		.innerJoin(adminProfile, eq(adminProfile.userId, userId))
		.innerJoin(adminIssue, eq(adminIssue.id, adminIssueEvent.issueId))
		.leftJoin(target, eq(target.id, adminIssueEvent.toValue))
		.where(unreadWhere(userId))
		.orderBy(desc(adminIssueEvent.createdAt), desc(adminIssueEvent.id))
		.limit(limit);

	return rows.map((r) => ({
		id: r.id,
		issueId: r.issueId,
		issueTitle: r.issueTitle,
		summary: eventSummary(r.type as IssueEventType, r.fromValue, r.toValue, r.targetName),
		createdAt: r.createdAt.getTime()
	}));
}

/** Bump the watermark to now() — clears the unread feed for this user. Uses DB `now()` (not a
 *  JS `new Date()`) so the watermark and events' `created_at` are stamped by the SAME clock: the
 *  events column is `timestamp` (no tz), so a JS UTC Date would land behind them on a non-UTC DB
 *  and never clear the feed. */
export async function markNotificationsRead(db: DB, userId: string): Promise<void> {
	await db
		.update(adminProfile)
		.set({ notificationsSeenAt: sql`now()` })
		.where(eq(adminProfile.userId, userId));
}
