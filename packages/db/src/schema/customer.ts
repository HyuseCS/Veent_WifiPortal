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
	// Phone lives on customer_user (better-auth phoneNumber plugin); no duplicate here.
	creditBalance: numeric('credit_balance', { precision: 12, scale: 2 }).notNull().default('0'),
	lastFreeSessionAt: timestamp('last_free_session_at'),
	// The ACCOUNT's internet access window — authoritative source of truth for "is this
	// account online and until when". Buying a tier / claiming free time extends it; the
	// revoke cron drives off it. Null or in the past = no live access. Devices bind under
	// this window (network_sessions); they share it rather than each holding their own time.
	accessExpiresAt: timestamp('access_expires_at'),
	// The tier backing the current access window (null = Free Time, or no window). Lives on
	// the ACCOUNT, not the device row, so every bound device shows the SAME package — a device
	// that joined during Free Time and one that bought a tier share one account window, so they
	// must read one package. Set by the most recent window-extending purchase/free claim.
	accessPackageId: integer('access_package_id').references(() => packages.id, {
		onDelete: 'set null'
	}),
	// Pause: when non-null, the access window is FROZEN — held remaining time is
	// `access_expires_at − access_paused_at`, all devices are unbound (no internet flows),
	// and the revoke cron skips the account so the held time isn't swept away. Resume sets
	// `access_expires_at = now + held` and clears this. Any window-extending buy/free claim
	// also clears it (adding time un-pauses). Paid windows only.
	accessPausedAt: timestamp('access_paused_at'),
	// Admin "block": when true, grant paths refuse to start sessions for this user.
	blocked: boolean('blocked').notNull().default(false),
	// Last AP/network this account was granted on (network_health.id), stamped whenever a
	// grant resolves an AP. A fallback for payment-location attribution: a returning buyer
	// whose captive-portal context was lost and who has no live session still gets their
	// last-known AP at checkout. Loose link (no FK), same rationale as network_sessions.
	lastNetworkId: integer('last_network_id'),
	// The device MAC this account most recently presented to the portal (from the captive
	// `?mac=` redirect or a router IP→MAC lookup). Durably stored here — keyed by user, NOT a
	// cookie — so a returning buyer whose portal cookie was lost can still be matched to their
	// device WITHOUT a fresh portal reconnect. The CNA and the system browser have separate
	// cookie jars, so the `?mac=` cookie is gone after a Maya payment hop; this column bridges
	// that. Same loose-fallback rationale as `lastNetworkId`; a fresh `?mac=` always supersedes it.
	lastKnownMac: text('last_known_mac')
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

/**
 * Full record of every payment-gateway webhook event (success AND failure),
 * captured verbatim so the admin Finance page can report on the complete payment
 * funnel. `credit_ledger` only records *successful, credited* top-ups; this table
 * is the superset — failed/expired/cancelled attempts, fund source, receipt,
 * buyer, and error detail. The PK is the gateway's own transaction id, so a
 * resent or status-transitioning webhook upserts the same row.
 */
