import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { listTransactions } from '$lib/server/queries';
import { parsePeriod } from '$lib/server/period';
import { rateLimit } from '$lib/server/rateLimit';
import { cell } from '$lib/server/csv';
import type { RequestHandler } from './$types';

/**
 * GET /finance/export?period= — streams the filtered transactions as a CSV download.
 * This is a GET endpoint (not a form action) because SvelteKit actions can't return a
 * downloadable Response. The page links to it with a plain `<a download>`.
 */
export const GET: RequestHandler = async (event) => {
	// Layout guards don't run for +server.ts endpoints, and hooks expose locals.user
	// pre-enrollment — enforce auth + mandatory 2FA here, same as /api/router-log.
	if (!event.locals.user) error(401, 'Not authenticated');
	if (!event.locals.user.twoFactorEnabled) error(403, 'Two-factor enrollment required');

	// Each export scans up to 10k rows; cap per admin so it can't be hammered into a DB DoS.
	const rl = await rateLimit('finance_export', event.locals.user.id, 20);
	if (!rl.allowed) error(429, 'Too many exports. Please wait a bit and try again.');

	const { from, to } = parsePeriod(event.url.searchParams.get('period'));
	const { rows } = await listTransactions(db, { from, to, page: 1, pageSize: 10_000 });

	const csv = [
		'Date,Status,Amount,Fund Source,Masked,Receipt No,Buyer,Email,Package,Access Point',
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
				r.packageName ?? '',
				r.apName ?? ''
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
