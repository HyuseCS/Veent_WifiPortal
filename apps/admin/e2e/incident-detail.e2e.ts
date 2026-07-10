/**
 * Phase 2 — incident detail + comments.
 *
 * As the seeded owner (a manager, who may open any incident): create one on the board, follow its
 * title link to /issues/[id], confirm the detail renders with its timeline, post a comment and see
 * it land in that timeline, and confirm a non-existent id 404s (the same guard that hides
 * incidents a non-assignee isn't allowed to see).
 */
import { test, expect, chromium, type Page } from '@playwright/test';
import postgres from 'postgres';
import { STAFF_PASSWORD, TEST_DATABASE_URL, TEST_ORIGIN } from './config';
import { totp } from './totp';

const TITLE = `Detail probe ${Date.now()}`;
const COMMENT = `Investigating now ${Date.now()}`;

/** admin_user.id for a seeded staff email (throwaway test DB). */
async function userId(email: string): Promise<string> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		const [row] = await sql<{ id: string }[]>`SELECT id FROM admin_user WHERE email = ${email}`;
		return row!.id;
	} finally {
		await sql.end();
	}
}

/** Insert a resolved, UNASSIGNED incident straight into the test DB; return its id. */
async function seedResolvedUnassignedIssue(title: string): Promise<number> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		const [row] = await sql<{ id: number }[]>`
			INSERT INTO admin_issue (title, status, source) VALUES (${title}, 'resolved', 'human') RETURNING id
		`;
		return row!.id;
	} finally {
		await sql.end();
	}
}

async function assign(issueId: number, adminUserId: string): Promise<void> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		await sql`INSERT INTO admin_issue_assignee (issue_id, admin_user_id) VALUES (${issueId}, ${adminUserId})`;
	} finally {
		await sql.end();
	}
}

/**
 * Sign a seeded NON-manager staff member (role 'admin') in through the live preview server,
 * driving the mandatory first-login 2FA enrollment, and return an authenticated page. The suite's
 * shared storageState is the owner (a manager) — M3 needs a non-manager to exercise the pool path.
 */
async function loginNonManager(email: string): Promise<Page> {
	const browser = await chromium.launch();
	const page = await browser.newPage({ baseURL: TEST_ORIGIN });
	await page.goto('/login');
	await page.fill('input[name="email"]', email);
	await page.fill('input[name="password"]', STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign In' }).click();
	await page.waitForURL('**/enroll-2fa');
	await page.fill('input[name="password"]', STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Continue' }).click();
	const secret = (await page.locator('span.font-mono.select-all').innerText()).trim();
	await page.locator('input[type="checkbox"]').check();
	await page.fill('input[name="code"]', totp(secret));
	await page.getByRole('button', { name: 'Verify & finish' }).click();
	await page.waitForURL('**/dashboard');
	return page;
}

test('open an incident from the board, read its timeline, and comment', async ({ page }) => {
	await page.goto('/issues');

	// Create it on the board.
	await page.getByRole('button', { name: 'New incident' }).click();
	const dlg = page.locator('dialog[open]');
	await dlg.getByLabel('Title').fill(TITLE);
	await dlg.getByRole('button', { name: 'Create incident' }).click();

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

/**
 * M3 — a RESOLVED, unassigned incident is NOT in the open pool, so it must 404 to a non-manager,
 * non-assignee staff member on the detail endpoint (only OPEN + unassigned is the shared pool).
 * Once that same staff member is assigned to it, it becomes readable (200). Runs as a seeded
 * non-manager admin (adrian), since the suite's owner session is a manager and bypasses the pool
 * check entirely.
 */
test('M3: resolved+unassigned incident is 404 to a non-assignee, readable once assigned', async () => {
	const email = 'adrian@veent.test';
	const issueId = await seedResolvedUnassignedIssue(`M3 pool probe ${Date.now()}`);
	const page = await loginNonManager(email);
	try {
		// Non-manager, NOT assigned, incident is resolved → not a pool item → 404.
		const before = await page.request.get(`/issues/${issueId}/detail`);
		expect(before.status()).toBe(404);

		// Assign this staff member → now readable (assignee path, independent of status).
		await assign(issueId, await userId(email));
		const after = await page.request.get(`/issues/${issueId}/detail`);
		expect(after.status()).toBe(200);
	} finally {
		await page.context().browser()?.close();
	}
});
