/**
 * Governance flow 2 — demote an owner via the owner-change lifecycle.
 *
 * With exactly two owners, an owner targeting the *other* reaches unanimity the
 * instant they submit (the initiator's request counts as their sole required
 * approval), so the demotion executes immediately. Pins: the request action clears
 * its gates (name + TOTP step-up) and the target's role actually drops to `admin`,
 * exercising createRequest → evaluate → core executeOwnerChange end-to-end.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { OWNER_TOTP_SECRET_FILE, setStaffRole, staffRole } from './config';
import { totp } from './totp';

const TARGET_NAME = 'Adrian Admin';
const TARGET_EMAIL = 'adrian@veent.test';

test('owner demotes a second owner (immediate unanimity at 2 owners)', async ({ page }) => {
	// Precondition: make the target an owner so a 2-owner peer demote is possible.
	await setStaffRole(TARGET_EMAIL, 'owner');
	expect(await staffRole(TARGET_EMAIL)).toBe('owner');

	await page.goto('/staff');
	await page.getByRole('button', { name: `Demote or remove ${TARGET_NAME}` }).click();

	const secret = readFileSync(OWNER_TOTP_SECRET_FILE, 'utf8').trim();
	const dlg = page.locator('dialog[open]');
	await dlg.locator('input[name="action"][value="demote"]').check();
	await dlg.locator('input[name="confirmName"]').fill(TARGET_NAME);
	await dlg.locator('input[name="code"]').fill(totp(secret));
	await dlg.getByRole('button', { name: 'Request approval' }).click();

	// Unanimous at 2 owners → executes on submit; the target drops back to admin.
	await expect.poll(() => staffRole(TARGET_EMAIL)).toBe('admin');
});
