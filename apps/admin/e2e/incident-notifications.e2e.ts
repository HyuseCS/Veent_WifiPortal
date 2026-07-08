/**
 * Phase 5 — incident notifications.
 *
 * The feed is watermark-derived: a staff member's unread items are notifiable timeline events on
 * incidents they're assigned to, done by someone else, newer than their `notifications_seen_at`.
 * As the seeded owner we: create an incident assigned to ourselves (our OWN 'assigned' event must
 * NOT notify us — self-exclusion), then simulate another admin acting on it (a status change by
 * adrian) and assert the bell + count light up, the dropdown lists it, and "Mark all read" clears
 * it (watermark bump). Assigning a second person also exercises the stub email path (no real send).
 */
import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { TEST_DATABASE_URL, OWNER_EMAIL } from './config';

const ADRIAN_EMAIL = 'adrian@veent.test';
const TITLE = `Notif probe ${Date.now()}`;

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

const issueIdByTitle = (title: string) =>
	withSql(async (sql) => {
		const rows = await sql<{ id: number }[]>`SELECT id FROM admin_issue WHERE title = ${title}`;
		return rows[0]?.id ?? null;
	});

/** Simulate a DIFFERENT admin acting on the incident (there's only one authenticated session in
 *  the harness, so we seed the "someone else did X" event directly). */
const insertEvent = (issueId: number, actorId: string, type: string, from: string, to: string) =>
	withSql(
		(sql) => sql`
			INSERT INTO admin_issue_event (issue_id, actor_id, type, from_value, to_value, created_at)
			VALUES (${issueId}, ${actorId}, ${type}, ${from}, ${to}, now())`
	);

test('assignee is notified of others’ activity; own action is silent; mark-all-read clears it', async ({
	page
}) => {
	const ownerId = (await userIdByEmail(OWNER_EMAIL))!;
	const adrianId = (await userIdByEmail(ADRIAN_EMAIL))!;

	await page.goto('/issues');

	// Create an incident assigned to the owner (self) AND adrian (exercises the stub email path).
	await page.getByRole('button', { name: 'New incident' }).click();
	const dlg = page.locator('dialog[open]');
	await dlg.getByLabel('Title').fill(TITLE);
	await dlg.locator(`input[name="assigneeId"][value="${ownerId}"]`).check();
	await dlg.locator(`input[name="assigneeId"][value="${adrianId}"]`).check();
	await dlg.getByRole('button', { name: 'Create issue' }).click();

	await expect.poll(() => issueIdByTitle(TITLE)).not.toBeNull();
	const id = (await issueIdByTitle(TITLE))!;

	// Self-exclusion: the owner's OWN 'assigned' event must not notify the owner → bell shows no count.
	await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();

	// Another admin (adrian) moves it to in_progress → now the owner (assignee, not the actor) has 1 unread.
	await insertEvent(id, adrianId, 'status_changed', 'open', 'in_progress');
	await page.reload();

	await expect(page.getByRole('button', { name: 'Notifications (1 unread)' })).toBeVisible();

	// The dropdown lists the incident.
	await page.getByRole('button', { name: 'Notifications (1 unread)' }).click();
	await expect(page.getByRole('menuitem', { name: new RegExp(TITLE) })).toBeVisible();

	// Mark all read bumps the watermark → count clears.
	await page.getByRole('button', { name: 'Mark all read' }).click();
	await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});
