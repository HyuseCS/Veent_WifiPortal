/**
 * Server-side queries that map the shared DB into the admin view shapes declared
 * in `$lib/types`. Display formatting (₱, MM:SS, tones) lives here — it's
 * presentation, not domain logic, so it stays in the app rather than @veent/core.
 *
 * These back the `load()` functions that replace `$lib/mocks`.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import {
	type DB,
	customerUser,
	customerProfile,
	networkSessions,
	creditLedger,
	packages,
	paymentTransactions,
	adminUser,
	adminProfile,
	adminRole,
	networkHealth
} from '@veent/db';
import { SESSION_STATUS, LEDGER_TYPE } from '@veent/core';
import type {
	ActiveSession,
	AdminUserRow,
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
	TransactionRow
} from '$lib/types';

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
			networkName: networkHealth.name
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
			network: r.networkName ?? null,
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
			lastActiveAt: adminProfile.lastActiveAt
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
		lastActiveAt: r.lastActiveAt ? r.lastActiveAt.getTime() : null
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

	return rows.map((r) => {
		const uptime = Number(r.uptimePct);
		let tone: StatusTone = 'online';
		let status = 'Healthy';
		if (!r.online) {
			tone = 'blocked';
			status = 'Offline';
		} else if (uptime < 99 || (r.latencyMs ?? 0) > LATENCY_DEGRADED_MS) {
			tone = 'warning';
			status = 'Degraded';
		}
		return {
			id: String(r.id),
			name: r.name,
			tone,
			status,
			uptime: `${uptime.toFixed(1)}%`,
			latency: r.latencyMs == null ? '—' : `${r.latencyMs}ms`,
			users: activeByNetwork.get(r.id) ?? 0,
			throughput: `${r.throughputMbps} Mbps`,
			latitude: r.latitude,
			longitude: r.longitude,
			address: r.address,
			interfaceName: r.interfaceName,
			model: r.model,
			rangeMeters: r.rangeMeters,
			clusterName: r.clusterName,
			logs: logsByNetwork.get(r.id) ?? []
		};
	});
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
				userName: customerUser.name,
				packageName: packages.name
			})
			.from(paymentTransactions)
			.leftJoin(customerUser, eq(customerUser.id, paymentTransactions.userId))
			.leftJoin(packages, eq(packages.id, paymentTransactions.packageId))
			.where(where)
			.orderBy(desc(paymentTransactions.createdAt))
			.limit(pageSize)
			.offset((page - 1) * pageSize)
	]);

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
			createdAt: r.createdAt.toISOString()
		}))
	};
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
