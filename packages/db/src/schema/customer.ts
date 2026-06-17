import {
	pgTable,
	serial,
	integer,
	text,
	boolean,
	numeric,
	doublePrecision,
	timestamp,
	index
} from 'drizzle-orm/pg-core';
import { customerUser } from './auth-customer';

/**
 * Domain tables for the customer (captive-portal) module.
 *
 * Modeled directly from docs/use-cases/wifi-portal-erd.puml. Column SQL types
 * mirror the ERD literally (decimal -> numeric, float -> double precision,
 * int -> integer, string -> text, bool -> boolean).
 *
 * better-auth owns `customer_user` (id / name / email / ...). The ERD's "Users"
 * entity also carries portal-domain fields (role, phone, credit balance, free-
 * session cooldown); those live here in `customer_profile`, a 1:1 extension of
 * the auth user, so the hand-maintained auth tables stay clean.
 */

/** Portal-domain extension of the better-auth user (ERD "Users", 1:1). */
export const customerProfile = pgTable('customer_profile', {
	userId: text('user_id')
		.primaryKey()
		.references(() => customerUser.id, { onDelete: 'cascade' }),
	role: text('role').notNull().default('user'),
	phoneNumber: text('phone_number'),
	creditBalance: numeric('credit_balance', { precision: 12, scale: 2 }).notNull().default('0'),
	lastFreeSessionAt: timestamp('last_free_session_at'),
	// Admin "block": when true, grant paths refuse to start sessions for this user.
	blocked: boolean('blocked').notNull().default(false)
});

/** Purchasable credit bundles / access tiers, configured by admin (ERD "Packages"). */
export const packages = pgTable('packages', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	type: text('type').notNull(),
	fiatCost: doublePrecision('fiat_cost'),
	creditsProvided: integer('credits_provided'),
	creditCost: integer('credit_cost'),
	durationMinutes: integer('duration_minutes'),
	isActive: boolean('is_active').notNull().default(true)
});

/** Append-only history of every credit movement (ERD "CreditLedger"). */
export const creditLedger = pgTable(
	'credit_ledger',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => customerUser.id, { onDelete: 'cascade' }),
		// Nullable + set null on delete: refunds/promos may not map to a package, and
		// removing a package config must not erase ledger history (deviates from the
		// ERD's required FK on purpose).
		packageId: integer('package_id').references(() => packages.id, { onDelete: 'set null' }),
		amount: doublePrecision('amount').notNull(),
		type: text('type').notNull(),
		// Unique so a retried payment webhook can't credit the balance twice
		// (business rule #3). NULL for non-webhook entries (Postgres allows many
		// NULLs under a unique constraint), so manual/promo credits don't collide.
		externalTransactionId: text('external_transaction_id').unique(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('credit_ledger_user_id_idx').on(t.userId)]
);

/** A network access grant for a device MAC, tied to a user (ERD "NetworkSessions"). */
export const networkSessions = pgTable(
	'network_sessions',
	{
		id: serial('id').primaryKey(),
		macAddress: text('mac_address'),
		userId: text('user_id')
			.notNull()
			.references(() => customerUser.id, { onDelete: 'cascade' }),
		// "package_id_opt" in the ERD — free sessions / grace periods have no package.
		packageId: integer('package_id').references(() => packages.id, { onDelete: 'set null' }),
		status: text('status').notNull(),
		startedAt: timestamp('started_at').notNull().defaultNow(),
		expiresAt: timestamp('expires_at')
	},
	(t) => [
		index('network_sessions_user_id_idx').on(t.userId),
		index('network_sessions_mac_address_idx').on(t.macAddress),
		// Drives the revoke cron: "find active sessions whose time is up".
		index('network_sessions_status_expires_at_idx').on(t.status, t.expiresAt)
	]
);

/**
 * Pre-auth OTP / request throttling, keyed by device MAC or phone number
 * (ERD "RateLimits"). No user FK: these guard requests before a user exists.
 */
export const rateLimits = pgTable(
	'rate_limits',
	{
		id: serial('id').primaryKey(),
		macAddress: text('mac_address'),
		phoneNumber: text('phone_number'),
		attempts: integer('attempts').notNull().default(0),
		lastAttemptAt: timestamp('last_attempt_at').notNull().defaultNow()
	},
	// Looked up on every OTP request, by one identifier or the other.
	(t) => [
		index('rate_limits_mac_address_idx').on(t.macAddress),
		index('rate_limits_phone_number_idx').on(t.phoneNumber)
	]
);
