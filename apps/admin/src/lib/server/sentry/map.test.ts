import { describe, it, expect } from 'vitest';
import { mapIssue, mapVolume, deriveKpis } from './map';

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
			extra: 'ignored'
		});
		expect(issue.count).toBe(1234);
		expect(issue.userCount).toBe(7);
		expect(issue.level).toBe('warning');
		expect(issue).not.toHaveProperty('extra');
	});

	it('degrades garbage to empty/0 without throwing', () => {
		const issue = mapIssue({ count: 'not-a-number' });
		expect(issue.count).toBe(0);
		expect(issue.title).toBe('');
		expect(issue.level).toBe('error'); // default
	});
});

describe('mapVolume', () => {
	const raw = {
		intervals: ['2026-06-30T00:00:00Z', '2026-07-01T00:00:00Z'],
		groups: [
			{ by: { outcome: 'rate_limited' }, series: { 'sum(times_seen)': [99, 99] } },
			{ by: { outcome: 'accepted' }, series: { 'sum(times_seen)': [3, 5] } }
		]
	};

	it('picks the accepted group and aligns counts to intervals', () => {
		const points = mapVolume(raw);
		expect(points).toHaveLength(2);
		expect(points.map((p) => p.count)).toEqual([3, 5]); // accepted, NOT rate_limited
		expect(points[1].label).toBe('Jul 1'); // TZ-stable (UTC)
	});

	it('degrades to zeros when the accepted group is absent', () => {
		const points = mapVolume({ intervals: ['2026-07-01T00:00:00Z'], groups: [] });
		expect(points).toEqual([{ label: 'Jul 1', count: 0 }]);
	});
});

describe('deriveKpis', () => {
	it('sums events + users and caps open issues at "25+"', () => {
		const issues = Array.from({ length: 25 }, (_, i) => mapIssue({ id: String(i), userCount: 2 }));
		const volume = [
			{ label: 'a', count: 10 },
			{ label: 'b', count: 5 }
		];
		const kpis = deriveKpis(issues, volume);
		expect(kpis.find((k) => k.label === 'Open issues')?.value).toBe('25+');
		expect(kpis.find((k) => k.label === 'Events (14d)')?.value).toBe('15');
		expect(kpis.find((k) => k.label === 'Users affected')?.value).toBe('50');
	});
});
