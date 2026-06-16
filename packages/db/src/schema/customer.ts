import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { customerUser } from './auth-customer';

/**
 * Domain tables owned by the customer (captive-portal) module.
 * Placeholder: a wifi access session granted to an end-user after login.
 * Replace/extend with the real portal domain model.
 */
export const wifiSession = pgTable('wifi_session', {
	id: serial('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => customerUser.id, { onDelete: 'cascade' }),
	deviceMac: text('device_mac'),
	grantedAt: timestamp('granted_at').notNull().defaultNow(),
	expiresAt: timestamp('expires_at')
});
