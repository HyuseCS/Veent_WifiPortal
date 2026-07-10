import { describe, it, expect, vi } from 'vitest';

// Mock @veent/db so importing the module (and its ./issues dependency) doesn't spin up the real
// client. The filter/read-join is SQL — covered by the e2e; here we pin the JS parts: the
// notifiable-type set and the row→NotificationRow mapping (title, summary, read/unread flag).
vi.mock('@veent/db', () => ({
	adminIssue: { __t: 'issue' },
	adminIssueAssignee: { __t: 'assignee' },
	adminIssueEvent: { __t: 'event' },
	adminNotificationRead: { __t: 'read' },
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
	it("includes 'unassigned' (L4 audience exception routes on this type)", () => {
		expect(NOTIFIABLE_EVENTS).toContain('unassigned');
	});
	it("excludes 'note_edited' (resolution-note edits are deliberately non-notifiable)", () => {
		expect(NOTIFIABLE_EVENTS).not.toContain('note_edited');
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
	it('maps rows to title + summary and flags read/unread', async () => {
		const readAt = new Date('2026-07-08T01:00:00Z');
		const db = fakeDb('limit', [
			{
				id: 10,
				issueId: 5,
				issueTitle: 'AP offline',
				type: 'assigned',
				fromValue: null,
				toValue: 'u2',
				createdAt: new Date('2026-07-08T00:00:00Z'),
				targetName: 'Bea Reyes',
				readAt: null // unread
			},
			{
				id: 9,
				issueId: 5,
				issueTitle: 'AP offline',
				type: 'status_changed',
				fromValue: 'open',
				toValue: 'in_progress',
				createdAt: new Date('2026-07-07T00:00:00Z'),
				targetName: null,
				readAt // read
			}
		]);
		const rows = await listNotifications(db, 'u1', { unreadOnly: false });
		expect(rows).toEqual([
			{
				id: 10,
				issueId: 5,
				issueTitle: 'AP offline',
				summary: 'Assigned Bea Reyes',
				createdAt: new Date('2026-07-08T00:00:00Z').getTime(),
				read: false,
				readAt: null
			},
			{
				id: 9,
				issueId: 5,
				issueTitle: 'AP offline',
				summary: 'Status: Open → In Progress',
				createdAt: new Date('2026-07-07T00:00:00Z').getTime(),
				read: true,
				readAt: readAt.getTime()
			}
		]);
	});

	it("maps an 'unassigned' row to its summary (L4 removed-person feed item)", async () => {
		// JS-shape only: the fakeDb returns this row regardless of the WHERE/JOIN, so this proves the
		// row→summary mapping for an unassignment, NOT the SQL audience predicate (that is the e2e +
		// browser scenario 4). See the module's SQL note.
		const db = fakeDb('limit', [
			{
				id: 20,
				issueId: 7,
				issueTitle: 'AP flapping',
				type: 'unassigned',
				fromValue: null,
				toValue: 'u1',
				createdAt: new Date('2026-07-09T00:00:00Z'),
				targetName: 'Cara Diaz',
				readAt: null
			}
		]);
		const rows = await listNotifications(db, 'u1', { unreadOnly: true });
		expect(rows).toEqual([
			{
				id: 20,
				issueId: 7,
				issueTitle: 'AP flapping',
				summary: 'Unassigned Cara Diaz',
				createdAt: new Date('2026-07-09T00:00:00Z').getTime(),
				read: false,
				readAt: null
			}
		]);
	});
});
