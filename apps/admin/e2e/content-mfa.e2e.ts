/**
 * Per-save MFA on /content — pins the new step-up gate end-to-end on the simplest write
 * (Session Limits save, inline code field): a wrong TOTP is rejected, a valid one saves.
 * The server re-verifies the code on every content write, so this guards the whole section.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { OWNER_TOTP_SECRET_FILE } from './config';
import { totp } from './totp';

test('content save requires a valid TOTP (rejects a bad code, accepts a good one)', async ({
	page
}) => {
	await page.goto('/content/limits');

	// A 6-digit but wrong code passes the client gate, fails server step-up.
	await page.locator('#limits-code').fill('000000');
	await page.getByRole('button', { name: 'Save limits' }).click();
	await expect(page.getByRole('alert')).toContainText(/code/i);

	// A live code from the owner's enrolled secret saves.
	const secret = readFileSync(OWNER_TOTP_SECRET_FILE, 'utf8').trim();
	await page.locator('#limits-code').fill(totp(secret));
	await page.getByRole('button', { name: 'Save limits' }).click();
	// Specific text — getByRole('status') alone also matches the topbar live-pill.
	await expect(page.getByText('Saved. New limits are live.')).toBeVisible();
});
