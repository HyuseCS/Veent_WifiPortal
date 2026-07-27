import {
	pgTable,
	serial,
	integer,
	text,
	boolean,
	numeric,
	doublePrecision,
	timestamp,
	index,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
	// Buyer details collected on the top-up form for Maya's Kount fraud protection (which
	// requires firstName + lastName + email on every checkout). Stored ONLY when the buyer ticks
	// "save my details" — null means not stored, and the form is shown/re-asked next time. Kept
	// here (not on customer_user) because that table's email is a unique better-auth placeholder,
	// while a real contact email is non-unique (buyers can share one) and portal-domain data.
	firstName: text('first_name'),
	lastName: text('last_name'),
	contactEmail: text('contact_email'),
	// Phone lives on customer_user (better-auth phoneNumber plugin); no duplicate here.
	creditBalance: numeric('credit_balance', { precision: 12, scale: 2 }).notNull().default('0'),
	// Loyalty points, a SEPARATE wallet from credits: earned as a % of each verified top-up
	// (points_ledger `earn`) and redeemable for the same access tiers instead of credits
	// (points_ledger `spend`). Whole numbers only — earning floors the percentage. Never expires.
	pointsBalance: integer('points_balance').notNull().default(0),
	lastFreeSessionAt: timestamp('last_free_session_at', { withTimezone: true }),
	// The ACCOUNT's internet access window — authoritative source of truth for "is this
	// account online and until when". Buying a tier / claiming free time extends it; the
	// revoke cron drives off it. Null or in the past = no live access. Devices bind under
	// this window (network_sessions); they share it rather than each holding their own time.
	accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
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
	accessPausedAt: timestamp('access_paused_at', { withTimezone: true }),
	// Why paused: 'user' (guest tapped Pause) or 'outage' (auto-paused because this account's AP
	// went down — see the outage sweep). Null when not paused. Lets the outage auto-resume touch
	// ONLY its own pauses and never un-pause a manual one.
	accessPausedReason: text('access_paused_reason'),
	// For an 'outage' pause: the network_health.id of the AP whose outage triggered it, so the
	// sweep resumes the account only when THAT AP recovers. Null for a 'user' pause. Loose link.
	accessPausedNetworkId: integer('access_paused_network_id'),
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
	// Points price for a `tier`, set by admin independently of `creditCost`. Null = this tier
	// can't be redeemed with points (only credits). Whole points only.
	pointsCost: integer('points_cost'),
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
		// Durable AP attribution: the raw DHCP circuit-id STRING the buyer was on at spend time
		// (not a network_health.id reference), resolved best-effort BEFORE the spend transaction
		// opens. Immutable fact — survives the AP being renamed or pruned from network_health.
		// Null = AP was unresolvable at spend time ("Unattributed"). Read-time label resolution
		// (resolveApCircuitLabel) joins network_health.ap_circuit_id for a current friendly name,
		// else shows this raw string. No FK/index (attribution is read rarely).
		apCircuitId: text('ap_circuit_id'),
		// Frozen AP label (display_name ?? name) captured pre-transaction at write time. Finance shows
		// this as-was name; a later AP rename never rewrites it. Null = unresolvable → live fallback.
		apNameSnapshot: text('ap_name_snapshot'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('credit_ledger_user_id_idx').on(t.userId)]
);

/**
 * Append-only history of every POINTS movement — the credit_ledger twin for the loyalty wallet.
 * Kept as its OWN table (not a `type` on credit_ledger) so the two wallets never share a balance
 * or an idempotency key: a top-up writes ONE credit_ledger row and ONE points_ledger row, each
 * with the SAME Maya txn id under its own unique `external_transaction_id`, so neither can
 * double-apply and the two can't collide. Positive amount = earn, negative = spend.
 */
