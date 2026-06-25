import { db } from '$lib/server/db';
import {
	financeKpis,
	revenueByPeriod,
	paymentMethodBreakdown,
	revenueByAp
} from '$lib/server/queries';
import { parsePeriod, granularityFor } from '$lib/server/period';
import type { PageServerLoad } from './$types';

/**
 * Finance overview SSR seed. Reads payment_transactions over the selected `?period=` window:
 * KPIs, settled revenue over time, and fund-source + access-point breakdowns. The transactions
 * list lives on its own page (./transactions). CSV export is a separate GET endpoint (./export)
 * — a form action can't return a downloadable Response.
 */
export const load: PageServerLoad = async ({ url }) => {
	const { period, from, to } = parsePeriod(url.searchParams.get('period'));

	const [kpis, revenue, breakdown, apRevenue] = await Promise.all([
		financeKpis(db, { from, to }),
		revenueByPeriod(db, { from, to, granularity: granularityFor(period) }),
		paymentMethodBreakdown(db, { from, to }),
		revenueByAp(db, { from, to })
	]);

	return { kpis, revenue, breakdown, apRevenue, period };
};
