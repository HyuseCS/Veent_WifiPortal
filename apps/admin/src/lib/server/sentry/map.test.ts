import { describe, it, expect } from 'vitest';
import { mapEventDetail, mapIssue, mapTrend, deriveKpis } from './map';

// The mappers are the seam that absorbs Sentry's payload quirks — if they regress, the dashboard
// silently mis-reports. Assert the coercions and the accepted-series selection that matter.

describe('mapIssue', () => {
	it('coerces numeric-string count/userCount and narrows the fields', () => {
		const issue = mapIssue({
			id: '42',
			shortId: 'RADIUS-3F',
			title: 'Boom',
			culprit: 'do/thing',
			level: 'warning',
			count: '1234', // Sentry sends this as a string
			userCount: 7,
			lastSeen: '2026-07-01T00:00:00Z',
			status: 'unresolved',
			permalink: 'https://sentry.io/issues/42/',
			stats: { '14d': [[1719792000, '3'], [1719878400, 5]] },
			extra: 'ignored'
		});
		expect(issue.count).toBe(1234);
		expect(issue.userCount).toBe(7);
		expect(issue.level).toBe('warning');
		expect(issue.trend14d).toEqual([3, 5]); // counts pulled from [ts, count] tuples
		expect(issue.trend24h).toEqual([]); // period absent from this payload
		expect(issue.permalink).toBe('https://sentry.io/issues/42/'); // real https passes through
		expect(issue).not.toHaveProperty('extra');
	});

	it('only passes through absolute https permalinks (blocks script/other schemes)', () => {
		// The permalink is rendered as an href on an admin page — a poisoned API response must
		// not be able to smuggle a javascript:/http: URL through. Anything non-https → ''.
		expect(mapIssue({ permalink: 'javascript:alert(1)' }).permalink).toBe('');
		expect(mapIssue({ permalink: 'http://evil.example/x' }).permalink).toBe('');
		expect(mapIssue({ permalink: '//evil.example' }).permalink).toBe('');
		expect(mapIssue({ permalink: 42 }).permalink).toBe(''); // non-string coerced then rejected
		expect(mapIssue({}).permalink).toBe(''); // missing → ''
	});

	it('degrades garbage to empty/0 without throwing', () => {
		const issue = mapIssue({ count: 'not-a-number' });
		expect(issue.count).toBe(0);
		expect(issue.title).toBe('');
		expect(issue.level).toBe('error'); // default
		expect(issue.trend14d).toEqual([]); // no stats → flat, not a throw
	});
});

describe('mapTrend', () => {
	it('keeps only the count of each [timestamp, count] bucket, coercing strings', () => {
		expect(mapTrend({ '24h': [[1, '10'], [2, 20]] }, '24h')).toEqual([10, 20]);
	});

	it('degrades a missing period or ragged payload to [] without throwing', () => {
		expect(mapTrend({ '14d': [[1, 5]] }, '24h')).toEqual([]); // wrong period
		expect(mapTrend(null, '14d')).toEqual([]);
		expect(mapTrend({ '14d': 'nope' }, '14d')).toEqual([]);
		expect(mapTrend({ '14d': [42, [3, 9]] }, '14d')).toEqual([0, 9]); // non-tuple bucket → 0
	});
});

describe('mapEventDetail', () => {
	it('reads the last exception value + narrows frames and tags', () => {
		const detail = mapEventDetail({
			id: 'evt1',
			culprit: 'load(users)',
			dateCreated: '2026-07-01T00:00:00Z',
			entries: [
				{
					type: 'exception',
					data: {
						values: [
							{ type: 'CauseError', value: 'root cause' },
							{
								type: 'TypeError',
								value: "cannot read 'id' of null",
								stacktrace: {
									frames: [
										{ filename: 'lib/db.ts', function: 'query', lineNo: 11, inApp: true },
										{ filename: 'node:internal', function: 'x', lineNo: null, inApp: false }
									]
								}
							}
						]
					}
				}
			],
			tags: [{ key: 'environment', value: 'production' }, { key: '', value: 'dropped' }]
		});
		expect(detail.type).toBe('TypeError'); // last value, not the cause
		expect(detail.value).toBe("cannot read 'id' of null");
		expect(detail.frames).toHaveLength(2);
		expect(detail.frames[0]).toEqual({ filename: 'lib/db.ts', function: 'query', lineNo: 11, inApp: true });
		expect(detail.frames[1].lineNo).toBeNull();
		expect(detail.tags).toEqual([{ key: 'environment', value: 'production' }]); // keyless tag dropped
	});

	it('falls back to metadata and degrades to empty without throwing', () => {
		const detail = mapEventDetail({ metadata: { type: 'ValueError', value: 'bad' } });
		expect(detail.type).toBe('ValueError');
		expect(detail.value).toBe('bad');
		expect(detail.frames).toEqual([]);
		expect(mapEventDetail(null).id).toBe('');
	});
});

describe('deriveKpis', () => {
	it('sums 14d sparkline events + users and caps open issues at "25+"', () => {
		// Each issue contributes 3 events (1+2) over 14d and 2 users → 75 events, 50 users.
		const issues = Array.from({ length: 25 }, (_, i) =>
			mapIssue({ id: String(i), userCount: 2, stats: { '14d': [[1, 1], [2, 2]] } })
		);
		const kpis = deriveKpis(issues);
		expect(kpis.find((k) => k.label === 'Open issues')?.value).toBe('25+');
		expect(kpis.find((k) => k.label === 'Events (14d)')?.value).toBe('75');
		expect(kpis.find((k) => k.label === 'Users affected')?.value).toBe('50');
	});
});
