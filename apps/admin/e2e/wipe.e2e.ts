/**
 * Governance flow 4 — the user-wipe step-up gate (non-destructive).
 *
 * The wipe is two-step: request a one-time code (emailed), then enter it. The real
 * code is in-memory on the server and not observable from a test in preview mode, so
 * this pins the SECURITY-CRITICAL property instead of the destructive happy path:
 * the wipe is rejected without a valid code. (The code issue/consume logic itself is
 * unit-level.) This keeps the seeded customers intact for any later spec.
 */
import { test, expect } from '@playwright/test';

test('wipe is rejected without a valid code', async ({ page }) => {
	await page.goto('/users');
	await page.getByRole('button', { name: 'Wipe database' }).click();

	const dlg = page.locator('dialog[open]');
	await dlg.getByRole('button', { name: 'Email me a code' }).click();

	// Step 2 appears…
	await expect(dlg.getByText('Code sent — check your email.')).toBeVisible();

	// …a bogus code is refused, and nothing is wiped.
	await dlg.locator('#wipe-code').fill('000000');
	await dlg.getByRole('button', { name: 'Wipe everything' }).click();
	await expect(dlg.getByText('Invalid or expired code.')).toBeVisible();
});
