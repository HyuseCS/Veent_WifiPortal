import { describe, it, expect } from 'vitest';
import { parseIntField } from './formValidation';

/**
 * Boundary coverage for the required-integer parser behind the operational-limits save
 * (device cap, free-time minutes/cooldown) — a bad parse there silently mis-configures
 * the portal, so the edges (blank, float, out-of-range, sign) are pinned.
 */
const fd = (value: string) => {
	const f = new FormData();
	f.set('k', value);
	return f;
};

describe('parseIntField', () => {
	it('accepts an in-range integer (inclusive bounds)', () => {
		expect(parseIntField(fd('1'), 'k', { min: 1, max: 20 })).toBe(1);
		expect(parseIntField(fd('20'), 'k', { min: 1, max: 20 })).toBe(20);
		expect(parseIntField(fd('  7 '), 'k', { min: 1, max: 20 })).toBe(7); // trimmed
		expect(parseIntField(fd('0'), 'k', { min: 0, max: 168 })).toBe(0);
	});

	it('rejects out-of-range values', () => {
		expect(parseIntField(fd('0'), 'k', { min: 1, max: 20 })).toBeNull();
		expect(parseIntField(fd('21'), 'k', { min: 1, max: 20 })).toBeNull();
		expect(parseIntField(fd('-3'), 'k', { min: 0, max: 168 })).toBeNull();
	});

	it('rejects blanks, non-integers, and non-numbers', () => {
		expect(parseIntField(fd(''), 'k', { min: 1, max: 20 })).toBeNull();
		expect(parseIntField(fd('   '), 'k', { min: 1, max: 20 })).toBeNull();
		expect(parseIntField(fd('1.5'), 'k', { min: 1, max: 20 })).toBeNull();
		expect(parseIntField(fd('abc'), 'k', { min: 1, max: 20 })).toBeNull();
	});

	it('returns null for a missing field', () => {
		expect(parseIntField(new FormData(), 'k', { min: 1, max: 20 })).toBeNull();
	});
});
