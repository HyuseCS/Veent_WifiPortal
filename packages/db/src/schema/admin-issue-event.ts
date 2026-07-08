import { sql } from 'drizzle-orm';
import { pgTable, serial, integer, text, timestamp, index, check } from 'drizzle-orm/pg-core';
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
