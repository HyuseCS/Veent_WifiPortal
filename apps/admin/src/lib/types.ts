/**
 * Shared data contracts for the admin dashboard.
 *
 * These interfaces are the seam between the frontend and the backend that a
 * teammate is building: pages currently read fixtures from `$lib/mocks` typed
 * against the shapes below. When real `load()` functions land, they return the
 * same shapes and pages switch from `import { … } from '$lib/mocks'` to props.
 */

/** Semantic tone for a status badge — maps to a `--color-*` token. */
export type StatusTone = 'online' | 'warning' | 'blocked';

/** A single headline metric on the dashboard. */
export interface Kpi {
	label: string;
	/** Pre-formatted for display (e.g. "₱12,480", "142"). */
	value: string;
	/** Optional change vs. the previous period (e.g. "+8.2%"). */
	delta?: string;
	trend?: 'up' | 'down' | 'flat';
}

/** One bucket in the revenue chart. */
export interface RevenuePoint {
	/** Axis label (e.g. "Mon", "08:00"). */
	label: string;
	/** Peso amount for the bucket. */
	amount: number;
}

/** A currently-connected device/session shown on the dashboard. */
export interface ActiveSession {
	mac: string;
	package: string;
	/** Remaining time, pre-formatted "MM:SS" or "H:MM" — the server's snapshot at
	 * query time. The dashboard recomputes a live countdown from `expiresAt`; this
	 * is the SSR/no-JS fallback. */
	timeLeft: string;
	tone: StatusTone;
	status: string;
	/** Session expiry as an ISO string, so the client can tick the countdown every
	 * second instead of waiting on the 5s SSE snapshot. Null if no expiry recorded. */
	expiresAt: string | null;
}

/** The whole dashboard in one frame — what the live feed re-queries and pushes
 * over SSE on each DB notify, and what `load()` seeds for SSR first paint. */
export interface DashboardSnapshot {
	kpis: Kpi[];
	revenue: RevenuePoint[];
	activeSessions: ActiveSession[];
	networks: NetworkAp[];
}

/** Health snapshot for one access point. */
export interface NetworkAp {
	id: string;
	name: string;
	tone: StatusTone;
	status: string;
	uptime: string;
	latency: string;
	users: number;
	throughput: string;
}

/** A row in the user-management table. */
export interface AdminUserRow {
	id: string;
	name: string;
	email: string;
	/** Credit balance in pesos. */
	balance: number;
	/** Lifetime/period usage, pre-formatted (e.g. "4.2 GB"). */
	usage: string;
	tone: StatusTone;
	status: string;
}

/**
 * Access level of an admin-side staff member.
 * `owner` holds full control and is never disabled or removed. Everyone provisioned
 * by the owner starts as an `admin`; an active admin can be promoted to `owner`.
 * Role *values* are DB-driven (admin_role); this union names the ones with behaviour.
 */
export type StaffRole = 'owner' | 'admin';

/**
 * Lifecycle state of a staff member.
 * `pending` = activation email sent, awaiting the member to activate their account.
 * Maps to a `StatusTone` for badge coloring (active→online, pending→warning,
 * disabled→blocked).
 */
export type StaffStatus = 'active' | 'pending' | 'disabled';

/** A row in the staff-management table. */
export interface StaffMember {
	id: string;
	name: string;
	email: string;
	role: StaffRole;
	/** Human display name for the role, sourced from admin_role.label. */
	roleLabel: string;
	status: StaffStatus;
	/** Last-active label, pre-formatted (e.g. "2h ago", "—"). */
	lastActive: string;
}
