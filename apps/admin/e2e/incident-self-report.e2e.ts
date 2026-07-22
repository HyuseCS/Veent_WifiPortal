/**
 * Self-report tile (?/selfReport) — the path any signed-in staff member (not just a manager) uses
 * to flag something they noticed.
 *
 * The load-bearing property is a SECURITY one: `+page.server.ts` overwrites `assigneeIds = []`
 * unconditionally, so this path can never smuggle an assignment through — not even from a hostile
 * client that hand-crafts the POST. The UI can't prove that (canAssign={false} means an honest
 * submission has no assignee field to begin with), so the first test bypasses the DOM entirely and
 * POSTs the form action directly with an `assigneeId` appended.
 *
 * That raw POST must carry an explicit `Origin` header: SvelteKit's CSRF guard 403s any
 * form-content-type POST with a missing/mismatched Origin, and a CSRF-rejected request creates zero
 * assignee rows — indistinguishable from a correct discard. Hence the mandatory "did this actually
 * reach the action" pre-assertion before any discard assertion runs.
 *
 * Runs as a seeded NON-manager (cleo) — the suite's banked session is the owner, a manager, who
 * takes a different code path. cleo (not bea) deliberately: finance-export.e2e.ts depends on bea
 * staying un-enrolled in 2FA, and logging in here would permanently enroll her.
 */
import { test, expect, chromium, type Page } from '@playwright/test';
import postgres from 'postgres';
import { STAFF_PASSWORD, TEST_DATABASE_URL, TEST_ORIGIN } from './config';
import { totp } from './totp';

const REPORTER_EMAIL = 'cleo@veent.test';
const OWNER_ID_EMAIL = 'owner@veent.test';
const TITLE = `Self-report probe ${Date.now()}`;

async function withSql<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		return await fn(sql);
	} finally {
		await sql.end();
	}
}

// Duplicated locally rather than imported: neither incident-notifications.e2e.ts's helpers nor
// incident-detail.e2e.ts's loginNonManager are exported, and extracting a shared helpers module is
// a separate refactor (out of this spec's blast radius).
const userIdByEmail = (email: string) =>
	withSql(async (sql) => {
		const rows = await sql<{ id: string }[]>`SELECT id FROM admin_user WHERE email = ${email}`;
		return rows[0]?.id ?? null;
	});

const issueIdByTitle = (title: string) =>
	withSql(async (sql) => {
		const rows = await sql<{ id: number }[]>`SELECT id FROM admin_issue WHERE title = ${title}`;
		return rows[0]?.id ?? null;
	});

const assigneesOf = (issueId: number) =>
	withSql(
		(sql) =>
			sql<
				{ admin_user_id: string }[]
			>`SELECT admin_user_id FROM admin_issue_assignee WHERE issue_id = ${issueId}`
	);

const eventsOf = (issueId: number) =>
	withSql(
		(sql) =>
			sql<
				{ type: string; actor_id: string | null }[]
			>`SELECT type, actor_id FROM admin_issue_event WHERE issue_id = ${issueId}`
	);

/**
 * Sign a seeded NON-manager in through the live preview server, driving mandatory first-login 2FA
 * enrollment, and return an authenticated page. The explicit empty storageState matters: contexts
 * created inside a test body otherwise inherit the project-level banked owner session.
 */
async function loginNonManager(email: string): Promise<Page> {
	const browser = await chromium.launch();
	const context = await browser.newContext({
		baseURL: TEST_ORIGIN,
		storageState: { cookies: [], origins: [] }
	});
	const page = await context.newPage();
	try {
		await page.goto('/login');
		await expect(page).toHaveURL(/\/login$/); // fail fast if auth state leaked in
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
	} catch (e) {
		await browser.close();
		throw e;
	}
}

/** POST a form action as the signed-in reporter, JSON-result style (x-sveltekit-action), with the
 *  Origin header SvelteKit's CSRF guard requires on a raw (non-browser-form) submission. */
