/**
 * Shared data contracts for the admin dashboard.
 *
 * These interfaces are the seam between the frontend and the backend that a
 * teammate is building: pages currently read fixtures from `$lib/mocks` typed
 * against the shapes below. When real `load()` functions land, they return the
 * same shapes and pages switch from `import { … } from '$lib/mocks'` to props.
 */
import type { StaffRole } from '@veent/core';

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
	/** Session row id — the stable, unique key for list rendering. MAC is NOT unique
	 * (multiple grants can share a MAC, e.g. the dev placeholder), so keying a Svelte
	 * each on it throws a duplicate-key error and crashes the dashboard. */
	id: number;
	mac: string;
	package: string;
	/** Remaining time, pre-formatted "MM:SS" or "H:MM" — the server's snapshot at
	 * query time. The dashboard recomputes a live countdown from `expiresAt`; this
	 * is the SSR/no-JS fallback. */
	timeLeft: string;
	tone: StatusTone;
	status: string;
	/** AP/network the session is bound to (network_health.name), or null when the
	 * controller couldn't resolve an AP (stub/dev, wired client). */
	network: string | null;
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
	/** Full user-management table, so the Users page can read the same live stream
	 * (online status, balances, block state) instead of a reload. */
	users: AdminUserRow[];
}

/** Health snapshot for one access point. */
export interface NetworkAp {
	id: string;
	name: string;
	tone: StatusTone;
	status: string;
	/** True when no fresh router sample has landed within the staleness ceiling — the metrics
	 * shown are last-known, not live. Drives a "Stale" chip instead of a misleading "Healthy". */
	stale: boolean;
	/** ISO timestamp of the last router sample for this AP (null if never sampled). Feeds the
	 * page-level "router unreachable, last synced X ago" banner. */
	syncedAt: string | null;
	uptime: string;
	latency: string;
	users: number;
	/** Pre-formatted throughput ("47 Mbps"), or "—" when this AP's firmware doesn't expose per-AP
	 * byte counters (honest AC4 degradation — the number is genuinely unavailable, not zero). */
	throughput: string;
	/** Physical-AP MAC for an auto-discovered AP row (Phase A), or null for interface/pinned rows. */
	mac: string | null;
	/** OLT Option 82 agent-circuit-id this AP is on; the group key. Null on non-AP rows. */
	apCircuitId: string | null;
	/** How this row's attribution was derived: 'circuit-id' marks an auto-discovered AP row; null =
	 * an interface/pinned row (KPI throughput/latency sums are computed over these only). */
	attributionSource: string | null;
	/** Display names of the OTHER APs sharing this AP's circuit-id (a shared-ONU group the router
	 * can't split). Empty for solo APs and non-AP rows. */
	groupPeers: string[];
	/** Operator-entered location for the public locator map; null until set. Raw
	 * numeric strings (decimal degrees), kept as-is for round-tripping into the form. */
	latitude: string | null;
	longitude: string | null;
	address: string | null;
	/** Router AP/interface this pin's user count is bound to; null = unbound. */
	interfaceName: string | null;
	/** Router/AP model id (catalog key in `$lib/router-models`); drives the simulated
	 * coverage radius. Null = use the default model's range. */
	model: string | null;
	/** Operator-calibrated coverage radius in metres, overriding the model's advertised
	 * range. Null = fall back to the model's catalog range. */
	rangeMeters: number | null;
	/** Operator label for the overlap cluster this AP belongs to (mirrored across the
	 * cluster's members on rename). Null = unnamed; the UI shows "Cluster N". */
	clusterName: string | null;
	/** Aggregate download/upload caps enforced on the router for this AP, in Kbps.
	 * Null = uncapped. The card presents these as Mbps. */
	maxDownKbps: number | null;
	maxUpKbps: number | null;
	/** Recent connections attributed to this AP (newest first), for the card's log. */
	logs: ConnectionLog[];
}

/** One device's connection through an AP — a row in the per-network log. */
export interface ConnectionLog {
	/** Short "x ago" label for when it started. */
	at: string;
	mac: string;
	/** Tier name (e.g. "3 Hours") or "Free Time". */
	package: string;
	/** Display status: "Online" | "Expired" | "Revoked". */
	status: string;
	tone: StatusTone;
}

