/**
 * Phase 2 — incident detail + comments.
 *
 * As the seeded owner (a manager, who may open any incident): create one on the board, follow its
 * title link to /issues/[id], confirm the detail renders with its timeline, post a comment and see
 * it land in that timeline, and confirm a non-existent id 404s (the same guard that hides
 * incidents a non-assignee isn't allowed to see).
 */
import { test, expect } from '@playwright/test';

const TITLE = `Detail probe ${Date.now()}`;
const COMMENT = `Investigating now ${Date.now()}`;

test('open an incident from the board, read its timeline, and comment', async ({ page }) => {
	await page.goto('/issues');

	// Create it on the board.
	await page.getByRole('button', { name: 'New incident' }).click();
	const dlg = page.locator('dialog[open]');
	await dlg.getByLabel('Title').fill(TITLE);
	await dlg.getByRole('button', { name: 'Create issue' }).click();

	// The board row's title is now a link into the detail page (Phase 2 reshape).
	await page.getByRole('link', { name: TITLE }).click();
	await expect(page).toHaveURL(/\/issues\/\d+$/);

	// Detail renders: heading + the create entry in the timeline.
	await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
	await expect(page.getByText('Created this incident')).toBeVisible();

	// Post a comment → it appears in the timeline (a 'comment' event with the body as its note).
	await page.getByLabel('Comment').fill(COMMENT);
	await page.getByRole('button', { name: 'Comment' }).click();
	await expect(page.getByText(COMMENT)).toBeVisible();
});

test('a non-existent incident 404s (same guard that scopes assignee access)', async ({ page }) => {
	const resp = await page.goto('/issues/99999999');
	expect(resp?.status()).toBe(404);
});