export const pointsLedger = pgTable(
	'points_ledger',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => customerUser.id, { onDelete: 'cascade' }),
		// Nullable + set null on delete, same rationale as credit_ledger: spends may reference a
		// tier, but removing a package config must not erase points history.
		packageId: integer('package_id').references(() => packages.id, { onDelete: 'set null' }),
		amount: integer('amount').notNull(),
		type: text('type').notNull(), // earn | spend
		// Unique so a retried payment webhook can't earn points twice (mirrors credit_ledger).
		// NULL for spends (Postgres allows many NULLs under a unique constraint).
		externalTransactionId: text('external_transaction_id').unique(),
		// Durable AP attribution for a points spend — same rationale/shape as credit_ledger.
		// Raw circuit-id string, resolved best-effort pre-transaction; null = "Unattributed".
		apCircuitId: text('ap_circuit_id'),
		// Frozen AP label (display_name ?? name) captured pre-transaction — same rationale as
		// credit_ledger. Null = unresolvable → live fallback.
		apNameSnapshot: text('ap_name_snapshot'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('points_ledger_user_id_idx').on(t.userId)]
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
		// Durable AP attribution: the raw circuit-id STRING copied from the matching
		// payment_checkouts row at webhook/reconcile time (alongside network_id). Unlike
		// network_id (a network_health.id reference that renders "AP #<id>" once the AP is
		// pruned), this string survives rename/prune. INSERT-only, never in an onConflict
		// update set. Null = unresolvable at checkout ("Unattributed").
		apCircuitId: text('ap_circuit_id'),
		// Frozen AP label (display_name ?? name) copied INSERT-only from the checkout, same as
		// ap_circuit_id. The as-was name for Finance; immune to later AP renames. Null → live fallback.
		apNameSnapshot: text('ap_name_snapshot'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('payment_transactions_user_id_idx').on(t.userId),
		index('payment_transactions_created_at_idx').on(t.createdAt),
		index('payment_transactions_status_idx').on(t.status),
		// One terminal payment = one Finance row. The same payment can arrive under two gateway
		// ids (webhook → payment id; reconcile/poll → checkout id) but always the same reference_no,
		// so a partial unique index lets Postgres reject the divergent duplicate (recorder collapses
		// onto the existing row). Partial (NOT NULL): a failed event may carry no referenceNo.
		uniqueIndex('payment_transactions_reference_no_key')
			.on(t.referenceNo)
			.where(sql`${t.referenceNo} IS NOT NULL`)
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
		// Durable AP attribution: raw circuit-id STRING resolved at checkout alongside network_id
		// (same 5-fallback chain), copied onto payment_transactions at webhook/reconcile time.
		// Survives AP rename/prune where network_id degrades. Null = unresolvable at checkout.
		apCircuitId: text('ap_circuit_id'),
		// Frozen AP label (display_name ?? name) captured at checkout, copied onto payment_transactions
		// alongside ap_circuit_id. The as-was name for Finance. Null = unresolvable → live fallback.
		apNameSnapshot: text('ap_name_snapshot'),
		// Throttle for the on-return poll so a fast-refreshing page can't hammer the gateway.
		lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		settledAt: timestamp('settled_at', { withTimezone: true })
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
		// Durable AP attribution: raw circuit-id STRING resolved best-effort BEFORE the grant
		// transaction opens and threaded into bindMacTx. Carries AP identity for free-time grants
		// (which write no ledger row) and for credit/points tier buys. Survives AP rename/prune
		// where network_id degrades. Null = unresolvable at grant time ("Unattributed").
		apCircuitId: text('ap_circuit_id'),
		// Frozen AP label (display_name ?? name) captured pre-transaction at grant time — same
		// rationale as ap_circuit_id. Null = unresolvable → live fallback.
		apNameSnapshot: text('ap_name_snapshot'),
		status: text('status').notNull(),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		// Device-binding registry: one active row per (user, MAC) = "this device is
		// currently bypassed for this account". boundAt = first bind under the current
		// window; lastSeenAt = refreshed on every (re)bind/dashboard land, drives LRU
		// eviction when the per-account device cap is exceeded. expiresAt mirrors the
		// account window (customer_profile.access_expires_at) so the cron index + router
		// sweep keep working — but the profile window is the authoritative gate.
		boundAt: timestamp('bound_at', { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true })
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
	// Looked up on every OTP request (mac/phone) or scoped check (scope+identifier). UNIQUE per
	// key type so `consumeRateLimit`'s insert-if-absent upsert is race-safe (one counter row per
	// key, never duplicates from a concurrent first attempt). Postgres treats NULLs as distinct,
	// so a mac/phone row (null scope+identifier) never collides under the scope index, etc.
	(t) => [
		uniqueIndex('rate_limits_mac_address_key').on(t.macAddress),
		uniqueIndex('rate_limits_phone_number_key').on(t.phoneNumber),
		uniqueIndex('rate_limits_scope_identifier_key').on(t.scope, t.identifier)
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
	// Points awarded per top-up as a WHOLE-NUMBER percent of the peso amount (10 = 10%).
	// Earned points are floored: floor(pesos * rate / 100). Admin-tunable; 0 disables earning.
	pointsEarnRate: integer('points_earn_rate').notNull().default(10),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});

/**
 * Append-only log of every OTP send attempt, written from the send seam
 * (`apps/customer/src/lib/server/otp.ts`) after the gateway accepts a message.
 *
 * Exists because a gateway ACCEPT is not a DELIVERY: Cast accepts every OTP and the carrier
 * can still reject 100% of them (`dlr_status: "REJECTD"`) — the guest is told "code sent" and
 * nothing arrives, with no log and no alert. The 5-minute sweep cron
 * (`/api/otp/sweep-delivery`) re-checks Cast's DLR status endpoint for `pending` rows and
 * classifies them `rejected` (alerts) or `unknown` (30-min give-up, no alert).
 *
 * Deliberate design notes:
 *  - Provider-agnostic shape: all four providers write a row, only Cast is swept (only Cast has
 *    a DLR endpoint). `provider_message_id` is NULLABLE — the other providers return no id.
 *  - NO unique constraint. This is an attempt log, not an idempotency table; a resend is a new
 *    row. A 23505 on the guest-LOGIN path would lock a guest out, so there is nothing to retry.
 *  - PII: `phone_masked` stores `maskPhone()` output only, never raw E.164. Rows are pruned
 *    unconditionally after 48h on every sweep run.
 */
export const customerOtpDeliveryLog = pgTable(
	'customer_otp_delivery_log',
	{
		id: serial('id').primaryKey(),
		provider: text('provider').notNull(),
		providerMessageId: text('provider_message_id'),
		phoneMasked: text('phone_masked').notNull(),
		// pending | rejected | unknown
		status: text('status').notNull().default('pending'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('customer_otp_delivery_log_provider_status_created_idx').on(
			t.provider,
			t.status,
			t.createdAt
		)
	]
);
