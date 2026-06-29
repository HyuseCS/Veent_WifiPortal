/**
 * Governance flow 3 — owner invites a new staff member.
 *
 * Pins: the owner-only invite form creates a `pending` admin_profile for the invited
 * email (the activation gate), and the UI confirms the send. Regression net for the
 * invite action / AddStaffForm.
 */
import { test, expect } from '@playwright/test';
import { staffByEmail } from './config';

const NEW_NAME = 'New Hire';
const NEW_EMAIL = 'newhire@veent.test';

test('owner invites a new admin (creates a pending account)', async ({ page }) => {
	expect(await staffByEmail(NEW_EMAIL)).toBeNull(); // not seeded

	await page.goto('/staff');
	await page.getByRole('button', { name: 'Add staff' }).click();

	const dlg = page.locator('dialog[open]');
	await dlg.locator('input[name="name"]').first().fill(NEW_NAME);
	await dlg.locator('input[name="email"]').first().fill(NEW_EMAIL);
	await dlg.locator('button[type="submit"]').click();

	// UI confirms, and a pending account now exists for the invitee.
	await expect(dlg.getByRole('status')).toContainText('Sent 1 invitation');
	await expect.poll(() => staffByEmail(NEW_EMAIL).then((s) => s?.status)).toBe('pending');
});

test('dialog returns focus to its trigger on close (BaseDialog a11y #3)', async ({ page }) => {
	await page.goto('/staff');
	const trigger = page.getByRole('button', { name: 'Add staff' });
	await trigger.click();
	await expect(page.locator('dialog[open]')).toBeVisible();

	// Esc closes the modal; focus must land back on the control that opened it.
	await page.keyboard.press('Escape');
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(trigger).toBeFocused();
});
