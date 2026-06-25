import { pgTable, text } from 'drizzle-orm/pg-core';
import { adminUser } from './auth-admin';

/**
 * better-auth two-factor plugin storage for staff (admin-only — customers use
 * phone OTP, not TOTP). 1:N with the auth user, same `admin_*` prefix convention.
 *
 * `secret` and `backupCodes` are encrypted at rest by the plugin using
 * BETTER_AUTH_SECRET; never returned to the client. JS property keys match the
 * plugin's field names (`secret` / `backupCodes` / `userId`); Drizzle maps to
 * snake_case columns.
 */
export const adminTwoFactor = pgTable('admin_two_factor', {
	id: text('id').primaryKey(),
	secret: text('secret').notNull(),
	backupCodes: text('backup_codes').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => adminUser.id, { onDelete: 'cascade' })
});
