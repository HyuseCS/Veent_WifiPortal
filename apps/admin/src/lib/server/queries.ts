/**
 * Server-side queries that map the shared DB into the admin view shapes declared
 * in `$lib/types`. Display formatting (₱, MM:SS, tones) lives here — it's
 * presentation, not domain logic, so it stays in the app rather than @veent/core.
 *
 * These back the `load()` functions that replace `$lib/mocks`.
 */
import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	ne,
	sql,
	type SQL
} from 'drizzle-orm';
import {
	type DB,
	customerUser,
	customerProfile,
	networkSessions,
	creditLedger,
	pointsLedger,
	packages,
	paymentTransactions,
	adminUser,
	adminProfile,
	adminRole,
	networkHealth,
	routerModel,
	isNetworkHealthStale
} from '@veent/db';
import { SESSION_STATUS, LEDGER_TYPE, resolveApCircuitLabel } from '@veent/core';
import type {
	ActiveSession,
	AdminUserRow,
	ApRevenueSlice,
	ConnectionLog,
	DashboardSnapshot,
	Kpi,
	NetworkAp,
	PaymentMethodSlice,
	RevenuePoint,
	StaffMember,
	StaffRole,
	StaffStatus,
	StatusTone,
	TransactionRow,
	UnifiedTransactionRow
} from '$lib/types';

/**
 * Batch-resolve durable AP circuit-id strings to their display labels (friendly name / raw string /
 * "Unattributed") — one lookup per UNIQUE circuit-id on the page, NOT one per row (avoids N+1
 * against network_health). Null circuit-ids never hit the DB. Returns circuit-id → label.
 */
async function resolveApCircuitLabels(
	db: DB,
	circuitIds: readonly (string | null)[]
): Promise<Map<string, string>> {
	const unique = [...new Set(circuitIds.filter((c): c is string => c != null))];
	const map = new Map<string, string>();
	await Promise.all(
		unique.map(async (cid) => {
			map.set(cid, await resolveApCircuitLabel(db, cid));
		})
	);
	return map;
}

/** The label for one row's circuit-id, using a pre-resolved batch map. */
function apCircuitLabelOf(circuitId: string | null, labels: Map<string, string>): string {
	return circuitId == null ? 'Unattributed' : (labels.get(circuitId) ?? circuitId);
}

const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;

/** "MM:SS" under an hour, else "H:MM:SS"; clamps negatives to 00:00. */
function formatTimeLeft(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** User-management table rows. */
export async function listUsers(db: DB, now: Date = new Date()): Promise<AdminUserRow[]> {
	const rows = await db
		.select({
			id: customerUser.id,
			// Customers register by phone only — the canonical identity for the table.
			phone: customerUser.phoneNumber,
			balance: customerProfile.creditBalance,
			points: customerProfile.pointsBalance,
			blocked: customerProfile.blocked,
			// Account-owned access window (source of truth for online + time-left).
			accessExpiresAt: customerProfile.accessExpiresAt,
			// Non-null = window FROZEN (paused): devices unbound, no internet flows, so the
			// account is not "online" and its time-left is held, not ticking.
			accessPausedAt: customerProfile.accessPausedAt
		})
		.from(customerUser)
		.leftJoin(customerProfile, eq(customerProfile.userId, customerUser.id))
		.orderBy(customerUser.phoneNumber);

	// One pass over sessions (newest first) yields: the most recent device MAC (any
	// status, for the dev Allow-WiFi grant) and the list of currently-BOUND devices
	// (active rows) per account, with their last-seen times.
	const sessions = await db
		.select({
			userId: networkSessions.userId,
			mac: networkSessions.macAddress,
			status: networkSessions.status,
			lastSeenAt: networkSessions.lastSeenAt,
			network: networkHealth.name
		})
		.from(networkSessions)
		.leftJoin(networkHealth, eq(networkHealth.id, networkSessions.networkId))
		.orderBy(desc(networkSessions.startedAt));
	const lastMacByUser = new Map<string, string>();
	const devicesByUser = new Map<string, { mac: string | null; lastSeenAt: string | null }[]>();
	// Distinct AP names per user, across their active sessions (Set dedupes a user with
	// several devices on the same AP; null networkId — unresolved — is skipped).
	const networksByUser = new Map<string, Set<string>>();
	for (const s of sessions) {
		if (s.mac && !lastMacByUser.has(s.userId)) lastMacByUser.set(s.userId, s.mac);
		if (s.status === SESSION_STATUS.active) {
			if (!devicesByUser.has(s.userId)) devicesByUser.set(s.userId, []);
			devicesByUser
				.get(s.userId)!
				.push({ mac: s.mac, lastSeenAt: s.lastSeenAt ? s.lastSeenAt.toISOString() : null });
			if (s.network) {
				if (!networksByUser.has(s.userId)) networksByUser.set(s.userId, new Set());
				networksByUser.get(s.userId)!.add(s.network);
			}
		}
	}

	return rows.map((r) => {
		const balance = Number(r.balance ?? 0);
		// A paused account has no live devices and isn't passing traffic — treat as offline.
		const online =
			!r.accessPausedAt && !!r.accessExpiresAt && r.accessExpiresAt.getTime() > now.getTime();
		const devices = online ? (devicesByUser.get(r.id) ?? []) : [];
		let tone: StatusTone = 'online';
		let status = 'Active';
		if (r.blocked) {
			tone = 'blocked';
			status = 'Blocked';
		} else if (balance <= 0) {
			// Empty wallet — can't buy any paid access (Free Time still works). Amber like Low
			// Balance, but a distinct label so staff can spot fully-drained accounts at a glance.
			tone = 'warning';
			status = 'No credits';
		} else if (balance < 10) {
			tone = 'warning';
			status = 'Low Balance';
		}
		const timeLeftMs =
			online && r.accessExpiresAt ? r.accessExpiresAt.getTime() - now.getTime() : null;
		return {
			id: r.id,
			phone: r.phone ?? '—',
			balance,
			points: Number(r.points ?? 0),
			usage: '—', // byte-level usage isn't tracked yet (needs accounting feed)
			tone,
			status,
			online,
			lastMac: lastMacByUser.get(r.id) ?? null,
			deviceCount: devices.length,
			devices,
			timeLeft: timeLeftMs != null ? formatTimeLeft(timeLeftMs) : null,
			timeLeftMs,
			location: online ? ([...(networksByUser.get(r.id) ?? [])].join(', ') || null) : null
		};
	});
}

/** Currently-connected sessions (initial snapshot; SSE streams updates). */
export async function listActiveSessions(db: DB, now: Date = new Date()): Promise<ActiveSession[]> {
	// Package is account-level (customer_profile.access_package_id), so every device bound
	// under one account's window shows the SAME tier — not each device's own bind-time package.
	const rows = await db
		.select({
			id: networkSessions.id,
			macAddress: networkSessions.macAddress,
			expiresAt: networkSessions.expiresAt,
			packageName: packages.name,
			networkName: networkHealth.name,
			networkDisplayName: networkHealth.displayName
		})
		.from(networkSessions)
		.leftJoin(customerProfile, eq(customerProfile.userId, networkSessions.userId))
		.leftJoin(packages, eq(packages.id, customerProfile.accessPackageId))
		.leftJoin(networkHealth, eq(networkHealth.id, networkSessions.networkId))
		.where(eq(networkSessions.status, SESSION_STATUS.active))
		.orderBy(desc(networkSessions.startedAt));

	return rows.map((r) => {
		const msLeft = r.expiresAt ? r.expiresAt.getTime() - now.getTime() : 0;
		let tone: StatusTone = 'online';
		let status = 'Online';
		if (msLeft <= 0) {
			tone = 'blocked';
			status = 'Expired';
		} else if (msLeft < 3 * 60 * 1000) {
			tone = 'warning';
			status = 'Low Time';
		}
		return {
			id: r.id,
			mac: r.macAddress ?? '—',
			package: r.packageName ?? 'Free Time',
			network: r.networkDisplayName ?? r.networkName ?? null,
			timeLeft: formatTimeLeft(msLeft),
			tone,
			status,
			expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null
		};
	});
}

/** The full admin live frame: KPIs + revenue + active sessions + network health +
 * the user table. Pure composition of the queries below — seeds SSR and is what the
 * live feed re-queries per DB notify, so the Dashboard, Networks, and Users pages all
 * read one stream. */
export async function dashboardSnapshot(db: DB): Promise<DashboardSnapshot> {
	const [kpis, revenue, activeSessions, networks, users] = await Promise.all([
		dashboardKpis(db),
		revenueByDay(db),
		listActiveSessions(db),
		listNetworkHealth(db),
		listUsers(db)
	]);
	return { kpis, revenue, activeSessions, networks, users };
}

/** Headline KPIs. Deltas are omitted (no period-over-period baseline yet).
 * Active-session count is intentionally absent — the Active Sessions table covers it. */
export async function dashboardKpis(db: DB): Promise<Kpi[]> {
	const [[free], [revenue], [avg]] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(networkSessions)
			.where(isNull(networkSessions.packageId)),
		db
			.select({ total: sql<number>`coalesce(sum(${packages.fiatCost}), 0)::float` })
			.from(creditLedger)
			.innerJoin(packages, eq(packages.id, creditLedger.packageId))
			.where(eq(creditLedger.type, LEDGER_TYPE.topup)),
		db
			.select({
				mins: sql<number>`coalesce(avg(extract(epoch from (${networkSessions.expiresAt} - ${networkSessions.startedAt})) / 60), 0)::float`
			})
			.from(networkSessions)
	]);

	return [
		{ label: 'Gross Revenue', value: peso(revenue?.total ?? 0) },
		{ label: 'Free-Time Grants', value: String(free?.n ?? 0) },
		{ label: 'Avg. Session', value: `${Math.round(avg?.mins ?? 0)}m` }
	];
}

