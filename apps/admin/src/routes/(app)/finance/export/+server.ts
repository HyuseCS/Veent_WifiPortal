import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { listTransactions } from '$lib/server/queries';
import { parsePeriod } from '$lib/server/period';
import { rateLimit } from '$lib/server/rateLimit';
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
export const GET: RequestHandler = async (event) => {
	// Each export scans up to 10k rows; cap per admin so it can't be hammered into a DB DoS.
	// (The (app) layout already guarantees an authenticated staff user.)
	const rl = await rateLimit('finance_export', event.locals.user!.id, 20);
	if (!rl.allowed) error(429, 'Too many exports. Please wait a bit and try again.');

	const { from, to } = parsePeriod(event.url.searchParams.get('period'));
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
