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
	timestamp
} from 'drizzle-orm/pg-core';
import { adminUser } from './auth-admin';

/**
 * Staff-domain extension of the better-auth admin user (1:1).
 *   role   — 'owner' (singular bootstrap account) | 'admin' (everyone invited)
 *   status — 'pending' (invited, awaiting activation) | 'active' | 'disabled'
 */
export const adminProfile = pgTable('admin_profile', {
	userId: text('user_id')
		.primaryKey()
		.references(() => adminUser.id, { onDelete: 'cascade' }),
	role: text('role').notNull().default('admin'),
	status: text('status').notNull().default('pending'),
	lastActiveAt: timestamp('last_active_at')
});

/**
 * Per-access-point health snapshot (ERD has none yet — admin-owned). Raw metrics
 * only; the app derives display tone/labels (like the other admin view mappers).
 */
export const networkHealth = pgTable('network_health', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	online: boolean('online').notNull().default(true),
	uptimePct: numeric('uptime_pct', { precision: 5, scale: 2 }).notNull().default('0'),
	latencyMs: integer('latency_ms'),
	users: integer('users').notNull().default(0),
	throughputMbps: integer('throughput_mbps').notNull().default(0),
	lastSampleAt: timestamp('last_sample_at').notNull().defaultNow()
});
