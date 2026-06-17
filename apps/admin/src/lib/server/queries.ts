/**
 * Server-side queries that map the shared DB into the admin view shapes declared
 * in `$lib/types`. Display formatting (₱, MM:SS, tones) lives here — it's
 * presentation, not domain logic, so it stays in the app rather than @veent/core.
 *
 * These back the `load()` functions that replace `$lib/mocks`.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
	type DB,
	customerUser,
	customerProfile,
	networkSessions,
	creditLedger,
	packages
} from '@veent/db';
import { SESSION_STATUS, LEDGER_TYPE } from '@veent/core';
import type { ActiveSession, AdminUserRow, Kpi, RevenuePoint, StatusTone } from '$lib/types';

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
export async function listUsers(db: DB): Promise<AdminUserRow[]> {
	const rows = await db
		.select({
			id: customerUser.id,
			name: customerUser.name,
			email: customerUser.email,
			balance: customerProfile.creditBalance,
			blocked: customerProfile.blocked
		})
		.from(customerUser)
		.leftJoin(customerProfile, eq(customerProfile.userId, customerUser.id))
		.orderBy(customerUser.name);

	return rows.map((r) => {
		const balance = Number(r.balance ?? 0);
		let tone: StatusTone = 'online';
		let status = 'Active';
		if (r.blocked) {
			tone = 'blocked';
			status = 'Blocked';
		} else if (balance < 10) {
			tone = 'warning';
			status = 'Low Balance';
		}
		return {
			id: r.id,
			name: r.name,
			email: r.email,
			balance,
			usage: '—', // byte-level usage isn't tracked yet (needs accounting feed)
			tone,
			status
		};
	});
}

/** Currently-connected sessions (initial snapshot; SSE streams updates). */
export async function listActiveSessions(db: DB, now: Date = new Date()): Promise<ActiveSession[]> {
	const rows = await db
		.select({
			macAddress: networkSessions.macAddress,
			expiresAt: networkSessions.expiresAt,
			packageName: packages.name
		})
		.from(networkSessions)
		.leftJoin(packages, eq(packages.id, networkSessions.packageId))
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
			mac: r.macAddress ?? '—',
			package: r.packageName ?? 'Free Time',
			timeLeft: formatTimeLeft(msLeft),
			tone,
			status
		};
	});
}

/** Headline KPIs. Deltas are omitted (no period-over-period baseline yet). */
export async function dashboardKpis(db: DB): Promise<Kpi[]> {
	const [[active], [free], [revenue], [avg]] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(networkSessions)
			.where(eq(networkSessions.status, SESSION_STATUS.active)),
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
		{ label: 'Active Sessions', value: String(active?.n ?? 0) },
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
				sql`${creditLedger.createdAt} >= now() - interval '7 days'`
			)
		)
		.groupBy(sql`date_trunc('day', ${creditLedger.createdAt})`)
		.orderBy(sql`date_trunc('day', ${creditLedger.createdAt})`);

	return rows.map((r) => ({ label: r.day, amount: r.amount }));
}