/** Gross revenue per day for the last 7 days (peso). */
export async function revenueByDay(db: DB): Promise<RevenuePoint[]> {
	const rows = await db
		.select({
			day: sql<string>`to_char(date_trunc('day', ${creditLedger.createdAt}), 'Dy')`,
			amount: sql<number>`coalesce(sum(${packages.fiatCost}), 0)::float`
		})
		.from(creditLedger)
		.innerJoin(packages, eq(packages.id, creditLedger.packageId))
		.where(
			and(
				eq(creditLedger.type, LEDGER_TYPE.topup),
				// Start-of-day 6 days ago → today = exactly 7 distinct calendar days, so
				// the weekday labels ('Dy') can't collide (a rolling 7×24h window spans 8
				// dates and could yield two same-weekday buckets).
				sql`${creditLedger.createdAt} >= date_trunc('day', now()) - interval '6 days'`
			)
		)
		.groupBy(sql`date_trunc('day', ${creditLedger.createdAt})`)
		.orderBy(sql`date_trunc('day', ${creditLedger.createdAt})`);

	return rows.map((r) => ({ label: r.day, amount: r.amount }));
}

/** Coarse "Xs/m/h/d ago" label; "—" when never seen. */
function formatLastActive(at: Date | null, now: Date = new Date()): string {
	if (!at) return '—';
	const secs = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
	if (secs < 60) return 'Just now';
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 7) return `${days}d ago`;
	return `${Math.floor(days / 7)}w ago`;
}

/** Absolute join date, e.g. "12 Jun 2026" (en-GB day-month order for PH). */
function formatJoined(at: Date | null): string {
	if (!at) return '—';
	return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Display name for one staff member, or null if no such user. Used by the promote
 *  step-up to enforce the type-to-confirm gate server-side (not just in the UI). */
export async function getStaffName(db: DB, userId: string): Promise<string | null> {
	const [row] = await db
		.select({ name: adminUser.name })
		.from(adminUser)
		.where(eq(adminUser.id, userId))
		.limit(1);
	return row?.name ?? null;
}

/** Staff-management table rows (admin_user joined to its admin_profile). */
export async function listStaff(db: DB): Promise<StaffMember[]> {
	const rows = await db
		.select({
			id: adminUser.id,
			name: adminUser.name,
			email: adminUser.email,
			role: adminProfile.role,
			roleLabel: adminRole.label,
			status: adminProfile.status,
			lastActiveAt: adminProfile.lastActiveAt,
			// Profile-detail fields (surfaced in the member profile modal). All live on the
			// two tables already joined below — no extra joins, no new data exposure.
			image: adminUser.image,
			createdAt: adminUser.createdAt,
			emailVerified: adminUser.emailVerified,
			twoFactorEnabled: adminUser.twoFactorEnabled,
			phone: adminProfile.phone,
			jobTitle: adminProfile.jobTitle,
			contactEmail: adminProfile.contactEmail
		})
		.from(adminUser)
		.innerJoin(adminProfile, eq(adminProfile.userId, adminUser.id))
		// Role display name is DB-driven (admin_role), not hardcoded in the view.
		.innerJoin(adminRole, eq(adminRole.key, adminProfile.role))
		// Owner first, then alphabetical — keeps the singular owner pinned to the top.
		.orderBy(asc(adminProfile.role), asc(adminUser.name));

	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		email: r.email,
		role: r.role as StaffRole,
		roleLabel: r.roleLabel,
		status: r.status as StaffStatus,
		lastActive: formatLastActive(r.lastActiveAt),
		lastActiveAt: r.lastActiveAt ? r.lastActiveAt.getTime() : null,
		image: r.image,
		joined: formatJoined(r.createdAt),
		joinedAt: r.createdAt ? r.createdAt.getTime() : null,
		emailVerified: r.emailVerified,
		// two_factor_enabled is nullable (defaults false) → normalise to a real boolean.
		twoFactorEnabled: r.twoFactorEnabled ?? false,
		phone: r.phone,
		jobTitle: r.jobTitle,
		contactEmail: r.contactEmail
	}));
}

