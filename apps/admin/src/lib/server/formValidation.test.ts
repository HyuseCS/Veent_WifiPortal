import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseIntField, parseDueDate } from './formValidation';

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

/**
 * parseDueDate underpins BOTH the incident board form and the Sentry ?/track action, so its rules
 * (UTC-midnight parse, NaN reject, past-date reject with grandfathering) are the single source of
 * truth for due-date validation (M4a). Clock is pinned so "today" is deterministic.
 */
describe('parseDueDate', () => {
	afterEach(() => vi.useRealTimers());
	const pin = (iso: string) => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(iso));
	};
	const ms = (day: string) => new Date(`${day}T00:00:00Z`).getTime();

	it('returns null for an empty / whitespace value (no due date)', () => {
		expect(parseDueDate('')).toEqual({ dueDate: null });
		expect(parseDueDate('   ')).toEqual({ dueDate: null });
	});

	it('parses a valid future date at UTC midnight', () => {
		pin('2026-07-10T09:00:00Z');
		const r = parseDueDate('2026-07-20');
		expect('dueDate' in r && r.dueDate?.getTime()).toBe(ms('2026-07-20'));
	});

	it('accepts today (UTC-midnight boundary is inclusive)', () => {
		pin('2026-07-10T23:00:00Z');
		const r = parseDueDate('2026-07-10');
		expect('dueDate' in r && r.dueDate?.getTime()).toBe(ms('2026-07-10'));
	});

	it('rejects a malformed value', () => {
		expect(parseDueDate('not-a-date')).toEqual({ error: 'Invalid due date.' });
	});

	it('rejects a newly-set past date', () => {
		pin('2026-07-10T09:00:00Z');
		expect(parseDueDate('2026-07-01')).toEqual({ error: 'Due date cannot be in the past.' });
	});

	it('grandfathers a past date that already matches the existing due date (edit case)', () => {
		pin('2026-07-10T09:00:00Z');
		const r = parseDueDate('2026-07-01', ms('2026-07-01'));
		expect('dueDate' in r && r.dueDate?.getTime()).toBe(ms('2026-07-01'));
	});
});
