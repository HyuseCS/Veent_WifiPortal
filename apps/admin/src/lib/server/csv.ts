/**
 * CSV cell encoding with two layers of protection. Extracted so it can be unit-tested
 * (the Finance export streams it for buyer-supplied, semi-untrusted gateway fields).
 *
 *  1. Formula-injection guard — a leading =, +, -, @, tab or CR makes Excel/Sheets/LibreOffice
 *     evaluate the cell as a formula on open. buyerName/buyerEmail come from the payment gateway,
 *     so a value like `=HYPERLINK(...)` or a DDE payload would run in the operator's spreadsheet.
 *     Prefix any such value with a single quote to force it to plain text. (RFC-4180 quoting alone
 *     does NOT prevent this — the wrapping quotes are stripped as CSV delimiters.)
 *  2. RFC-4180 quoting — wrap in quotes and double inner quotes when it contains , " or newline.
 */
export function cell(v: string): string {
	const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
	return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
