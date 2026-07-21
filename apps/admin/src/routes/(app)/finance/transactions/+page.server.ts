import { db } from '$lib/server/db';
import { listTransactions, listRecentGrantAttribution } from '$lib/server/queries';
import { parsePeriod } from '$lib/server/period';
import type { PageServerLoad } from './$types';

/**
 * Transactions list page. First page of payment_transactions over the selected `?period=`
 * window (same parser as the overview + CSV export, so all three agree on the range).
 * Also surfaces recent credit/points/free-time grant AP attribution (the non-Maya paths).
 */
export const load: PageServerLoad = async ({ url }) => {
	const { period, from, to } = parsePeriod(url.searchParams.get('period'));
	const [{ rows: transactions, total }, grantAttribution] = await Promise.all([
		listTransactions(db, { from, to, page: 1, pageSize: 50 }),
		listRecentGrantAttribution(db, { limit: 50 })
	]);

	return { transactions, total, period, grantAttribution };
};
