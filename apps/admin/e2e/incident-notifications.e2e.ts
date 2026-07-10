/**
 * Phase 5 — incident notifications.
 *
 * The feed uses a per-event read model: a staff member's unread items are notifiable timeline
 * events on incidents they're assigned to (from their assignment onward), done by someone else,
 * with NO `admin_notification_read` row for that (user, event). Reading marks individual events by
 * inserting a read row; "Mark all read" inserts a read row for every currently-unread event.
 * As the seeded owner we: create an incident assigned to ourselves (our OWN 'assigned' event must
 * NOT notify us — self-exclusion), then simulate another admin acting on it (a status change by
 * adrian) and assert the bell + count light up, the dropdown lists it, and "Mark all read" clears
 * it (a read row per event). Assigning a second person also exercises the stub email path (no real send).
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
	await dlg.getByRole('button', { name: 'Create incident' }).click();

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

	// Following the item deep-links to the detail page — and the bell must still work there
	// (its list comes from the shared /issues layout load, not the index page).
	await page.getByRole('menuitem', { name: new RegExp(TITLE) }).click();
	await expect(page).toHaveURL(/\/issues\/\d+$/);
	await expect(page.getByRole('button', { name: 'Notifications (1 unread)' })).toBeVisible();
	await page.getByRole('button', { name: 'Notifications (1 unread)' }).click();
	await expect(page.getByRole('menuitem', { name: new RegExp(TITLE) })).toBeVisible();

	// Mark all read records read rows for every unread item → count clears (from the detail page too).
	await page.getByRole('button', { name: 'Mark all read' }).click();
	await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});

test('mark a single notification done, and browse read + unread in the history', async ({ page }) => {
	const ownerId = (await userIdByEmail(OWNER_EMAIL))!;
	const adrianId = (await userIdByEmail(ADRIAN_EMAIL))!;
	const TITLE2 = `Notif entry ${Date.now()}`;

	await page.goto('/issues');
	await page.getByRole('button', { name: 'New incident' }).click();
	const dlg = page.locator('dialog[open]');
	await dlg.getByLabel('Title').fill(TITLE2);
	await dlg.locator(`input[name="assigneeId"][value="${ownerId}"]`).check();
	await dlg.getByRole('button', { name: 'Create incident' }).click();
	await expect.poll(() => issueIdByTitle(TITLE2)).not.toBeNull();
	const id = (await issueIdByTitle(TITLE2))!;

	// Two events by another admin → two unread for the owner.
	await insertEvent(id, adrianId, 'status_changed', 'open', 'in_progress');
	await insertEvent(id, adrianId, 'priority_changed', 'medium', 'high');
	await page.reload();
	await expect(page.getByRole('button', { name: 'Notifications (2 unread)' })).toBeVisible();

	// Mark ONE done from the dropdown (the button doesn't close it) → count drops to 1.
	await page.getByRole('button', { name: 'Notifications (2 unread)' }).click();
	await page.getByRole('button', { name: 'Mark this notification as read' }).first().click();
	await expect(page.getByRole('button', { name: 'Notifications (1 unread)' })).toBeVisible();

	// History shows read + unread — at least one Read label, and the remaining unread is markable.
	// (The history spans all the owner's incidents, so earlier read items appear too — hence .first().)
	await page.goto('/issues/notifications');
	await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
	await expect(page.getByText('Read', { exact: true }).first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Mark this notification as read' })).toHaveCount(1);

	// Mark all read from the history → nothing left to mark, bell clears.
	await page.getByRole('button', { name: 'Mark all read' }).click();
	await expect(page.getByRole('button', { name: 'Mark this notification as read' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});