/** Latency (ms) at/above which an AP is flagged "Degraded". Real internet RTT to
 * the probe host runs ~40–80ms on a healthy link, so the bar sits well above that
 * — only a genuinely slow path (>100ms) raises an alert, not normal jitter. */
const LATENCY_DEGRADED_MS = 100;

/** Per-AP health cards. Raw metrics → display tone/labels (presentation lives here).
 * `users` is the live count of active, unexpired sessions attributed to each AP
 * (network_sessions.network_id), not the router's coarse per-interface sample. */
export async function listNetworkHealth(db: DB, now: Date = new Date()): Promise<NetworkAp[]> {
	const rows = await db.select().from(networkHealth).orderBy(asc(networkHealth.name));

	// Active users per AP, in one grouped pass.
	const counts = await db
		.select({ networkId: networkSessions.networkId, n: sql<number>`count(*)::int` })
		.from(networkSessions)
		.where(and(eq(networkSessions.status, SESSION_STATUS.active), gt(networkSessions.expiresAt, now)))
		.groupBy(networkSessions.networkId);
	const activeByNetwork = new Map<number, number>();
	for (const c of counts) if (c.networkId != null) activeByNetwork.set(c.networkId, c.n);

	// Recent connections per AP for the card log (newest first, capped per AP).
	// ponytail: wide-then-slice — pull the 400 newest sessions globally, then keep the
	// first 15 per AP in memory. Bounded and fine while AP count is small; the ceiling is
	// that with many APs the 400-row window could starve a low-traffic AP of its log.
	// Upgrade path if that happens: a per-AP LATERAL (top-15-per-network) or pagination.
	const LOGS_PER_AP = 15;
	const logRows = await db
		.select({
			networkId: networkSessions.networkId,
			mac: networkSessions.macAddress,
			status: networkSessions.status,
			startedAt: networkSessions.startedAt,
			packageName: packages.name
		})
		.from(networkSessions)
		.leftJoin(packages, eq(packages.id, networkSessions.packageId))
		.where(isNotNull(networkSessions.networkId))
		.orderBy(desc(networkSessions.startedAt))
		.limit(400);
	const logsByNetwork = new Map<number, ConnectionLog[]>();
	for (const r of logRows) {
		if (r.networkId == null) continue;
		const list = logsByNetwork.get(r.networkId);
		if (list && list.length >= LOGS_PER_AP) continue;
		const online = r.status === SESSION_STATUS.active;
		const expired = r.status === SESSION_STATUS.expired;
		const entry: ConnectionLog = {
			at: formatLastActive(r.startedAt, now),
			mac: r.mac ?? '—',
			package: r.packageName ?? 'Free Time',
			status: online ? 'Online' : expired ? 'Expired' : 'Revoked',
			tone: online ? 'online' : expired ? 'warning' : 'blocked'
		};
		if (list) list.push(entry);
		else logsByNetwork.set(r.networkId, [entry]);
	}

	// Group peers: AP rows sharing a non-null circuit-id (attributionSource='circuit-id') form a
	// shared-ONU group the router can't split. Precompute each circuit-id's member names so a card
	// can name the OTHER APs it shares an ONU with (AC5). Non-AP rows never participate.
	// Operator display name wins over the sweep-managed `name` everywhere the label is shown.
	const label = (r: (typeof rows)[number]): string => r.displayName ?? r.name;
	const namesByCircuit = new Map<string, string[]>();
	for (const r of rows) {
		if (r.attributionSource === 'circuit-id' && r.apCircuitId) {
			const list = namesByCircuit.get(r.apCircuitId);
			if (list) list.push(label(r));
			else namesByCircuit.set(r.apCircuitId, [label(r)]);
		}
	}

	return rows.map((r) => {
		const uptime = Number(r.uptimePct);
		// B3.5: if no fresh sample has landed within the ceiling, the stored online/uptime is no
		// longer trustworthy — surface "Stale" rather than a confidently-wrong "Healthy". Checked
		// first so it overrides the metric-based tones below.
		const stale = isNetworkHealthStale(r.lastSampleAt, now);
		let tone: StatusTone = 'online';
		let status = 'Healthy';
		if (stale) {
			tone = 'warning';
			status = 'Stale';
		} else if (!r.online) {
			tone = 'blocked';
			status = 'Offline';
		} else if (uptime < 99 || (r.latencyMs ?? 0) > LATENCY_DEGRADED_MS) {
			tone = 'warning';
			status = 'Degraded';
		}
		return {
			id: String(r.id),
			name: label(r),
			tone,
			status,
			stale,
			syncedAt: r.lastSampleAt ? r.lastSampleAt.toISOString() : null,
			uptime: `${uptime.toFixed(1)}%`,
			latency: r.latencyMs == null ? '—' : `${r.latencyMs}ms`,
			users: activeByNetwork.get(r.id) ?? 0,
			// Null throughput = per-AP counters unavailable on this firmware → honest "—" (AC4). Every
			// consumer already parses the leading number (num()/parseFloat → NaN for "—", filtered), so
			// this display-string guard is the single null-safety seam (E2).
			throughput: r.throughputMbps == null ? '—' : `${r.throughputMbps} Mbps`,
			mac: r.mac,
			apCircuitId: r.apCircuitId,
			attributionSource: r.attributionSource,
			groupPeers:
				r.attributionSource === 'circuit-id' && r.apCircuitId
					? (namesByCircuit.get(r.apCircuitId) ?? []).filter((n) => n !== label(r))
					: [],
			latitude: r.latitude,
			longitude: r.longitude,
			address: r.address,
			interfaceName: r.interfaceName,
			model: r.model,
			rangeMeters: r.rangeMeters,
			clusterName: r.clusterName,
			maxDownKbps: r.maxDownKbps,
			maxUpKbps: r.maxUpKbps,
			logs: logsByNetwork.get(r.id) ?? []
		};
	});
}

