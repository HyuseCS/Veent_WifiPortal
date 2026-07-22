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
	bigint,
	text,
	boolean,
	numeric,
	timestamp,
	uniqueIndex,
	check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { adminUser, adminSession } from './auth-admin';

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
 *
 * Self-service contact fields (edited from the staff member's own Profile page):
 *   phone / jobTitle / contactEmail — optional display/contact details. `contactEmail`
 *   is a separate reach-me address; the LOGIN email stays on admin_user (the auth
 *   identity). The avatar lives in the better-auth `admin_user.image` column.
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
	lastActiveAt: timestamp('last_active_at'),
	phone: text('phone'),
	jobTitle: text('job_title'),
	contactEmail: text('contact_email')
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
export const routerModel = pgTable(
	'router_model',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		rangeMeters: integer('range_meters').notNull(),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	// DB-level backstop: range is metres, so a zero/negative is always corrupt. The admin action
	// already enforces 10–5000, this guards direct inserts and future migrations.
	(t) => [check('router_model_range_meters_positive', sql`${t.rangeMeters} > 0`)]
);

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
	// Operator-set display name. `name` is the sweep's working identity — the natural key the health
	// upsert writes on (interface rows) and re-derives from the DHCP hostname every refresh (AP rows),
	// so a custom name written to `name` is clobbered/pruned on the next sample. `display_name` is the
	// human label the sweep never touches: the UI and durable AP attribution show `display_name ?? name`.
	// Null = no override (fall back to the router-derived `name`).
	displayName: text('display_name'),
	online: boolean('online').notNull().default(true),
	// Whether the router's uplink/WAN was reachable at the last sample (shared across a router's
	// interfaces). `online` is the raw per-AP LINK state; an AP with `online=true` but `wan_ok=false`
	// (radio up, internet dead) is NOT serving guests, so the outage sweep treats it as down. Defaults
	// true so a never-sampled/legacy row is never mistaken for a WAN outage.
	wanOk: boolean('wan_ok').notNull().default(true),
	// When the AP most recently transitioned online→offline (cleared on recovery). Drives the
	// outage sweep's PAUSE debounce: guests on the AP are auto-paused only after it has been down for
	// a sustained period, not on a brief blip.
	offlineSince: timestamp('offline_since'),
	// Mirror of offline_since for the RESUME side (cleared while offline). The outage sweep resumes a
	// held guest only after their AP has been confirmed back UP for a sustained period — so a flapping
	// AP can't un-freeze paid time on the first "online" sample and burn it while service is unstable.
	onlineSince: timestamp('online_since'),
	uptimePct: numeric('uptime_pct', { precision: 5, scale: 2 }).notNull().default('0'),
	latencyMs: integer('latency_ms'),
	users: integer('users').notNull().default(0),
	// Per-AP/interface throughput in Mbps. NULLABLE for Phase A per-AP visibility: an AP row whose
	// firmware doesn't expose hotspot byte counters carries `null` = "traffic unavailable" (the card
	// shows "—"). Interface/pinned rows and every existing writer still write a number; default 0.
	throughputMbps: integer('throughput_mbps').default(0),
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
	clusterName: text('cluster_name'),
	// Aggregate per-AP bandwidth caps, enforced on the router as a `/queue/simple` on this
	// hotspot's client subnet (so all guests on the AP share the cap, bypass bindings and
	// all). Kilobits/s; null = uncapped. Operator-set from the admin Networks card and
	// preserved across the health sweep (see refreshNetworkHealth — telemetry-only upsert).
	maxDownKbps: integer('max_down_kbps'),
	maxUpKbps: integer('max_up_kbps'),
	// ── Phase A per-AP visibility (router-side DHCP Option 82) ─────────────────────────────────
	// Physical-AP identity for auto-discovered AP rows. NULL on interface/pinned rows (today's
	// semantics). Unique (Postgres allows multiple NULLs) so an AP row is keyed on MAC, not IP —
	// a lease IP change updates the same row. Uppercased at write time.
	mac: text('mac'),
	// Raw OLT-inserted Option 82 agent-circuit-id string (e.g. "OLT-9 xpon 0/1/0/4:16.3.70"). The
	// join key between a client lease and its AP; APs sharing an ONU carry the same value (grouped
	// at render time). NULL on non-AP rows.
	apCircuitId: text('ap_circuit_id'),
	// How this row's identity/attribution was derived. Phase A writes 'circuit-id'; 'ap-api' is
	// reserved vocabulary for Phase B (Fatap AP API). NULL = interface/pinned row (not an AP row).
	attributionSource: text('attribution_source'),
	// Last cumulative attributed hotspot byte sum for this AP (Section 5 traffic-delta basis).
	// NULL until the first counter sample lands, or permanently NULL when firmware hides counters.
	trafficBytes: bigint('traffic_bytes', { mode: 'number' })
}, (t) => [
	// `name` is the natural key the health sweep upserts on (one row per router interface /
	// map pin). Unique so concurrent sweeps can't race two rows for the same AP, and so the
	// service can use onConflictDoUpdate instead of select-then-insert.
	uniqueIndex('network_health_name_key').on(t.name),
	// AP rows are keyed on `mac` (physical-AP identity). Unique so an AP-lease IP change updates the
	// same row (AC8); Postgres permits multiple NULLs, so interface/pinned rows are unaffected.
	uniqueIndex('network_health_mac_key').on(t.mac),
	// A cap is either unset or a positive rate — a zero/negative Kbps is always corrupt.
	// Mirrors the router_model range check; guards direct inserts and future migrations.
	check('network_health_max_down_kbps_positive', sql`${t.maxDownKbps} IS NULL OR ${t.maxDownKbps} > 0`),
	check('network_health_max_up_kbps_positive', sql`${t.maxUpKbps} IS NULL OR ${t.maxUpKbps} > 0`)
]);