/** A row in the user-management table. */
export interface AdminUserRow {
	id: string;
	/** The guest's phone number in E.164 (e.g. "+639176544521") — customers register by
	 * phone only (no name/email), so this is the identity shown in the table. */
	phone: string;
	/** Credit balance in pesos. */
	balance: number;
	/** Loyalty-points balance (separate wallet, earned on top-ups). */
	points: number;
	/** Lifetime/period usage, pre-formatted (e.g. "4.2 GB"). */
	usage: string;
	tone: StatusTone;
	status: string;
	/** Account has a live access window (online across any of its devices). */
	online: boolean;
	/** Most recent device MAC seen for this user, for the dev "Allow WiFi" grant.
	 * Null if we've never recorded a session MAC for them. */
	lastMac: string | null;
	/** Number of devices currently bound under the account's access window. */
	deviceCount: number;
	/** The bound devices (account-owned access): MAC + last-seen time. */
	devices: { mac: string | null; lastSeenAt: string | null }[];
	/** Account access time remaining, pre-formatted (e.g. "1:23:45"); null if offline. */
	timeLeft: string | null;
	/** Raw remaining access time in ms (for chronological Time-Left sort); null if offline. */
	timeLeftMs: number | null;
	/** Network(s) the user's live device(s) are on (network_health.name, distinct,
	 * comma-joined). Null if offline or no AP resolved (stub/dev, wired client). */
	location: string | null;
}

/**
 * Access level of an admin-side staff member.
 * `owner` holds full control and is never disabled or removed. Everyone provisioned
 * by the owner starts as an `admin`; an active admin can be promoted to `owner`, or
 * granted `system_admin` (manages Issues + Content, but not Staff).
 * Role *values* are DB-driven (admin_role). Sourced from @veent/core (derived from
 * STAFF_ROLE) so the admin and core definitions can never drift.
 */
export type { StaffRole };

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
	/** Raw last-active time (epoch ms) for sorting; null if never active. */
	lastActiveAt: number | null;
	/** Avatar image URL, or null (falls back to initials). */
	image: string | null;
	/** Account-created label, pre-formatted (e.g. "12 Jun 2026"). */
	joined: string;
	/** Raw created time (epoch ms); null only if unset. */
	joinedAt: number | null;
	/** Whether the member has verified their email. */
	emailVerified: boolean;
	/** Whether the member has enrolled a TOTP authenticator. */
	twoFactorEnabled: boolean;
	/** Optional profile contact fields (unset until an edit UI exists). */
	phone: string | null;
	jobTitle: string | null;
	contactEmail: string | null;
}

/** One slice of the Finance "revenue by payment method" donut. */
export interface PaymentMethodSlice {
	/** Raw fund source key, e.g. 'card' | 'gcash' | 'maya-wallet' | 'unknown'. */
	type: string;
	/** Display name (e.g. "GCash"). */
	label: string;
	/** Settled peso amount for this method. */
	amount: number;
	count: number;
	/** Share of total settled amount, 0–100. */
	pct: number;
}

/**
 * One slice of the Finance "revenue by access point" donut. Same shape as
 * PaymentMethodSlice so it renders through the shared <DonutChart>.
 */
export interface ApRevenueSlice {
	/** Stable key: the network_health id as a string, or 'unattributed'. */
	type: string;
	/** AP display name, "AP #<id>" for a pruned AP, or "Unattributed". */
	label: string;
	/** Settled peso amount attributed to this AP. */
	amount: number;
	count: number;
	/** Share of total settled amount, 0–100. */
	pct: number;
}

/** A row in the Finance transactions table. */
export interface TransactionRow {
	id: string;
	/** Raw gateway status (e.g. "PAYMENT_SUCCESS"). */
	status: string;
	/** Badge tone derived from status. */
	statusTone: StatusTone;
	/** Pre-formatted peso amount (e.g. "₱1,200"). */
	amount: string;
	fundSourceType: string;
	fundSourceMasked: string | null;
	receiptNo: string | null;
	buyerName: string;
	buyerEmail: string | null;
	packageName: string | null;
	/** AP the payment came from — name, "AP #<id>" if pruned, or null if unattributed. */
	apName: string | null;
	/** ISO timestamp. */
	createdAt: string;
}

/** A pending owner demotion/removal request awaiting unanimous owner approval.
 *  Mirrors the server's `OpenOwnerChange` ($lib/server/owner-change). */
export interface OwnerChangeRequest {
	id: string;
	targetId: string;
	targetName: string;
	action: 'demote' | 'remove';
	initiatedById: string;
	initiatedByName: string;
	/** Current owners whose approval is required (all owners except the target). */
	requiredOwnerIds: string[];
	/** Of the required owners, those who have approved. */
	approvedOwnerIds: string[];
	expiresAt: number;
	expired: boolean;
}

/** The Finance page in one frame (KPIs + chart + breakdown + first page of rows). */
export interface FinanceSnapshot {
	kpis: Kpi[];
	revenue: RevenuePoint[];
	breakdown: PaymentMethodSlice[];
	/** Settled revenue grouped by access point. */
	apRevenue: ApRevenueSlice[];
	transactions: TransactionRow[];
	/** Total rows matching the filter, for pagination. */
	total: number;
}
