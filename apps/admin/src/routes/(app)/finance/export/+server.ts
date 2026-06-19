import { db } from '$lib/server/db';
import { listTransactions } from '$lib/server/queries';
import { parsePeriod } from '$lib/server/period';
import type { RequestHandler } from './$types';

/** RFC-4180 cell: wrap in quotes and double inner quotes when it contains , " or newline. */
function cell(v: string): string {
	return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * GET /finance/export?period= — streams the filtered transactions as a CSV download.
 * This is a GET endpoint (not a form action) because SvelteKit actions can't return a
 * downloadable Response. The page links to it with a plain `<a download>`.
 */
export const GET: RequestHandler = async ({ url }) => {
	const { from, to } = parsePeriod(url.searchParams.get('period'));
	const { rows } = await listTransactions(db, { from, to, page: 1, pageSize: 10_000 });

	const csv = [
		'Date,Status,Amount,Fund Source,Masked,Receipt No,Buyer,Email,Package',
		...rows.map((r) =>
			[
				r.createdAt,
				r.status,
				r.amount,
				r.fundSourceType,
				r.fundSourceMasked ?? '',
				r.receiptNo ?? '',
				r.buyerName,
				r.buyerEmail ?? '',
				r.packageName ?? ''
			]
				.map((v) => cell(String(v)))
				.join(',')
		)
	].join('\n');

	return new Response(csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': 'attachment; filename="transactions.csv"'
		}
	});
};
