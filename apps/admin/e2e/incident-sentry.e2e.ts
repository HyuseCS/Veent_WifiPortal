/**
 * Phase 4 — Sentry → incident.
 *
 * A manager tracks a Sentry error as an assigned incident: source='sentry', the four Sentry fields
 * snapshotted, the assignee attached. The Sentry API is unconfigured in the test env (no token), so
 * the tracking *dialog* has no live issues to open — but the ?/track action doesn't depend on Sentry
 * being configured, so we drive it via an authenticated form POST and assert the DB outcome. (The
 * dialog UI is covered by typecheck + the human browser pass.)
 */
import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { TEST_DATABASE_URL, TEST_ORIGIN } from './config';

const ADRIAN_EMAIL = 'adrian@veent.test';
const SENTRY_ID = `S-e2e-${Date.now()}`;

async function withSql<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		return await fn(sql);
	} finally {
		await sql.end();
	}
}

const userIdByEmail = (email: string) =>
	withSql(async (sql) => {
		const rows = await sql<{ id: string }[]>`SELECT id FROM admin_user WHERE email = ${email}`;
		return rows[0]?.id ?? null;
	});

const trackedIncident = (sentryIssueId: string) =>
	withSql(async (sql) => {
		const rows = await sql<
			{ id: number; source: string; short_id: string; permalink: string; title: string }[]
		>`SELECT id, source, sentry_short_id AS short_id, sentry_permalink AS permalink, sentry_title AS title
		  FROM admin_issue WHERE sentry_issue_id = ${sentryIssueId}`;
		return rows[0] ?? null;
	});

const assigneeCount = (issueId: number) =>
	withSql(async (sql) => {
		const rows = await sql<{ n: number }[]>`
			SELECT count(*)::int AS n FROM admin_issue_assignee WHERE issue_id = ${issueId}`;
		return rows[0]?.n ?? 0;
	});

test('a manager tracks a Sentry error as an assigned, source=sentry incident', async ({ page }) => {
	const adrianId = (await userIdByEmail(ADRIAN_EMAIL))!;

	// Land on the app first so page.request carries the authenticated owner cookies.
	await page.goto('/sentry');

	const resp = await page.request.post('/sentry?/track', {
		headers: { origin: TEST_ORIGIN }, // satisfy SvelteKit's form-POST CSRF origin check
		form: {
			sentryIssueId: SENTRY_ID,
			sentryShortId: 'RADIUS-ADMIN-E2E',
			sentryPermalink: 'https://sentry.io/e2e',
			sentryTitle: 'TypeError: e2e boom',
			'issue-title': 'Investigate e2e boom',
			'issue-priority': 'high',
			assigneeId: adrianId
		}
	});
	expect(resp.ok()).toBeTruthy();

	const row = await trackedIncident(SENTRY_ID);
	expect(row).not.toBeNull();
	expect(row!.source).toBe('sentry');
	expect(row!.short_id).toBe('RADIUS-ADMIN-E2E');
	expect(row!.permalink).toBe('https://sentry.io/e2e');
	expect(row!.title).toBe('TypeError: e2e boom');
	expect(await assigneeCount(row!.id)).toBe(1); // adrian attached
});