/** Set (or clear) an AP's operator display name — the human label shown on the card and in
 * durable transaction attribution. Writes ONLY `display_name`; the sweep-managed `name` is left
 * untouched, so the override survives every router refresh. Blank/null clears it (revert to the
 * router-derived name). */
export async function setApDisplayName(
	db: DB,
	id: number,
	displayName: string | null
): Promise<void> {
	await db.update(networkHealth).set({ displayName }).where(eq(networkHealth.id, id));
}

/** Bind (or clear) the router AP/interface whose clients count toward this pin.
 * Drives per-AP active-user attribution without relying on name-matching. */
export async function setNetworkInterface(
	db: DB,
	id: number,
	interfaceName: string | null
): Promise<void> {
	await db.update(networkHealth).set({ interfaceName }).where(eq(networkHealth.id, id));
}

/**
 * Set an AP's router-side config from the Networks card in one write: the interface binding
 * plus the aggregate up/down bandwidth caps (Kbps; null = uncapped). Returns the row's
 * canonical `name` so the caller can enforce the caps against the resolved interface
 * (`interfaceName ?? name`), or null if the AP no longer exists.
 */
export async function setApRouterConfig(
	db: DB,
	id: number,
	config: { interfaceName: string | null; maxDownKbps: number | null; maxUpKbps: number | null }
): Promise<{ name: string } | null> {
	const [row] = await db
		.update(networkHealth)
		.set(config)
		.where(eq(networkHealth.id, id))
		.returning({ name: networkHealth.name });
	return row ?? null;
}

/** Placed members of a named cluster (for the coverage-reach assignment check), excluding the
 * AP being assigned. Coords-only rows; the caller computes reach with distanceMeters + rangeFor. */
export async function clusterMembers(
	db: DB,
	name: string,
	excludeId: number | null
): Promise<{ latitude: string | null; longitude: string | null; rangeMeters: number | null; model: string | null }[]> {
	return db
		.select({
			latitude: networkHealth.latitude,
			longitude: networkHealth.longitude,
			rangeMeters: networkHealth.rangeMeters,
			model: networkHealth.model
		})
		.from(networkHealth)
		.where(
			and(
				eq(networkHealth.clusterName, name),
				isNotNull(networkHealth.latitude),
				isNotNull(networkHealth.longitude),
				excludeId == null ? undefined : ne(networkHealth.id, excludeId)
			)
		);
}

/** Name (or clear) the overlap cluster: writes the same label to every current member.
 * Clusters have no stable id — the name rides on the member rows (see schema). No-op on
 * an empty id list. */
export async function setClusterName(
	db: DB,
	ids: number[],
	name: string | null
): Promise<void> {
	if (ids.length === 0) return;
	await db.update(networkHealth).set({ clusterName: name }).where(inArray(networkHealth.id, ids));
}

// ───────────────────────────── Finance page ─────────────────────────────
// Finance reads payment_transactions (the full webhook record), NOT credit_ledger.
// "Revenue (settled)" here = money the gateway actually charged on PAYMENT_SUCCESS,
// which can differ from the Dashboard's packages.fiatCost estimate by design.

const SUCCESS = 'PAYMENT_SUCCESS';

interface DateRange {
	from?: Date;
	to?: Date;
}

/**
 * Predicate shared by every Finance query: the created_at range AND a scope to
 * ATTRIBUTED transactions (those tied to a real customer_user). Unattributed rows —
 * a failed event with no referenceId, or a webhook for a user not in this DB (e.g.
 * other developers sharing the same Maya sandbox account) — are still recorded in
 * payment_transactions, but kept OUT of Finance reporting so the figures reflect real
 * activity, matching the dashboard. (The webhook nulls user_id for unknown users, so
 * `user_id IS NOT NULL` is exactly the attributed set.)
 */
function rangeWhere(range: DateRange): SQL[] {
	const conds: SQL[] = [isNotNull(paymentTransactions.userId)];
	if (range.from) conds.push(gte(paymentTransactions.createdAt, range.from));
	if (range.to) conds.push(lte(paymentTransactions.createdAt, range.to));
	return conds;
}

/** Human label for a fund source key; falls back to "Other". */
function fundSourceLabel(type: string | null): string {
	const map: Record<string, string> = {
		card: 'Card',
		gcash: 'GCash',
		'maya-wallet': 'Maya Wallet',
		shopeepay: 'ShopeePay',
		qrph: 'QR Ph'
	};
	return type ? (map[type] ?? type) : 'Other';
}

/** Status badge tone from the raw gateway status. */
function statusTone(status: string): StatusTone {
	if (status === SUCCESS) return 'online';
	if (status === 'PAYMENT_FAILED') return 'blocked';
	return 'warning'; // expired / cancelled / pending
}

/** Headline Finance metrics over the range. Peso values pre-formatted with peso(). */
export async function financeKpis(db: DB, range: DateRange = {}): Promise<Kpi[]> {
	const [row] = await db
		.select({
			gross: sql<number>`coalesce(sum(${paymentTransactions.amount}) filter (where ${paymentTransactions.status} = ${SUCCESS}), 0)::float`,
			txns: sql<number>`count(*)::int`,
			avg: sql<number>`coalesce(avg(${paymentTransactions.amount}) filter (where ${paymentTransactions.status} = ${SUCCESS}), 0)::float`,
			successRate: sql<number>`coalesce(count(*) filter (where ${paymentTransactions.status} = ${SUCCESS})::float / nullif(count(*), 0), 0)::float`
		})
		.from(paymentTransactions)
		.where(and(...rangeWhere(range)));

	return [
		{ label: 'Gross Revenue (settled)', value: peso(row?.gross ?? 0) },
		{ label: 'Transactions', value: String(row?.txns ?? 0) },
		{ label: 'Success Rate', value: `${Math.round((row?.successRate ?? 0) * 100)}%` },
		{ label: 'Avg. Transaction', value: peso(row?.avg ?? 0) }
	];
}

