import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePeriod } from './period';

// The finance timestamp columns are now `timestamptz`. parsePeriod returns REAL Manila-day
// instants: the Manila wall-clock boundary converted to its true UTC instant (fixed −8h, no DST).
// So Manila end-of-day 07-23 (23:59:59.999 Manila) is 2026-07-23T15:59:59.999Z, NOT 23:59:59.999Z
// (the pre-migration wall-clock-SPELLING value). These assertions lock in the corrected values.
describe('parsePeriod', () => {
	afterEach(() => vi.useRealTimers());

	it('returns real Manila-day UTC instants for 7d (today + prior 6)', () => {
		// 10:00 Manila on 2026-07-23 (UTC+8).
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-23T02:00:00.000Z'));
		const { from, to } = parsePeriod('7d');
		// Manila EOD 07-23 → −8h; Manila SOD 07-17 (07-23 minus 6 days) → −8h.
		expect(to!.toISOString()).toBe('2026-07-23T15:59:59.999Z');
		expect(from!.toISOString()).toBe('2026-07-16T16:00:00.000Z');
	});

	it('returns real Manila-day UTC instants for 30d (today + prior 29)', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-23T02:00:00.000Z'));
		const { from, to } = parsePeriod('30d');
		// Manila EOD 07-23 → −8h; Manila SOD 06-24 (07-23 minus 29 days) → −8h.
		expect(to!.toISOString()).toBe('2026-07-23T15:59:59.999Z');
		expect(from!.toISOString()).toBe('2026-06-23T16:00:00.000Z');
	});

	it('returns real Manila-day UTC instants for 90d (today + prior 89)', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-23T02:00:00.000Z'));
		const { from, to } = parsePeriod('90d');
		// Manila EOD 07-23 → −8h; Manila SOD 04-25 (07-23 minus 89 days) → −8h.
		expect(to!.toISOString()).toBe('2026-07-23T15:59:59.999Z');
		expect(from!.toISOString()).toBe('2026-04-24T16:00:00.000Z');
	});

	it('uses the Manila calendar day even when the instant is a different UTC day', () => {
		// 2026-07-23T20:00Z is already 2026-07-24 04:00 in Manila — boundaries must be July 24,
		// proving the calc does not depend on the process timezone (a UTC prod container would
		// otherwise compute July 23 here). Manila EOD 07-24 → −8h.
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-23T20:00:00.000Z'));
		const { to } = parsePeriod('30d');
		expect(to!.toISOString()).toBe('2026-07-24T15:59:59.999Z');
	});

	it('all-time has no bounds', () => {
		expect(parsePeriod('all')).toEqual({ period: 'all' });
	});
});
