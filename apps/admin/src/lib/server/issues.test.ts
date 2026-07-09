import { describe, it, expect, vi } from 'vitest';

// Mock @veent/db so importing issues.ts doesn't spin up the real client. Tables are opaque
// sentinels — our fake db tags recorded inserts by identity, so we can assert which table
// (and which event types) each mutation writes. drizzle-orm/@veent/core stay real (pure).
vi.mock('@veent/db', () => ({
	adminIssue: { __t: 'issue' },
	adminIssueAssignee: { __t: 'assignee' },
	adminIssueEvent: { __t: 'event' },
	adminUser: { __t: 'user' },
	networkHealth: { __t: 'net' }
}));

import type { DB } from '@veent/db';
import {
	isIssueSource,
	eventSummary,
	createIssue,
	createIssueFromSentry,
	setIssueStatus,
	updateIssue,
	takeIssue,
	ISSUE_EVENT
} from './issues';

// Guards the DB CHECK-constraint contract: only 'human' | 'sentry' pass. Anything else
// (typos, injected form values, a future value not yet handled) must be rejected.
describe('isIssueSource', () => {
	it('accepts the two valid sources', () => {
		expect(isIssueSource('human')).toBe(true);
		expect(isIssueSource('sentry')).toBe(true);
	});

	it('rejects anything else', () => {
		for (const v of ['', 'Human', 'SENTRY', 'manual', 'code', 'unknown', ' human ']) {
			expect(isIssueSource(v)).toBe(false);
		}
	});
});

// The human-readable sentence a manager reads in the timeline. Branchy pure logic, so it
// gets a direct test; the DB wiring is exercised by the recorder-fake tests below + e2e.
describe('eventSummary', () => {
	it('formats each event type', () => {
		expect(eventSummary('created', null, null, null)).toBe('Created this incident');
		expect(eventSummary('status_changed', 'open', 'in_progress', null)).toBe(
			'Status: Open → In Progress'
		);
		expect(eventSummary('priority_changed', 'low', 'high', null)).toBe('Priority: Low → High');
		expect(eventSummary('assigned', null, 'u1', 'Adrian Cruz')).toBe('Assigned Adrian Cruz');
		expect(eventSummary('unassigned', null, 'u1', 'Bea Reyes')).toBe('Unassigned Bea Reyes');
	});

	it('falls back gracefully when the target user was removed', () => {
		expect(eventSummary('assigned', null, 'gone', null)).toBe('Assigned a former staff member');
	});
});

/**
 * Recording fake db: captures every insert tagged by table sentinel so we can assert the
 * event set a mutation produces. `select().…limit()` returns the queued "before" row (for the
 * priority/status diff reads); other builder calls no-op. transaction(fn) just runs fn(db).
 */
function fakeDb(before: unknown[] = []) {
	const inserts: { table: string; rows: unknown }[] = [];
	const db = {
		insert: (table: { __t: string }) => ({
			values: (rows: unknown) => {
				inserts.push({ table: table.__t, rows });
				const p = Promise.resolve(undefined) as Promise<unknown> & { returning: () => unknown };
				p.returning = () => Promise.resolve([{ id: 1 }]);
				return p;
			}
		}),
		update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
		delete: () => ({ where: () => Promise.resolve(undefined) }),
		select: () => ({
			from: () => ({
				// where() is awaitable (existing-assignee read) AND chainable via .limit() (before-row reads).
				where: () => {
					const r = Promise.resolve(before) as Promise<unknown> & { limit: () => unknown };
					r.limit = () => Promise.resolve(before);
					return r;
				}
			})
		}),
		transaction: (fn: (tx: unknown) => unknown) => fn(db)
	};
	return { db: db as unknown as DB, inserts };
}

const eventTypes = (inserts: { table: string; rows: unknown }[]): string[] =>
	inserts
		.filter((i) => i.table === 'event')
		.map((i) => (i.rows as { type: string }).type);

describe('createIssue events', () => {
	it('records a created event plus one assigned per initial assignee', async () => {
		const { db, inserts } = fakeDb();
		await createIssue(
			db,
			{
				title: 'AP down',
				description: null,
				priority: 'high',
				networkId: null, // null → apName short-circuits, no select needed
				dueDate: null,
				assigneeIds: ['u1', 'u2']
			},
			'mgr'
		);
		expect(eventTypes(inserts)).toEqual([
			ISSUE_EVENT.created,
			ISSUE_EVENT.assigned,
			ISSUE_EVENT.assigned
		]);
	});

	it('records only a created event when unassigned', async () => {
		const { db, inserts } = fakeDb();
		await createIssue(
			db,
			{ title: 'x', description: null, priority: 'low', networkId: null, dueDate: null, assigneeIds: [] },
			'mgr'
		);
		expect(eventTypes(inserts)).toEqual([ISSUE_EVENT.created]);
	});
});