function postSelfReport(reporter: Page, form: Record<string, string | string[]>) {
	return reporter.request.post('/issues?/selfReport', {
		headers: { origin: TEST_ORIGIN, 'x-sveltekit-action': 'true' },
		form
	});
}

test.describe.serial('self-report tile', () => {
	let reporter: Page;
	let reporterId: string;
	let ownerId: string;

	test.beforeAll(async () => {
		reporterId = (await userIdByEmail(REPORTER_EMAIL))!;
		ownerId = (await userIdByEmail(OWNER_ID_EMAIL))!;
		reporter = await loginNonManager(REPORTER_EMAIL);
	});

	test.afterAll(async () => {
		await reporter?.context().browser()?.close();
	});

	test('a tampered self-report POST cannot smuggle an assignee', async ({ page }) => {
		// The ONLY create action for this test: a hand-crafted POST with an assigneeId the UI could
		// never send (canAssign={false} renders no assignee field at all).
		const res = await postSelfReport(reporter, {
			'issue-title': TITLE,
			'issue-description': 'Raw POST with a smuggled assigneeId',
			'issue-priority': 'medium',
			assigneeId: ownerId
		});

		// MANDATORY pre-assertion — prove the request actually reached the action. A CSRF rejection
		// (403) also yields zero assignee rows, so without this the discard assertion below would
		// pass for entirely the wrong reason.
		expect(res.status()).not.toBe(403);
		const body = (await res.json()) as { type: string; status?: number };
		expect(body.type).toBe('success');

		await expect.poll(() => issueIdByTitle(TITLE)).not.toBeNull();
		const id = (await issueIdByTitle(TITLE))!;

		// The security property: the posted assigneeId was discarded server-side.
		expect(await assigneesOf(id)).toHaveLength(0);

		// …and it landed in the shared Open pool rather than being silently assigned: absent from the
		// reporter's own "My Issues", present on the manager's board.
		await reporter.goto('/issues');
		await expect(reporter.getByText(TITLE)).toHaveCount(0);
		await reporter.getByRole('button', { name: /^Open/ }).first().click();
		await expect(reporter.getByRole('button', { name: TITLE })).toBeVisible();

		await page.goto('/issues');
		await expect(page.getByRole('link', { name: TITLE })).toBeVisible();
	});

	test('the audit trail records exactly one created event and no assignment', async () => {
		const id = (await issueIdByTitle(TITLE))!;
		const events = await eventsOf(id);

		const created = events.filter((e) => e.type === 'created');
		expect(created).toHaveLength(1);
		expect(created[0]!.actor_id).toBe(reporterId);
		// No `assigned` event — createIssue only emits one when assigneeIds is non-empty, so this is
		// the second, independent witness that the override fired.
		expect(events.filter((e) => e.type === 'assigned')).toHaveLength(0);
	});

	test('the self-report form hides the assignment fieldset (canAssign=false)', async () => {
		await reporter.goto('/issues');
		await reporter.getByRole('button', { name: 'Report an issue' }).click();
		const dlg = reporter.locator('dialog[open]');
		await expect(dlg).toBeVisible();

		// Scoped to the dialog so unrelated "Assign to" text elsewhere can't mask a regression.
		await expect(dlg.getByText('Assign to')).toHaveCount(0);
		await expect(dlg.getByText('reported unassigned')).toBeVisible();
		// It posts to the self-report action, not the manager create action.
		await expect(dlg.locator('form[action="?/selfReport"]')).toHaveCount(1);
	});

	test('an invalid self-report is rejected by the server-side validator', async () => {
		// The title input is `required`, so the DOM can't produce this — post it directly.
		const res = await postSelfReport(reporter, {
			'issue-title': '   ',
			'issue-priority': 'medium'
		});

		expect(res.status()).not.toBe(403); // reached the action, not the CSRF guard
		const body = (await res.json()) as { type: string; status: number; data: string };
		expect(body.type).toBe('failure');
		expect(body.status).toBe(400);
		expect(body.data).toContain('Title is required.');
	});
});
