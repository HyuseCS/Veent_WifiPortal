/**
 * Domain tables owned by the admin (management dashboard) module.
 *
 * better-auth owns `admin_user` (id / name / email / ...). The dashboard's own
 * staff fields (role, lifecycle status, last-active) live in `admin_profile`, a
 * 1:1 extension of the auth user — the same pattern `customer_profile` uses for
 * the portal side, so the hand-maintained auth tables stay clean.
 *
 * `network_health` is an admin-owned snapshot table for the Networks page. Until
 * a real router/controller telemetry feed exists it is seeded with sample rows;
 * the shape matches what a future feed would write.
 */
import { pgTable, serial, integer, text, boolean, numeric, timestamp } from 'drizzle-orm/pg-core';
import { adminUser } from './auth-admin';

/**
 * Lookup table of staff roles — the single source of truth for what a role *is*.
 * `admin_profile.role` is a foreign key into this table, so roles are DB-driven
 * rather than hardcoded.
 *   key              — the stored role value ('owner', 'admin', …); the FK target.
 *   label            — human display name ('Owner', 'Admin').
 *   assignable       — may this role be handed out through the app (vs. bootstrap
 *                      only)? `owner` is false: it's reached by promotion, not invite.
 *   requiresApproval — scaffold for the deferred "all owners must confirm" flow;
 *                      true for `owner` so the future approval gate has its flag.
 *   sortOrder        — display ordering.
 */
export const adminRole = pgTable('admin_role', {
	key: text('key').primaryKey(),
	label: text('label').notNull(),
	description: text('description'),
	assignable: boolean('assignable').notNull().default(true),
	requiresApproval: boolean('requires_approval').notNull().default(false),
	sortOrder: integer('sort_order').notNull().default(0)
});

/**
 * Staff-domain extension of the better-auth admin user (1:1).
 *   role   — FK into admin_role: 'owner' (bootstrap/promotion) | 'admin' (invited)
 *   status — 'pending' (invited, awaiting activation) | 'active' | 'disabled'
 */
export const adminProfile = pgTable('admin_profile', {
	userId: text('user_id')
		.primaryKey()
		.references(() => adminUser.id, { onDelete: 'cascade' }),
	role: text('role')
		.notNull()
		.default('admin')
		.references(() => adminRole.key),
	status: text('status').notNull().default('pending'),
	lastActiveAt: timestamp('last_active_at')
});

/**
 * Per-access-point health snapshot (ERD has none yet — admin-owned). Raw metrics
 * only; the app derives display tone/labels (like the other admin view mappers).
 *
 * Location columns (latitude/longitude/address) are operator-entered from the
 * admin Networks page and power the public "Radius" locator map (apps/locator).
 * Nullable: an AP with no coordinates simply isn't plotted on the map.
 */
export const networkHealth = pgTable('network_health', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	online: boolean('online').notNull().default(true),
	uptimePct: numeric('uptime_pct', { precision: 5, scale: 2 }).notNull().default('0'),
	latencyMs: integer('latency_ms'),
	users: integer('users').notNull().default(0),
	throughputMbps: integer('throughput_mbps').notNull().default(0),
	lastSampleAt: timestamp('last_sample_at').notNull().defaultNow(),
	latitude: numeric('latitude', { precision: 9, scale: 6 }),
	longitude: numeric('longitude', { precision: 9, scale: 6 }),
	address: text('address')
});
