import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';

/**
 * Builds the standard better-auth table set (user / session / account /
 * verification) under a table-name prefix. We run TWO isolated better-auth
 * instances against one database — customers and staff are separate populations
 * — so each gets its own physically distinct tables (`customer_*` vs `admin_*`).
 *
 * The JS property keys (camelCase) match better-auth's field names; Drizzle maps
 * them to snake_case DB columns. Pass the returned object to the better-auth
 * drizzle adapter's `schema` option.
 */
export function authTables(prefix: string) {
	const user = pgTable(`${prefix}_user`, {
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		email: text('email').notNull().unique(),
		emailVerified: boolean('email_verified').notNull().default(false),
		image: text('image'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	});

	const session = pgTable(`${prefix}_session`, {
		id: text('id').primaryKey(),
		expiresAt: timestamp('expires_at').notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	});

	const account = pgTable(`${prefix}_account`, {
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at'),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	});

	const verification = pgTable(`${prefix}_verification`, {
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	});

	return { user, session, account, verification };
}
