import { db } from '$lib/server/db';
import { financeKpis, revenueByPeriod, paymentMethodBreakdown } from '$lib/server/queries';
import { parsePeriod, granularityFor } from '$lib/server/period';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const { period, from, to } = parsePeriod(url.searchParams.get('period'));

	const [kpis, revenue, breakdown] = await Promise.all([
		financeKpis(db, { from, to }),
		revenueByPeriod(db, { from, to, granularity: granularityFor(period) }),
		paymentMethodBreakdown(db, { from, to })
	]);

	return { kpis, revenue, breakdown, period };
};
