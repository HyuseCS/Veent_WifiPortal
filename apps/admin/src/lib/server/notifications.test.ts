import { describe, it, expect, vi } from 'vitest';

// Mock @veent/db so importing the module (and its ./issues dependency) doesn't spin up the real
// client. The filter itself is SQL — that's covered by the e2e; here we pin the parts that live in
// JS: the notifiable-type set and the row→NotificationRow mapping (title passthrough + summary).
vi.mock('@veent/db', () => ({
	adminIssue: { __t: 'issue' },
	adminIssueAssignee: { __t: 'assignee' },
	adminIssueEvent: { __t: 'event' },
	adminProfile: { __t: 'profile' },
	adminUser: { __t: 'user' }
}));
vi.mock('drizzle-orm/pg-core', () => ({ alias: (t: unknown) => t }));

import type { DB } from '@veent/db';
import { NOTIFIABLE_EVENTS, unreadCount, listNotifications } from './notifications';

describe('NOTIFIABLE_EVENTS', () => {
	it("excludes 'created' (the paired 'assigned' event is the real signal)", () => {
		expect(NOTIFIABLE_EVENTS).not.toContain('created');
	});
	it("includes 'assigned'", () => {
		expect(NOTIFIABLE_EVENTS).toContain('assigned');
	});
});

/** Chainable stand-in: every builder call returns the proxy; the terminal (`where` for the count,
 *  `limit` for the list) resolves to canned rows. */
function fakeDb(terminal: 'where' | 'limit', rows: unknown[]): DB {
	const proxy: unknown = new Proxy(function () {}, {
		get(_t, prop) {
			if (prop === terminal) return () => Promise.resolve(rows);
			if (prop === 'then') return undefined; // not itself awaitable
			return () => proxy;
		}
	});
	return { select: () => proxy } as unknown as DB;
}

describe('unreadCount', () => {
	it('returns the counted value', async () => {
		const db = fakeDb('where', [{ n: 3 }]);
		expect(await unreadCount(db, 'u1')).toBe(3);
	});
	it('returns 0 when the count query yields nothing', async () => {
		const db = fakeDb('where', []);
		expect(await unreadCount(db, 'u1')).toBe(0);
	});
});

describe('listNotifications', () => {
	it('maps rows to issue title + human summary', async () => {
		const db = fakeDb('limit', [
			{
				id: 10,
				issueId: 5,
				issueTitle: 'AP offline',
				type: 'assigned',
				fromValue: null,
				toValue: 'u2',
				createdAt: new Date('2026-07-08T00:00:00Z'),
				targetName: 'Bea Reyes'
			},
			{
				id: 9,
				issueId: 5,
				issueTitle: 'AP offline',
				type: 'status_changed',
				fromValue: 'open',
				toValue: 'in_progress',
				createdAt: new Date('2026-07-07T00:00:00Z'),
				targetName: null
			}
		]);
		const rows = await listNotifications(db, 'u1');
		expect(rows).toEqual([
			{ id: 10, issueId: 5, issueTitle: 'AP offline', summary: 'Assigned Bea Reyes', createdAt: new Date('2026-07-08T00:00:00Z').getTime() },
			{ id: 9, issueId: 5, issueTitle: 'AP offline', summary: 'Status: Open → In Progress', createdAt: new Date('2026-07-07T00:00:00Z').getTime() }
		]);
	});
});