/** Settled revenue grouped by period. Labels are collision-free per granularity. */
export async function revenueByPeriod(
	db: DB,
	opts: DateRange & { granularity: 'day' | 'week' | 'month' }
): Promise<RevenuePoint[]> {
	// 'IYYY-IW' (ISO year-week) and the date formats avoid the weekday-collision
	// problem revenueByDay has when a window spans more than 7 days.
	const fmt =
		opts.granularity === 'week' ? 'IYYY-IW' : opts.granularity === 'month' ? 'YYYY-MM' : 'MM-DD';
	// Inline the granularity as a SQL literal (NOT a bind param). If it were a param,
	// Drizzle would emit a *different* parameter marker in SELECT vs GROUP BY/ORDER BY,
	// and Postgres matches grouped expressions structurally — distinct markers fail to
	// match ("column must appear in the GROUP BY clause"). granularity is a validated
	// enum here, so literal interpolation is safe. sql.raw keeps it param-free.
	const trunc = sql.raw(`'${opts.granularity}'`);
	const bucket = sql`date_trunc(${trunc}, ${paymentTransactions.createdAt})`;

	const rows = await db
		.select({
			label: sql<string>`to_char(${bucket}, ${fmt})`,
			amount: sql<number>`coalesce(sum(${paymentTransactions.amount}), 0)::float`
		})
		.from(paymentTransactions)
		.where(and(eq(paymentTransactions.status, SUCCESS), ...rangeWhere(opts)))
		.groupBy(bucket)
		.orderBy(bucket);

	return rows.map((r) => ({ label: r.label, amount: r.amount }));
}

/** Settled revenue split by fund source, with each slice's share of the total. */
export async function paymentMethodBreakdown(
	db: DB,
	range: DateRange = {}
): Promise<PaymentMethodSlice[]> {
	const rows = await db
		.select({
			type: paymentTransactions.fundSourceType,
			amount: sql<number>`coalesce(sum(${paymentTransactions.amount}), 0)::float`,
			count: sql<number>`count(*)::int`
		})
		.from(paymentTransactions)
		.where(and(eq(paymentTransactions.status, SUCCESS), ...rangeWhere(range)))
		.groupBy(paymentTransactions.fundSourceType)
		.orderBy(desc(sql`sum(${paymentTransactions.amount})`));

	const total = rows.reduce((sum, r) => sum + r.amount, 0);
	return rows.map((r) => ({
		type: r.type ?? 'unknown',
		label: fundSourceLabel(r.type),
		amount: r.amount,
		count: r.count,
		pct: total > 0 ? Math.round((r.amount / total) * 100) : 0
	}));
}

/**
 * Label an AP from its (loose) network_id + the joined name. The link is intentionally
 * not an FK (network_health rows are pruned by the health sweep), so three cases:
 * no id → "Unattributed"; id with a live row → its name; id whose row was pruned →
 * "AP #<id>" (we know a location existed, just not its current name).
 */
function apLabel(networkId: number | null, name: string | null): string {
	if (networkId == null) return 'Unattributed';
	return name ?? `AP #${networkId}`;
}

/** Settled revenue split by access point, with each slice's share of the total. */
export async function revenueByAp(db: DB, range: DateRange = {}): Promise<ApRevenueSlice[]> {
	const rows = await db
		.select({
			networkId: paymentTransactions.networkId,
			name: networkHealth.name,
			amount: sql<number>`coalesce(sum(${paymentTransactions.amount}), 0)::float`,
			count: sql<number>`count(*)::int`
		})
		.from(paymentTransactions)
		.leftJoin(networkHealth, eq(networkHealth.id, paymentTransactions.networkId))
		.where(and(eq(paymentTransactions.status, SUCCESS), ...rangeWhere(range)))
		.groupBy(paymentTransactions.networkId, networkHealth.name)
		.orderBy(desc(sql`sum(${paymentTransactions.amount})`));

	const total = rows.reduce((sum, r) => sum + r.amount, 0);
	return rows.map((r) => ({
		type: r.networkId == null ? 'unattributed' : String(r.networkId),
		label: apLabel(r.networkId, r.name),
		amount: r.amount,
		count: r.count,
		pct: total > 0 ? Math.round((r.amount / total) * 100) : 0
	}));
}

/** Paginated transaction list (newest first), with package name and buyer. */
export async function listTransactions(
	db: DB,
	opts: DateRange & { status?: string; page?: number; pageSize?: number }
): Promise<{ rows: TransactionRow[]; total: number }> {
	const page = Math.max(1, opts.page ?? 1);
	const pageSize = opts.pageSize ?? 50;

	const conds = rangeWhere(opts);
	if (opts.status) conds.push(eq(paymentTransactions.status, opts.status));
	const where = conds.length ? and(...conds) : undefined;

	const [[counted], rows] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(paymentTransactions)
			.where(where),
		db
			.select({
				id: paymentTransactions.id,
				status: paymentTransactions.status,
				amount: paymentTransactions.amount,
				fundSourceType: paymentTransactions.fundSourceType,
				fundSourceMasked: paymentTransactions.fundSourceMasked,
				receiptNo: paymentTransactions.receiptNo,
				buyerName: paymentTransactions.buyerName,
				buyerEmail: paymentTransactions.buyerEmail,
				createdAt: paymentTransactions.createdAt,
				networkId: paymentTransactions.networkId,
				apNameRaw: networkHealth.name,
				apDisplayName: networkHealth.displayName,
				apNameSnapshot: paymentTransactions.apNameSnapshot,
				apCircuitId: paymentTransactions.apCircuitId,
				userName: customerUser.name,
				packageName: packages.name
			})
			.from(paymentTransactions)
			.leftJoin(customerUser, eq(customerUser.id, paymentTransactions.userId))
			.leftJoin(packages, eq(packages.id, paymentTransactions.packageId))
			.leftJoin(networkHealth, eq(networkHealth.id, paymentTransactions.networkId))
			.where(where)
			.orderBy(desc(paymentTransactions.createdAt))
			.limit(pageSize)
			.offset((page - 1) * pageSize)
	]);

	// Durable AP labels resolved once per unique circuit-id on this page (not per row).
	const circuitLabels = await resolveApCircuitLabels(db, rows.map((r) => r.apCircuitId));

	return {
		total: counted?.n ?? 0,
		rows: rows.map((r) => ({
			id: r.id,
			status: r.status,
			statusTone: statusTone(r.status),
			amount: peso(Number(r.amount)),
			fundSourceType: fundSourceLabel(r.fundSourceType),
			fundSourceMasked: r.fundSourceMasked,
			receiptNo: r.receiptNo,
			// Prefer the buyer captured on the gateway event; fall back to the linked user.
			buyerName: r.buyerName || r.userName || '—',
			buyerEmail: r.buyerEmail,
			packageName: r.packageName,
			// Frozen snapshot (name as-was at purchase) wins; else null networkId → unattributed
			// (render as —), pruned AP → "AP #<id>". Operator display name wins over sweep `name`.
			apName:
				r.apNameSnapshot ??
				(r.networkId == null ? null : (r.apDisplayName ?? r.apNameRaw ?? `AP #${r.networkId}`)),
			// Frozen snapshot wins; else durable circuit-id resolution (survives AP rename/prune).
			apCircuitLabel: r.apNameSnapshot ?? apCircuitLabelOf(r.apCircuitId, circuitLabels),
			createdAt: r.createdAt.toISOString()
		}))
	};
}

