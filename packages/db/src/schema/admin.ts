import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { adminUser } from './auth-admin';

/**
 * Domain tables owned by the admin (management dashboard) module.
 * Placeholder: an audit-log entry recording a staff action.
 * Replace/extend with the real admin domain model.
 */
export const auditLog = pgTable('audit_log', {
	id: serial('id').primaryKey(),
	actorId: text('actor_id').references(() => adminUser.id, { onDelete: 'set null' }),
	action: text('action').notNull(),
	detail: text('detail'),
	createdAt: timestamp('created_at').notNull().defaultNow()
});
