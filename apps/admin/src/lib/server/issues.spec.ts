import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { type DB, adminUser, adminIssue, adminIssueAssignee } from '@veent/db';
import { listIssuesPage, ISSUES_PAGE_SIZE } from './issues';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, '../../../../../packages/db/drizzle');

let client: PGlite;
let db: DB;

type Seed = Partial<typeof adminIssue.$inferInsert> & { title: string };

const list = (args: { page: number; q?: string }) => listIssuesPage(db, args);

beforeAll(async () => {
	client = new PGlite();
	const raw = drizzle(client);
	await migrate(raw, { migrationsFolder: MIGRATIONS });
	db = raw as unknown as DB;
}, 60_000);

beforeEach(async () => {
	await client.exec('TRUNCATE "admin_issue", "admin_user" RESTART IDENTITY CASCADE;');
});

async function seedUser(id: string, name: string) {
	await db.insert(adminUser).values({ id, name, email: `${id}@example.test` });
}

async function seed(rows: Seed[]) {
	const t0 = Date.parse('2026-01-01T00:00:00Z');
	return db
		.insert(adminIssue)
		.values(rows.map((r, i) => ({ createdAt: new Date(t0 + i * 60_000), ...r })))
		.returning({ id: adminIssue.id });
}

const thirty = () => Array.from({ length: 30 }, (_, i) => ({ title: `Issue ${i}` }));

describe('listIssuesPage', () => {
	it('exports the page size', () => {
		expect(ISSUES_PAGE_SIZE).toBe(25);
	});

	it('splits 30 rows into 25 + 5 with no overlap', async () => {
		await seed(thirty());
		const p1 = await list({ page: 1 });
		const p2 = await list({ page: 2 });
		expect(p1.issues).toHaveLength(25);
		expect(p2.issues).toHaveLength(5);
		expect(p1.total).toBe(30);
		expect(p1.pageCount).toBe(2);
		const ids = [...p1.issues, ...p2.issues].map((i) => i.id);
		expect(new Set(ids).size).toBe(30);
	});

	it('orders in SQL: open/high before newer resolved/low across the page edge', async () => {
		await seed([
			...Array.from({ length: 10 }, (_, i) => ({
				title: `hot ${i}`,
				status: 'open',
				priority: 'high'
			})),
			...Array.from({ length: 20 }, (_, i) => ({
				title: `done ${i}`,
				status: 'resolved',
				priority: 'low'
			}))
		]);
		const p1 = await list({ page: 1 });
		expect(p1.issues.slice(0, 10).every((i) => i.status === 'open' && i.priority === 'high')).toBe(
			true
		);
		expect(p1.issues.slice(10).every((i) => i.status === 'resolved')).toBe(true);
	});

	it('q matches title, description, network_name and assignee name', async () => {
		await seedUser('u1', 'Zebediah Quux');
		const rows = await seed([
			{ title: 'alpha-needle one' },
			{ title: 'plain', description: 'has a Needle-desc inside' },
			{ title: 'plain2', networkName: 'AP-needle-net' },
			{ title: 'plain3' },
			{ title: 'unrelated' }
		]);
		await db.insert(adminIssueAssignee).values({ issueId: rows[3]!.id, adminUserId: 'u1' });

		for (const [q, n] of [
			['alpha-needle', 1],
			['needle-desc', 1],
			['ap-needle-net', 1],
			['zebediah', 1],
			['needle', 3]
		] as const) {
			const r = await list({ page: 1, q });
			expect(r.total, q).toBe(n);
			expect(r.issues, q).toHaveLength(n);
		}
		const none = await list({ page: 1, q: 'no-such-text' });
		expect(none.issues).toHaveLength(0);
		expect(none.total).toBe(0);
		expect(none.pageCount).toBe(1);
	});

	it('treats % and _ in q literally', async () => {
		await seed([{ title: '100% sure' }, { title: 'snake_case' }, { title: 'other' }]);
		const pct = await list({ page: 1, q: '%' });
		expect(pct.issues.map((i) => i.title)).toEqual(['100% sure']);
		const us = await list({ page: 1, q: '_' });
		expect(us.issues.map((i) => i.title)).toEqual(['snake_case']);
	});

	it('clamps a bad page and never errors or returns an empty page', async () => {
		await seed(thirty());
		for (const [page, want] of [
			[99, 2],
			[0, 1],
			[-3, 1],
			[NaN, 1]
		] as const) {
			const r = await list({ page });
			expect(r.page, String(page)).toBe(want);
			expect(r.issues.length, String(page)).toBeGreaterThan(0);
		}
	});

	it('keeps assignees on each returned row', async () => {
		await seedUser('u1', 'Ann');
		await seedUser('u2', 'Bob');
		const rows = await seed(thirty());
		await db.insert(adminIssueAssignee).values([
			{ issueId: rows[29]!.id, adminUserId: 'u1' },
			{ issueId: rows[29]!.id, adminUserId: 'u2' }
		]);
		const p1 = await list({ page: 1 });
		const row = p1.issues.find((i) => i.id === rows[29]!.id)!;
		expect(row.assignees).toHaveLength(2);
	});
});
