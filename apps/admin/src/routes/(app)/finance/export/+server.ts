import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { listTransactions } from '$lib/server/queries';
import { parsePeriod } from '$lib/server/period';
import { rateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

/**
 * CSV cell with two layers of protection:
 *  1. Formula-injection guard — a leading =, +, -, @, tab or CR makes Excel/Sheets/LibreOffice
 *     evaluate the cell as a formula on open. buyerName/buyerEmail come from the (semi-untrusted)
 *     payment gateway, so a value like `=HYPERLINK(...)` or a DDE payload would run in the
 *     operator's spreadsheet. Prefix any such value with a single quote to force it to plain text.
 *     (RFC-4180 quoting alone does NOT prevent this — the quotes are stripped as CSV delimiters.)
 *  2. RFC-4180 quoting — wrap in quotes and double inner quotes when it contains , " or newline.
 */
function cell(v: string): string {
	const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
	return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
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
