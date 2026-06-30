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
import {
	pgTable,
	serial,
	integer,
	text,
	boolean,
	numeric,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
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
 * Catalog of router/AP models — the operator-editable source of truth for a model's
 * advertised coverage range. `network_health.model` stores `id` (a slug key), not the
 * range, so editing `range_meters` here re-sizes every AP on that model automatically.
 *
 *   id          — slug key stored on network_health.model (e.g. 'suncomm-ap3000g').
 *   name        — human display name ('Suncomm AP3000G').
 *   rangeMeters — advertised/illustrative outdoor range in metres (not survey-grade).
 *   sortOrder   — display order; the lowest is the *default* model (new pins + the
 *                 fallback range for an AP with a null/unknown model). No is_default
 *                 flag: deleting the default simply promotes the next, never orphans.
 */
export const routerModel = pgTable('router_model', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	rangeMeters: integer('range_meters').notNull(),
	sortOrder: integer('sort_order').notNull().default(0)
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
	address: text('address'),
	// Operator-set binding: the router AP/interface name whose connected clients
	// count toward this pin (network_sessions attribution). Lets a map pin be named
	// anything while still tracking a specific interface. Null = no binding.
	interfaceName: text('interface_name'),
	// Router/AP model id — a slug key into the `router_model` catalog. Drives the
	// simulated coverage radius on the map. Loose ref (no FK): an unknown/null model
	// falls back to the default model's range, so deleting a catalog row is safe.
	model: text('model'),
	// Operator-calibrated coverage radius in metres, overriding the model's advertised
	// range to match real-world reach (walls, height, interference). Null = fall back to
	// the model's catalog range.
	rangeMeters: integer('range_meters'),
	// Operator label for the overlap cluster this AP belongs to. Clusters are computed live
	// from coverage overlap (no stable id), so the name rides on the members: renaming a
	// cluster mirrors this value across all its current members. Null = unnamed (shown as
	// "Cluster N" in the UI).
	clusterName: text('cluster_name')
}, (t) => [
	// `name` is the natural key the health sweep upserts on (one row per router interface /
	// map pin). Unique so concurrent sweeps can't race two rows for the same AP, and so the
	// service can use onConflictDoUpdate instead of select-then-insert.
	uniqueIndex('network_health_name_key').on(t.name)
]);