export const paymentTransactions = pgTable(
	'payment_transactions',
	{
		id: text('id').primaryKey(), // Maya's tx id (payload.id)
		status: text('status').notNull(), // PAYMENT_SUCCESS | PAYMENT_FAILED | PAYMENT_EXPIRED | PAYMENT_CANCELLED
		amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
		currency: text('currency').notNull().default('PHP'),
		fundSourceType: text('fund_source_type'), // card | gcash | maya-wallet | shopeepay | qrph | null
		fundSourceMasked: text('fund_source_masked'), // card last4 / wallet masked, nullable
		receiptNo: text('receipt_no'),
		referenceNo: text('reference_no'), // requestReferenceNumber (our referenceId echo)
		errorCode: text('error_code'),
		errorMessage: text('error_message'),
		buyerName: text('buyer_name'),
		buyerEmail: text('buyer_email'),
		// Nullable: a failed event may carry no referenceId, so we can't always map it.
		userId: text('user_id').references(() => customerUser.id, { onDelete: 'set null' }),
		packageId: integer('package_id').references(() => packages.id, { onDelete: 'set null' }),
		// Which AP/network the payment originated from (network_health.id), copied from the
		// matching payment_checkouts row at webhook time so EVERY event — success AND
		// failed/expired — carries a location, not just credited ones. Loose link (no FK),
		// same rationale as network_sessions.network_id: network_health rows are pruned/
		// reseeded by the health sweep, and a hard reference would fight that (and could
		// null/cascade settled payment history on prune). Null = location was unresolvable
		// (foreign webhook with no checkout, wired/dev device); reported as "Unattributed".
		networkId: integer('network_id'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('payment_transactions_user_id_idx').on(t.userId),
		index('payment_transactions_created_at_idx').on(t.createdAt),
		index('payment_transactions_status_idx').on(t.status)
	]
);

/**
 * Pending checkouts — the SAFETY NET for "user paid but the webhook never landed".
 * Written when a checkout is created (we have the gateway checkoutId + our referenceId
 * but not the payment/txn id yet). A reconcile pass (cron + on-return poll) asks the
 * gateway the truth and credits idempotently, so a missed webhook can't lose money.
 *
 * `status` is the coordination primitive: an atomic pending→settled claim (by id from
 * reconcile, by reference_id from the webhook) ensures EXACTLY ONE path credits, no
 * matter the ordering. reference_id carries a per-attempt nonce so it maps to one row.
 */
export const paymentCheckouts = pgTable(
	'payment_checkouts',
	{
		id: text('id').primaryKey(), // gateway checkoutId (unique per attempt)
		userId: text('user_id')
			.notNull()
			.references(() => customerUser.id, { onDelete: 'cascade' }),
		packageId: integer('package_id')
			.notNull()
			.references(() => packages.id, { onDelete: 'cascade' }),
		// `${userId}:${packageId}:${nonce}` — echoed to the gateway, unique per attempt.
		referenceId: text('reference_id').notNull().unique(),
		amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
		// pending | settled | failed | expired
		status: text('status').notNull().default('pending'),
		// Gateway txn id once known (from reconcile/webhook), for tracing.
		externalTransactionId: text('external_transaction_id'),
		// AP/network the buyer was on when this checkout was created (network_health.id),
		// resolved from the captive-portal context / active session at checkout. The webhook
		// copies it onto payment_transactions for every resulting event, so even a failed
		// payment is attributed to a location. Loose link (no FK) for the same reason as
		// network_sessions.network_id. Null when no AP could be resolved at checkout.
		networkId: integer('network_id'),
		// Throttle for the on-return poll so a fast-refreshing page can't hammer the gateway.
		lastPolledAt: timestamp('last_polled_at'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		settledAt: timestamp('settled_at')
	},
	(t) => [
		index('payment_checkouts_status_idx').on(t.status),
		index('payment_checkouts_created_at_idx').on(t.createdAt)
	]
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
		// Which AP/network the device was on at grant time (network_health.id), for
		// per-AP active-user counts. Loose link (no FK): network_health rows are
		// reconciled/pruned by the health sweep, so a hard reference would fight it.
		// Null when the controller couldn't resolve an AP (stub/dev, wired client).
		networkId: integer('network_id'),
		status: text('status').notNull(),
		startedAt: timestamp('started_at').notNull().defaultNow(),
		// Device-binding registry: one active row per (user, MAC) = "this device is
		// currently bypassed for this account". boundAt = first bind under the current
		// window; lastSeenAt = refreshed on every (re)bind/dashboard land, drives LRU
		// eviction when the per-account device cap is exceeded. expiresAt mirrors the
		// account window (customer_profile.access_expires_at) so the cron index + router
		// sweep keep working — but the profile window is the authoritative gate.
		boundAt: timestamp('bound_at').notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
		expiresAt: timestamp('expires_at')
	},
	(t) => [
		index('network_sessions_user_id_idx').on(t.userId),
		index('network_sessions_mac_address_idx').on(t.macAddress),
		// Per-AP active-user count: "active sessions grouped by network".
		index('network_sessions_network_id_idx').on(t.networkId),
		// Drives the revoke cron: "find active sessions whose time is up".
		index('network_sessions_status_expires_at_idx').on(t.status, t.expiresAt),
		// List an account's bound devices + find the least-recently-seen one to evict.
		index('network_sessions_user_status_lastseen_idx').on(t.userId, t.status, t.lastSeenAt)
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
		// Generic key for non-OTP limiters (e.g. admin email): `scope` namespaces the
		// counter ('admin_email'), `identifier` is the keyed value (recipient address).
		// Kept alongside mac/phone so each limiter uses its own column pair and never
		// shares a row — a scoped counter can't collide with a mac/phone one.
		scope: text('scope'),
		identifier: text('identifier'),
		attempts: integer('attempts').notNull().default(0),
		lastAttemptAt: timestamp('last_attempt_at').notNull().defaultNow()
	},
	// Looked up on every OTP request (mac/phone) or scoped check (scope+identifier).
	(t) => [
		index('rate_limits_mac_address_idx').on(t.macAddress),
		index('rate_limits_phone_number_idx').on(t.phoneNumber),
		index('rate_limits_scope_identifier_idx').on(t.scope, t.identifier)
	]
);

/**
 * Customer-facing Help/FAQ entries, managed in the admin Content Management section.
 * The customer Help page renders only PUBLISHED entries, ordered by `sortOrder` (then id).
 * Moving this out of the hardcoded `faq/+page.svelte` array so operators can edit copy
 * without a deploy.
 */
export const faqs = pgTable(
	'faqs',
	{
		id: serial('id').primaryKey(),
		question: text('question').notNull(),
		answer: text('answer').notNull(),
		// Display order on the customer Help page (ascending). Ties broken by id.
		sortOrder: integer('sort_order').notNull().default(0),
		// Only published entries show to guests; admin sees drafts + published.
		isPublished: boolean('is_published').notNull().default(true),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [index('faqs_sort_order_idx').on(t.sortOrder)]
);

/**
 * Singleton app-wide configuration (exactly one row, id=1), editable in the admin Content
 * Management → Session Limits. Column defaults mirror the @veent/core config constants;
 * `getSessionLimits()` reads this row with those constants as the fallback, so the system
 * works even before the row exists. Operators tune these without a deploy.
 */
export const appSettings = pgTable('app_settings', {
	id: integer('id').primaryKey().default(1),
	maxDevicesPerAccount: integer('max_devices_per_account').notNull().default(2),
	freeTimeMinutes: integer('free_time_minutes').notNull().default(15),
	freeTimeCooldownHours: integer('free_time_cooldown_hours').notNull().default(12),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});
