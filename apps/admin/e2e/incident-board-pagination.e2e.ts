/**
 * Manager board pagination (#99). With 26 incidents seeded: page 1 shows 25 rows and the range
 * footer, Next goes to ?page=2 (1 row), typing in search sets ?q= and drops page, reload keeps both.
 */
import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { TEST_DATABASE_URL } from './config';

const ROWS = 'tr:has(a[href^="/issues/"])';

test.beforeAll(async () => {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		await sql`DELETE FROM admin_issue`;
		for (let i = 1; i <= 26; i++) {
			const n = String(i).padStart(2, '0');
			await sql`
				INSERT INTO admin_issue (title, status, source, created_at)
				VALUES (${`Pager probe ${n}`}, 'open', 'human', now() - make_interval(mins => ${i}))
			`;
		}
	} finally {
		await sql.end();
	}
});

test.afterAll(async () => {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		await sql`DELETE FROM admin_issue WHERE title LIKE 'Pager probe %'`;
	} finally {
		await sql.end();
	}
});

test('board pages 25 at a time, Next goes to page 2, search resets page, reload keeps state', async ({
	page
}) => {
	await page.goto('/issues');
	await expect(page.locator(ROWS)).toHaveCount(25);
	await expect(page.getByText('Showing 1-25 of 26 incidents')).toBeVisible();

	await page.getByRole('link', { name: 'Next' }).click();
	await expect(page).toHaveURL(/[?&]page=2(&|$)/);
	await expect(page.locator(ROWS)).toHaveCount(1);
	await expect(page.getByText('Showing 26-26 of 26 incidents')).toBeVisible();

	await page.getByLabel('Search incidents').fill('probe 1');
	await expect(page).toHaveURL(/[?&]q=probe(\+|%20)1(&|$)/);
	expect(new URL(page.url()).searchParams.has('page')).toBe(false);
	await expect(page.locator(ROWS)).toHaveCount(10);

	await page.reload();
	expect(new URL(page.url()).searchParams.get('q')).toBe('probe 1');
	await expect(page.getByLabel('Search incidents')).toHaveValue('probe 1');
	await expect(page.locator(ROWS)).toHaveCount(10);
});
