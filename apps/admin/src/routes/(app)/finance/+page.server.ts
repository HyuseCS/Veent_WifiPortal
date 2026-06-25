import { db } from '$lib/server/db';
import {
	financeKpis,
	revenueByPeriod,
	paymentMethodBreakdown,
	revenueByAp,
	listTransactions
} from '$lib/server/queries';
import { parsePeriod, granularityFor } from '$lib/server/period';
import type { PageServerLoad } from './$types';

/**
 * Finance SSR seed. Reads payment_transactions over the selected `?period=` window:
 * KPIs, settled revenue over time, fund-source breakdown, and the first page of
 * transactions. CSV export is a separate GET endpoint (./export) — a form action
 * can't return a downloadable Response.
 */
export const load: PageServerLoad = async ({ url }) => {
	const { period, from, to } = parsePeriod(url.searchParams.get('period'));

	const [kpis, revenue, breakdown, apRevenue, { rows: transactions, total }] = await Promise.all([
		financeKpis(db, { from, to }),
		revenueByPeriod(db, { from, to, granularity: granularityFor(period) }),
		paymentMethodBreakdown(db, { from, to }),
		revenueByAp(db, { from, to }),
		listTransactions(db, { from, to, page: 1, pageSize: 50 })
	]);

	return { kpis, revenue, breakdown, apRevenue, transactions, total, period };
};
