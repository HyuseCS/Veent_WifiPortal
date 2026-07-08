import { sql } from 'drizzle-orm';
import {
	pgTable,
	serial,
	integer,
	text,
	timestamp,
	index,
	check,
	primaryKey
} from 'drizzle-orm/pg-core';
import { adminUser } from './auth-admin';
import { adminIssue } from './admin-issue';

/**
 * Append-only audit timeline for an incident. Every mutation (create, status change,
 * assign/unassign, priority change — and comments in Phase 2) writes one row here inside
 * the mutation's own transaction, so history can never half-commit. Also the source feed
 * for notifications (Phase 5).
 *
 * `issueId` CASCADEs — deleting an incident removes its history. `actorId` is SET NULL so
 * removing a staff member keeps the timeline readable (shows "someone" instead of vanishing).
 *
 * `fromValue`/`toValue` hold the before/after of whatever changed (status, priority) or the
 * assignee id for assign/unassign. `note` carries the resolution note now, comment body later.
 */
export const adminIssueEvent = pgTable(
	'admin_issue_event',
	{
		id: serial('id').primaryKey(),
		issueId: integer('issue_id')
			.notNull()
			.references(() => adminIssue.id, { onDelete: 'cascade' }),
		actorId: text('actor_id').references(() => adminUser.id, { onDelete: 'set null' }),
		type: text('type').notNull(), // created | status_changed | assigned | unassigned | priority_changed | comment
		fromValue: text('from_value'),
		toValue: text('to_value'),
		note: text('note'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		// Timeline reads are "all events for one issue, newest first".
		index('admin_issue_event_issue_idx').on(t.issueId, t.createdAt),
		check(
			'admin_issue_event_type_ck',
			sql`${t.type} in ('created', 'status_changed', 'assigned', 'unassigned', 'priority_changed', 'comment')`
		)
	]
);

/**
 * Per-user notification read state. One row = "this user has marked this event read". The
 * notification feed is still derived (notifiable events on the user's incidents), but read/unread
 * is now tracked per entry here — so a user can mark individual notifications done and still see a
 * history of read ones. Composite PK → idempotent mark-read; both FKs CASCADE so a removed user or
 * a deleted incident's events clean up their read rows automatically.
 */
export const adminNotificationRead = pgTable(
	'admin_notification_read',
	{
		userId: text('user_id')
			.notNull()
			.references(() => adminUser.id, { onDelete: 'cascade' }),
		eventId: integer('event_id')
			.notNull()
			.references(() => adminIssueEvent.id, { onDelete: 'cascade' }),
		readAt: timestamp('read_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.eventId] })]
);