describe('setIssueStatus events', () => {
	it('records a status_changed event when the status actually changes', async () => {
		const { db, inserts } = fakeDb([{ status: 'open' }]);
		await setIssueStatus(db, 1, 'in_progress', { actorId: 'mgr' });
		expect(eventTypes(inserts)).toEqual([ISSUE_EVENT.statusChanged]);
	});

	it('records nothing when the status is unchanged', async () => {
		const { db, inserts } = fakeDb([{ status: 'open' }]);
		await setIssueStatus(db, 1, 'open', { actorId: 'mgr' });
		expect(eventTypes(inserts)).toEqual([]);
	});
});

describe('createIssueFromSentry', () => {
	it('creates a sentry-sourced incident with the snapshot + created/assigned events', async () => {
		const { db, inserts } = fakeDb();
		await createIssueFromSentry(
			db,
			{ issueId: 'S1', shortId: 'RADIUS-ADMIN-3F', permalink: 'https://sentry.io/x', title: 'Boom' },
			{ title: 'Track boom', description: null, priority: 'high', networkId: null, dueDate: null, assigneeIds: ['u1'] },
			'mgr'
		);
		expect(eventTypes(inserts)).toEqual([ISSUE_EVENT.created, ISSUE_EVENT.assigned]);
		const issueInsert = inserts.find((i) => i.table === 'issue');
		expect(issueInsert?.rows).toMatchObject({
			source: 'sentry',
			sentryIssueId: 'S1',
			sentryShortId: 'RADIUS-ADMIN-3F',
			sentryPermalink: 'https://sentry.io/x',
			sentryTitle: 'Boom'
		});
	});
});

/**
 * takeIssue makes TWO distinct reads (status, then existing-assignee count), so the shared
 * fakeDb's single reused `before` can't model it. This bespoke fake returns a queued value per
 * successive select() call, letting us drive each branch of the pool invariant independently.
 */
function seqDb(reads: unknown[][]) {
	const inserts: { table: string; rows: unknown }[] = [];
	let call = 0;
	const db = {
		insert: (table: { __t: string }) => ({
			values: (rows: unknown) => {
				inserts.push({ table: table.__t, rows });
				return Promise.resolve(undefined);
			}
		}),
		select: () => {
			const val = reads[call++] ?? [];
			return {
				from: () => ({
					where: () => {
						const r = Promise.resolve(val) as Promise<unknown> & { limit: () => unknown };
						// .limit() is chainable via .for('update') (the locked before-row read in takeIssue).
						r.limit = () => {
							const p = Promise.resolve(val) as Promise<unknown> & { for: () => unknown };
							p.for = () => Promise.resolve(val);
							return p;
						};
						return r;
					}
				})
			};
		},
		transaction: (fn: (tx: unknown) => unknown) => fn(db)
	};
	return { db: db as unknown as DB, inserts };
}

describe('takeIssue', () => {
	it('claims an unassigned open incident: inserts an assignee + an assigned event', async () => {
		// read 0 = status row (open); read 1 = existing assignees (none)
		const { db, inserts } = seqDb([[{ status: 'open' }], []]);
		const ok = await takeIssue(db, 1, 'u9');
		expect(ok).toBe(true);
		expect(inserts.map((i) => i.table)).toEqual(['assignee', 'event']);
		const event = inserts.find((i) => i.table === 'event')!.rows as { type: string; toValue: string };
		expect(event.type).toBe(ISSUE_EVENT.assigned);
		expect(event.toValue).toBe('u9'); // self-assign
	});

	it('refuses (no writes) when the incident already has an assignee', async () => {
		const { db, inserts } = seqDb([[{ status: 'open' }], [{ adminUserId: 'someoneElse' }]]);
		expect(await takeIssue(db, 1, 'u9')).toBe(false);
		expect(inserts).toEqual([]);
	});

	it('refuses (no writes) when the incident is not open', async () => {
		const { db, inserts } = seqDb([[{ status: 'in_progress' }]]);
		expect(await takeIssue(db, 1, 'u9')).toBe(false);
		expect(inserts).toEqual([]);
	});
});

describe('updateIssue events', () => {
	it('records priority_changed + assignee diffs', async () => {
		// before-row: priority 'low', currently assigned to u1. Update to 'high', assignees [u2].
		const { db, inserts } = fakeDb([{ priority: 'low', adminUserId: 'u1' }]);
		await updateIssue(
			db,
			1,
			{ title: 't', description: null, priority: 'high', networkId: null, dueDate: null, assigneeIds: ['u2'] },
			'mgr'
		);
		// order: priority_changed, then unassigned(u1), then assigned(u2)
		expect(eventTypes(inserts)).toEqual([
			ISSUE_EVENT.priorityChanged,
			ISSUE_EVENT.unassigned,
			ISSUE_EVENT.assigned
		]);
	});
});