/**
 * The device MAC that got an admin internet bypass (B3.2), stashed at login so the sliding
 * renewal and logout revoke can find it without re-doing the flaky live IP→MAC lookup — replacing
 * the old signed cookie, which didn't reliably survive the login form-action to logout.
 *
 * Keyed to the better-auth session (its unique `token`), so each device/login owns its own row:
 * a staff member on two devices has two rows, and each logout revokes only its own binding. The
 * FK cascades the row away when the session is deleted (logout) or expires — the router revoke on
 * logout is what makes sign-out instant; the cascade is just cleanup. `updated_at` records the last
 * slide for debugging (the renewal throttle itself is in-memory in the app).
 *
 * ponytail: keyed by `token` (in hand at both login `res.token` and later `locals.session.token`)
 * so no session-id lookup is needed; better-auth doesn't rotate session tokens, so the FK is stable
 * for the session's life. Switch the key to `session.id` if token rotation is ever enabled.
 */
export const adminBypassDevice = pgTable('admin_bypass_device', {
	sessionToken: text('session_token')
		.primaryKey()
		.references(() => adminSession.token, { onDelete: 'cascade' }),
	mac: text('mac').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Durable last-known-circuit-per-client cache (Phase A per-AP visibility). Maps a client device MAC
 * to the OLT Option 82 agent-circuit-id observed on its most recent DHCP lease that carried one.
 *
 * Exists because a unicast DHCP renewal often OMITS the agent-circuit-id (only the initial
 * broadcast DISCOVER passes through the OLT relay that inserts Option 82). Without a cache, a
 * renewing device would fall out of its AP's client count until it re-broadcasts. The cache holds
 * the last-known circuit so attribution tolerates those gaps (SPEC AC6); a blank/absent circuit-id
 * never overwrites a cached value. Internal to the @veent/core service layer — no app reads it
 * directly. Harmless when AP rows don't exist (a lookup simply finds no matching AP).
 */
export const networkClientAttribution = pgTable('network_client_attribution', {
	mac: text('mac').primaryKey(),
	circuitId: text('circuit_id').notNull(),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});
