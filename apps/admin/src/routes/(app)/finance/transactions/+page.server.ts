import { db } from '$lib/server/db';
import { listTransactions } from '$lib/server/queries';
import { parsePeriod } from '$lib/server/period';
import type { PageServerLoad } from './$types';

/**
 * Transactions list page. First page of payment_transactions over the selected `?period=`
 * window (same parser as the overview + CSV export, so all three agree on the range).
 */
export const load: PageServerLoad = async ({ url }) => {
	const { period, from, to } = parsePeriod(url.searchParams.get('period'));
	const { rows: transactions, total } = await listTransactions(db, {
		from,
		to,
		page: 1,
		pageSize: 50
	});

	return { transactions, total, period };
};
