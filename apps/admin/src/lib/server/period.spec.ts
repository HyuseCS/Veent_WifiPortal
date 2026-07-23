import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePeriod } from './period';

// The bug this guards: postgres.js binds these boundary Dates as their UTC wall-clock against
// `timestamp WITHOUT time zone` columns that store Manila wall-clock. So each boundary's
// toISOString() must SPELL the intended Manila day boundary, or same-day rows get dropped.
describe('parsePeriod', () => {
	afterEach(() => vi.useRealTimers());

	it('spells Manila day boundaries in the UTC value postgres.js sends', () => {
		// 10:00 Manila on 2026-07-23 (UTC+8).
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-23T02:00:00.000Z'));
		const { from, to } = parsePeriod('7d');
		// today end + start of the 7th day back (today + prior 6).
		expect(to!.toISOString()).toBe('2026-07-23T23:59:59.999Z');
		expect(from!.toISOString()).toBe('2026-07-17T00:00:00.000Z');
	});

	it('uses the Manila calendar day even when the instant is a different UTC day', () => {
		// 2026-07-23T20:00Z is already 2026-07-24 04:00 in Manila — boundaries must be July 24,
		// proving the fix does not depend on the process timezone (a UTC prod container would
		// otherwise compute July 23 here).
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-23T20:00:00.000Z'));
		const { to } = parsePeriod('30d');
		expect(to!.toISOString()).toBe('2026-07-24T23:59:59.999Z');
	});

	it('all-time has no bounds', () => {
		expect(parsePeriod('all')).toEqual({ period: 'all' });
	});
});
