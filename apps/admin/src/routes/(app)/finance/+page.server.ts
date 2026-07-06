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
export const load: PageServerLoad = ({ url }) => {
	const { period, from, to } = parsePeriod(url.searchParams.get('period'));

	// Stream the aggregates: return `period` immediately (cheap, straight off the URL) so the
	// navigation resolves at once and the page can paint its own skeleton, then let the heavier
	// payment_transactions rollups resolve after. SvelteKit serializes the promise into the SSR
	// stream and settles it client-side; the page shows a skeleton until it lands. Not awaited
	// here — awaiting would re-introduce the block-on-slowest-query first-paint stall.
	const snapshot = Promise.all([
		financeKpis(db, { from, to }),
		revenueByPeriod(db, { from, to, granularity: granularityFor(period) }),
		paymentMethodBreakdown(db, { from, to }),
		revenueByAp(db, { from, to })
	]).then(([kpis, revenue, breakdown, apRevenue]) => ({ kpis, revenue, breakdown, apRevenue }));

	return { period, snapshot };
};
