import { pgTable, text, timestamp, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { adminUser } from './auth-admin';

/**
 * Governed owner demotion/removal. Demoting or removing an `owner` requires the
 * UNANIMOUS approval of all OTHER owners (see apps/admin owner-change service). The
 * flow is durable + multi-party, so it lives in the DB rather than the in-memory
 * step-up store used for single-owner wipe codes.
 *
 * A request is `pending` until every current owner except the target has an approval
 * row, then it's `executed`; an owner can `cancel` it. The partial-unique index keeps
 * at most one open request per target.
 */
export const adminOwnerChangeRequest = pgTable(
	'admin_owner_change_request',
	{
		id: text('id').primaryKey(),
		// The owner being demoted/removed.
		targetUserId: text('target_user_id')
			.notNull()
			.references(() => adminUser.id, { onDelete: 'cascade' }),
		action: text('action').notNull(), // 'demote' | 'remove'
		initiatedBy: text('initiated_by')
			.notNull()
			.references(() => adminUser.id, { onDelete: 'cascade' }),
		status: text('status').notNull().default('pending'), // 'pending' | 'executed' | 'cancelled'
		reason: text('reason'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
		expiresAt: timestamp('expires_at').notNull()
	},
	(t) => [
		// At most one open request per target — the backstop for the in-code check.
		uniqueIndex('owner_change_one_pending_per_target')
			.on(t.targetUserId)
			.where(sql`${t.status} = 'pending'`)
	]
);

/** One approval per owner per request (composite PK → idempotent re-votes). */
export const adminOwnerChangeApproval = pgTable(
	'admin_owner_change_approval',
	{
		requestId: text('request_id')
			.notNull()
			.references(() => adminOwnerChangeRequest.id, { onDelete: 'cascade' }),
		ownerId: text('owner_id')
			.notNull()
			.references(() => adminUser.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.requestId, t.ownerId] })]
);