/**
 * One merged, deduped, chronological activity list for the admin Finance page (supersedes the old
 * split of `listTransactions` + `listRecentGrantAttribution`). Merges five sources app-side:
 *   1. Maya payments (payment_transactions, full status/receipt/buyer/fund-source detail)
 *   2. Standalone credit top-ups (credit_ledger topup rows NOT mirrored from a Maya payment)
 *   3. Credit spends (credit_ledger spend rows)
 *   4. Points spends (points_ledger spend rows)
 *   5. Free-time grants (network_sessions with no package)
 * The period filter applies uniformly to all five (AC5). A Maya payment that also wrote a mirrored
 * credit-ledger topup (same tx id) is shown ONCE — the topup source anti-joins it out (AC3).
 * Points earned as a side effect of a Maya payment are annotated as a badge on the originating
 * payment row, never a standalone row. Read-only, newest first, page-1-only (each source is
 * independently capped at `pageSize`).
 */
export async function listUnifiedTransactions(
	db: DB,
	opts: DateRange & { page?: number; pageSize?: number }
): Promise<{ rows: UnifiedTransactionRow[]; total: number }> {
	const pageSize = opts.pageSize ?? 50;

	// Per-source inline range conditions against each source's OWN timestamp column. rangeWhere()
	// is Maya-only (it hardcodes paymentTransactions columns + the attributed-user rule), so the
	// four non-Maya sources build their own small condition arrays here instead of reusing it.
	const rangeOn = (
		col:
			| typeof creditLedger.createdAt
			| typeof pointsLedger.createdAt
			| typeof networkSessions.startedAt
	): SQL[] => {
		const c: SQL[] = [];
		if (opts.from) c.push(gte(col, opts.from));
		if (opts.to) c.push(lte(col, opts.to));
		return c;
	};
	const creditRange = rangeOn(creditLedger.createdAt);
	const pointsRange = rangeOn(pointsLedger.createdAt);
	const sessionRange = rangeOn(networkSessions.startedAt);

	// AC3 dedupe: a Maya payment writes a mirrored credit_ledger `topup` row sharing the SAME id
	// (payment_transactions.id === credit_ledger.external_transaction_id). Suppress those topups —
	// the Maya row already represents the money. A manual/promo topup has a NULL (or non-matching)
	// external_transaction_id, so NOT EXISTS keeps it (AC4).
	const noMayaMirror = sql`not exists (select 1 from ${paymentTransactions} pt where pt.id = ${creditLedger.externalTransactionId})`;

	const [maya, topups, creditSpends, pointsSpends, freeTime, pointsEarn, counts] =
		await Promise.all([
			db
				.select({
					id: paymentTransactions.id,
					status: paymentTransactions.status,
					amount: paymentTransactions.amount,
					fundSourceType: paymentTransactions.fundSourceType,
					fundSourceMasked: paymentTransactions.fundSourceMasked,
					receiptNo: paymentTransactions.receiptNo,
					buyerName: paymentTransactions.buyerName,
					buyerEmail: paymentTransactions.buyerEmail,
					createdAt: paymentTransactions.createdAt,
					apCircuitId: paymentTransactions.apCircuitId,
					apNameSnapshot: paymentTransactions.apNameSnapshot,
					userName: customerUser.name,
					packageName: packages.name
				})
				.from(paymentTransactions)
				.leftJoin(customerUser, eq(customerUser.id, paymentTransactions.userId))
				.leftJoin(packages, eq(packages.id, paymentTransactions.packageId))
				.where(and(...rangeWhere(opts)))
				.orderBy(desc(paymentTransactions.createdAt))
				.limit(pageSize),
			db
				.select({
					id: creditLedger.id,
					amount: creditLedger.amount,
					apCircuitId: creditLedger.apCircuitId,
					apNameSnapshot: creditLedger.apNameSnapshot,
					createdAt: creditLedger.createdAt,
					who: customerUser.name
				})
				.from(creditLedger)
				.leftJoin(customerUser, eq(customerUser.id, creditLedger.userId))
				.where(and(eq(creditLedger.type, LEDGER_TYPE.topup), noMayaMirror, ...creditRange))
				.orderBy(desc(creditLedger.createdAt))
				.limit(pageSize),
			db
				.select({
					id: creditLedger.id,
					amount: creditLedger.amount,
					apCircuitId: creditLedger.apCircuitId,
					apNameSnapshot: creditLedger.apNameSnapshot,
					createdAt: creditLedger.createdAt,
					who: customerUser.name
				})
				.from(creditLedger)
				.leftJoin(customerUser, eq(customerUser.id, creditLedger.userId))
				.where(and(eq(creditLedger.type, LEDGER_TYPE.spend), ...creditRange))
				.orderBy(desc(creditLedger.createdAt))
				.limit(pageSize),
			db
				.select({
					id: pointsLedger.id,
					amount: pointsLedger.amount,
					apCircuitId: pointsLedger.apCircuitId,
					apNameSnapshot: pointsLedger.apNameSnapshot,
					createdAt: pointsLedger.createdAt,
					who: customerUser.name
				})
				.from(pointsLedger)
				.leftJoin(customerUser, eq(customerUser.id, pointsLedger.userId))
				.where(and(eq(pointsLedger.type, 'spend'), ...pointsRange))
				.orderBy(desc(pointsLedger.createdAt))
				.limit(pageSize),
			db
				.select({
					id: networkSessions.id,
					apCircuitId: networkSessions.apCircuitId,
					apNameSnapshot: networkSessions.apNameSnapshot,
					createdAt: networkSessions.startedAt,
					who: customerUser.name
				})
				.from(networkSessions)
				.leftJoin(customerUser, eq(customerUser.id, networkSessions.userId))
				.where(and(isNull(networkSessions.packageId), ...sessionRange))
				.orderBy(desc(networkSessions.startedAt))
				.limit(pageSize),
			// Points-earn: badge lookup, never a standalone row. Keyed by the shared Maya tx id.
			// ponytail: an `earn` row with a NULL external_transaction_id is unreachable by the current
			// write path (earnPointsTx only fires inside a settled-payment tx with a non-null id), so it
			// would silently not surface as a badge — documented, not handled.
			db
				.select({
					externalTransactionId: pointsLedger.externalTransactionId,
					amount: pointsLedger.amount
				})
				.from(pointsLedger)
				.where(
					and(
						eq(pointsLedger.type, 'earn'),
						isNotNull(pointsLedger.externalTransactionId),
						...pointsRange
					)
				),
			// Total = sum of the 5 source counts (same predicate as each list query). Points-earn is
			// NEVER counted — badges are not rows.
			Promise.all([
				db
					.select({ n: sql<number>`count(*)::int` })
					.from(paymentTransactions)
					.where(and(...rangeWhere(opts))),
				db
					.select({ n: sql<number>`count(*)::int` })
					.from(creditLedger)
					.where(and(eq(creditLedger.type, LEDGER_TYPE.topup), noMayaMirror, ...creditRange)),
				db
					.select({ n: sql<number>`count(*)::int` })
					.from(creditLedger)
					.where(and(eq(creditLedger.type, LEDGER_TYPE.spend), ...creditRange)),
				db
					.select({ n: sql<number>`count(*)::int` })
					.from(pointsLedger)
					.where(and(eq(pointsLedger.type, 'spend'), ...pointsRange)),
				db
					.select({ n: sql<number>`count(*)::int` })
					.from(networkSessions)
					.where(and(isNull(networkSessions.packageId), ...sessionRange))
			])
		]);

	const total = counts.reduce((sum, [row]) => sum + (row?.n ?? 0), 0);

	// Points-earn badge map: shared Maya tx id → total points earned on that payment.
	const earnByTxId = new Map<string, number>();
	for (const e of pointsEarn) {
		if (e.externalTransactionId == null) continue;
		earnByTxId.set(
			e.externalTransactionId,
			(earnByTxId.get(e.externalTransactionId) ?? 0) + e.amount
		);
	}

	// Merge all five sources into the superset row shape (Maya-only fields explicit null off-Maya).
	const combined: Array<
		UnifiedTransactionRow & {
			_createdAt: Date;
			_apCircuitId: string | null;
			_apNameSnapshot: string | null;
		}
	> =
		[
			...maya.map((r) => ({
				kind: 'maya-payment' as const,
				id: r.id,
				createdAt: '',
				who: r.buyerName || r.userName || '—',
				apCircuitLabel: '',
				amount: peso(Number(r.amount)),
				detail: r.packageName ?? 'Maya payment',
				status: r.status,
				statusTone: statusTone(r.status),
				receiptNo: r.receiptNo,
				buyerEmail: r.buyerEmail,
				fundSourceType: fundSourceLabel(r.fundSourceType),
				fundSourceMasked: r.fundSourceMasked,
				packageName: r.packageName,
				_createdAt: r.createdAt,
				_apCircuitId: r.apCircuitId,
				_apNameSnapshot: r.apNameSnapshot
			})),
			...topups.map((r) => ({
				kind: 'credit-topup' as const,
				id: `credit-${r.id}`,
				createdAt: '',
				who: r.who ?? '—',
				apCircuitLabel: '',
				amount: peso(Number(r.amount)),
				detail: 'Credit top-up',
				status: null,
				statusTone: null,
				receiptNo: null,
				buyerEmail: null,
				fundSourceType: null,
				fundSourceMasked: null,
				packageName: null,
				_createdAt: r.createdAt,
				_apCircuitId: r.apCircuitId,
				_apNameSnapshot: r.apNameSnapshot
			})),
			...creditSpends.map((r) => ({
				kind: 'credit-spend' as const,
				id: `credit-${r.id}`,
				createdAt: '',
				who: r.who ?? '—',
				apCircuitLabel: '',
				amount: peso(Math.abs(Number(r.amount))),
				detail: 'Credit spend',
				status: null,
				statusTone: null,
				receiptNo: null,
				buyerEmail: null,
				fundSourceType: null,
				fundSourceMasked: null,
				packageName: null,
				_createdAt: r.createdAt,
				_apCircuitId: r.apCircuitId,
				_apNameSnapshot: r.apNameSnapshot
			})),
			...pointsSpends.map((r) => ({
				kind: 'points-spend' as const,
				id: `points-${r.id}`,
				createdAt: '',
				who: r.who ?? '—',
				apCircuitLabel: '',
				amount: null,
				detail: `${Math.abs(r.amount)} points`,
				status: null,
				statusTone: null,
				receiptNo: null,
				buyerEmail: null,
				fundSourceType: null,
				fundSourceMasked: null,
				packageName: null,
				_createdAt: r.createdAt,
				_apCircuitId: r.apCircuitId,
				_apNameSnapshot: r.apNameSnapshot
			})),
			...freeTime.map((r) => ({
				kind: 'free-time' as const,
				id: `session-${r.id}`,
				createdAt: '',
				who: r.who ?? '—',
				apCircuitLabel: '',
				amount: null,
				detail: 'Free time',
				status: null,
				statusTone: null,
				receiptNo: null,
				buyerEmail: null,
				fundSourceType: null,
				fundSourceMasked: null,
				packageName: null,
				_createdAt: r.createdAt,
				_apCircuitId: r.apCircuitId,
				_apNameSnapshot: r.apNameSnapshot
			}))
		];

	combined.sort((a, b) => b._createdAt.getTime() - a._createdAt.getTime());
	const top = combined.slice(0, pageSize);

	// Batch-resolve AP labels across ALL merged+sliced rows in one call (avoids N+1).
	const circuitLabels = await resolveApCircuitLabels(
		db,
		top.map((r) => r._apCircuitId)
	);

	const rows: UnifiedTransactionRow[] = top.map(
		({ _createdAt, _apCircuitId, _apNameSnapshot, ...row }) => {
			const earned = row.kind === 'maya-payment' ? earnByTxId.get(row.id) : undefined;
			return {
				...row,
				createdAt: _createdAt.toISOString(),
				// Frozen snapshot (name as-was at the transaction) wins; else live circuit-id resolution.
				apCircuitLabel: _apNameSnapshot ?? apCircuitLabelOf(_apCircuitId, circuitLabels),
				...(earned ? { pointsEarned: earned } : {})
			};
		}
	);

	return { rows, total };
}

