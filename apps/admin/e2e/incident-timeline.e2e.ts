/**
 * Phase 1 — incident audit timeline.
 *
 * Exercises the append-only history end-to-end as the seeded owner (a manager): creating an
 * incident writes a `created` event, a status change (made from the detail page) writes a
 * `status_changed` event, and both surface in the Timeline. Deleting the incident CASCADES its
 * events away (asserted straight against the test DB, since the row is gone from the UI).
 */
import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { TEST_DATABASE_URL } from './config';

const TITLE = `Timeline probe ${Date.now()}`;

/** The incident's id, looked up by its unique title (null once deleted). */
async function issueIdByTitle(title: string): Promise<number | null> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		const rows = await sql<{ id: number }[]>`SELECT id FROM admin_issue WHERE title = ${title}`;
		return rows[0]?.id ?? null;
	} finally {
		await sql.end();
	}
}

/** How many timeline events exist for one incident (proves create writes, delete cascades). */
async function eventCount(issueId: number): Promise<number> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		const rows = await sql<{ n: number }[]>`
			SELECT count(*)::int AS n FROM admin_issue_event WHERE issue_id = ${issueId}`;
		return rows[0]?.n ?? 0;
	} finally {
		await sql.end();
	}
}

test('incident timeline records create + status change, and cascades on delete', async ({
	page
}) => {
	await page.goto('/issues');

	// Create an incident through the manager dialog (defaults: priority medium, status open).
	await page.getByRole('button', { name: 'New incident' }).click();
	const dlg = page.locator('dialog[open]');
	await dlg.getByLabel('Title').fill(TITLE);
	await dlg.getByRole('button', { name: 'Create issue' }).click();

	// The created event exists in the DB the moment the transaction commits.
	await expect.poll(() => issueIdByTitle(TITLE)).not.toBeNull();
	const id = (await issueIdByTitle(TITLE))!;
	expect(await eventCount(id)).toBeGreaterThan(0);

	// Expand the incident's row → its Timeline shows the create entry.
	const row = page.getByRole('row', { name: new RegExp(TITLE) });
	await row.getByRole('button', { name: 'Expand issue details' }).click();
	await expect(page.getByText('Created this incident')).toBeVisible();

	// Status is changed from the detail page now (not inline on the board). Open the incident,
	// set In Progress → a status_changed entry appears in its History (newest-first, above "created").
	await page.goto(`/issues/${id}`);
	await page.getByLabel('Set status').selectOption('in_progress');
	await page.getByRole('button', { name: 'Update' }).click();
	await expect(page.getByText(/Status:.*In Progress/)).toBeVisible();

	// Back to the board to delete the incident → confirm → its events cascade away.
	await page.goto('/issues');
	await row.getByRole('button', { name: `Delete ${TITLE}` }).click();
	await page.getByRole('button', { name: `Confirm deleting ${TITLE}` }).click();
	await expect.poll(() => issueIdByTitle(TITLE)).toBeNull();
	expect(await eventCount(id)).toBe(0);
});
