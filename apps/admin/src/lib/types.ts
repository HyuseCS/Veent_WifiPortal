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
	/** Remaining time, pre-formatted "MM:SS" or "H:MM". */
	timeLeft: string;
	tone: StatusTone;
	status: string;
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