/** Create a new operator-placed AP from the map ("a place where there is a router").
 * Coordinates are required (it's a pin); health metrics default healthy until the
 * router reports an interface of this name. Kept off the interface-sweep prune by
 * its coordinates (see refreshNetworkHealth). */
export async function createNetworkPlace(
	db: DB,
	place: {
		name: string;
		latitude: string;
		longitude: string;
		address: string | null;
		model: string | null;
		rangeMeters: number | null;
		clusterName: string | null;
	}
): Promise<void> {
	await db.insert(networkHealth).values({
		name: place.name,
		latitude: place.latitude,
		longitude: place.longitude,
		address: place.address,
		model: place.model,
		rangeMeters: place.rangeMeters,
		clusterName: place.clusterName,
		online: true,
		uptimePct: '100.00'
	});
}

/** Update an operator-placed AP's editable fields (name, location, model, range, cluster)
 * from the map — the single editing path now that /networks deep-links here. */
export async function updateNetworkPlace(
	db: DB,
	id: number,
	place: {
		name: string;
		latitude: string;
		longitude: string;
		address: string | null;
		model: string | null;
		rangeMeters: number | null;
		clusterName: string | null;
	}
): Promise<void> {
	await db
		.update(networkHealth)
		.set({
			name: place.name,
			latitude: place.latitude,
			longitude: place.longitude,
			address: place.address,
			model: place.model,
			rangeMeters: place.rangeMeters,
			clusterName: place.clusterName
		})
		.where(eq(networkHealth.id, id));
}

