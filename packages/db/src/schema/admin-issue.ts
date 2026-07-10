import { sql } from 'drizzle-orm';
import { pgTable, serial, integer, text, timestamp, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { adminUser } from './auth-admin';

/**
 * Operational issue tracking. A System Admin (or owner) files an issue — optionally
 * tied to an Access Point — and assigns it to one or more staff who then work and
 * resolve it. Distinct from the read-only Sentry error feed: these are manually-managed
 * tickets.
 *
 * `networkId` is a LOOSE link to `network_health.id` (no FK) — the same convention as
 * `network_sessions.networkId` — because the health sweep prunes/reseeds those rows and
 * a hard FK would fight it. `networkName` snapshots the AP's name at creation so the
 * issue still shows which AP it referred to even if that row is later reseeded.
 *
 * `createdBy` / `resolvedBy` use ON DELETE SET NULL so removing a staff member keeps the
 * issue history intact (the assignment rows below cascade away instead).
 */
export const adminIssue = pgTable(
	'admin_issue',
	{
		id: serial('id').primaryKey(),
		title: text('title').notNull(),
		description: text('description'),
		status: text('status').notNull().default('open'), // 'open' | 'in_progress' | 'resolved'
		priority: text('priority').notNull().default('medium'), // 'low' | 'medium' | 'high'
		source: text('source').notNull().default('human'), // 'human' | 'sentry' — where the incident came from
		networkId: integer('network_id'), // loose link to network_health.id (nullable = general issue)
		networkName: text('network_name'), // snapshot of the AP name at creation
		// Sentry origin snapshot (source='sentry' only, else null). Snapshotted at track time so the
		// incident still links back + reads correctly even after Sentry ages the error out of its feed.
		sentryIssueId: text('sentry_issue_id'),
		sentryShortId: text('sentry_short_id'),
		sentryPermalink: text('sentry_permalink'),
		sentryTitle: text('sentry_title'),
		dueDate: timestamp('due_date'),
		resolutionNote: text('resolution_note'),
		createdBy: text('created_by').references(() => adminUser.id, { onDelete: 'set null' }),
		resolvedBy: text('resolved_by').references(() => adminUser.id, { onDelete: 'set null' }),
		resolvedAt: timestamp('resolved_at'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	// DB-level whitelist guards — the app already type-guards these, but a CHECK stops a bad
	// write from any path (raw SQL, a future service) reaching the table.
	(t) => [
		check('admin_issue_status_ck', sql`${t.status} in ('open', 'in_progress', 'resolved')`),
		check('admin_issue_priority_ck', sql`${t.priority} in ('low', 'medium', 'high')`),
		check('admin_issue_source_ck', sql`${t.source} in ('human', 'sentry')`),
		// One incident per Sentry issue. Partial (source='sentry' only) so it never touches human
		// incidents (all of which have a null sentry_issue_id anyway), and it closes the retry/race
		// window where createIssueFromSentry could otherwise insert the same error twice.
		uniqueIndex('admin_issue_sentry_issue_id_key')
			.on(t.sentryIssueId)
			.where(sql`${t.source} = 'sentry'`)
	]
);

/** Which staff an issue is assigned to (many-to-many). Composite PK → idempotent re-assign. */
export const adminIssueAssignee = pgTable(
	'admin_issue_assignee',
	{
		issueId: integer('issue_id')
			.notNull()
			.references(() => adminIssue.id, { onDelete: 'cascade' }),
		adminUserId: text('admin_user_id')
			.notNull()
			.references(() => adminUser.id, { onDelete: 'cascade' }),
		assignedBy: text('assigned_by').references(() => adminUser.id, { onDelete: 'set null' }),
		assignedAt: timestamp('assigned_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.issueId, t.adminUserId] }),
		// Backs the "issues assigned to me" lookup (assignee view).
		index('admin_issue_assignee_user_idx').on(t.adminUserId)
	]
);