/** Delete an operator-placed AP. Safe: network_sessions.network_id is a loose link (no FK),
 * so attributed sessions simply stop matching the per-AP count — no constraint to violate. */
export async function deleteNetworkPlace(db: DB, id: number): Promise<void> {
	await db.delete(networkHealth).where(eq(networkHealth.id, id));
}

/** Wipe every access point / health row. Same loose-link safety as deleteNetworkPlace —
 * no FK to violate. Caller owns authorization (owner-only + step-up code). Returns count. */
export async function wipeNetworks(db: DB): Promise<number> {
	const removed = await db.delete(networkHealth).returning({ id: networkHealth.id });
	return removed.length;
}

/** One router/AP catalog model plus how many APs currently reference it. `usageCount`
 * powers the "in use by N APs" hint so an owner deletes a model with eyes open. */
export type RouterModelRow = {
	id: string;
	name: string;
	rangeMeters: number;
	sortOrder: number;
	usageCount: number;
};

/** The full router model catalog, ordered so the first row is the default model
 * (lowest sortOrder). LEFT JOIN counts referencing APs per model. Shape is a superset
 * of `RouterModel`, so the same rows feed both the map picker and the /networks editor. */
export async function listRouterModels(db: DB): Promise<RouterModelRow[]> {
	return db
		.select({
			id: routerModel.id,
			name: routerModel.name,
			rangeMeters: routerModel.rangeMeters,
			sortOrder: routerModel.sortOrder,
			// LEFT JOIN → 0 for an unused model (count of a NULL-joined id is 0, not 1).
			usageCount: sql<number>`count(${networkHealth.id})`.mapWith(Number)
		})
		.from(routerModel)
		.leftJoin(networkHealth, eq(networkHealth.model, routerModel.id))
		.groupBy(routerModel.id)
		.orderBy(asc(routerModel.sortOrder), asc(routerModel.id));
}

/** Add a model to the catalog. `id` is the immutable slug stored on network_health.model;
 * new models append at the end (max sortOrder + 1) so existing default/order is untouched. */
export async function createRouterModel(
	db: DB,
	model: { id: string; name: string; rangeMeters: number }
): Promise<boolean> {
	const [{ next }] = await db
		.select({ next: sql<number>`coalesce(max(${routerModel.sortOrder}), -1) + 1`.mapWith(Number) })
		.from(routerModel);
	// onConflictDoNothing → the insert itself is the uniqueness check: a concurrent add of the
	// same id yields 0 rows here instead of surfacing a primary-key violation as a 500. Returns
	// whether a row was actually inserted.
	const inserted = await db
		.insert(routerModel)
		.values({ ...model, sortOrder: next })
		.onConflictDoNothing()
		.returning({ id: routerModel.id });
	return inserted.length > 0;
}

/** Edit a model's display name and advertised range. The `id` slug is immutable — APs
 * reference it by value (loose link), so renaming the slug would orphan them; rename the
 * label instead. Editing rangeMeters re-sizes every AP on this model that has no override. */
export async function updateRouterModel(
	db: DB,
	id: string,
	fields: { name: string; rangeMeters: number }
): Promise<boolean> {
	// `returning` makes the UPDATE the existence check too — 0 rows means the id is gone, so the
	// caller can 404 without a separate (race-prone) read.
	const updated = await db
		.update(routerModel)
		.set(fields)
		.where(eq(routerModel.id, id))
		.returning({ id: routerModel.id });
	return updated.length > 0;
}

/** Remove a model from the catalog. Safe: network_health.model is a loose text ref (no FK),
 * so APs on a deleted model fall back to the default range — exactly like an unknown id.
 * Caller owns the "can't delete the last model" guard (the catalog must never be empty). */
export async function deleteRouterModel(db: DB, id: string): Promise<boolean> {
	// `returning` reports whether a row actually existed, so the caller can 404 on a stale id
	// without a pre-read.
	const deleted = await db
		.delete(routerModel)
		.where(eq(routerModel.id, id))
		.returning({ id: routerModel.id });
	return deleted.length > 0;
}
